frappe.pages["cashflow"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Cashflow"),
		single_column: true,
	});
	$(wrapper).addClass("cf-wrapper");

	wrapper.cashflow = new CashflowSheet(page);
};

// Pages are kept alive between visits, so a link from the Painel Financeiro
// (frappe.route_options = { ano, mes }) is picked up here on every show.
frappe.pages["cashflow"].on_page_show = function (wrapper) {
	if (wrapper.cashflow) wrapper.cashflow.abrir_de_route_options();
};

const API = "entre_erp.pagamentos.";

const MESES = [
	"Janeiro",
	"Fevereiro",
	"Março",
	"Abril",
	"Maio",
	"Junho",
	"Julho",
	"Agosto",
	"Setembro",
	"Outubro",
	"Novembro",
	"Dezembro",
];
const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const ESTADOS = ["Pendente", "Reservado", "Em Progresso", "Parcialmente Pago", "Pago", "Em Espera", "Próximo Mês", "Cancelado"];
// Stay on the sheet but don't count as money to pay this month.
const ESTADOS_FORA_DO_MES = ["Próximo Mês", "Cancelado"];
const ESTADO_CLASS = {
	Pendente: "pendente",
	Reservado: "reservado",
	"Em Progresso": "progresso",
	"Parcialmente Pago": "parcial",
	Pago: "pago",
	"Em Espera": "espera",
	"Próximo Mês": "proximo",
	Cancelado: "cancelado",
};
const ESTADOS_PLANO = ["Rascunho", "Em Curso", "Fechado"];

const ABA_RESUMO = "Resumo";
const ABA_INVESTIMENTOS = "Investimentos";
const ABA_RECORRENTES = "Recorrentes";
const ABA_CAIXA = "Caixa";
const API_CAIXA = "entre_erp.caixa.";

const COLUNAS_CAIXA = [
	{ campo: "data", label: "Data", tipo: "date", largura: 130 },
	{ campo: "descricao", label: "Descrição", tipo: "text", largura: 280, fixa: true },
	{ campo: "tipo", label: "Tipo", tipo: "select", largura: 110, opcoes: () => ["Gasto", "Reforço"] },
	{ campo: "categoria", label: "Categoria", tipo: "select", largura: 190, opcoes: (s) => [""].concat(s.categorias) },
	{ campo: "valor", label: "Valor", tipo: "num", largura: 120 },
	{ campo: "observacoes", label: "Observações", tipo: "text", largura: 300 },
];

// Columns of a month / investments sheet. `opcoes` gets the sheet, so
// select lists can come from the server (payment methods, categories).
const COLUNAS_PLANO = [
	{ campo: "descricao", label: "Descrição", tipo: "text", largura: 260, fixa: true },
	{ campo: "valor", label: "Valor", tipo: "num", largura: 120 },
	{ campo: "prioridade", label: "Prior.", tipo: "select", largura: 90, filtro: true, opcoes: () => ["", "1", "2", "3", "4"] },
	{ campo: "estado", label: "Estado", tipo: "select", largura: 150, filtro: true, opcoes: () => ESTADOS },
	{ campo: "data_pretendida", label: "Data pretendida", tipo: "date", largura: 140 },
	{ campo: "valor_pago", label: "Valor Pago", tipo: "num", largura: 120 },
	{ campo: "data_pagamento", label: "Pago em", tipo: "date", largura: 140 },
	{ campo: "metodo_pagamento", label: "Método", tipo: "select", largura: 110, filtro: true, opcoes: (s) => [""].concat(s.metodos) },
	{ campo: "categoria", label: "Categoria", tipo: "select", largura: 190, filtro: true, opcoes: (s) => [""].concat(s.categorias) },
	{ campo: "factura", label: "Factura", tipo: "link", doctype: "Purchase Invoice", largura: 190 },
	{ campo: "observacoes", label: "Observações", tipo: "text", largura: 300 },
];

const COLUNAS_RECORRENTES = [
	{ campo: "despesa", label: "Despesa", tipo: "text", largura: 220, fixa: true, so_leitura: true },
	{ campo: "categoria", label: "Categoria", tipo: "select", largura: 190, opcoes: (s) => s.categorias },
	{ campo: "valor_padrao", label: "Valor Padrão", tipo: "num", largura: 130 },
	{ campo: "tipo_valor", label: "Tipo", tipo: "select", largura: 100, opcoes: () => ["Fixo", "Variável"] },
	{ campo: "prioridade", label: "Prior.", tipo: "select", largura: 70, opcoes: () => ["", "1", "2", "3", "4"] },
	{ campo: "metodo_pagamento", label: "Método", tipo: "select", largura: 100, opcoes: (s) => [""].concat(s.metodos) },
	{ campo: "referencia", label: "Referência / NIB", tipo: "text", largura: 320 },
	{ campo: "ativo", label: "Ativo", tipo: "check", largura: 60 },
];

const ICONE_FILTRO = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 4h18l-7 9v6l-4 2v-8z"/></svg>`;

const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
const dinheiro = (v) => format_number(v || 0, null, 2);

function nome_plano(ano, aba) {
	if (aba === ABA_INVESTIMENTOS) return `PI-${ano}`;
	return `PP-${ano}-${String(MESES.indexOf(aba) + 1).padStart(2, "0")}`;
}

function mes_seguinte(ano, mes) {
	const i = MESES.indexOf(mes);
	return i === 11 ? [ano + 1, MESES[0]] : [ano, MESES[i + 1]];
}

function mes_anterior(ano, mes) {
	const i = MESES.indexOf(mes);
	return i === 0 ? [ano - 1, MESES[11]] : [ano, MESES[i - 1]];
}

const curto = (mes) => MESES_CURTOS[MESES.indexOf(mes)];

class CashflowSheet {
	constructor(page) {
		this.page = page;
		const destino = frappe.route_options || {};
		frappe.route_options = null;
		this.ano = cint(destino.ano) || new Date().getFullYear();
		this.aba = MESES.includes(destino.mes) ? destino.mes : MESES[new Date().getMonth()];
		this.planos = {};
		this.metodos = [];
		this.categorias = [];
		this.doc = null;
		this.fila = Promise.resolve();
		this.selecionadas = new Set(); // row names ticked for a bulk action
		this.ocultas = ler_colunas_ocultas();
		// Header filters { campo: Set of values }, kept while switching months
		// so you can follow e.g. only STB across the year.
		this.filtros = {};
		this.so_por_pagar = false;
		this.so_em_atraso = false;
		this.pesquisa = "";

		inject_styles();
		this.$body = $(page.body).empty().html(`
			<div class="cf-sheet">
				<div class="cf-topo">
					<div class="cf-ano">
						<button class="btn btn-default btn-sm cf-ano-ant" title="${__("Ano anterior")}">‹</button>
						<span class="cf-ano-valor"></span>
						<button class="btn btn-default btn-sm cf-ano-seg" title="${__("Ano seguinte")}">›</button>
					</div>
					<div class="cf-topo-direita">
						<div class="cf-topo-acoes"></div>
						<button class="btn btn-default btn-sm cf-importar">${__("Importar Excel")}</button>
					</div>
				</div>
				<div class="cf-conteudo"></div>
				<div class="cf-abas"></div>
			</div>
		`);

		this.$body.find(".cf-ano-ant").on("click", () => this.mudar_ano(-1));
		this.$body.find(".cf-ano-seg").on("click", () => this.mudar_ano(1));
		this.$body.find(".cf-importar").on("click", () => this.importar_excel());
		this.$body.on("click", ".cf-aba", (e) => this.abrir_aba($(e.currentTarget).attr("data-aba")));

		this.carregar_ano();
	}

	// ------------------------------------------------------------------
	// Year + tabs
	// ------------------------------------------------------------------

	mudar_ano(delta) {
		this.ano += delta;
		this.carregar_ano();
	}

	abrir_de_route_options() {
		const destino = frappe.route_options;
		if (!destino || !MESES.includes(destino.mes)) return;
		frappe.route_options = null;
		this.aba = destino.mes;
		if (cint(destino.ano) && cint(destino.ano) !== this.ano) {
			this.ano = cint(destino.ano);
			this.carregar_ano();
		} else {
			this.render_abas();
			this.abrir_aba(destino.mes);
		}
	}

	carregar_ano() {
		this.$body.find(".cf-ano-valor").text(this.ano);
		this.page.set_title(__("Cashflow {0}", [this.ano]));

		return frappe.xcall(API + "obter_ano", { ano: this.ano }).then((d) => {
			this.metodos = d.metodos;
			this.categorias = d.categorias;
			this.planos = {};
			d.planos.forEach((p) => (this.planos[p.name] = p));
			this.render_abas();
			this.abrir_aba(this.aba);
		});
	}

	render_abas() {
		const ponto = (aba) => {
			const p = this.planos[nome_plano(this.ano, aba)];
			if (!p) return "";
			return `<span class="cf-ponto ${p.total_remanescente > 0 ? "cf-ponto-pendente" : "cf-ponto-ok"}"></span>`;
		};
		const aba = (id, label, extra = "") =>
			`<button class="cf-aba ${extra} ${id === this.aba ? "active" : ""}" data-aba="${esc(id)}">${label}</button>`;

		const $abas = this.$body.find(".cf-abas");
		$abas.html(
			aba(ABA_RESUMO, __("Resumo Anual"), "cf-aba-especial") +
				MESES.map((m, i) => aba(m, ponto(m) + MESES_CURTOS[i])).join("") +
				aba(ABA_INVESTIMENTOS, ponto(ABA_INVESTIMENTOS) + __("Investimentos"), "cf-aba-especial") +
				aba(ABA_RECORRENTES, __("Recorrentes"), "cf-aba-especial") +
				aba(ABA_CAIXA, `💰 ${__("Caixa")}`, "cf-aba-especial"),
		);
		const ativa = $abas.find(".cf-aba.active")[0];
		if (ativa) ativa.scrollIntoView({ inline: "nearest", block: "nearest" });
	}

	abrir_aba(aba) {
		this.fechar_menu_filtro();
		this.fechar_menu_link();
		// The panel survives only a reload of the same sheet (e.g. after a save).
		const mesma_folha = this.doc && aba === this.aba && this.doc.name === nome_plano(this.ano, aba);
		if (this.painel && !mesma_folha) this.fechar_painel();
		this.aba = aba;
		this.doc = null;
		this.$body.find(".cf-aba").removeClass("active").filter(`[data-aba="${aba}"]`).addClass("active");
		this.$body.find(".cf-topo-acoes").empty();
		this.$conteudo = this.$body.find(".cf-conteudo").off().html(`<div class="cf-vazio">${__("A carregar...")}</div>`);

		if (aba === ABA_RESUMO) return this.carregar_resumo();
		if (aba === ABA_RECORRENTES) return this.carregar_recorrentes();
		if (aba === ABA_CAIXA) return this.carregar_caixa();

		const nome = nome_plano(this.ano, aba);
		if (!this.planos[nome]) return this.render_sem_plano(aba);
		frappe.xcall(API + "obter_plano", { plano: nome }).then((doc) => this.render_plano(doc));
	}

	titulo_aba(aba) {
		return aba === ABA_INVESTIMENTOS ? __("Investimentos {0}", [this.ano]) : `${aba} ${this.ano}`;
	}

	render_sem_plano(aba) {
		this.$conteudo.html(`
			<div class="cf-vazio">
				<p>${__("Ainda não existe plano para {0}.", [`<b>${esc(this.titulo_aba(aba))}</b>`])}</p>
				${
					aba === ABA_INVESTIMENTOS
						? ""
						: `<p class="text-muted">${__("Será criado com as Despesas Recorrentes ativas e as linhas em Próximo Mês do mês anterior.")}</p>`
				}
				<button class="btn btn-primary cf-criar">${__("Criar plano")}</button>
			</div>
		`);
		this.$conteudo.find(".cf-criar").on("click", () => {
			const tipo = aba === ABA_INVESTIMENTOS ? "Investimentos" : "Mensal";
			frappe
				.xcall(API + "criar_plano", { ano: this.ano, tipo, mes: tipo === "Mensal" ? aba : null })
				.then((doc) => {
					this.planos[doc.name] = doc;
					this.render_abas();
					this.abrir_aba(aba);
				});
		});
	}

	// ------------------------------------------------------------------
	// Month / investments sheet
	// ------------------------------------------------------------------

	render_plano(doc) {
		this.doc = doc;
		this.selecionadas.clear();
		const fechado = doc.estado === "Fechado";
		// Locked while last month still has lines to settle (see bloqueio_do_mes_anterior).
		const bloqueio = doc.bloqueio;
		const so_leitura = fechado || !!bloqueio;

		this.$body.find(".cf-topo-acoes").html(`
			<select class="form-control input-sm cf-estado-plano" title="${__("Estado do Plano")}" ${bloqueio ? "disabled" : ""}>
				${ESTADOS_PLANO.map((e) => `<option ${e === doc.estado ? "selected" : ""}>${e}</option>`).join("")}
			</select>
			<button class="btn btn-default btn-sm cf-preencher" data-acao="recorrentes" ${so_leitura ? "disabled" : ""}>
				${__("Copiar Despesas Recorrentes")}
			</button>
			<button class="btn btn-default btn-sm cf-abrir-form">${__("Formulário")}</button>
		`);

		this.$conteudo.html(`
			<div class="cf-cabecalho"></div>
			${fechado ? `<div class="cf-aviso-fechado">${__("Plano Fechado — mude o estado para Em Curso para editar.")}</div>` : ""}
			${
				bloqueio
					? `<div class="cf-aviso-bloqueio">
						<span>🔒 ${__("{0} ainda tem {1} pagamento(s) por liquidar ({2}). Pague, cancele ou mova-os para Próximo Mês — {3} fica disponível depois disso.", [
							`<b>${esc(bloqueio.titulo)}</b>`,
							bloqueio.pendentes,
							dinheiro(bloqueio.valor),
							esc(this.titulo_aba(this.aba)),
						])}</span>
						<button class="btn btn-primary btn-xs cf-ir-bloqueio">${__("Ir para {0}", [esc(bloqueio.mes)])} →</button>
					</div>`
					: ""
			}
			<div class="cf-filtros">
				<input type="text" class="form-control input-sm cf-pesquisa" placeholder="${__("Pesquisar...")}" value="${esc(this.pesquisa)}">
				<button class="btn btn-default btn-sm cf-por-pagar" title="${__("Só o que falta pagar")}">${__("Por pagar")}</button>
				<button class="btn btn-default btn-sm cf-em-atraso" title="${__("Data pretendida já passou e ainda não está liquidado")}">${__("Em atraso")} <span class="cf-atraso-n"></span></button>
				<button class="btn btn-link btn-sm cf-limpar-filtros">✕ ${__("Limpar filtros")}</button>
				<span class="cf-contagem text-muted"></span>
				<div class="btn-group cf-colunas">
					<button class="btn btn-default btn-sm dropdown-toggle cf-colunas-btn" data-toggle="dropdown"></button>
					<div class="dropdown-menu dropdown-menu-right cf-colunas-menu">
						${COLUNAS_PLANO.filter((c) => !c.fixa)
							.map(
								(c) => `<label class="cf-filtro-op">
									<input type="checkbox" class="cf-coluna-check" value="${c.campo}" ${this.ocultas.has(c.campo) ? "" : "checked"}>
									${__(c.label)}
								</label>`,
							)
							.join("")}
						<div class="cf-filtro-rodape"><button class="btn btn-xs btn-default cf-colunas-todas">${__("Mostrar todas")}</button></div>
					</div>
				</div>
			</div>
			<div class="cf-lote"></div>
			<div class="cf-grelha-wrap">
				<table class="cf-grelha ${[...this.ocultas].map((c) => `cf-sem-${c}`).join(" ")}">
					<thead><tr>
						<th class="cf-idx">${
							so_leitura ? "#" : `<input type="checkbox" class="cf-sel-todas" title="${__("Selecionar as linhas visíveis")}">`
						}</th>
						${COLUNAS_PLANO.map(
							(c) => `<th class="cf-col-${c.campo} ${c.fixa ? "cf-fixa" : ""} ${c.tipo === "num" ? "cf-num" : ""}" style="min-width:${c.largura}px">${__(c.label)}${
								c.filtro
									? `<button class="cf-filtro-btn" data-campo="${c.campo}" title="${__("Filtrar")}">${ICONE_FILTRO}</button>`
									: ""
							}</th>`,
						).join("")}
						<th style="min-width:110px"></th>
					</tr></thead>
					<tbody>${doc.linhas.map((row, i) => this.html_linha(row, i + 1, so_leitura)).join("")}</tbody>
					<tfoot>
						${
							so_leitura
								? ""
								: `<tr class="cf-nova"><td class="cf-idx">+</td>${COLUNAS_PLANO.map((c) =>
										c.fixa
											? `<td class="cf-col-${c.campo} cf-fixa"><input class="cf-cell cf-nova-input" placeholder="${__("Nova despesa… (Enter)")}"></td>`
											: `<td class="cf-col-${c.campo}"></td>`,
									).join("")}<td></td></tr>`
						}
						<tr class="cf-total"><td></td>${COLUNAS_PLANO.map((c) => {
							if (c.fixa) return `<td class="cf-col-${c.campo} cf-fixa cf-total-label">${__("TOTAL")}</td>`;
							if (c.campo === "valor") return `<td class="cf-col-valor cf-num cf-total-valor"></td>`;
							if (c.campo === "valor_pago") return `<td class="cf-col-valor_pago cf-num cf-total-pago"></td>`;
							return `<td class="cf-col-${c.campo}"></td>`;
						}).join("")}<td></td></tr>
					</tfoot>
				</table>
			</div>
		`);

		this.render_cabecalho(doc);
		this.bind_plano();
		this.destacar_linha();
		if (this.painel) {
			if (this.$conteudo.find(`tbody tr[data-name="${this.painel.nome}"]`).length) this.abrir_painel(this.painel.nome);
			else this.fechar_painel();
		}
	}

	html_linha(row, idx, so_leitura) {
		return `
			<tr data-name="${esc(row.name)}" data-origem="${esc(row.linha_origem || "")}" class="cf-estado-${ESTADO_CLASS[row.estado] || "pendente"} ${caixa_sem_reforco(row) ? "cf-caixa-sem-reforco" : ""}">
				<td class="cf-idx"><span class="cf-n">${idx}</span>${so_leitura ? "" : `<input type="checkbox" class="cf-sel">`}</td>
				${COLUNAS_PLANO.map((c) => `<td class="cf-col-${c.campo} ${c.fixa ? "cf-fixa" : ""}">${html_celula(c, row[c.campo], this, so_leitura)}</td>`).join("")}
				<td class="cf-acoes">${this.html_acoes(row, so_leitura)}</td>
			</tr>`;
	}

	html_acoes(row, so_leitura) {
		let html = "";
		if (this.doc.tipo === "Mensal" && row.estado === "Próximo Mês") {
			const [, mes] = mes_seguinte(this.doc.ano, this.doc.mes);
			html += `<button class="cf-salto" data-ir="seguinte" title="${__("Ver esta linha em {0}", [mes])}">→ ${curto(mes)}</button>`;
		}
		if (this.doc.tipo === "Mensal" && e_linha_de_caixa(row)) {
			html += `<button class="cf-salto-caixa" title="${__("Saldo da Caixa no fim de {0} — abrir a Caixa", [this.doc.mes])}">${this.html_chip_caixa()}</button>`;
		}
		if (row.linha_origem) {
			const [, mes] = mes_anterior(this.doc.ano, this.doc.mes);
			html += `<button class="cf-salto" data-ir="anterior" title="${__("Veio de {0} (Próximo Mês)", [mes])}">← ${curto(mes)}</button>`;
		}
		if (!so_leitura) html += `<button class="btn btn-xs btn-link cf-remover" title="${__("Remover linha")}">×</button>`;
		html += `<button class="btn btn-xs btn-link cf-abrir-painel" title="${__("Detalhes")}">›</button>`;
		return html;
	}

	html_chip_caixa() {
		const c = this.doc && this.doc.caixa;
		return c ? `💰 <span class="${c.saldo_final < 0 ? "cf-vermelho" : ""}">${dinheiro(c.saldo_final)}</span>` : `💰 ${__("Caixa")}`;
	}

	render_cabecalho(p) {
		// Caixa balance travels with the plan header; refresh the chip on the Caixa line.
		if (this.doc && "caixa" in p) {
			this.doc.caixa = p.caixa;
			this.$conteudo.find(".cf-salto-caixa").html(this.html_chip_caixa());
		}
		const pct = p.total_previsto ? Math.min(100, Math.round((p.total_pago / p.total_previsto) * 100)) : 0;
		this.$conteudo.find(".cf-cabecalho").html(`
			<div class="cf-kpis">
				<div class="cf-kpi"><div class="cf-kpi-label">${__("Total Previsto")}</div><div class="cf-kpi-valor">${dinheiro(p.total_previsto)}</div></div>
				<div class="cf-kpi"><div class="cf-kpi-label">${__("Total Pago")}</div><div class="cf-kpi-valor cf-verde">${dinheiro(p.total_pago)}</div></div>
				<div class="cf-kpi"><div class="cf-kpi-label">${__("Remanescente")}</div><div class="cf-kpi-valor ${p.total_remanescente > 0 ? "cf-laranja" : ""}">${dinheiro(p.total_remanescente)}</div></div>
				<div class="cf-kpi cf-kpi-progresso">
					<div class="cf-kpi-label">${__("Pago")} ${pct}%</div>
					<div class="cf-barra"><div style="width:${pct}%"></div></div>
				</div>
			</div>
			<div class="cf-metodos">${(p.resumo_metodos || [])
				.filter((m) => m.pendente || m.pago)
				.map(
					(m) => `<span class="cf-metodo">
						<b>${esc(m.metodo_pagamento)}</b>
						<span class="${m.pendente > 0 ? "cf-laranja" : "text-muted"}">${__("Por pagar")} ${dinheiro(m.pendente)}</span>
						<span class="text-muted">·</span>
						<span>${__("Pago")} ${dinheiro(m.pago)}</span>
					</span>`,
				)
				.join("")}</div>
		`);
		this.cabecalho = p;
		this.atualizar_rodape();
		this.marcar_atrasos();

		// Keep the tab dot in sync.
		const resumo = this.planos[p.name];
		if (resumo) {
			resumo.total_remanescente = p.total_remanescente;
			resumo.estado = p.estado;
			this.render_abas();
		}
	}

	bind_plano() {
		const $c = this.$conteudo.off();

		$c.on("change", "tbody .cf-cell", (e) => {
			const $el = $(e.currentTarget);
			const $tr = $el.closest("tr");
			const coluna = COLUNAS_PLANO.find((c) => c.campo === $el.attr("data-campo"));
			const valor = ler_celula(coluna, $el);

			if (coluna.campo === "estado") definir_classe_estado($tr, valor);
			this.guardar_campo_linha($tr.attr("data-name"), coluna.campo, valor);
		});

		$c.on("focus input", "tbody .cf-cell-link", (e) => this.buscar_link(e.currentTarget));
		$c.on("keydown", "tbody .cf-cell-link", (e) => this.teclado_link(e));
		$c.on("blur", "tbody .cf-cell-link", () => setTimeout(() => this.fechar_menu_link(), 150));
		$c.find(".cf-grelha-wrap").on("scroll", () => this.fechar_menu_link());

		$c.on("keydown", "tbody .cf-cell", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			// Excel-like: Enter goes to the same column on the next row.
			const campo = $(e.currentTarget).attr("data-campo");
			const $prox = $(e.currentTarget).closest("tr").nextAll(":visible").first();
			const $alvo = $prox.length ? $prox.find(`[data-campo="${campo}"]`) : $c.find(".cf-nova-input");
			($alvo.length ? $alvo : $(e.currentTarget)).trigger("focus").trigger("select");
		});

		$c.on("focus", "tbody .cf-data", (e) => {
			const el = e.currentTarget;
			if (el.disabled) return;
			el.type = "date";
			el.value = el.dataset.iso || "";
		});
		$c.on("blur", "tbody .cf-data", (e) => {
			const el = e.currentTarget;
			if (el.type === "date") el.dataset.iso = el.value;
			el.type = "text";
			el.value = data_utilizador(el.dataset.iso);
		});
		$c.on("blur", "tbody .cf-dinheiro", (e) => {
			const $el = $(e.currentTarget);
			const v = flt($el.val());
			$el.val(v ? dinheiro(v) : "");
		});

		$c.on("keydown", ".cf-nova-input", (e) => {
			const descricao = $(e.currentTarget).val().trim();
			if (e.key !== "Enter" || !descricao) return;
			this.guardar(() =>
				frappe.xcall(API + "adicionar_linha", { plano: this.doc.name, descricao }).then((doc) => {
					this.render_plano(doc);
					this.$conteudo.find('tbody tr:last [data-campo="valor"]').trigger("focus");
				}),
			);
		});

		$c.on("click", ".cf-remover", (e) => {
			const $tr = $(e.currentTarget).closest("tr");
			const descricao = $tr.find('[data-campo="descricao"]').val();
			frappe.confirm(__("Remover a linha {0}?", [`<b>${esc(descricao)}</b>`]), () =>
				this.guardar(() =>
					frappe
						.xcall(API + "remover_linha", { plano: this.doc.name, linha: $tr.attr("data-name") })
						.then((r) => {
							this.render_plano(r.plano);
							if (r.transporte) this.anunciar_transporte(r.transporte);
						}),
				),
			);
		});

		$c.on("click", ".cf-ir-bloqueio", () => {
			const b = this.doc.bloqueio;
			this.ir_para(b.ano, b.mes, null);
			this.so_por_pagar = true;
		});

		$c.on("click", ".cf-abrir-painel", (e) => this.abrir_painel($(e.currentTarget).closest("tr").attr("data-name")));
		$c.on("dblclick", "tbody .cf-idx", (e) => this.abrir_painel($(e.currentTarget).closest("tr").attr("data-name")));

		$c.on("click", ".cf-salto-caixa", () => {
			this.caixa_ano = this.doc.ano;
			this.caixa_mes = this.doc.mes;
			this.aba = ABA_CAIXA;
			this.render_abas();
			this.abrir_aba(ABA_CAIXA);
		});

		$c.on("click", ".cf-salto", (e) => {
			const $tr = $(e.currentTarget).closest("tr");
			if ($(e.currentTarget).attr("data-ir") === "seguinte") {
				const [ano, mes] = mes_seguinte(this.doc.ano, this.doc.mes);
				this.ir_para(ano, mes, `tr[data-origem="${$tr.attr("data-name")}"]`);
			} else {
				const [ano, mes] = mes_anterior(this.doc.ano, this.doc.mes);
				this.ir_para(ano, mes, `tr[data-name="${$tr.attr("data-origem")}"]`);
			}
		});

		$c.on("change", ".cf-sel", (e) => {
			const $tr = $(e.currentTarget).closest("tr");
			const nome = $tr.attr("data-name");
			if (e.currentTarget.checked) this.selecionadas.add(nome);
			else this.selecionadas.delete(nome);
			$tr.toggleClass("cf-selecionada", e.currentTarget.checked);
			this.atualizar_barra_lote();
		});
		$c.on("change", ".cf-sel-todas", (e) => {
			const marcar = e.currentTarget.checked;
			$c.find("tbody tr:visible").each((_i, tr) => {
				$(tr).toggleClass("cf-selecionada", marcar).find(".cf-sel").prop("checked", marcar);
				if (marcar) this.selecionadas.add(tr.getAttribute("data-name"));
				else this.selecionadas.delete(tr.getAttribute("data-name"));
			});
			this.atualizar_barra_lote();
		});
		$c.on("click", ".cf-lote-op", (e) => {
			const $el = $(e.currentTarget);
			this.aplicar_lote({ [$el.attr("data-campo")]: $el.attr("data-valor") });
		});
		$c.on("click", ".cf-lote-pagar", () => this.aplicar_lote({ estado: "Pago" }));
		$c.on("click", ".cf-lote-pretendida", () =>
			frappe.prompt(
				{ fieldtype: "Date", fieldname: "data", label: __("Data pretendida"), reqd: 1 },
				(v) => this.aplicar_lote({ data_pretendida: v.data }),
				__("Data pretendida"),
				__("Aplicar"),
			),
		);
		$c.on("click", ".cf-lote-data", () =>
			frappe.prompt(
				{ fieldtype: "Date", fieldname: "data", label: __("Pago em"), default: frappe.datetime.get_today(), reqd: 1 },
				(v) => this.aplicar_lote({ data_pagamento: v.data }),
				__("Data de pagamento"),
				__("Aplicar"),
			),
		);
		$c.on("click", ".cf-lote-remover", () =>
			frappe.confirm(__("Remover {0} linha(s)?", [this.selecionadas.size]), () =>
				this.guardar(() =>
					frappe
						.xcall(API + "remover_linhas", { plano: this.doc.name, linhas: [...this.selecionadas] })
						.then((r) => this.depois_do_lote(r, __("{0} linha(s) removida(s).", [this.selecionadas.size]))),
				),
			),
		);
		$c.on("click", ".cf-lote-limpar", () => {
			this.selecionadas.clear();
			$c.find(".cf-sel, .cf-sel-todas").prop("checked", false);
			$c.find("tr.cf-selecionada").removeClass("cf-selecionada");
			this.atualizar_barra_lote();
		});

		$c.on("click", ".cf-colunas-menu", (e) => e.stopPropagation()); // keep open while ticking
		$c.on("change", ".cf-coluna-check", (e) => {
			if (e.currentTarget.checked) this.ocultas.delete(e.currentTarget.value);
			else this.ocultas.add(e.currentTarget.value);
			this.aplicar_colunas();
		});
		$c.on("click", ".cf-colunas-todas", () => {
			this.ocultas.clear();
			$c.find(".cf-coluna-check").prop("checked", true);
			this.aplicar_colunas();
		});

		$c.on("input", ".cf-pesquisa", (e) => {
			this.pesquisa = $(e.currentTarget).val();
			this.aplicar_filtros();
		});
		$c.on("click", ".cf-por-pagar", () => {
			this.so_por_pagar = !this.so_por_pagar;
			this.aplicar_filtros();
		});
		$c.on("click", ".cf-em-atraso", () => {
			this.so_em_atraso = !this.so_em_atraso;
			this.aplicar_filtros();
		});
		$c.on("click", ".cf-limpar-filtros", () => {
			this.filtros = {};
			this.so_por_pagar = false;
			this.so_em_atraso = false;
			this.pesquisa = "";
			$c.find(".cf-pesquisa").val("");
			this.aplicar_filtros();
		});
		$c.on("click", ".cf-filtro-btn", (e) => {
			e.stopPropagation();
			this.abrir_menu_filtro($(e.currentTarget));
		});

		const $acoes = this.$body.find(".cf-topo-acoes");
		$acoes.find(".cf-estado-plano").on("change", (e) => {
			const estado = $(e.currentTarget).val();
			this.guardar(() =>
				frappe
					.xcall(API + "definir_estado_plano", { plano: this.doc.name, estado })
					.then(() => this.abrir_aba(this.aba)),
			);
		});
		$acoes.find(".cf-preencher").on("click", (e) => {
			const acao = $(e.currentTarget).attr("data-acao");
			this.guardar(() =>
				frappe.xcall(API + "preencher_plano", { plano: this.doc.name, acao }).then((r) => {
					frappe.show_alert({
						message: r.adicionadas
							? __("{0} linha(s) adicionada(s).", [r.adicionadas])
							: __("Nada novo para adicionar."),
						indicator: r.adicionadas ? "green" : "blue",
					});
					this.render_plano(r.plano);
				}),
			);
		});
		$acoes.find(".cf-abrir-form").on("click", () => frappe.set_route("Form", "Plano de Pagamentos", this.doc.name));

		this.aplicar_colunas();
		this.aplicar_filtros();
	}

	aplicar_colunas() {
		const $grelha = this.$conteudo.find(".cf-grelha");
		COLUNAS_PLANO.forEach((c) => $grelha.toggleClass(`cf-sem-${c.campo}`, this.ocultas.has(c.campo)));
		const n = this.ocultas.size;
		this.$conteudo
			.find(".cf-colunas-btn")
			.html(`${__("Colunas")}${n ? ` <span class="cf-colunas-n">${__("{0} ocultas", [n])}</span>` : ""} <span class="caret"></span>`);
		guardar_colunas_ocultas(this.ocultas);
	}

	// ------------------------------------------------------------------
	// Link cells (Factura → Purchase Invoice): search as you type
	// ------------------------------------------------------------------

	buscar_link(input) {
		clearTimeout(this.link_timer);
		this.link_timer = setTimeout(() => {
			const coluna = COLUNAS_PLANO.find((c) => c.campo === input.getAttribute("data-campo"));
			frappe.call({
				method: "frappe.desk.search.search_link",
				args: {
					doctype: coluna.doctype,
					txt: input.value,
					filters: { docstatus: ["!=", 2] },
					page_length: 15,
				},
				callback: (r) => {
					if (document.activeElement !== input) return;
					this.mostrar_menu_link(input, r.message || r.results || []);
				},
			});
		}, 250);
	}

	mostrar_menu_link(input, resultados) {
		this.fechar_menu_link();
		const $menu = $(`
			<div class="cf-filtro-menu cf-link-menu">
				${
					resultados.length
						? resultados
								.map(
									(r, i) => `<div class="cf-link-op ${i === 0 ? "ativo" : ""}" data-valor="${esc(r.value)}">
										<b>${esc(r.value)}</b>
										${r.description ? `<div class="cf-link-desc">${esc($("<div>").html(r.description).text())}</div>` : ""}
									</div>`,
								)
								.join("")
						: `<div class="cf-link-vazio">${__("Nenhuma factura encontrada.")}</div>`
				}
			</div>
		`).appendTo(document.body);

		const r = input.getBoundingClientRect();
		$menu.css({ top: r.bottom + 2, left: Math.max(8, Math.min(r.left, window.innerWidth - 330)) });
		// mousedown (not click) so the input doesn't lose focus first
		$menu.on("mousedown", ".cf-link-op", (e) => {
			e.preventDefault();
			this.escolher_link(input, e.currentTarget.getAttribute("data-valor"));
		});
		this.$menu_link = $menu;
	}

	teclado_link(e) {
		if (!this.$menu_link) return;
		const $ops = this.$menu_link.find(".cf-link-op");
		let i = $ops.index($ops.filter(".ativo"));
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			i = Math.max(0, Math.min($ops.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
			$ops.removeClass("ativo").eq(i).addClass("ativo")[0].scrollIntoView({ block: "nearest" });
		} else if (e.key === "Enter" && $ops.length) {
			e.preventDefault();
			e.stopImmediatePropagation();
			this.escolher_link(e.currentTarget, $ops.eq(Math.max(i, 0)).attr("data-valor"));
		} else if (e.key === "Escape") {
			this.fechar_menu_link();
		}
	}

	escolher_link(input, valor) {
		input.value = valor;
		this.fechar_menu_link();
		input.blur(); // the browser's change event saves it, like any other cell
	}

	fechar_menu_link() {
		if (this.$menu_link) this.$menu_link.remove();
		this.$menu_link = null;
	}

	guardar_campo_linha(nome, campo, valor) {
		return this.guardar(() =>
			frappe
				.xcall(API + "atualizar_linha", { plano: this.doc.name, linha: nome, campo, valor })
				.then((r) => {
					this.atualizar_linha_na_grelha(this.$conteudo.find(`tbody tr[data-name="${nome}"]`), r.linha);
					this.render_cabecalho(r.plano);
					if (this.painel && this.painel.nome === nome) this.atualizar_painel(r.linha, campo);
					if (r.transporte) this.anunciar_transporte(r.transporte, r.linha.name);
					if (r.plano.fechado_automaticamente) this.anunciar_fecho();
					return r;
				}),
		);
	}

	atualizar_linha_na_grelha($tr, linha) {
		definir_classe_estado($tr, linha.estado);
		$tr.toggleClass("cf-caixa-sem-reforco", caixa_sem_reforco(linha));
		$tr.find(".cf-acoes").html(this.html_acoes(linha, false));
		$tr.find(".cf-cell").each((_i, el) => {
			if (el === document.activeElement) return;
			const coluna = COLUNAS_PLANO.find((c) => c.campo === el.getAttribute("data-campo"));
			escrever_celula(coluna, $(el), linha[coluna.campo]);
		});
	}

	// Opens another month (another year if needed) and flashes the row
	// matching `seletor` once the sheet is drawn.
	ir_para(ano, mes, seletor) {
		this.destacar = seletor;
		this.aba = mes;
		if (ano !== this.ano) {
			this.ano = ano;
			this.carregar_ano();
		} else {
			this.render_abas();
			this.abrir_aba(mes);
		}
	}

	destacar_linha() {
		if (!this.destacar) return;
		const $tr = this.$conteudo.find(this.destacar);
		this.destacar = null;
		if (!$tr.length) return;
		$tr[0].scrollIntoView({ block: "center", behavior: "smooth" });
		$tr.addClass("cf-destaque");
		setTimeout(() => $tr.removeClass("cf-destaque"), 2600);
	}

	anunciar_transporte(t, linha) {
		const destino = `${t.mes} ${t.ano}`;
		const msg = t.adicionadas
			? t.criado
				? __("Movido para {0} — plano de {0} criado.", [destino])
				: __("Movido para {0}.", [destino])
			: __("Retirado de {0}.", [destino]);

		const $alerta = frappe.show_alert(
			{
				message: t.adicionadas ? `${msg} <a class="cf-alerta-link">${__("Abrir {0}", [t.mes])} →</a>` : msg,
				indicator: t.adicionadas ? "blue" : "gray",
			},
			7,
		);
		$alerta &&
			$alerta.find(".cf-alerta-link").on("click", () =>
				this.ir_para(t.ano, t.mes, linha ? `tr[data-origem="${linha}"]` : null),
			);

		// The next month may have just been created: refresh the tab dots.
		frappe.xcall(API + "obter_ano", { ano: this.ano }).then((d) => {
			d.planos.forEach((p) => (this.planos[p.name] = p));
			this.render_abas();
		});
	}

	// ------------------------------------------------------------------
	// Bulk actions
	// ------------------------------------------------------------------

	atualizar_barra_lote() {
		const n = this.selecionadas.size;
		const $barra = this.$conteudo.find(".cf-lote");
		this.$conteudo.find(".cf-grelha").toggleClass("cf-selecionando", n > 0);
		const $todas = this.$conteudo.find(".cf-sel-todas");
		const visiveis = this.$conteudo.find("tbody tr:visible").length;
		$todas.prop("checked", n > 0 && n === visiveis).prop("indeterminate", n > 0 && n < visiveis);
		if (!n) {
			$barra.removeClass("visivel").empty();
			return;
		}

		let total = 0;
		this.selecionadas.forEach((nome) => {
			total += flt(this.$conteudo.find(`tr[data-name="${nome}"] [data-campo="valor"]`).val());
		});

		const menu = (label, campo, opcoes) => `
			<div class="btn-group">
				<button class="btn btn-default btn-xs dropdown-toggle" data-toggle="dropdown">${label} <span class="caret"></span></button>
				<div class="dropdown-menu">${opcoes
					.map(
						(o) => `<a class="dropdown-item cf-lote-op" data-campo="${campo}" data-valor="${esc(o)}">${
							o ? esc(o) : `<i class="text-muted">${__("(nenhum)")}</i>`
						}</a>`,
					)
					.join("")}</div>
			</div>`;

		$barra.addClass("visivel").html(`
			<span class="cf-lote-info"><b>${__("{0} selecionada(s)", [n])}</b> · ${dinheiro(total)}</span>
			<button class="btn btn-primary btn-xs cf-lote-pagar">✓ ${__("Marcar como Pago")}</button>
			${menu(__("Estado"), "estado", ESTADOS)}
			${menu(__("Método"), "metodo_pagamento", [""].concat(this.metodos))}
			${menu(__("Categoria"), "categoria", [""].concat(this.categorias))}
			${menu(__("Prior."), "prioridade", ["", "1", "2", "3", "4"])}
			<button class="btn btn-default btn-xs cf-lote-pretendida">${__("Data pretendida…")}</button>
			<button class="btn btn-default btn-xs cf-lote-data">${__("Pago em…")}</button>
			<button class="btn btn-default btn-xs cf-lote-remover">${__("Remover")}</button>
			<button class="btn btn-link btn-xs cf-lote-limpar" title="${__("Limpar seleção")}">✕</button>
		`);
	}

	aplicar_lote(valores) {
		const linhas = [...this.selecionadas];
		this.guardar(() =>
			frappe
				.xcall(API + "atualizar_linhas", { plano: this.doc.name, linhas, valores })
				.then((r) => this.depois_do_lote(r, __("{0} linha(s) atualizada(s).", [linhas.length]))),
		);
	}

	depois_do_lote(r, mensagem) {
		this.render_plano(r.plano);
		frappe.show_alert({ message: mensagem, indicator: "green" });
		if (r.transporte) this.anunciar_transporte(r.transporte);
		if (r.cabecalho && r.cabecalho.fechado_automaticamente) this.anunciar_fecho();
	}

	// ------------------------------------------------------------------
	// Side panel: every detail of one line
	// ------------------------------------------------------------------

	abrir_painel(nome) {
		if (!this.doc || !nome) return;
		const so_leitura = this.doc.estado === "Fechado" || !!this.doc.bloqueio;
		this.painel = { nome, so_leitura, controlos: {} };

		this.$conteudo.find("tbody tr").removeClass("cf-painel-ativo");
		this.$conteudo.find(`tbody tr[data-name="${nome}"]`).addClass("cf-painel-ativo");
		this.$body.find(".cf-sheet").addClass("cf-com-painel");

		if (!this.$painel) {
			this.$painel = $(`<div class="cf-painel"></div>`).appendTo(this.$body.find(".cf-sheet"));
			$(document).on("keydown.cf-painel", (e) => this.teclado_painel(e));
		}
		this.$painel.html(`<div class="cf-vazio">${__("A carregar...")}</div>`);

		frappe.xcall(API + "obter_detalhes_linha", { plano: this.doc.name, linha: nome }).then((d) => {
			if (!this.painel || this.painel.nome !== nome) return; // moved on meanwhile
			this.render_painel(d);
		});
	}

	fechar_painel() {
		this.painel = null;
		if (this.$painel) this.$painel.remove();
		this.$painel = null;
		$(document).off("keydown.cf-painel");
		this.$body.find(".cf-sheet").removeClass("cf-com-painel");
		if (this.$conteudo) this.$conteudo.find("tbody tr").removeClass("cf-painel-ativo");
	}

	linhas_visiveis() {
		return this.$conteudo.find("tbody tr:visible").map((_i, tr) => tr.getAttribute("data-name")).get();
	}

	mover_painel(delta) {
		const nomes = this.linhas_visiveis();
		const i = nomes.indexOf(this.painel.nome) + delta;
		if (i < 0 || i >= nomes.length) return;
		this.abrir_painel(nomes[i]);
		const tr = this.$conteudo.find(`tbody tr[data-name="${nomes[i]}"]`)[0];
		if (tr) tr.scrollIntoView({ block: "nearest" });
	}

	teclado_painel(e) {
		if (!this.painel) return;
		if (e.key === "Escape") return this.fechar_painel();
		// ↑ / ↓ move between lines — but not while typing in a field
		if ($(e.target).is("input, select, textarea, [contenteditable]")) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			this.mover_painel(e.key === "ArrowDown" ? 1 : -1);
		}
	}

	render_painel(d) {
		const l = d.linha;
		const nomes = this.linhas_visiveis();
		const pos = nomes.indexOf(l.name);

		this.$painel.html(`
			<div class="cf-painel-topo">
				<div class="cf-painel-titulo">
					<div class="cf-painel-nome">${esc(l.descricao)}</div>
					<div class="cf-painel-sub">
						<span class="cf-painel-estado cf-estado-${ESTADO_CLASS[l.estado] || "pendente"}">${esc(l.estado)}</span>
						· ${dinheiro(l.valor)}
					</div>
				</div>
				<div class="cf-painel-nav">
					<button class="btn btn-default btn-xs cf-painel-ant" ${pos <= 0 ? "disabled" : ""} title="${__("Linha anterior")} (↑)">‹</button>
					<span class="text-muted">${pos + 1} / ${nomes.length}</span>
					<button class="btn btn-default btn-xs cf-painel-seg" ${pos < 0 || pos >= nomes.length - 1 ? "disabled" : ""} title="${__("Linha seguinte")} (↓)">›</button>
					<button class="btn btn-default btn-xs cf-painel-fechar" title="${__("Fechar")} (Esc)">✕</button>
				</div>
			</div>
			${this.painel.so_leitura ? `<div class="cf-painel-aviso">${__("Só leitura — o plano está fechado ou bloqueado.")}</div>` : ""}
			<div class="cf-painel-corpo">
				<div class="cf-painel-seccao"><div class="cf-painel-seccao-titulo">${__("Pagamento")}</div><div class="cf-painel-grelha" data-seccao="pagamento"></div></div>
				<div class="cf-painel-seccao"><div class="cf-painel-seccao-titulo">${__("Detalhes")}</div><div class="cf-painel-grelha" data-seccao="detalhes"></div></div>
				<div class="cf-painel-seccao">
					<div class="cf-painel-seccao-titulo">${__("Documentos")}</div>
					<div class="cf-painel-grelha" data-seccao="documentos"></div>
					<div class="cf-painel-factura">${this.html_factura(d.factura)}</div>
				</div>
				<div class="cf-painel-seccao"><div class="cf-painel-seccao-titulo">${__("Observações")}</div><div data-seccao="observacoes"></div></div>
				${this.html_caixa_painel(d.resumo_caixa)}
				${this.html_ligacoes(d)}
				<div class="cf-painel-seccao">
					<div class="cf-painel-seccao-titulo">${__("Histórico")}</div>
					${this.html_historico(d.historico)}
				</div>
			</div>
		`);

		const campo = (seccao, df) => this.criar_controlo(seccao, df, l);
		campo("pagamento", { fieldname: "valor", label: __("Valor"), fieldtype: "Currency" });
		campo("pagamento", { fieldname: "estado", label: __("Estado"), fieldtype: "Select", options: ESTADOS.join("\n") });
		campo("pagamento", { fieldname: "data_pretendida", label: __("Data pretendida"), fieldtype: "Date" });
		campo("pagamento", { fieldname: "valor_pago", label: __("Valor Pago"), fieldtype: "Currency" });
		campo("pagamento", { fieldname: "data_pagamento", label: __("Pago em"), fieldtype: "Date" });
		campo("pagamento", { fieldname: "metodo_pagamento", label: __("Método"), fieldtype: "Select", options: [""].concat(this.metodos).join("\n") });
		campo("pagamento", { fieldname: "prioridade", label: __("Prioridade"), fieldtype: "Select", options: "\n1\n2\n3\n4" });
		campo("detalhes", { fieldname: "descricao", label: __("Descrição"), fieldtype: "Data" });
		campo("detalhes", { fieldname: "categoria", label: __("Categoria"), fieldtype: "Link", options: "Categoria de Despesa" });
		campo("detalhes", { fieldname: "fornecedor", label: __("Fornecedor"), fieldtype: "Link", options: "Supplier" });
		if (l.despesa_recorrente) {
			campo("detalhes", { fieldname: "despesa_recorrente", label: __("Despesa Recorrente"), fieldtype: "Data", read_only: 1 });
		}
		campo("documentos", {
			fieldname: "factura",
			label: __("Factura (Purchase Invoice)"),
			fieldtype: "Link",
			options: "Purchase Invoice",
			get_query: () => ({ filters: { docstatus: ["!=", 2] } }),
		});
		campo("documentos", { fieldname: "ordem_compra", label: __("Ordem de Compra"), fieldtype: "Data" });
		campo("observacoes", { fieldname: "observacoes", label: "", fieldtype: "Small Text" });

		this.$painel.find(".cf-painel-fechar").on("click", () => this.fechar_painel());
		this.$painel.find(".cf-painel-ant").on("click", () => this.mover_painel(-1));
		this.$painel.find(".cf-painel-seg").on("click", () => this.mover_painel(1));
		this.$painel.on("click", ".cf-painel-ir", (e) => {
			const $a = $(e.currentTarget);
			this.ir_para(cint($a.attr("data-ano")), $a.attr("data-mes"), `tr[data-name="${$a.attr("data-linha")}"]`);
		});
		this.$painel.on("click", ".cf-painel-caixa", () => {
			this.caixa_ano = this.doc.ano;
			this.caixa_mes = this.doc.mes;
			this.aba = ABA_CAIXA;
			this.render_abas();
			this.abrir_aba(ABA_CAIXA);
		});
	}

	criar_controlo(seccao, df, linha) {
		const controlo = frappe.ui.form.make_control({
			parent: this.$painel.find(`[data-seccao="${seccao}"]`),
			df: { ...df, read_only: df.read_only || (this.painel.so_leitura ? 1 : 0) },
			render_input: true,
		});
		controlo.set_value(linha[df.fieldname] == null ? "" : linha[df.fieldname]);
		controlo.guardado = linha[df.fieldname] == null ? "" : linha[df.fieldname];
		// Attached after the first set_value, and compared with the last saved
		// value, so filling the panel never saves anything by itself.
		controlo.df.change = () => {
			const valor = controlo.get_value() == null ? "" : controlo.get_value();
			if (String(valor) === String(controlo.guardado)) return;
			controlo.guardado = valor;
			const nome = this.painel.nome;
			this.guardar_campo_linha(nome, df.fieldname, valor).then((r) => {
				if (df.fieldname === "factura" && this.painel && this.painel.nome === nome) this.abrir_painel(nome);
				return r;
			});
		};
		this.painel.controlos[df.fieldname] = controlo;
	}

	// After a save: show what the server changed too (e.g. Pago → Valor Pago
	// and Pago em), without touching the field being edited.
	atualizar_painel(linha, campo_editado) {
		for (const [campo, controlo] of Object.entries(this.painel.controlos)) {
			if (campo === campo_editado) continue;
			const valor = linha[campo] == null ? "" : linha[campo];
			if (String(valor) === String(controlo.guardado)) continue;
			controlo.guardado = valor;
			controlo.set_input(valor);
		}
		this.$painel
			.find(".cf-painel-estado")
			.attr("class", `cf-painel-estado cf-estado-${ESTADO_CLASS[linha.estado] || "pendente"}`)
			.text(linha.estado);
		this.$painel.find(".cf-painel-nome").text(linha.descricao);
	}

	html_factura(f) {
		if (!f) return "";
		const aberto = f.outstanding_amount > 0;
		return `
			<div class="cf-painel-cartao">
				<div><a href="/app/purchase-invoice/${encodeURIComponent(f.name)}" target="_blank" rel="noopener"><b>${esc(f.name)}</b> ↗</a>
					<span class="cf-painel-pill">${esc(f.docstatus === 0 ? __("Rascunho") : f.status)}</span></div>
				<div class="text-muted">${esc(f.supplier_name || "")}</div>
				<div class="cf-painel-factura-numeros">
					<span>${__("Total")} <b>${dinheiro(f.base_grand_total)}</b></span>
					<span class="${aberto ? "cf-laranja" : "cf-verde"}">${__("Em aberto")} <b>${dinheiro(f.outstanding_amount)}</b></span>
					${f.due_date ? `<span>${__("Vence")} <b>${frappe.datetime.str_to_user(f.due_date)}</b></span>` : ""}
				</div>
			</div>`;
	}

	html_caixa_painel(r) {
		if (!r) return "";
		const linha = (label, valor, cls = "") =>
			`<div class="cf-painel-caixa-linha"><span class="text-muted">${label}</span><span class="${cls}">${dinheiro(valor)}</span></div>`;
		return `
			<div class="cf-painel-seccao">
				<div class="cf-painel-seccao-titulo">💰 ${__("Caixa em {0}", [esc(this.doc.mes)])}</div>
				<div class="cf-painel-cartao">
					${linha(__("Saldo no início do mês"), r.saldo_inicial)}
					${linha(__("Reforços"), r.reforcos, "cf-verde")}
					${linha(__("Gastos"), r.gastos, r.gastos ? "cf-laranja" : "")}
					${linha(__("Saldo no fim do mês"), r.saldo_final, r.saldo_final < 0 ? "cf-vermelho" : "")}
					${linha(__("Saldo actual"), r.saldo_atual, r.saldo_atual < 0 ? "cf-vermelho" : "cf-verde")}
				</div>
				<div class="text-muted cf-painel-nota">${__("O Valor desta linha é o reforço do mês. Deixe 0 para não reforçar — a Caixa continua com o que sobrou.")}</div>
				<a class="cf-painel-caixa">${__("Abrir a Caixa")} →</a>
			</div>`;
	}

	html_ligacoes(d) {
		const itens = [];
		const link = (l, texto) =>
			`<a class="cf-painel-ir" data-ano="${l.ano}" data-mes="${esc(l.mes)}" data-linha="${esc(l.name)}">${texto}</a>`;
		if (d.origem) itens.push(`← ${link(d.origem, __("Veio de {0}", [esc(d.origem.titulo)]))} <span class="text-muted">(${esc(d.origem.estado)})</span>`);
		if (d.destino) itens.push(`→ ${link(d.destino, __("Movida para {0}", [esc(d.destino.titulo)]))} <span class="text-muted">(${esc(d.destino.estado)} · ${dinheiro(d.destino.valor)})</span>`);
		if (d.caixa) itens.push(`💰 <a class="cf-painel-caixa">${__("Reforço na Caixa")}</a> <span class="text-muted">(${dinheiro(d.caixa.valor)} · ${frappe.datetime.str_to_user(d.caixa.data)})</span>`);
		if (!itens.length) return "";
		return `<div class="cf-painel-seccao"><div class="cf-painel-seccao-titulo">${__("Ligações")}</div>${itens.map((i) => `<div class="cf-painel-ligacao">${i}</div>`).join("")}</div>`;
	}

	html_historico(historico) {
		if (!historico.length) return `<div class="text-muted cf-painel-vazio">${__("Sem alterações registadas.")}</div>`;
		const valor = (v) => (v === null || v === undefined || v === "" ? "—" : esc(v));
		return `<div class="cf-painel-historico">${historico
			.map(
				(h) => `<div class="cf-painel-evento">
					<div class="text-muted">${frappe.datetime.str_to_user(h.quando)} · ${esc(frappe.user.full_name(h.quem))}</div>
					<div>${h.criada ? __("Linha criada") : `${esc(h.campo)}: ${valor(h.antes)} → <b>${valor(h.depois)}</b>`}</div>
				</div>`,
			)
			.join("")}</div>`;
	}

	anunciar_fecho() {
		const [ano, mes] = mes_seguinte(this.doc.ano, this.doc.mes);
		const $alerta = frappe.show_alert(
			{
				message: `✅ ${__("{0} 100% liquidado — plano fechado.", [esc(this.titulo_aba(this.aba))])}
					<a class="cf-alerta-link">${__("Seguir para {0}", [mes])} →</a>`,
				indicator: "green",
			},
			8,
		);
		$alerta && $alerta.find(".cf-alerta-link").on("click", () => this.ir_para(ano, mes, null));
		this.abrir_aba(this.aba); // redraw read-only
	}

	// Past the Data pretendida and still not settled → red date, "Em atraso".
	marcar_atrasos() {
		const hoje = frappe.datetime.get_today();
		let n = 0;
		this.$conteudo.find("tbody tr").each((_i, tr) => {
			const $tr = $(tr);
			const $data = $tr.find('[data-campo="data_pretendida"]');
			const data = $data.length ? $data[0].dataset.iso : "";
			const estado = $tr.find('[data-campo="estado"]').val();
			const atraso =
				!!data && data < hoje && estado !== "Pago" && !ESTADOS_FORA_DO_MES.includes(estado) && !$tr.hasClass("cf-caixa-sem-reforco");
			$tr.toggleClass("cf-em-atraso-linha", atraso);
			$data.toggleClass("cf-atrasado", atraso);
			if (atraso) n++;
		});
		this.$conteudo.find(".cf-atraso-n").text(n ? `(${n})` : "");
	}

	filtros_ativos() {
		return (
			Object.keys(this.filtros).length + (this.so_por_pagar ? 1 : 0) + (this.so_em_atraso ? 1 : 0) + (this.pesquisa ? 1 : 0)
		);
	}

	aplicar_filtros() {
		const txt = (this.pesquisa || "").toLowerCase();
		let visiveis = 0;
		const $linhas = this.$conteudo.find("tbody tr");

		$linhas.each((_i, tr) => {
			const $tr = $(tr);
			const valor = (campo) => $tr.find(`[data-campo="${campo}"]`).val() || "";
			const estado = valor("estado");

			let mostrar =
				!this.so_por_pagar ||
				(estado !== "Pago" && !ESTADOS_FORA_DO_MES.includes(estado) && !$tr.hasClass("cf-caixa-sem-reforco"));
			if (this.so_em_atraso && !$tr.hasClass("cf-em-atraso-linha")) mostrar = false;
			for (const [campo, aceites] of Object.entries(this.filtros)) {
				if (!aceites.has(valor(campo))) mostrar = false;
			}
			if (mostrar && txt) {
				const texto = $tr
					.find("input.cf-cell")
					.map((_j, el) => el.value)
					.get()
					.join(" ")
					.toLowerCase();
				mostrar = texto.includes(txt);
			}
			$tr.toggle(mostrar);
			if (mostrar) visiveis++;
			else if (this.selecionadas.delete($tr.attr("data-name"))) {
				$tr.removeClass("cf-selecionada").find(".cf-sel").prop("checked", false);
			}
		});
		this.atualizar_barra_lote();

		this.$conteudo.find(".cf-filtro-btn").each((_i, el) => {
			$(el).toggleClass("ativo", !!this.filtros[el.getAttribute("data-campo")]);
		});
		this.$conteudo
			.find(".cf-por-pagar")
			.toggleClass("btn-primary", this.so_por_pagar)
			.toggleClass("btn-default", !this.so_por_pagar);
		this.$conteudo
			.find(".cf-em-atraso")
			.toggleClass("btn-danger", this.so_em_atraso)
			.toggleClass("btn-default", !this.so_em_atraso);
		this.$conteudo.find(".cf-limpar-filtros").toggle(this.filtros_ativos() > 0);
		this.$conteudo.find(".cf-contagem").text(__("{0} de {1} linhas", [visiveis, $linhas.length]));
		this.atualizar_rodape();
	}

	// TOTAL row: the plan totals, or — while filtering — the total of the
	// visible lines only (like Excel's SUBTOTAL on a filtered table).
	atualizar_rodape() {
		const $valor = this.$conteudo.find(".cf-total-valor");
		const $pago = this.$conteudo.find(".cf-total-pago");
		const $label = this.$conteudo.find(".cf-total-label");
		if (!this.filtros_ativos()) {
			const p = this.cabecalho || this.doc;
			$label.text(__("TOTAL"));
			$valor.text(dinheiro(p.total_previsto));
			$pago.text(dinheiro(p.total_pago));
			return;
		}

		let total = 0;
		let pago = 0;
		this.$conteudo.find("tbody tr:visible").each((_i, tr) => {
			const $tr = $(tr);
			const valor_pago = flt($tr.find('[data-campo="valor_pago"]').val());
			const estado = $tr.find('[data-campo="estado"]').val();
			total += ESTADOS_FORA_DO_MES.includes(estado) ? valor_pago : flt($tr.find('[data-campo="valor"]').val());
			pago += valor_pago;
		});
		$label.text(__("TOTAL (filtrado)"));
		$valor.text(dinheiro(total));
		$pago.text(dinheiro(pago));
	}

	abrir_menu_filtro($btn) {
		const campo = $btn.attr("data-campo");
		const aberto = this.$menu_filtro && this.$menu_filtro.attr("data-campo") === campo;
		this.fechar_menu_filtro();
		if (aberto) return;

		const coluna = COLUNAS_PLANO.find((c) => c.campo === campo);
		const contagem = new Map();
		this.$conteudo.find(`tbody [data-campo="${campo}"]`).each((_i, el) => {
			const v = el.value || "";
			contagem.set(v, (contagem.get(v) || 0) + 1);
		});
		// Same order as the column's dropdown, then anything else found.
		const ordem = coluna.opcoes(this).filter((v) => contagem.has(v));
		const valores = ordem.concat([...contagem.keys()].filter((v) => !ordem.includes(v)));
		const aceites = this.filtros[campo];
		const marcado = (v) => !aceites || aceites.has(v);

		const $menu = $(`
			<div class="cf-filtro-menu" data-campo="${campo}">
				<div class="cf-filtro-titulo">${__(coluna.label)}</div>
				<label class="cf-filtro-op cf-filtro-todos">
					<input type="checkbox" ${!aceites ? "checked" : ""}> ${__("(Selecionar tudo)")}
				</label>
				<div class="cf-filtro-lista">${valores
					.map(
						(v) => `<label class="cf-filtro-op">
							<input type="checkbox" value="${esc(v)}" ${marcado(v) ? "checked" : ""}>
							<span>${v ? esc(v) : `<i class="text-muted">${__("(vazio)")}</i>`}</span>
							<span class="cf-filtro-n">${contagem.get(v)}</span>
						</label>`,
					)
					.join("")}</div>
				<div class="cf-filtro-rodape">
					<button class="btn btn-xs btn-default cf-filtro-limpar">${__("Limpar filtro")}</button>
				</div>
			</div>
		`).appendTo(document.body);

		const r = $btn[0].getBoundingClientRect();
		$menu.css({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 260)) });

		const aplicar = () => {
			const $ops = $menu.find(".cf-filtro-lista input");
			const escolhidos = new Set($ops.filter(":checked").map((_i, el) => el.value).get());
			if (escolhidos.size === $ops.length) delete this.filtros[campo];
			else this.filtros[campo] = escolhidos;
			$menu.find(".cf-filtro-todos input").prop("checked", escolhidos.size === $ops.length);
			this.aplicar_filtros();
		};
		$menu.on("change", ".cf-filtro-lista input", aplicar);
		$menu.find(".cf-filtro-todos input").on("change", (e) => {
			$menu.find(".cf-filtro-lista input").prop("checked", $(e.currentTarget).is(":checked"));
			aplicar();
		});
		$menu.find(".cf-filtro-limpar").on("click", () => {
			delete this.filtros[campo];
			this.aplicar_filtros();
			this.fechar_menu_filtro();
		});

		this.$menu_filtro = $menu;
		$(document).on("mousedown.cf-filtro", (e) => {
			if (!$(e.target).closest(".cf-filtro-menu, .cf-filtro-btn").length) this.fechar_menu_filtro();
		});
		$(document).on("keydown.cf-filtro", (e) => e.key === "Escape" && this.fechar_menu_filtro());
		this.$conteudo.find(".cf-grelha-wrap").one("scroll", () => this.fechar_menu_filtro());
	}

	fechar_menu_filtro() {
		if (this.$menu_filtro) this.$menu_filtro.remove();
		this.$menu_filtro = null;
		$(document).off(".cf-filtro");
	}

	// Saves run one at a time, in order, like typing in a spreadsheet. On
	// failure the sheet is reloaded so it never shows unsaved values.
	guardar(fn) {
		this.fila = this.fila.then(fn).catch(() => this.abrir_aba(this.aba));
		return this.fila;
	}

	// ------------------------------------------------------------------
	// Import from Excel (upload → preview → choose sheets → import)
	// ------------------------------------------------------------------

	importar_excel() {
		new frappe.ui.FileUploader({
			allow_multiple: false,
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => {
				frappe
					.xcall("entre_erp.importar_cashflow.pre_visualizar_ficheiro", { file_url: file.file_url, ano: this.ano })
					.then((folhas) => this.dialogo_importacao(file.file_url, folhas));
			},
		});
	}

	dialogo_importacao(file_url, folhas) {
		if (!folhas.length) {
			frappe.msgprint(__("Nenhuma folha reconhecida. Os nomes das folhas devem ser os meses (Janeiro … Dezembro) ou Investimentos."));
			return;
		}

		const d = new frappe.ui.Dialog({
			title: __("Importar Excel para {0}", [this.ano]),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "tabela" }],
			primary_action_label: __("Importar"),
			primary_action: () => {
				const marcadas = folhas.filter((_f, i) => d.$wrapper.find(`.cf-imp-check[data-i="${i}"]`).is(":checked"));
				if (!marcadas.length) return frappe.msgprint(__("Selecione pelo menos uma folha."));

				const substituir = marcadas.filter((f) => f.existe).map((f) => f.nome);
				const executar = () =>
					frappe
						.xcall("entre_erp.importar_cashflow.importar_ficheiro", {
							file_url,
							ano: this.ano,
							planos: marcadas.map((f) => f.nome),
							substituir,
						})
						.then((resultado) => {
							d.hide();
							frappe.msgprint({
								title: __("Importação concluída"),
								message: `<pre class="cf-imp-resultado">${esc((resultado || []).join("\n"))}</pre>`,
								wide: true,
							});
							this.carregar_ano();
						});

				if (!substituir.length) return executar();
				frappe.confirm(
					__("Os planos {0} já existem e serão <b>substituídos</b> pelos dados do Excel (as alterações feitas no ERP perdem-se). Continuar?", [
						substituir.join(", "),
					]),
					executar,
				);
			},
		});

		d.fields_dict.tabela.$wrapper.html(`
			<p class="text-muted">${__("Folhas novas vêm marcadas. Folhas de meses que já existem vêm desmarcadas — marque-as para as substituir.")}</p>
			<table class="table table-bordered cf-imp-tabela">
				<thead><tr>
					<th style="width:40px"><input type="checkbox" class="cf-imp-todas"></th>
					<th>${__("Folha")}</th>
					<th class="text-right">${__("Linhas")}</th>
					<th class="text-right">${__("Previsto")}</th>
					<th class="text-right">${__("Pago")}</th>
					<th class="text-right">${__("Remanescente")}</th>
					<th>${__("Situação")}</th>
					<th>${__("Avisos")}</th>
				</tr></thead>
				<tbody>${folhas
					.map(
						(f, i) => `<tr>
							<td><input type="checkbox" class="cf-imp-check" data-i="${i}" ${f.existe ? "" : "checked"}></td>
							<td><b>${esc(f.titulo)}</b> <span class="text-muted">${esc(f.nome)}</span></td>
							<td class="text-right">${f.linhas}</td>
							<td class="text-right">${dinheiro(f.total_previsto)}</td>
							<td class="text-right">${dinheiro(f.total_pago)}</td>
							<td class="text-right">${dinheiro(f.total_remanescente)}</td>
							<td>${
								f.existe
									? `<span class="indicator-pill orange">${__("Já existe — substituir")}</span>`
									: `<span class="indicator-pill green">${__("Novo")}</span>`
							}</td>
							<td>${
								f.avisos.length
									? `<details><summary>${__("{0} aviso(s)", [f.avisos.length])}</summary>
										<ul class="cf-imp-avisos">${f.avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details>`
									: `<span class="text-muted">—</span>`
							}</td>
						</tr>`,
					)
					.join("")}</tbody>
			</table>
		`);
		d.$wrapper.find(".cf-imp-todas").on("change", (e) =>
			d.$wrapper.find(".cf-imp-check").prop("checked", $(e.currentTarget).is(":checked")),
		);
		d.show();
	}

	// ------------------------------------------------------------------
	// Resumo Anual
	// ------------------------------------------------------------------

	carregar_resumo() {
		frappe.xcall(API + "resumo_anual", { ano: this.ano }).then((d) => this.render_resumo(d));
	}

	render_resumo(d) {
		if (!d.categorias.length) {
			this.$conteudo.html(`<div class="cf-vazio">${__("Sem planos mensais em {0}.", [this.ano])}</div>`);
			return;
		}

		const soma = (valores) => MESES.reduce((t, m) => t + (valores[m] || 0), 0);
		const meses_com_plano = MESES.filter((m) => d.totais[m]).length || 1;
		const celulas = (valores, cls = "") =>
			MESES.map((m) => `<td class="cf-num ${cls}">${valores[m] ? dinheiro(valores[m]) : ""}</td>`).join("") +
			`<td class="cf-num cf-col-total ${cls}">${dinheiro(soma(valores))}</td>` +
			`<td class="cf-num ${cls}">${dinheiro(soma(valores) / meses_com_plano)}</td>`;

		const corpo = d.categorias
			.map((cat) => {
				const subtotal = {};
				cat.itens.forEach((it) => MESES.forEach((m) => (subtotal[m] = (subtotal[m] || 0) + (it.valores[m] || 0))));
				return (
					`<tr class="cf-cat"><td class="cf-fixa">${esc(cat.categoria)}</td>${celulas(subtotal)}</tr>` +
					cat.itens.map((it) => `<tr><td class="cf-fixa cf-item">${esc(it.item)}</td>${celulas(it.valores)}</tr>`).join("")
				);
			})
			.join("");

		const linha_total = (label, chave, cls) => {
			const valores = {};
			MESES.forEach((m) => (valores[m] = d.totais[m] ? d.totais[m][chave] : 0));
			return `<tr class="cf-total ${cls}"><td class="cf-fixa">${label}</td>${celulas(valores)}</tr>`;
		};

		this.$conteudo.html(`
			<div class="cf-grafico"></div>
			<div class="cf-grelha-wrap">
				<table class="cf-grelha cf-resumo">
					<thead><tr>
						<th class="cf-fixa" style="min-width:240px">${__("Despesa")}</th>
						${MESES_CURTOS.map((m, i) => `<th class="cf-num cf-mes-link" data-aba="${MESES[i]}" style="min-width:110px">${m}</th>`).join("")}
						<th class="cf-num" style="min-width:130px">${__("Total")}</th>
						<th class="cf-num" style="min-width:110px">${__("Média")}</th>
					</tr></thead>
					<tbody>${corpo}</tbody>
					<tfoot>
						${linha_total(__("Total Previsto"), "previsto", "")}
						${linha_total(__("Total Pago"), "pago", "cf-verde")}
						${linha_total(__("Remanescente"), "remanescente", "cf-laranja")}
					</tfoot>
				</table>
			</div>
		`);

		this.$conteudo.find(".cf-mes-link").on("click", (e) => this.abrir_aba($(e.currentTarget).attr("data-aba")));

		new frappe.Chart(this.$conteudo.find(".cf-grafico")[0], {
			type: "bar",
			height: 220,
			data: {
				labels: MESES_CURTOS,
				datasets: [
					{ name: __("Previsto"), values: MESES.map((m) => (d.totais[m] ? d.totais[m].previsto : 0)) },
					{ name: __("Pago"), values: MESES.map((m) => (d.totais[m] ? d.totais[m].pago : 0)) },
				],
			},
			barOptions: { spaceRatio: 0.4 },
			tooltipOptions: { formatTooltipY: (v) => dinheiro(v) },
		});
	}

	// ------------------------------------------------------------------
	// Caixa (petty cash) — its own running balance, month by month
	// ------------------------------------------------------------------

	carregar_caixa(focar) {
		const hoje = new Date();
		this.caixa_ano = this.caixa_ano || hoje.getFullYear();
		this.caixa_mes = this.caixa_mes || MESES[hoje.getMonth()];
		frappe
			.xcall(API_CAIXA + "obter_caixa", { ano: this.caixa_ano, mes: this.caixa_mes })
			.then((d) => this.render_caixa(d, focar));
	}

	mudar_mes_caixa(delta) {
		const [ano, mes] = (delta > 0 ? mes_seguinte : mes_anterior)(this.caixa_ano, this.caixa_mes);
		this.caixa_ano = ano;
		this.caixa_mes = mes;
		this.carregar_caixa();
	}

	render_caixa(d, focar) {
		this.caixa = d;
		this.$conteudo.html(`
			<div class="cf-caixa-topo">
				<div class="cf-ano">
					<button class="btn btn-default btn-sm cf-caixa-ant" title="${__("Mês anterior")}">‹</button>
					<span class="cf-caixa-mes">${esc(d.mes)} ${d.ano}</span>
					<button class="btn btn-default btn-sm cf-caixa-seg" title="${__("Mês seguinte")}">›</button>
				</div>
				<span class="text-muted cf-ajuda">${__("Os reforços entram sozinhos quando a linha Caixa do plano é paga. Registe aqui cada gasto.")}</span>
			</div>
			<div class="cf-cabecalho cf-caixa-resumo"></div>
			<div class="cf-caixa-reforco">${this.html_reforco_do_mes(d.reforco_do_mes, d.resumo)}</div>
			<div class="cf-grelha-wrap">
				<table class="cf-grelha">
					<thead><tr>
						<th class="cf-idx">#</th>
						${COLUNAS_CAIXA.map((c) => `<th class="${c.fixa ? "cf-fixa" : ""} ${c.tipo === "num" ? "cf-num" : ""}" style="min-width:${c.largura}px">${__(c.label)}</th>`).join("")}
						<th class="cf-num" style="min-width:120px">${__("Saldo")}</th>
						<th style="min-width:90px"></th>
					</tr></thead>
					<tbody>${d.movimentos.map((m, i) => this.html_movimento(m, i + 1)).join("")}</tbody>
					<tfoot>
						<tr class="cf-nova"><td class="cf-idx">+</td>${COLUNAS_CAIXA.map((c) =>
							c.fixa
								? `<td class="cf-fixa"><input class="cf-cell cf-nova-input" placeholder="${__("Novo gasto… (Enter)")}"></td>`
								: "<td></td>",
						).join("")}<td></td><td></td></tr>
					</tfoot>
				</table>
			</div>
		`);
		this.render_resumo_caixa(d.resumo);
		this.recalcular_saldos_caixa();
		this.bind_caixa();
		if (focar) this.$conteudo.find(`tr[data-name="${focar}"] [data-campo="valor"]`).trigger("focus");
	}

	html_reforco_do_mes(rf, resumo) {
		const titulo = `<b>${__("Reforço de {0}", [esc(this.caixa_mes)])}</b>`;
		const abrir_plano = `<a class="cf-reforco-plano">${__("Abrir o plano")} ↗</a>`;
		if (!rf.plano) {
			return `${titulo} <span class="text-muted">— ${__("ainda não há plano para {0}.", [esc(this.caixa_mes)])}</span> ${abrir_plano}`;
		}
		if (!rf.linha) {
			return `${titulo} <span class="text-muted">— ${__("o plano não tem linha Caixa.")}</span>
				${rf.editavel ? `<button class="btn btn-default btn-xs cf-reforco-adicionar">${__("Adicionar ao plano")}</button>` : ""} ${abrir_plano}`;
		}

		const l = rf.linha;
		const pago = ["Pago", "Parcialmente Pago"].includes(l.estado);
		// What the Caixa will have once this top-up is paid (if it isn't yet).
		const depois = pago ? resumo.saldo_atual : resumo.saldo_atual + (l.valor || 0);
		const bloqueado = !rf.editavel
			? `<span class="text-muted">${
					rf.bloqueio
						? __("— bloqueado: {0} ainda tem pagamentos por liquidar.", [esc(rf.bloqueio.titulo)])
						: __("— o plano de {0} está fechado.", [esc(this.caixa_mes)])
				}</span>`
			: "";
		return `
			${titulo}
			<label class="cf-reforco-campo">${__("Valor")}
				<input class="form-control input-sm cf-reforco-valor" inputmode="decimal" value="${l.valor ? esc(dinheiro(l.valor)) : ""}" placeholder="0,00" ${rf.editavel ? "" : "disabled"}>
			</label>
			<label class="cf-reforco-campo">${__("Estado")}
				<select class="form-control input-sm cf-reforco-estado" ${rf.editavel ? "" : "disabled"}>
					${ESTADOS.map((e) => `<option ${e === l.estado ? "selected" : ""}>${e}</option>`).join("")}
				</select>
			</label>
			<span class="text-muted cf-reforco-nota">${
				!l.valor
					? __("Sem reforço — a Caixa continua com {0}.", [dinheiro(resumo.saldo_atual)])
					: pago
						? __("Pago — já entrou na Caixa.")
						: __("Quando for pago, a Caixa fica com {0}.", [dinheiro(depois)])
			}</span>
			${bloqueado}
			${abrir_plano}`;
	}

	guardar_reforco(campo, valor) {
		const rf = this.caixa.reforco_do_mes;
		this.guardar(() =>
			frappe
				.xcall(API + "atualizar_linha", { plano: rf.plano, linha: rf.linha.name, campo, valor })
				.then((r) => {
					if (r.plano.fechado_automaticamente) {
						frappe.show_alert({ message: __("{0} 100% liquidado — plano fechado.", [rf.titulo]), indicator: "green" });
					}
					// Paying it creates the top-up movement: reload the month.
					this.carregar_caixa();
				}),
		);
	}

	html_movimento(m, idx) {
		// Top-ups that come from a plan can only be changed there.
		const do_plano = !!m.plano;
		const mes_plano = do_plano ? MESES[cint(m.plano.split("-")[2]) - 1] : null;
		return `
			<tr data-name="${esc(m.name)}" class="${m.tipo === "Reforço" ? "cf-reforco" : ""}">
				<td class="cf-idx">${idx}</td>
				${COLUNAS_CAIXA.map((c) => `<td class="${c.fixa ? "cf-fixa" : ""}">${html_celula(c, m[c.campo], this, do_plano && c.campo !== "observacoes" && c.campo !== "categoria")}</td>`).join("")}
				<td class="cf-num cf-saldo"></td>
				<td class="cf-acoes">${
					do_plano
						? `<button class="cf-salto-plano" data-plano="${esc(m.plano)}" data-linha="${esc(m.linha_plano)}" data-mes="${esc(mes_plano)}" title="${__("Vem do plano {0}", [m.plano])}">↗ ${curto(mes_plano)}</button>`
						: `<button class="btn btn-xs btn-link cf-remover" title="${__("Remover")}">×</button>`
				}</td>
			</tr>`;
	}

	render_resumo_caixa(r) {
		this.caixa.resumo = r;
		const card = (label, valor, cls = "") =>
			`<div class="cf-kpi"><div class="cf-kpi-label">${label}</div><div class="cf-kpi-valor ${cls}">${dinheiro(valor)}</div></div>`;
		this.$conteudo.find(".cf-caixa-resumo").html(`
			<div class="cf-kpis cf-kpis-5">
				${card(__("Saldo actual"), r.saldo_atual, r.saldo_atual < 0 ? "cf-vermelho" : "cf-verde")}
				${card(__("Saldo no início do mês"), r.saldo_inicial)}
				${card(__("Reforços do mês"), r.reforcos, "cf-verde")}
				${card(__("Gastos do mês"), r.gastos, r.gastos ? "cf-laranja" : "")}
				${card(__("Saldo no fim do mês"), r.saldo_final, r.saldo_final < 0 ? "cf-vermelho" : "")}
			</div>
			<div class="cf-metodos">${r.por_categoria
				.map((c) => `<span class="cf-metodo"><b>${esc(c.categoria)}</b> ${dinheiro(c.valor)}</span>`)
				.join("")}</div>
		`);
	}

	// Running balance, top to bottom, starting from the month's opening balance.
	recalcular_saldos_caixa() {
		let saldo = this.caixa.resumo.saldo_inicial;
		this.$conteudo.find("tbody tr").each((_i, tr) => {
			const $tr = $(tr);
			const valor = flt($tr.find('[data-campo="valor"]').val());
			const reforco = $tr.find('[data-campo="tipo"]').val() === "Reforço";
			saldo += reforco ? valor : -valor;
			$tr.toggleClass("cf-reforco", reforco);
			$tr.find(".cf-saldo").text(dinheiro(saldo)).toggleClass("cf-vermelho", saldo < 0);
		});
	}

	bind_caixa() {
		const $c = this.$conteudo.off();
		const args = () => ({ ano: this.caixa_ano, mes: this.caixa_mes });

		$c.find(".cf-caixa-ant").on("click", () => this.mudar_mes_caixa(-1));
		$c.find(".cf-caixa-seg").on("click", () => this.mudar_mes_caixa(1));

		$c.find(".cf-reforco-valor").on("change", (e) => this.guardar_reforco("valor", flt($(e.currentTarget).val())));
		$c.find(".cf-reforco-estado").on("change", (e) => this.guardar_reforco("estado", $(e.currentTarget).val()));
		$c.find(".cf-reforco-adicionar").on("click", () =>
			this.guardar(() =>
				frappe
					.xcall(API_CAIXA + "adicionar_linha_caixa", args())
					.then((d) => this.render_caixa(d)),
			),
		);
		$c.find(".cf-reforco-plano").on("click", () => {
			const rf = this.caixa.reforco_do_mes;
			this.ir_para(this.caixa_ano, this.caixa_mes, rf.linha ? `tr[data-name="${rf.linha.name}"]` : null);
		});

		$c.on("change", "tbody .cf-cell", (e) => {
			const $el = $(e.currentTarget);
			const coluna = COLUNAS_CAIXA.find((c) => c.campo === $el.attr("data-campo"));
			const valor = ler_celula(coluna, $el);
			this.recalcular_saldos_caixa();
			this.guardar(() =>
				frappe
					.xcall(API_CAIXA + "atualizar_movimento", {
						nome: $el.closest("tr").attr("data-name"),
						campo: coluna.campo,
						valor,
						...args(),
					})
					.then((r) => this.render_resumo_caixa(r.resumo)),
			);
		});

		$c.on("keydown", "tbody .cf-cell", (e) => {
			if (e.key !== "Enter") return;
			e.preventDefault();
			const campo = $(e.currentTarget).attr("data-campo");
			const $prox = $(e.currentTarget).closest("tr").next();
			const $alvo = $prox.length ? $prox.find(`[data-campo="${campo}"]`) : $c.find(".cf-nova-input");
			($alvo.length ? $alvo : $(e.currentTarget)).trigger("focus");
		});

		$c.on("focus", "tbody .cf-data", (e) => {
			const el = e.currentTarget;
			if (el.disabled) return;
			el.type = "date";
			el.value = el.dataset.iso || "";
		});
		$c.on("blur", "tbody .cf-data", (e) => {
			const el = e.currentTarget;
			if (el.type === "date") el.dataset.iso = el.value;
			el.type = "text";
			el.value = data_utilizador(el.dataset.iso);
		});
		$c.on("blur", "tbody .cf-dinheiro", (e) => {
			const v = flt($(e.currentTarget).val());
			$(e.currentTarget).val(v ? dinheiro(v) : "");
		});

		$c.on("keydown", ".cf-nova-input", (e) => {
			const descricao = $(e.currentTarget).val().trim();
			if (e.key !== "Enter" || !descricao) return;
			this.guardar(() =>
				frappe
					.xcall(API_CAIXA + "adicionar_movimento", { descricao, ...args() })
					.then((r) => this.render_caixa(r.caixa, r.nome)),
			);
		});

		$c.on("click", ".cf-remover", (e) => {
			const $tr = $(e.currentTarget).closest("tr");
			const descricao = $tr.find('[data-campo="descricao"]').val();
			frappe.confirm(__("Remover {0}?", [`<b>${esc(descricao)}</b>`]), () =>
				this.guardar(() =>
					frappe
						.xcall(API_CAIXA + "remover_movimentos", { nomes: [$tr.attr("data-name")], ...args() })
						.then((d) => this.render_caixa(d)),
				),
			);
		});

		$c.on("click", ".cf-salto-plano", (e) => {
			const $b = $(e.currentTarget);
			const ano = cint($b.attr("data-plano").split("-")[1]);
			this.ir_para(ano, $b.attr("data-mes"), `tr[data-name="${$b.attr("data-linha")}"]`);
		});
	}

	// ------------------------------------------------------------------
	// Despesas Recorrentes
	// ------------------------------------------------------------------

	carregar_recorrentes() {
		frappe
			.xcall("frappe.client.get_list", {
				doctype: "Despesa Recorrente",
				fields: ["name"].concat(COLUNAS_RECORRENTES.map((c) => c.campo)),
				order_by: "categoria asc, despesa asc",
				limit_page_length: 0,
			})
			.then((rows) => this.render_recorrentes(rows));
	}

	render_recorrentes(rows) {
		const total = rows.filter((r) => r.ativo).reduce((t, r) => t + (r.valor_padrao || 0), 0);

		this.$conteudo.html(`
			<p class="text-muted cf-ajuda">
				${__("Estas despesas são copiadas para cada novo plano mensal (no dia 1, ou em Preencher → Copiar Despesas Recorrentes).")}
				${__("Total mensal das ativas:")} <b>${dinheiro(total)}</b>
			</p>
			<div class="cf-grelha-wrap">
				<table class="cf-grelha">
					<thead><tr>
						<th class="cf-idx">#</th>
						${COLUNAS_RECORRENTES.map((c) => `<th class="${c.fixa ? "cf-fixa" : ""} ${c.tipo === "num" ? "cf-num" : ""}" style="min-width:${c.largura}px">${__(c.label)}</th>`).join("")}
						<th></th>
					</tr></thead>
					<tbody>${rows
						.map(
							(r, i) => `<tr data-name="${esc(r.name)}" class="${r.ativo ? "" : "cf-inativo"}">
								<td class="cf-idx">${i + 1}</td>
								${COLUNAS_RECORRENTES.map((c) => `<td class="${c.fixa ? "cf-fixa" : ""}">${html_celula(c, r[c.campo], this)}</td>`).join("")}
								<td class="cf-acoes"><button class="btn btn-xs btn-link cf-remover" title="${__("Remover")}">×</button></td>
							</tr>`,
						)
						.join("")}</tbody>
					<tfoot><tr class="cf-nova"><td class="cf-idx">+</td>
						<td class="cf-fixa"><input class="cf-cell cf-nova-input" placeholder="${__("Nova despesa recorrente… (Enter)")}"></td>
						<td colspan="${COLUNAS_RECORRENTES.length}"></td></tr></tfoot>
				</table>
			</div>
		`);

		const $c = this.$conteudo.off();
		$c.on("change", "tbody .cf-cell", (e) => {
			const $el = $(e.currentTarget);
			const $tr = $el.closest("tr");
			const coluna = COLUNAS_RECORRENTES.find((c) => c.campo === $el.attr("data-campo"));
			const valor = ler_celula(coluna, $el);
			if (coluna.campo === "ativo") $tr.toggleClass("cf-inativo", !valor);
			this.guardar(() =>
				frappe.xcall("frappe.client.set_value", {
					doctype: "Despesa Recorrente",
					name: $tr.attr("data-name"),
					fieldname: coluna.campo,
					value: valor,
				}),
			);
		});
		$c.on("blur", "tbody .cf-dinheiro", (e) => {
			const v = flt($(e.currentTarget).val());
			$(e.currentTarget).val(v ? dinheiro(v) : "");
		});
		$c.on("keydown", ".cf-nova-input", (e) => {
			const despesa = $(e.currentTarget).val().trim();
			if (e.key !== "Enter" || !despesa) return;
			const categoria = this.categorias.includes("Outros") ? "Outros" : this.categorias[0];
			this.guardar(() =>
				frappe
					.xcall("frappe.client.insert", { doc: { doctype: "Despesa Recorrente", despesa, categoria, ativo: 1 } })
					.then(() => this.carregar_recorrentes()),
			);
		});
		$c.on("click", ".cf-remover", (e) => {
			const name = $(e.currentTarget).closest("tr").attr("data-name");
			frappe.confirm(
				__("Remover {0}? Se já foi usada em planos, desmarque Ativo em vez de remover.", [`<b>${esc(name)}</b>`]),
				() =>
					this.guardar(() =>
						frappe
							.xcall("frappe.client.delete", { doctype: "Despesa Recorrente", name })
							.then(() => this.carregar_recorrentes()),
					),
			);
		});
	}
}

// ----------------------------------------------------------------------
// Cells
// ----------------------------------------------------------------------

function html_celula(coluna, valor, sheet, desativado = false) {
	const attrs = `class="cf-cell ${coluna.tipo === "num" || coluna.tipo === "int" ? "cf-num" : ""}" data-campo="${coluna.campo}" ${
		desativado || coluna.so_leitura ? "disabled" : ""
	}`;

	switch (coluna.tipo) {
		case "num":
			return `<input ${attrs.replace('class="cf-cell ', 'class="cf-cell cf-dinheiro ')} inputmode="decimal" value="${valor ? esc(dinheiro(valor)) : ""}">`;
		case "int":
			return `<input ${attrs} inputmode="numeric" value="${valor ? esc(valor) : ""}">`;
		case "date":
			return `<input ${attrs.replace('class="cf-cell ', 'class="cf-cell cf-data ')} type="text" placeholder="-" data-iso="${esc(valor || "")}" value="${esc(data_utilizador(valor))}">`;
		case "link":
			return `<div class="cf-link-wrap">
				<input ${attrs.replace('class="cf-cell ', 'class="cf-cell cf-cell-link ')} value="${esc(valor || "")}" autocomplete="off">
				<a class="cf-link-abrir" href="${url_link(coluna, valor)}" target="_blank" rel="noopener" title="${__("Abrir no ERPNext")}" ${valor ? "" : 'style="display:none"'}>↗</a>
			</div>`;
		case "check":
			return `<input type="checkbox" ${attrs.replace('class="cf-cell ', 'class="cf-cell cf-check ')} ${valor ? "checked" : ""}>`;
		case "select": {
			const opcoes = coluna.opcoes(sheet);
			const atual = valor == null ? "" : String(valor);
			// Keep a value that is no longer in the list (e.g. a disabled
			// payment method) instead of silently showing another one.
			const lista = opcoes.includes(atual) ? opcoes : opcoes.concat([atual]);
			return `<select ${attrs}>${lista
				.map((o) => `<option value="${esc(o)}" ${o === atual ? "selected" : ""}>${esc(o)}</option>`)
				.join("")}</select>`;
		}
		default:
			return `<input ${attrs} value="${esc(valor)}">`;
	}
}

function ler_celula(coluna, $el) {
	if (coluna.tipo === "date") {
		const el = $el[0];
		if (el.type === "date") el.dataset.iso = el.value;
		return el.dataset.iso || "";
	}
	if (coluna.tipo === "num") return flt($el.val());
	if (coluna.tipo === "int") return cint($el.val());
	if (coluna.tipo === "check") return $el.is(":checked") ? 1 : 0;
	return $el.val();
}

// Hidden columns are a per-viewer preference, remembered in this browser.
const CHAVE_COLUNAS = "entre_erp.cashflow.colunas_ocultas.v3";
const COLUNAS_OCULTAS_POR_DEFEITO = ["data_pagamento", "factura"];

function ler_colunas_ocultas() {
	try {
		const texto = localStorage.getItem(CHAVE_COLUNAS);
		const guardadas = texto === null ? COLUNAS_OCULTAS_POR_DEFEITO : JSON.parse(texto);
		return new Set(guardadas.filter((c) => COLUNAS_PLANO.some((col) => col.campo === c && !col.fixa)));
	} catch (e) {
		return new Set(COLUNAS_OCULTAS_POR_DEFEITO);
	}
}

function guardar_colunas_ocultas(ocultas) {
	try {
		localStorage.setItem(CHAVE_COLUNAS, JSON.stringify([...ocultas]));
	} catch (e) {
		// private mode / storage blocked: just don't remember
	}
}

function url_link(coluna, valor) {
	return valor ? `/app/${frappe.router.slug(coluna.doctype)}/${encodeURIComponent(valor)}` : "#";
}

// Same rule as entre_erp.caixa.e_linha_de_caixa
function e_linha_de_caixa(row) {
	if (row.despesa_recorrente === "Caixa") return true;
	const texto = (row.descricao || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
	return texto.startsWith("caixa");
}

function definir_classe_estado($tr, estado) {
	$tr.removeClass((_i, classes) => (classes.match(/cf-estado-\S+/g) || []).join(" "));
	$tr.addClass(`cf-estado-${ESTADO_CLASS[estado] || "pendente"}`);
}

function caixa_sem_reforco(row) {
	return e_linha_de_caixa(row) && !flt(row.valor) && row.estado === "Pendente";
}

function data_utilizador(iso) {
	return iso ? frappe.datetime.str_to_user(iso) : "";
}

function escrever_celula(coluna, $el, valor) {
	if (coluna.tipo === "date") {
		$el[0].dataset.iso = valor || "";
		$el.val(data_utilizador(valor));
		return;
	}
	if (coluna.tipo === "link") {
		$el.val(valor || "");
		$el.siblings(".cf-link-abrir").attr("href", url_link(coluna, valor)).toggle(!!valor);
		return;
	}
	if (coluna.tipo === "num") return $el.val(valor ? dinheiro(valor) : "");
	if (coluna.tipo === "check") return $el.prop("checked", !!valor);
	$el.val(valor == null ? "" : valor);
}

// ----------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------

function inject_styles() {
	if (document.getElementById("cf-sheet-style")) return;
	const style = document.createElement("style");
	style.id = "cf-sheet-style";
	style.innerHTML = `
		.cf-wrapper .container { max-width: 100% !important; }
		.cf-sheet {
			--cf-verde: #16a34a;
			--cf-laranja: #d97706;
			--cf-vermelho: #dc2626;
			--cf-linha: var(--border-color);
			padding-bottom: 56px; /* room for the frozen tab bar */
		}
		html[data-theme="dark"] .cf-sheet {
			--cf-verde: #4ade80;
			--cf-laranja: #fbbf24;
			--cf-vermelho: #f87171;
		}
		.cf-verde { color: var(--cf-verde) !important; }
		.cf-laranja { color: var(--cf-laranja) !important; }

		.cf-topo { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
		.cf-ano { display: flex; align-items: center; gap: 8px; }
		.cf-ano-valor { font-size: 18px; font-weight: 600; min-width: 52px; text-align: center; }
		.cf-topo-direita, .cf-topo-acoes { display: flex; align-items: center; gap: 8px; }
		.cf-imp-tabela td, .cf-imp-tabela th { vertical-align: top; font-size: 13px; }
		.cf-imp-avisos { margin: 6px 0 0; padding-left: 16px; font-size: 12px; color: var(--text-muted); }
		.cf-imp-resultado { white-space: pre-wrap; font-size: 12px; max-height: 60vh; overflow: auto; }
		.cf-topo-acoes .cf-estado-plano { width: 130px; }

		.cf-vazio { padding: 60px 20px; text-align: center; color: var(--text-muted); }
		.cf-vazio p { margin-bottom: 12px; }
		.cf-ajuda { margin-bottom: 10px; }
		.cf-aviso-bloqueio {
			display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
			padding: 10px 14px; margin-bottom: 10px; border-radius: 8px; font-size: 13px;
			border: 1px solid var(--cf-laranja); background: rgba(217, 119, 6, 0.08);
		}
		.cf-aviso-fechado {
			padding: 8px 12px; margin-bottom: 10px; border-radius: 6px;
			background: var(--bg-light-gray, var(--bg-color)); color: var(--text-muted); font-size: 13px;
		}

		/* KPI cards on one row, payment methods as a slim strip of chips under it. */
		.cf-cabecalho { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
		.cf-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
		.cf-kpi {
			padding: 8px 12px; border-radius: 8px;
			background: var(--fg-color); border: 1px solid var(--cf-linha);
		}
		.cf-kpi-label { font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
		.cf-kpi-valor { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.3; }
		.cf-barra { height: 6px; border-radius: 3px; background: var(--cf-linha); margin-top: 10px; overflow: hidden; }
		.cf-barra > div { height: 100%; background: var(--cf-verde); }
		.cf-metodos { display: flex; flex-wrap: wrap; gap: 6px; }
		.cf-metodos:empty { display: none; }
		.cf-metodo {
			display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
			font-size: 12px; border-radius: 12px; font-variant-numeric: tabular-nums;
			background: var(--fg-color); border: 1px solid var(--cf-linha);
		}

		.cf-filtros { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
		.cf-filtros .cf-pesquisa { max-width: 260px; }
		.cf-limpar-filtros { color: var(--text-muted); }
		.cf-colunas { margin-left: auto; }
		.cf-colunas-menu { min-width: 200px; padding: 6px 0; }
		.cf-colunas-n { font-size: 11px; color: var(--primary); }
		${COLUNAS_PLANO.map((c) => `.cf-grelha.cf-sem-${c.campo} .cf-col-${c.campo} { display: none; }`).join("\n\t\t")}

		.cf-filtro-btn {
			border: 0; background: transparent; color: var(--text-muted); opacity: 0.55;
			margin-left: 6px; padding: 2px 4px; border-radius: 4px; line-height: 1; vertical-align: middle;
		}
		.cf-filtro-btn:hover { opacity: 1; background: var(--control-bg); }
		.cf-filtro-btn.ativo { opacity: 1; color: #fff; background: var(--primary); }
		.cf-filtro-menu {
			position: fixed; z-index: 1030; width: 250px; padding: 8px 0;
			background: var(--fg-color); color: var(--text-color); border: 1px solid var(--border-color);
			border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15); font-size: 13px;
		}
		.cf-filtro-titulo { padding: 0 12px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); }
		.cf-filtro-lista { max-height: 280px; overflow-y: auto; border-top: 1px solid var(--border-color); }
		.cf-filtro-op { display: flex; align-items: center; gap: 8px; padding: 4px 12px; margin: 0; cursor: pointer; font-weight: normal; }
		.cf-filtro-op:hover { background: var(--control-bg); }
		.cf-filtro-op input { margin: 0; }
		.cf-filtro-n { margin-left: auto; color: var(--text-muted); font-size: 11px; }
		.cf-filtro-rodape { padding: 8px 12px 0; border-top: 1px solid var(--border-color); text-align: right; }
		.cf-contagem { font-size: 12px; }

		.cf-grelha-wrap {
			overflow: auto; max-height: calc(100vh - 360px); min-height: 200px;
			border: 1px solid var(--cf-linha); border-radius: 8px; background: var(--fg-color);
		}
		.cf-grelha { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
		.cf-grelha th, .cf-grelha td {
			border-right: 1px solid var(--cf-linha); border-bottom: 1px solid var(--cf-linha);
			padding: 0; white-space: nowrap; background: var(--fg-color);
		}
		.cf-grelha thead th {
			position: sticky; top: 0; z-index: 2; padding: 6px 8px;
			background: var(--subtle-fg, var(--bg-color)); font-weight: 600; font-size: 12px; color: var(--text-muted);
		}
		.cf-grelha .cf-fixa { position: sticky; left: 0; z-index: 1; }
		.cf-grelha thead .cf-fixa { z-index: 3; }
		.cf-grelha .cf-idx { width: 36px; text-align: center; color: var(--text-muted); font-size: 11px; padding: 0 4px; }
		/* Row number turns into a checkbox on hover / while selecting */
		.cf-idx .cf-sel { display: none; margin: 0; vertical-align: middle; }
		.cf-grelha tbody tr:hover .cf-sel, .cf-selecionando .cf-sel { display: inline-block; }
		.cf-grelha tbody tr:hover .cf-idx .cf-n:not(:only-child), .cf-selecionando .cf-idx .cf-n { display: none; }
		.cf-idx .cf-sel-todas { margin: 0; vertical-align: middle; }
		.cf-grelha tbody tr.cf-selecionada > td { background: rgba(59, 130, 246, 0.1); }
		.cf-cell.cf-data::placeholder { color: var(--text-muted); opacity: 0.6; }
		.cf-cell.cf-atrasado { color: var(--cf-vermelho) !important; font-weight: 600; }
		.cf-atraso-n { font-weight: 600; }
		/* Side panel */
		.cf-painel {
			position: fixed; right: 12px; width: 420px; z-index: 25;
			top: calc(var(--navbar-height, 48px) + 12px); bottom: 56px;
			display: flex; flex-direction: column;
			background: var(--fg-color); border: 1px solid var(--cf-linha); border-radius: 10px;
			box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
		}
		@media (min-width: 1300px) { .cf-sheet.cf-com-painel { margin-right: 436px; } }
		@media (max-width: 768px) { .cf-painel { left: 8px; right: 8px; width: auto; } }
		.cf-painel-topo { display: flex; gap: 10px; justify-content: space-between; align-items: flex-start; padding: 14px 16px 10px; border-bottom: 1px solid var(--cf-linha); }
		.cf-painel-nome { font-size: 15px; font-weight: 600; line-height: 1.3; }
		.cf-painel-sub { font-size: 13px; color: var(--text-muted); margin-top: 2px; font-variant-numeric: tabular-nums; }
		.cf-painel-estado { font-weight: 600; }
		.cf-painel-estado.cf-estado-pago { color: var(--cf-verde); }
		.cf-painel-estado.cf-estado-pendente { color: var(--cf-vermelho); }
		.cf-painel-estado.cf-estado-parcial, .cf-painel-estado.cf-estado-reservado, .cf-painel-estado.cf-estado-progresso { color: var(--cf-laranja); }
		.cf-painel-nav { display: flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 12px; }
		.cf-painel-aviso { padding: 6px 16px; font-size: 12px; color: var(--text-muted); background: var(--control-bg); }
		.cf-painel-corpo { overflow-y: auto; padding: 4px 16px 16px; flex: 1; }
		.cf-painel-seccao { padding: 12px 0 4px; border-bottom: 1px solid var(--cf-linha); }
		.cf-painel-seccao:last-child { border-bottom: 0; }
		.cf-painel-seccao-titulo { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
		.cf-painel-grelha { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; }
		.cf-painel .frappe-control { margin-bottom: 8px; }
		.cf-painel [data-seccao="observacoes"] textarea { min-height: 90px; }
		.cf-painel-cartao { margin: 4px 0 8px; padding: 8px 10px; border-radius: 8px; background: var(--control-bg); font-size: 12px; }
		.cf-painel-pill { margin-left: 6px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--cf-linha); font-size: 11px; }
		.cf-painel-factura-numeros { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; font-variant-numeric: tabular-nums; }
		.cf-painel-ligacao { font-size: 13px; padding: 3px 0; }
		.cf-painel-ligacao a { cursor: pointer; }
		.cf-painel-historico { max-height: 260px; overflow-y: auto; }
		.cf-painel-evento { font-size: 12px; padding: 5px 0; border-bottom: 1px dashed var(--cf-linha); }
		.cf-painel-evento:last-child { border-bottom: 0; }
		.cf-painel-vazio { font-size: 12px; padding-bottom: 8px; }
		.cf-grelha tbody tr.cf-painel-ativo > td { background: rgba(59, 130, 246, 0.14); }
		.cf-abrir-painel { font-size: 16px; line-height: 1; padding: 0 6px; color: var(--text-muted); }
		.cf-abrir-painel:hover { color: var(--primary); }

		.cf-link-wrap { display: flex; align-items: center; }
		.cf-salto-caixa, .cf-salto-plano {
			font-size: 11px; padding: 1px 7px; margin-left: 4px; border-radius: 10px; white-space: nowrap;
			border: 1px solid var(--cf-linha); background: var(--control-bg); color: var(--text-muted);
		}
		.cf-salto-caixa:hover, .cf-salto-plano:hover { color: var(--primary); border-color: var(--primary); }
		.cf-caixa-reforco {
			display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;
			padding: 8px 12px; border-radius: 8px; font-size: 13px;
			border: 1px dashed var(--cf-verde); background: rgba(22, 163, 74, 0.06);
		}
		.cf-caixa-reforco a { cursor: pointer; }
		.cf-reforco-campo { display: flex; align-items: center; gap: 6px; margin: 0; font-weight: normal; color: var(--text-muted); }
		.cf-reforco-campo .form-control { width: 130px; }
		.cf-reforco-valor { text-align: right; font-variant-numeric: tabular-nums; }
		.cf-reforco-nota { font-size: 12px; }
		.cf-caixa-sem-reforco > td:first-child { box-shadow: inset 3px 0 0 transparent !important; }
		.cf-caixa-sem-reforco .cf-cell { color: var(--text-muted); }
		.cf-painel-caixa-linha { display: flex; justify-content: space-between; padding: 2px 0; font-variant-numeric: tabular-nums; }
		.cf-painel-nota { font-size: 11px; margin: 4px 0 6px; }
		.cf-caixa-topo { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }
		.cf-caixa-mes { font-size: 15px; font-weight: 600; min-width: 130px; text-align: center; }
		.cf-caixa-topo .cf-ajuda { margin: 0; font-size: 12px; }
		.cf-kpis.cf-kpis-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
		.cf-vermelho { color: var(--cf-vermelho) !important; }
		.cf-reforco > td:first-child { box-shadow: inset 3px 0 0 var(--cf-verde) !important; }
		.cf-reforco [data-campo="tipo"], .cf-reforco [data-campo="valor"] { color: var(--cf-verde); font-weight: 600; }
		.cf-saldo { padding: 0 8px !important; font-variant-numeric: tabular-nums; font-weight: 600; }
		.cf-link-abrir { padding: 0 8px; color: var(--text-muted); text-decoration: none !important; }
		.cf-link-abrir:hover { color: var(--primary); }
		.cf-link-menu { width: 320px; max-height: 300px; overflow-y: auto; padding: 4px 0; }
		.cf-link-op { padding: 6px 12px; cursor: pointer; }
		.cf-link-op.ativo, .cf-link-op:hover { background: var(--control-bg); }
		.cf-link-desc { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.cf-link-vazio { padding: 8px 12px; color: var(--text-muted); font-size: 12px; }

		.cf-lote { display: none; }
		.cf-lote.visivel {
			display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;
			padding: 6px 10px; border-radius: 8px; border: 1px solid var(--primary);
			background: rgba(59, 130, 246, 0.08);
		}
		.cf-lote-info { margin-right: 6px; font-size: 13px; font-variant-numeric: tabular-nums; }
		.cf-lote .dropdown-menu { max-height: 300px; overflow-y: auto; }
		.cf-lote .dropdown-item { cursor: pointer; }
		.cf-grelha .cf-num { text-align: right; }
		.cf-grelha .cf-acoes { width: 32px; text-align: center; }
		.cf-grelha .cf-remover { color: var(--text-muted); font-size: 16px; line-height: 1; padding: 0 6px; }
		.cf-grelha .cf-remover:hover { color: var(--cf-vermelho); }

		.cf-cell {
			width: 100%; border: 0; outline: 0; background: transparent; color: inherit;
			padding: 6px 8px; font-size: 13px; height: 32px; border-radius: 0;
		}
		select.cf-cell { cursor: pointer; padding-right: 2px; }
		.cf-cell.cf-num { text-align: right; font-variant-numeric: tabular-nums; }
		.cf-cell:focus { box-shadow: inset 0 0 0 2px var(--primary); background: var(--control-bg); }
		.cf-cell:disabled { opacity: 1; cursor: default; }
		.cf-cell.cf-check { width: auto; height: auto; margin: 8px auto; display: block; }

		/* Row tint by Estado — the left bar is the main cue, readable in both themes. */
		.cf-grelha tbody tr > td:first-child { box-shadow: inset 3px 0 0 transparent; }
		.cf-estado-pago > td:first-child { box-shadow: inset 3px 0 0 var(--cf-verde) !important; }
		.cf-estado-pago [data-campo="estado"] { color: var(--cf-verde); font-weight: 600; }
		.cf-estado-parcial > td:first-child, .cf-estado-reservado > td:first-child,
		.cf-estado-progresso > td:first-child { box-shadow: inset 3px 0 0 var(--cf-laranja) !important; }
		.cf-estado-parcial [data-campo="estado"], .cf-estado-reservado [data-campo="estado"],
		.cf-estado-progresso [data-campo="estado"] { color: var(--cf-laranja); font-weight: 600; }
		.cf-estado-pendente > td:first-child { box-shadow: inset 3px 0 0 var(--cf-vermelho) !important; }
		.cf-estado-proximo td, .cf-estado-espera td, .cf-inativo td { color: var(--text-muted); }
		.cf-estado-proximo .cf-cell, .cf-estado-espera .cf-cell, .cf-inativo .cf-cell { color: var(--text-muted); }

		.cf-estado-cancelado .cf-cell { color: var(--text-muted); }
		.cf-estado-cancelado input.cf-cell { text-decoration: line-through; }
		.cf-estado-cancelado [data-campo="estado"] { text-decoration: none; font-style: italic; }

		.cf-nova td { background: var(--fg-color); }
		.cf-nova-input { font-style: italic; }
		.cf-total td { font-weight: 700; padding: 8px; background: var(--subtle-fg, var(--bg-color)); font-variant-numeric: tabular-nums; }
		.cf-grelha tfoot .cf-total td { position: sticky; bottom: 0; z-index: 1; }
		.cf-grelha tfoot .cf-total .cf-fixa { z-index: 2; }

		.cf-resumo td { padding: 6px 8px; font-variant-numeric: tabular-nums; }
		.cf-resumo .cf-cat td { font-weight: 600; background: var(--subtle-fg, var(--bg-color)); }
		.cf-resumo .cf-item { padding-left: 22px; }
		.cf-resumo .cf-col-total { font-weight: 600; }
		.cf-resumo tfoot .cf-total td { position: static; }
		.cf-mes-link { cursor: pointer; }
		.cf-mes-link:hover { color: var(--primary) !important; text-decoration: underline; }
		.cf-grafico { margin-bottom: 12px; background: var(--fg-color); border: 1px solid var(--cf-linha); border-radius: 8px; }

		/* Excel-style sheet tabs, frozen to the bottom of the window.
		   Frappe hides the whole page on route change, so this goes with it. */
		.cf-abas {
			position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
			display: flex; gap: 2px; overflow-x: auto; padding: 0 16px 6px;
			background: var(--bg-color); border-top: 1px solid var(--cf-linha);
			box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.06);
		}
		/* Gaps between the groups: Resumo | Jan…Dez | Investimentos, Recorrentes */
		.cf-aba-especial + .cf-aba:not(.cf-aba-especial),
		.cf-aba:not(.cf-aba-especial) + .cf-aba-especial { margin-left: 12px; }
		.cf-aba {
			border: 1px solid var(--cf-linha); background: var(--fg-color); color: var(--text-muted);
			border-radius: 0 0 6px 6px; border-top: 0; padding: 6px 14px; font-size: 13px;
			white-space: nowrap; display: flex; align-items: center; gap: 6px;
		}
		.cf-aba:hover { color: var(--text-color); }
		.cf-aba.active { color: var(--primary); font-weight: 600; box-shadow: inset 0 3px 0 var(--primary); }
		.cf-aba-especial { font-weight: 500; }
		.cf-salto {
			font-size: 11px; padding: 1px 7px; margin-left: 4px; border-radius: 10px; white-space: nowrap;
			border: 1px solid var(--cf-linha); background: var(--control-bg); color: var(--text-muted);
		}
		.cf-salto:hover { color: var(--primary); border-color: var(--primary); }
		.cf-grelha .cf-acoes { width: auto; white-space: nowrap; padding: 0 4px; }
		@keyframes cf-flash { from { background: rgba(59, 130, 246, 0.35); } to { background: var(--fg-color); } }
		.cf-destaque > td { animation: cf-flash 2.6s ease-out; }
		.cf-ponto { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
		.cf-ponto-ok { background: var(--cf-verde); }
		.cf-ponto-pendente { background: var(--cf-laranja); }

		@media (max-width: 768px) {
			.cf-kpis, .cf-kpis.cf-kpis-5 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.cf-kpi-valor { font-size: 16px; }
			.cf-grelha-wrap { max-height: none; }
		}
	`;
	document.head.appendChild(style);
}
