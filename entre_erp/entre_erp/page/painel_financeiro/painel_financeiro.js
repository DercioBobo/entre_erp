frappe.pages["painel-financeiro"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Painel Financeiro"),
		single_column: true,
	});
	$(wrapper).addClass("pf-wrapper");

	new PainelFinanceiro(page);
};

const PF_MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const pf_esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
const pf_dinheiro = (v) => format_number(v || 0, null, 2);
const pf_sinal = (v) => (v < 0 ? "pf-negativo" : v > 0 ? "pf-positivo" : "");

class PainelFinanceiro {
	constructor(page) {
		this.page = page;
		this.ano = new Date().getFullYear();
		this.company = null;

		pf_inject_styles();
		this.$body = $(page.body).empty().html(`
			<div class="pf-painel">
				<div class="pf-topo">
					<div class="pf-ano">
						<button class="btn btn-default btn-sm pf-ano-ant" title="${__("Ano anterior")}">‹</button>
						<span class="pf-ano-valor"></span>
						<button class="btn btn-default btn-sm pf-ano-seg" title="${__("Ano seguinte")}">›</button>
					</div>
					<div class="pf-topo-direita">
						<select class="form-control input-sm pf-empresa" style="display:none"></select>
						<button class="btn btn-default btn-sm pf-abrir-cashflow">${__("Abrir Cashflow")} →</button>
						<button class="btn btn-default btn-sm pf-configurar" style="display:none" title="${__("Definições do Cashflow")}">⚙</button>
					</div>
				</div>
				<div class="pf-conteudo"><div class="pf-vazio">${__("A carregar...")}</div></div>
			</div>
		`);

		this.$body.find(".pf-ano-ant").on("click", () => this.mudar_ano(-1));
		this.$body.find(".pf-ano-seg").on("click", () => this.mudar_ano(1));
		this.$body.find(".pf-empresa").on("change", (e) => {
			this.company = $(e.currentTarget).val();
			this.carregar();
		});
		this.$body.find(".pf-abrir-cashflow").on("click", () => frappe.set_route("cashflow"));
		this.$body.find(".pf-configurar").on("click", () => frappe.set_route("Form", "Cashflow Settings"));

		this.carregar();
	}

	mudar_ano(delta) {
		this.ano += delta;
		this.carregar();
	}

	carregar() {
		this.$body.find(".pf-ano-valor").text(this.ano);
		this.page.set_title(__("Painel Financeiro {0}", [this.ano]));
		frappe
			.xcall("entre_erp.painel.obter_painel", { ano: this.ano, company: this.company })
			.then((d) => this.render(d));
	}

	render(d) {
		this.company = d.company;
		this.$body.find(".pf-configurar").toggle(!!d.pode_configurar);
		const $empresa = this.$body.find(".pf-empresa");
		$empresa
			.html(d.empresas.map((e) => `<option ${e === d.company ? "selected" : ""}>${pf_esc(e)}</option>`).join(""))
			.toggle(d.empresas.length > 1);

		const soma = (campo) => d.meses.reduce((t, m) => t + (m[campo] || 0), 0);
		const t = {
			entradas_previstas: soma("entradas_previstas"),
			entradas_reais: soma("entradas_reais"),
			saidas_previstas: soma("saidas_previstas"),
			saidas_reais: soma("saidas_reais"),
			por_pagar: soma("por_pagar"),
		};
		t.saldo_previsto = t.entradas_previstas - t.saidas_previstas;
		t.saldo_real = t.entradas_reais - t.saidas_reais;
		const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

		this.$body.find(".pf-conteudo").html(`
			${this.html_alerta(d.mes_atual)}
			<div class="pf-cards">
				${this.card(
					__("Entradas previstas"),
					t.entradas_previstas,
					d.entradas_por_vencimento ? __("Facturas pela data de vencimento") : __("Facturas pela data de emissão"),
				)}
				${this.card(__("Entradas reais"), t.entradas_reais, __("{0}% do previsto", [pct(t.entradas_reais, t.entradas_previstas)]), "pf-positivo")}
				${this.card(__("Saídas previstas"), t.saidas_previstas, __("Planos mensais"))}
				${this.card(__("Saídas reais"), t.saidas_reais, __("{0}% do previsto", [pct(t.saidas_reais, t.saidas_previstas)]))}
				${this.card(__("Saldo real"), t.saldo_real, __("Previsto: {0}", [pf_dinheiro(t.saldo_previsto)]), pf_sinal(t.saldo_real), true)}
			</div>
			<div class="pf-cards pf-cards-pequenos">
				${this.card(__("Por receber (clientes)"), d.por_receber, __("Todas as facturas em aberto"))}
				${this.card(__("Por pagar ({0})", [this.ano]), t.por_pagar, __("Remanescente dos planos"))}
				${
					d.investimentos
						? this.card(
								__("Investimentos {0}", [this.ano]),
								d.investimentos.total_pago,
								__("de {0} previstos", [pf_dinheiro(d.investimentos.total_previsto)]),
							)
						: ""
				}
				${this.card(
					`💰 ${__("Caixa (saldo actual)")}`,
					d.caixa.saldo_atual,
					__("Gastos em {0}: {1}", [d.caixa.mes, pf_dinheiro(d.caixa.gastos)]),
					d.caixa.saldo_atual < 0
						? "pf-negativo"
						: d.caixa.aviso_saldo > 0 && d.caixa.saldo_atual < d.caixa.aviso_saldo
							? "pf-aviso"
							: "",
				)}
			</div>

			<div class="pf-bloco">
				<div class="pf-bloco-titulo">${__("Entradas vs Saídas")}</div>
				<div class="pf-grafico"></div>
			</div>

			<div class="pf-bloco">
				<div class="pf-bloco-titulo">${__("Mês a mês")}</div>
				<div class="pf-tabela-wrap">${this.html_tabela(d, t)}</div>
			</div>

			<div class="pf-duas-colunas">
				<div class="pf-bloco">
					<div class="pf-bloco-titulo">${__("Saídas por categoria")}</div>
					${this.html_categorias(d.categorias)}
				</div>
				<div class="pf-bloco">
					<div class="pf-bloco-titulo">${__("Clientes com mais por receber")}</div>
					${this.html_clientes(d.clientes_por_receber)}
				</div>
			</div>
		`);

		this.$body.find(".pf-mes-linha").on("click", (e) => {
			frappe.route_options = { ano: this.ano, mes: $(e.currentTarget).attr("data-mes") };
			frappe.set_route("cashflow");
		});
		this.$body.find(".pf-ir-cashflow").on("click", (e) => {
			frappe.route_options = { ano: this.ano, mes: $(e.currentTarget).attr("data-mes") };
			frappe.set_route("cashflow");
		});

		this.render_grafico(d);
	}

	card(label, valor, nota, cls = "", destaque = false) {
		return `
			<div class="pf-card ${destaque ? "pf-card-destaque" : ""}">
				<div class="pf-card-label">${label}</div>
				<div class="pf-card-valor ${cls}">${pf_dinheiro(valor)}</div>
				<div class="pf-card-nota">${nota || ""}</div>
			</div>`;
	}

	html_alerta(m) {
		if (!m) return "";
		const abrir = `<a class="pf-ir-cashflow" data-mes="${pf_esc(m.mes)}">${__("Abrir {0}", [m.mes])} →</a>`;
		if (!m.existe) {
			return `<div class="pf-alerta pf-alerta-aviso">${__("Ainda não há plano de pagamentos para {0}.", [m.mes])} ${abrir}</div>`;
		}
		if (m.bloqueio) {
			return `<div class="pf-alerta pf-alerta-aviso">🔒 ${__("{0} está bloqueado: {1} ainda tem {2} pagamento(s) por liquidar ({3}).", [
				m.mes,
				pf_esc(m.bloqueio.titulo),
				m.bloqueio.pendentes,
				pf_dinheiro(m.bloqueio.valor),
			])} <a class="pf-ir-cashflow" data-mes="${pf_esc(m.bloqueio.mes)}">${__("Abrir {0}", [m.bloqueio.mes])} →</a></div>`;
		}
		if (m.estado === "Fechado") {
			return `<div class="pf-alerta pf-alerta-ok">✅ ${__("{0} está 100% liquidado.", [m.mes])}</div>`;
		}
		return `<div class="pf-alerta">${__("{0}: {1} linha(s) por liquidar · {2} por pagar.", [
			m.mes,
			m.linhas_por_liquidar,
			pf_dinheiro(m.por_pagar),
		])} ${abrir}</div>`;
	}

	html_tabela(d, t) {
		const mes_atual = new Date().getFullYear() === this.ano ? new Date().getMonth() : -1;
		const celula = (v, sinal = false) =>
			`<td class="pf-num ${sinal ? pf_sinal(v) : ""}">${v ? pf_dinheiro(v) : `<span class="pf-traco">—</span>`}</td>`;

		const linhas = d.meses
			.map(
				(m, i) => `
				<tr class="pf-mes-linha ${i === mes_atual ? "pf-mes-atual" : ""}" data-mes="${pf_esc(m.mes)}" title="${__("Abrir {0} no Cashflow", [m.mes])}">
					<td>${PF_MESES_CURTOS[i]} ${m.estado_plano === "Fechado" ? `<span class="pf-fechado" title="${__("Fechado")}">✓</span>` : ""}</td>
					${celula(m.entradas_previstas)}
					${celula(m.entradas_reais)}
					${celula(m.saidas_previstas)}
					${celula(m.saidas_reais)}
					${celula(m.saldo_previsto, true)}
					${celula(m.saldo_real, true)}
					<td class="pf-num pf-acumulado ${pf_sinal(m.acumulado)}">${m.acumulado == null ? "" : pf_dinheiro(m.acumulado)}</td>
				</tr>`,
			)
			.join("");

		return `
			<table class="pf-tabela">
				<thead><tr>
					<th>${__("Mês")}</th>
					<th class="pf-num">${__("Entradas prev.")}</th>
					<th class="pf-num">${__("Entradas reais")}</th>
					<th class="pf-num">${__("Saídas prev.")}</th>
					<th class="pf-num">${__("Saídas reais")}</th>
					<th class="pf-num">${__("Saldo prev.")}</th>
					<th class="pf-num">${__("Saldo real")}</th>
					<th class="pf-num">${__("Acumulado")}</th>
				</tr></thead>
				<tbody>${linhas}</tbody>
				<tfoot><tr>
					<td>${__("Total")}</td>
					<td class="pf-num">${pf_dinheiro(t.entradas_previstas)}</td>
					<td class="pf-num">${pf_dinheiro(t.entradas_reais)}</td>
					<td class="pf-num">${pf_dinheiro(t.saidas_previstas)}</td>
					<td class="pf-num">${pf_dinheiro(t.saidas_reais)}</td>
					<td class="pf-num ${pf_sinal(t.saldo_previsto)}">${pf_dinheiro(t.saldo_previsto)}</td>
					<td class="pf-num ${pf_sinal(t.saldo_real)}">${pf_dinheiro(t.saldo_real)}</td>
					<td></td>
				</tr></tfoot>
			</table>`;
	}

	html_categorias(categorias) {
		if (!categorias.length) return `<div class="pf-vazio">${__("Sem saídas neste ano.")}</div>`;
		const maximo = Math.max(...categorias.map((c) => c.previsto)) || 1;
		const total = categorias.reduce((s, c) => s + c.previsto, 0) || 1;
		return `<div class="pf-barras">${categorias
			.map(
				(c) => `
				<div class="pf-barra-linha">
					<div class="pf-barra-label">${pf_esc(c.categoria)}</div>
					<div class="pf-barra-trilho"><div class="pf-barra" style="width:${(c.previsto / maximo) * 100}%"></div></div>
					<div class="pf-barra-valor">${pf_dinheiro(c.previsto)} <span class="text-muted">${Math.round((c.previsto / total) * 100)}%</span></div>
				</div>`,
			)
			.join("")}</div>`;
	}

	html_clientes(clientes) {
		if (!clientes.length) return `<div class="pf-vazio">${__("Nenhuma factura em aberto. 🎉")}</div>`;
		const hoje = frappe.datetime.get_today();
		return `
			<table class="pf-tabela pf-clientes">
				<thead><tr>
					<th>${__("Cliente")}</th>
					<th class="pf-num">${__("Facturas")}</th>
					<th class="pf-num">${__("Por receber")}</th>
					<th class="pf-num">${__("Mais antiga")}</th>
				</tr></thead>
				<tbody>${clientes
					.map((c) => {
						const dias = c.vencimento_mais_antigo ? frappe.datetime.get_diff(hoje, c.vencimento_mais_antigo) : 0;
						return `<tr>
							<td>${pf_esc(c.cliente)}</td>
							<td class="pf-num">${c.facturas}</td>
							<td class="pf-num">${pf_dinheiro(c.valor)}</td>
							<td class="pf-num ${dias > 0 ? "pf-negativo" : ""}">${
								dias > 0 ? __("{0} dias em atraso", [dias]) : frappe.datetime.str_to_user(c.vencimento_mais_antigo)
							}</td>
						</tr>`;
					})
					.join("")}</tbody>
			</table>`;
	}

	render_grafico(d) {
		// Only up to the last month with real movement: later months have
		// nothing to draw and the Acumulado line can't have gaps.
		const meses = d.meses.filter((m) => m.acumulado != null);
		if (!meses.length) {
			this.$body.find(".pf-grafico").html(`<div class="pf-vazio">${__("Ainda sem movimentos neste ano.")}</div>`);
			return;
		}
		new frappe.Chart(this.$body.find(".pf-grafico")[0], {
			type: "axis-mixed",
			height: 260,
			data: {
				labels: PF_MESES_CURTOS.slice(0, meses.length),
				datasets: [
					{ name: __("Entradas reais"), chartType: "bar", values: meses.map((m) => m.entradas_reais) },
					{ name: __("Saídas reais"), chartType: "bar", values: meses.map((m) => m.saidas_reais) },
					{ name: __("Acumulado"), chartType: "line", values: meses.map((m) => m.acumulado) },
				],
			},
			colors: ["#16a34a", "#dc2626", "#2563eb"],
			barOptions: { spaceRatio: 0.4 },
			lineOptions: { dotSize: 4 },
			tooltipOptions: { formatTooltipY: (v) => (v == null ? "" : pf_dinheiro(v)) },
		});
	}
}

function pf_inject_styles() {
	if (document.getElementById("pf-painel-style")) return;
	const style = document.createElement("style");
	style.id = "pf-painel-style";
	style.innerHTML = `
		.pf-wrapper .container { max-width: 100% !important; }
		.pf-painel {
			--pf-verde: #16a34a;
			--pf-vermelho: #dc2626;
			--pf-laranja: #d97706;
			padding-bottom: 40px;
		}
		html[data-theme="dark"] .pf-painel {
			--pf-verde: #4ade80;
			--pf-vermelho: #f87171;
			--pf-laranja: #fbbf24;
		}
		.pf-positivo { color: var(--pf-verde) !important; }
		.pf-aviso { color: var(--pf-laranja) !important; }
		.pf-negativo { color: var(--pf-vermelho) !important; }

		.pf-topo { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
		.pf-ano { display: flex; align-items: center; gap: 8px; }
		.pf-ano-valor { font-size: 18px; font-weight: 600; min-width: 52px; text-align: center; }
		.pf-topo-direita { display: flex; gap: 8px; align-items: center; }
		.pf-topo-direita .pf-empresa { width: 220px; }
		.pf-vazio { padding: 30px; text-align: center; color: var(--text-muted); }

		.pf-alerta {
			padding: 10px 14px; margin-bottom: 14px; border-radius: 8px; font-size: 13px;
			border: 1px solid var(--border-color); background: var(--fg-color);
		}
		.pf-alerta a { cursor: pointer; font-weight: 600; margin-left: 6px; }
		.pf-alerta-aviso { border-color: var(--pf-laranja); background: rgba(217, 119, 6, 0.08); }
		.pf-alerta-ok { border-color: var(--pf-verde); background: rgba(22, 163, 74, 0.08); }

		.pf-cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 10px; }
		.pf-cards-pequenos { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
		.pf-card { padding: 12px 14px; border-radius: 8px; background: var(--fg-color); border: 1px solid var(--border-color); }
		.pf-card-destaque { border-width: 2px; }
		.pf-card-label { font-size: 12px; color: var(--text-muted); }
		.pf-card-valor { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.4; }
		.pf-cards-pequenos .pf-card-valor { font-size: 16px; }
		.pf-card-nota { font-size: 11px; color: var(--text-muted); }

		.pf-bloco { background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; }
		.pf-bloco-titulo { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 8px; }
		.pf-duas-colunas { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
		.pf-duas-colunas .pf-bloco { margin-bottom: 0; }

		.pf-tabela-wrap { overflow-x: auto; }
		.pf-tabela { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
		.pf-tabela th { font-size: 12px; font-weight: 600; color: var(--text-muted); padding: 6px 8px; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
		.pf-tabela td { padding: 6px 8px; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
		.pf-tabela .pf-num { text-align: right; }
		.pf-tabela tfoot td { font-weight: 700; border-bottom: 0; border-top: 2px solid var(--border-color); }
		.pf-mes-linha { cursor: pointer; }
		.pf-mes-linha:hover td { background: var(--control-bg); }
		.pf-mes-atual td { font-weight: 600; background: rgba(59, 130, 246, 0.06); }
		.pf-acumulado { font-weight: 600; }
		.pf-traco { color: var(--text-muted); opacity: 0.5; }
		.pf-fechado { color: var(--pf-verde); font-size: 11px; margin-left: 4px; }

		.pf-barras { display: flex; flex-direction: column; gap: 6px; }
		.pf-barra-linha { display: grid; grid-template-columns: 170px 1fr 170px; gap: 10px; align-items: center; font-size: 13px; }
		.pf-barra-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.pf-barra-trilho { height: 10px; border-radius: 5px; background: var(--control-bg); overflow: hidden; }
		.pf-barra { height: 100%; border-radius: 5px; background: var(--pf-vermelho); opacity: 0.75; }
		.pf-barra-valor { text-align: right; font-variant-numeric: tabular-nums; }

		@media (max-width: 1100px) {
			.pf-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.pf-cards-pequenos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.pf-duas-colunas { grid-template-columns: 1fr; }
		}
		@media (max-width: 600px) {
			.pf-barra-linha { grid-template-columns: 110px 1fr; }
			.pf-barra-valor { grid-column: 1 / -1; text-align: left; }
		}
	`;
	document.head.appendChild(style);
}
