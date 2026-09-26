import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from entre_erp.caixa import apagar_reforcos_do_plano, sincronizar_reforcos
from entre_erp.pagamentos import (
	ESTADO_PAGO,
	ESTADO_PARCIAL,
	ESTADO_PROXIMO_MES,
	ESTADOS_FORA_DO_MES,
	bloqueio_do_mes_anterior,
	linha_por_liquidar,
	mes_anterior,
	mes_seguinte,
	nome_plano,
	valor_pago_da_linha,
)


class PlanodePagamentos(Document):
	def autoname(self):
		self.name = nome_plano(self.tipo, self.ano, self.mes)

	def validate(self):
		self._validar_periodo()
		self._validar_duplicado()
		self.titulo = f"{self.mes} {self.ano}" if self.tipo == "Mensal" else f"Investimentos {self.ano}"
		self._preencher_linhas()
		self._calcular_totais()
		self._validar_mes_anterior_liquidado()
		self._fechar_quando_liquidado()
		self._validar_fecho()

	def on_update(self):
		self._sincronizar_proximo_mes()
		sincronizar_reforcos(self)

	def on_trash(self):
		apagar_reforcos_do_plano(self)

	# ------------------------------------------------------------------
	# Buttons (plano_de_pagamentos.js)
	# ------------------------------------------------------------------

	@frappe.whitelist()
	def copiar_despesas_recorrentes(self):
		adicionadas = self.adicionar_despesas_recorrentes()
		self.save()
		return adicionadas

	# ------------------------------------------------------------------
	# Also used by the monthly scheduler and plan creation
	# (entre_erp.pagamentos) and by the automatic Próximo Mês move
	# ------------------------------------------------------------------

	def adicionar_despesas_recorrentes(self):
		"""Adds every active Despesa Recorrente not already in this plan."""
		ja_no_plano = {row.despesa_recorrente for row in self.linhas if row.despesa_recorrente}
		despesas = frappe.get_all(
			"Despesa Recorrente",
			filters={"ativo": 1},
			fields=[
				"name",
				"categoria",
				"fornecedor",
				"valor_padrao",
				"prioridade",
				"metodo_pagamento",
				"referencia",
			],
			order_by="prioridade asc, despesa asc",
		)

		adicionadas = 0
		for d in despesas:
			if d.name in ja_no_plano:
				continue
			self.append(
				"linhas",
				{
					"descricao": d.name,
					"despesa_recorrente": d.name,
					"categoria": d.categoria,
					"fornecedor": d.fornecedor,
					"valor": d.valor_padrao,
					"prioridade": d.prioridade,
					"metodo_pagamento": d.metodo_pagamento,
					"observacoes": d.referencia,
					"estado": "Pendente",
				},
			)
			adicionadas += 1
		return adicionadas

	def adicionar_linhas_proximo_mes(self):
		"""Brings over last month's lines marked Próximo Mês (only what was
		left unpaid). Lines already brought over are skipped."""
		if self.tipo != "Mensal":
			return 0

		ano, mes = mes_anterior(self.ano, self.mes)
		anterior = nome_plano("Mensal", ano, mes)
		if not frappe.db.exists("Plano de Pagamentos", anterior):
			return 0

		ja_transportadas = {row.linha_origem for row in self.linhas if row.linha_origem}
		adicionadas = 0
		for row in frappe.get_doc("Plano de Pagamentos", anterior).linhas:
			if row.estado != ESTADO_PROXIMO_MES or row.name in ja_transportadas:
				continue
			self.append("linhas", {**_dados_da_copia(row), "estado": "Pendente", "linha_origem": row.name})
			adicionadas += 1
		return adicionadas

	# ------------------------------------------------------------------
	# Private
	# ------------------------------------------------------------------

	def _linhas_por_liquidar(self, linhas=None):
		return [r for r in (self.linhas if linhas is None else linhas) if linha_por_liquidar(r)]

	def _validar_mes_anterior_liquidado(self):
		if self.tipo != "Mensal" or self.flags.ignorar_bloqueio:
			return
		bloqueio = bloqueio_do_mes_anterior(self.ano, self.mes)
		if bloqueio:
			frappe.throw(
				_(
					"{0} ainda tem {1} pagamento(s) por liquidar ({2}). Pague, cancele ou mova-os para "
					"Próximo Mês antes de trabalhar em {3}."
				).format(
					frappe.bold(bloqueio["titulo"]),
					bloqueio["pendentes"],
					frappe.format_value(bloqueio["valor"], {"fieldtype": "Currency"}),
					self.titulo,
				),
				title=_("Mês anterior por liquidar"),
			)

	def _fechar_quando_liquidado(self):
		"""Closes a month the moment its last line gets settled. Only on that
		change, so a month reopened on purpose (to add a late bill) is not
		closed again until something new in it gets settled."""
		if self.tipo != "Mensal" or self.estado == "Fechado" or not self.linhas:
			return
		if self._linhas_por_liquidar():
			return
		antes = self.get_doc_before_save()
		if not antes or not self._linhas_por_liquidar(antes.linhas):
			return
		self.estado = "Fechado"
		self.flags.fechado_automaticamente = True

	def _validar_fecho(self):
		if self.estado != "Fechado":
			return
		por_liquidar = self._linhas_por_liquidar()
		if por_liquidar:
			frappe.throw(
				_("Não pode fechar {0}: ainda há {1} linha(s) por liquidar ({2}).").format(
					self.titulo,
					len(por_liquidar),
					", ".join(r.descricao for r in por_liquidar[:5]) + ("…" if len(por_liquidar) > 5 else ""),
				),
				title=_("Plano por liquidar"),
			)

	def _sincronizar_proximo_mes(self):
		"""A line set to Próximo Mês moves (what is left unpaid) to next
		month's plan, creating that plan if needed. While the copy is
		untouched there (Pendente, nothing paid) it follows edits made here;
		undoing Próximo Mês takes it back out. What happened is left in
		`flags.transporte` for the Cashflow page."""
		self.flags.transporte = None
		if self.tipo != "Mensal" or self.flags.sem_transporte:
			return

		marcadas = {r.name: r for r in self.linhas if r.estado == ESTADO_PROXIMO_MES}
		antes = self.get_doc_before_save()
		desmarcadas = {
			r.name for r in (antes.linhas if antes else []) if r.estado == ESTADO_PROXIMO_MES
		} - set(marcadas)
		if not marcadas and not desmarcadas:
			return

		ano, mes = mes_seguinte(self.ano, self.mes)
		nome = nome_plano("Mensal", ano, mes)
		existe = bool(frappe.db.exists("Plano de Pagamentos", nome))
		if not existe and not marcadas:
			return

		if existe:
			destino = frappe.get_doc("Plano de Pagamentos", nome)
		else:
			destino = frappe.get_doc({"doctype": "Plano de Pagamentos", "tipo": "Mensal", "ano": ano, "mes": mes})
			destino.adicionar_despesas_recorrentes()

		copias = {r.linha_origem: r for r in destino.linhas if r.linha_origem}
		titulo_destino = f"{mes} {ano}"

		removidas = 0
		for origem in desmarcadas:
			copia = copias.get(origem)
			if not copia:
				continue
			if copia.estado != "Pendente" or flt(copia.valor_pago):
				frappe.throw(
					_("{0} já foi mexida em {1} ({2}). Trate-a lá antes de a tirar de Próximo Mês.").format(
						frappe.bold(copia.descricao), titulo_destino, copia.estado
					)
				)
			destino.remove(copia)
			removidas += 1

		alteradas = 0
		for origem, row in marcadas.items():
			copia = copias.get(origem)
			if not copia or copia.estado != "Pendente" or flt(copia.valor_pago):
				continue
			for campo, valor in _dados_da_copia(row).items():
				if (copia.get(campo) or None) != (valor or None):
					copia.set(campo, valor)
					alteradas += 1

		adicionadas = destino.adicionar_linhas_proximo_mes()

		if not (adicionadas or removidas or alteradas or not existe):
			return
		if destino.estado == "Fechado":
			frappe.throw(
				_("O plano de {0} está Fechado — reabra-o para mover linhas para lá.").format(titulo_destino)
			)

		# Moving lines is how this month gets settled, so it must work even
		# though next month is still locked by this one.
		destino.flags.ignorar_bloqueio = True
		if existe:
			destino.save()
		else:
			destino.insert()

		if adicionadas or removidas or not existe:
			self.flags.transporte = {
				"plano": destino.name,
				"ano": ano,
				"mes": mes,
				"adicionadas": adicionadas,
				"removidas": removidas,
				"criado": not existe,
			}

	def _validar_periodo(self):
		if not (2000 <= (self.ano or 0) <= 2100):
			frappe.throw(_("Ano inválido."))
		if self.tipo == "Mensal" and not self.mes:
			frappe.throw(_("Indique o Mês do plano."))
		if self.tipo == "Investimentos":
			self.mes = None

	def _validar_duplicado(self):
		if not self.is_new():
			return
		nome = nome_plano(self.tipo, self.ano, self.mes)
		if frappe.db.exists("Plano de Pagamentos", nome):
			frappe.throw(
				_("Já existe um plano para este período: {0}").format(
					frappe.utils.get_link_to_form("Plano de Pagamentos", nome)
				),
				title=_("Plano duplicado"),
			)

	def _preencher_linhas(self):
		antes = self.get_doc_before_save()
		estado_antes = {r.name: r.estado for r in (antes.linhas if antes else [])}
		for row in self.linhas:
			self._preencher_da_factura(row)
			row.valor_pago = valor_pago_da_linha(row)
			if row.despesa_recorrente and not row.categoria:
				row.categoria = frappe.db.get_value("Despesa Recorrente", row.despesa_recorrente, "categoria")
			self._registar_pagamento(row, estado_antes.get(row.name))

	def _preencher_da_factura(self, row):
		"""Supplier always follows the linked Purchase Invoice; the amount
		only when the line has none yet (a plan may pay part of an invoice)."""
		if not row.factura or (row.fornecedor and flt(row.valor)):
			return
		factura = frappe.db.get_value(
			"Purchase Invoice", row.factura, ["supplier", "base_grand_total"], as_dict=True
		)
		if not factura:
			return
		row.fornecedor = row.fornecedor or factura.supplier
		if not flt(row.valor):
			row.valor = factura.base_grand_total

	def _registar_pagamento(self, row, estado_antes):
		"""Stamps "Pago em" with today (editable) the moment a line becomes
		Pago / Parcialmente Pago; clears it when the line goes back to
		unpaid. Imported lines keep an empty date — it isn't known."""
		pagos = (ESTADO_PAGO, ESTADO_PARCIAL)
		if row.estado not in pagos:
			if not flt(row.valor_pago):
				row.data_pagamento = None
			return
		if estado_antes in pagos or self.flags.importacao:
			return
		row.data_pagamento = row.data_pagamento or frappe.utils.today()

	def _calcular_totais(self):
		"""Mirrors the spreadsheet: Previsto / Pago / Remanescente, plus the
		pending-vs-paid split per bank. A Próximo Mês or Cancelado line only
		counts for what was paid this month — the rest belongs to next
		month's plan, or isn't paid at all."""
		previsto = pago = remanescente = 0.0
		por_metodo = {}

		for row in self.linhas:
			valor, valor_pago = flt(row.valor), flt(row.valor_pago)
			if row.estado in ESTADOS_FORA_DO_MES:
				previsto_linha, pendente = valor_pago, 0.0
			else:
				previsto_linha = valor
				pendente = 0.0 if row.estado == ESTADO_PAGO else max(valor - valor_pago, 0.0)

			previsto += previsto_linha
			pago += valor_pago
			remanescente += pendente

			metodo = por_metodo.setdefault(row.metodo_pagamento or _("Sem método"), [0.0, 0.0])
			metodo[0] += pendente
			metodo[1] += valor_pago

		self.total_previsto = previsto
		self.total_pago = pago
		self.total_remanescente = remanescente

		self.set("resumo_metodos", [])
		for metodo, (pendente, pago_metodo) in sorted(por_metodo.items()):
			self.append("resumo_metodos", {"metodo_pagamento": metodo, "pendente": pendente, "pago": pago_metodo})


def _dados_da_copia(row):
	"""What a Próximo Mês line carries into next month: only the unpaid part."""
	return {
		"descricao": row.descricao,
		"valor": flt(row.valor) - flt(row.valor_pago),
		"prioridade": row.prioridade,
		"metodo_pagamento": row.metodo_pagamento,
		"categoria": row.categoria,
		"despesa_recorrente": row.despesa_recorrente,
		"fornecedor": row.fornecedor,
		"factura": row.factura,
		"ordem_compra": row.ordem_compra,
		"observacoes": row.observacoes,
	}
