import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from entre_erp.pagamentos import (
	ESTADO_PAGO,
	ESTADO_PROXIMO_MES,
	data_vencimento,
	mes_anterior,
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

	# ------------------------------------------------------------------
	# Buttons (plano_de_pagamentos.js)
	# ------------------------------------------------------------------

	@frappe.whitelist()
	def copiar_despesas_recorrentes(self):
		adicionadas = self.adicionar_despesas_recorrentes()
		self.save()
		return adicionadas

	@frappe.whitelist()
	def transportar_do_mes_anterior(self):
		adicionadas = self.adicionar_linhas_proximo_mes()
		self.save()
		return adicionadas

	# ------------------------------------------------------------------
	# Also used by the monthly scheduler (entre_erp.pagamentos)
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
				"dia_vencimento",
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
					"data_vencimento": data_vencimento(self.ano, self.mes, d.dia_vencimento)
					if self.tipo == "Mensal"
					else None,
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
			self.append(
				"linhas",
				{
					"descricao": row.descricao,
					"valor": flt(row.valor) - flt(row.valor_pago),
					"prioridade": row.prioridade,
					"estado": "Pendente",
					"metodo_pagamento": row.metodo_pagamento,
					"categoria": row.categoria,
					"despesa_recorrente": row.despesa_recorrente,
					"fornecedor": row.fornecedor,
					"factura": row.factura,
					"ordem_compra": row.ordem_compra,
					"observacoes": row.observacoes,
					"linha_origem": row.name,
				},
			)
			adicionadas += 1
		return adicionadas

	# ------------------------------------------------------------------
	# Private
	# ------------------------------------------------------------------

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
		for row in self.linhas:
			row.valor_pago = valor_pago_da_linha(row)
			if row.despesa_recorrente and not row.categoria:
				row.categoria = frappe.db.get_value("Despesa Recorrente", row.despesa_recorrente, "categoria")

	def _calcular_totais(self):
		"""Mirrors the spreadsheet: Previsto / Pago / Remanescente, plus the
		pending-vs-paid split per bank. A Próximo Mês line only counts for
		what was paid this month — the rest belongs to next month's plan."""
		previsto = pago = remanescente = 0.0
		por_metodo = {}

		for row in self.linhas:
			valor, valor_pago = flt(row.valor), flt(row.valor_pago)
			if row.estado == ESTADO_PROXIMO_MES:
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
