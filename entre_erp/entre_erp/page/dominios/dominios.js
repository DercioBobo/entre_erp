frappe.pages["dominios"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Domínios"),
		single_column: true,
	});
	$(wrapper).addClass("dm-wrapper");
	wrapper.painel_dominios = new PainelDominios(page);
};

// Coming back from a domain or renewal form: show what changed there.
frappe.pages["dominios"].on_page_show = function (wrapper) {
	const painel = wrapper.painel_dominios;
	if (painel && Date.now() - painel.carregado_em > 2000) painel.carregar();
};

const dm_esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
const dm_data = (d) => (d ? frappe.datetime.str_to_user(d) : "—");
const dm_normal = (t) =>
	(t || "")
		.toString()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase();

// What people paste: "https://www.exemplo.co.mz/contacto" → "exemplo.co.mz".
const dm_como_dominio = (texto) =>
	dm_normal(texto)
		.trim()
		.replace(/^[a-z]+:\/\//, "")
		.split(/[/?#:]/)[0]
		.replace(/^www\./, "")
		.replace(/\.$/, "");
const dm_parece_dominio = (texto) => /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(texto);

function dm_quando(dias) {
	if (dias == null) return __("Sem data");
	if (dias < 0) return dias === -1 ? __("Expirou ontem") : __("Expirou há {0} dias", [-dias]);
	if (dias === 0) return __("Expira hoje");
	if (dias === 1) return __("Expira amanhã");
	return __("Expira em {0} dias", [dias]);
}

const DM_CORES_ESTADO = { Ativo: "verde", Expirado: "vermelho", Cancelado: "cinza" };
const DM_CORES_RENOVACAO = {
	Pendente: "laranja",
	Pago: "azul",
	Renovado: "roxo",
	"Concluído": "verde",
	Cancelado: "cinza",
};

const dm_pilula = (texto, cor) => (texto ? `<span class="dm-pilula dm-${cor || "cinza"}">${dm_esc(__(texto))}</span>` : "");

const DM_ORDENS = {
	expira: { rotulo: __("Expira primeiro"), fn: (a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9) },
	nome: { rotulo: __("Domínio (A-Z)"), fn: (a, b) => a.name.localeCompare(b.name) },
	cliente: { rotulo: __("Cliente (A-Z)"), fn: (a, b) => (a.customer || "").localeCompare(b.customer || "") },
	valor: { rotulo: __("Valor (maior)"), fn: (a, b) => (b.valor || 0) - (a.valor || 0) },
};

function dm_guardar(chave, valor) {
	try {
		localStorage.setItem(`dm-${chave}`, valor);
	} catch (e) {
		// private mode: just don't remember
	}
}
function dm_ler(chave, padrao) {
	try {
		return localStorage.getItem(`dm-${chave}`) || padrao;
	} catch (e) {
		return padrao;
	}
}

class PainelDominios {
	constructor(page) {
		this.page = page;
		this.dominios = [];
		this.filtro = dm_ler("filtro", "todos");
		this.ordem = dm_ler("ordem", "expira");
		this.query = "";
		this.seleccionado = null;
		this.consulta = null; // registry lookup result for the typed domain
		this.detalhes = {};
		this.carregado_em = 0;

		dm_inject_styles();
		this.montar();
		this.carregar();
	}

	get filtros() {
		const limite = this.dias_abrir_renovacao || 40;
		return [
			{ id: "todos", rotulo: __("Ativos e expirados"), tom: "", teste: (d) => d.estado !== "Cancelado" },
			{
				id: "a_expirar",
				rotulo: __("A expirar"),
				nota: __("próximos {0} dias", [limite]),
				tom: "laranja",
				teste: (d) => d.estado !== "Cancelado" && d.dias != null && d.dias >= 0 && d.dias <= limite,
			},
			{ id: "pendentes", rotulo: __("Por pagar"), tom: "laranja", teste: (d) => d.renovacao_estado === "Pendente" },
			{ id: "pagos", rotulo: __("Pagos, por renovar"), tom: "azul", teste: (d) => d.renovacao_estado === "Pago" },
			{ id: "expirados", rotulo: __("Expirados"), tom: "vermelho", teste: (d) => d.estado === "Expirado" },
			{
				id: "alertas",
				rotulo: __("Com alertas"),
				tom: "vermelho",
				teste: (d) => d.alertas.some((a) => a.nivel !== "info"),
			},
			{ id: "cancelados", rotulo: __("Cancelados"), tom: "cinza", teste: (d) => d.estado === "Cancelado" },
		];
	}

	montar() {
		this.$body = $(this.page.body).empty().html(`
			<div class="dm-painel">
				<div class="dm-topo">
					<div class="dm-pesquisa">
						<svg class="dm-lupa" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
						<input type="text" class="dm-pesquisa-input" autocomplete="off" spellcheck="false"
							placeholder="${__("Pesquisar domínio, cliente, email, name server… ou escreva qualquer domínio para consultar o registo")}">
						<button class="dm-limpar" title="${__("Limpar (Esc)")}" style="display:none">×</button>
						<span class="dm-tecla" title="${__("Atalho")}">/</span>
					</div>
					<div class="dm-topo-accoes">
						<button class="btn btn-default btn-sm dm-recarregar" title="${__("Recarregar")}">↻</button>
						<button class="btn btn-default btn-sm dm-definicoes" style="display:none" title="${__("Definições")}">⚙</button>
						<button class="btn btn-primary btn-sm dm-novo" style="display:none">+ ${__("Novo domínio")}</button>
					</div>
				</div>
				<div class="dm-cards"></div>
				<div class="dm-corpo">
					<div class="dm-coluna-lista">
						<div class="dm-barra-lista">
							<span class="dm-contagem"></span>
							<select class="form-control input-xs dm-ordem">
								${Object.entries(DM_ORDENS)
									.map(([id, o]) => `<option value="${id}">${dm_esc(o.rotulo)}</option>`)
									.join("")}
							</select>
						</div>
						<div class="dm-consulta"></div>
						<div class="dm-lista">${this.html_esqueleto()}</div>
					</div>
					<div class="dm-detalhe">${this.html_detalhe_vazio()}</div>
				</div>
			</div>
		`);

		const $input = this.$body.find(".dm-pesquisa-input");
		$input.on("input", frappe.utils.debounce(() => this.ao_pesquisar($input.val()), 120));
		$input.on("keydown", (e) => this.teclas_pesquisa(e));
		this.$body.find(".dm-limpar").on("click", () => this.limpar_pesquisa());
		this.$body.find(".dm-recarregar").on("click", () => this.carregar());
		this.$body.find(".dm-definicoes").on("click", () => frappe.set_route("Form", "Domain Settings"));
		this.$body.find(".dm-novo").on("click", () => frappe.new_doc("Domain Management"));
		this.$body
			.find(".dm-ordem")
			.val(this.ordem)
			.on("change", (e) => {
				this.ordem = $(e.currentTarget).val();
				dm_guardar("ordem", this.ordem);
				this.render_lista();
			});

		this.$body.on("click", ".dm-card", (e) => {
			this.filtro = $(e.currentTarget).data("filtro");
			dm_guardar("filtro", this.filtro);
			this.render_cards();
			this.render_lista();
		});
		this.$body.on("click", ".dm-linha", (e) => this.seleccionar($(e.currentTarget).attr("data-nome")));

		// "/" anywhere on the page jumps to the search, as in most search UIs.
		$(document).on("keydown.dominios", (e) => {
			if (frappe.get_route_str() !== "dominios") return;
			if (e.key === "/" && !$(e.target).is("input, textarea, select, [contenteditable]")) {
				e.preventDefault();
				$input.trigger("focus").trigger("select");
			}
			if (e.key === "Escape" && this.$body.find(".dm-detalhe").hasClass("dm-aberto")) {
				this.fechar_detalhe();
			}
		});
	}

	carregar() {
		this.carregado_em = Date.now();
		return frappe.xcall("entre_erp.painel_dominios.obter_dominios").then((r) => {
			this.dominios = r.dominios;
			this.dias_abrir_renovacao = r.dias_abrir_renovacao;
			this.$body.find(".dm-novo").toggle(!!r.pode_criar);
			this.pode_criar = r.pode_criar;
			this.$body.find(".dm-definicoes").toggle(!!r.pode_configurar);
			this.detalhes = {};
			this.render_cards();
			this.render_lista();
			if (this.seleccionado) this.render_detalhe();
		});
	}

	// --- search ------------------------------------------------------------

	ao_pesquisar(valor) {
		this.query = valor || "";
		this.$body.find(".dm-limpar").toggle(!!this.query);
		this.$body.find(".dm-tecla").toggle(!this.query);
		const dominio = dm_como_dominio(this.query);
		if (!this.consulta || this.consulta.dominio !== dominio) this.consulta = null;
		this.render_lista();
	}

	limpar_pesquisa() {
		this.$body.find(".dm-pesquisa-input").val("").trigger("focus");
		this.consulta = null;
		this.ao_pesquisar("");
	}

	teclas_pesquisa(e) {
		const visiveis = this.visiveis;
		const i = visiveis.findIndex((d) => d.name === this.seleccionado);
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (!visiveis.length) return;
			const j = e.key === "ArrowDown" ? Math.min(i + 1, visiveis.length - 1) : Math.max(i - 1, 0);
			this.seleccionar(visiveis[j].name, { manter_foco: true });
		} else if (e.key === "Enter") {
			e.preventDefault();
			const dominio = dm_como_dominio(this.query);
			const gerido = this.dominios.find((d) => d.name === dominio || dm_normal(d.nome_do_dominio) === dominio);
			if (gerido) this.seleccionar(gerido.name, { manter_foco: true });
			else if (dm_parece_dominio(dominio)) this.consultar_registo(dominio);
			else if (visiveis.length) this.seleccionar(visiveis[Math.max(i, 0)].name, { manter_foco: true });
		} else if (e.key === "Escape") {
			e.stopPropagation();
			if (this.query) this.limpar_pesquisa();
			else this.fechar_detalhe();
		}
	}

	consultar_registo(dominio) {
		this.consulta = { dominio, a_carregar: true };
		this.render_consulta();
		frappe
			.xcall("entre_erp.painel_dominios.consultar_dominio", { dominio })
			.then((r) => {
				this.consulta = r;
				this.render_consulta();
			})
			.catch(() => {
				this.consulta = { dominio, erro: __("Não foi possível consultar agora. Tente daqui a pouco.") };
				this.render_consulta();
			});
	}

	// --- list --------------------------------------------------------------

	get visiveis() {
		const filtro = this.filtros.find((f) => f.id === this.filtro) || this.filtros[0];
		const termos = dm_normal(this.query).split(/\s+/).filter(Boolean);
		// While searching, look everywhere: a cancelled domain is still findable.
		const base = termos.length ? this.dominios : this.dominios.filter(filtro.teste);
		return base
			.filter((d) => {
				if (!termos.length) return true;
				const texto = dm_normal(
					[d.name, d.nome_do_dominio, d.customer, d.email, d.telemovel, d.pacote, d.whois_registrar, d.whois_nameservers].join(" ")
				);
				return termos.every((t) => texto.includes(t));
			})
			.sort(DM_ORDENS[this.ordem].fn);
	}

	render_cards() {
		this.$body.find(".dm-cards").html(
			this.filtros
				.map((f) => {
					const n = this.dominios.filter(f.teste).length;
					return `
						<button class="dm-card ${f.id === this.filtro ? "dm-card-activo" : ""} ${n && f.tom ? `dm-tom-${f.tom}` : ""}" data-filtro="${f.id}">
							<div class="dm-card-valor">${n}</div>
							<div class="dm-card-rotulo">${dm_esc(f.rotulo)}</div>
							${f.nota ? `<div class="dm-card-nota">${dm_esc(f.nota)}</div>` : ""}
						</button>`;
				})
				.join("")
		);
	}

	render_lista() {
		const visiveis = this.visiveis;
		const filtro = this.filtros.find((f) => f.id === this.filtro);
		this.$body
			.find(".dm-contagem")
			.text(
				this.query
					? __("{0} resultados para “{1}”", [visiveis.length, this.query.trim()])
					: __("{0} domínios · {1}", [visiveis.length, filtro ? filtro.rotulo : ""])
			);
		this.render_consulta();

		const $lista = this.$body.find(".dm-lista");
		if (!visiveis.length) {
			$lista.html(`<div class="dm-lista-vazia">${
				this.query ? __("Nenhum domínio gerido corresponde à pesquisa.") : __("Nada aqui. 🎉")
			}</div>`);
			return;
		}
		$lista.html(visiveis.map((d) => this.html_linha(d)).join(""));
	}

	html_linha(d) {
		const tom = d.estado === "Cancelado" ? "cinza" : d.dias == null ? "cinza" : d.dias < 0 ? "vermelho" : d.dias <= (this.dias_abrir_renovacao || 40) ? "laranja" : "verde";
		const resto = d.dias == null ? 0 : Math.max(0, Math.min(1, d.dias / (d.dias_periodo || 365)));
		const alertas = d.alertas.filter((a) => a.nivel !== "info");
		const pior = alertas.some((a) => a.nivel === "erro") ? "vermelho" : "laranja";
		return `
			<div class="dm-linha ${d.name === this.seleccionado ? "dm-linha-activa" : ""} ${d.estado === "Cancelado" ? "dm-linha-cancelada" : ""}" data-nome="${dm_esc(d.name)}" tabindex="-1">
				<div class="dm-linha-principal">
					<div class="dm-nome">
						${this.realcar(d.name)}
						${alertas.length ? `<span class="dm-alerta-ponto dm-${pior}" title="${dm_esc(alertas.map((a) => a.texto).join("\n"))}">${alertas.length}</span>` : ""}
					</div>
					<div class="dm-sub">${this.realcar(d.customer || "—")}${d.pacote ? ` · ${dm_esc(d.pacote)}` : ""}</div>
				</div>
				<div class="dm-pilulas">
					${d.estado !== "Ativo" ? dm_pilula(d.estado, DM_CORES_ESTADO[d.estado]) : ""}
					${["Pendente", "Pago", "Renovado"].includes(d.renovacao_estado) ? dm_pilula(d.renovacao_estado, DM_CORES_RENOVACAO[d.renovacao_estado]) : ""}
				</div>
				<div class="dm-expira">
					<div class="dm-dias dm-texto-${tom}">${dm_esc(dm_quando(d.dias))}</div>
					<div class="dm-barra"><span class="dm-fundo-${tom}" style="width:${Math.round(resto * 100)}%"></span></div>
					<div class="dm-data">${dm_data(d.expira)}</div>
				</div>
			</div>`;
	}

	realcar(texto) {
		const termos = dm_normal(this.query).split(/\s+/).filter(Boolean);
		const original = String(texto || "");
		if (!termos.length) return dm_esc(original);
		// Mark matches on the accent-free text, then cut the original at the same spots.
		const normal = dm_normal(original);
		const marcas = new Array(original.length).fill(false);
		for (const t of termos) {
			let i = normal.indexOf(t);
			while (i !== -1) {
				for (let k = i; k < i + t.length; k++) marcas[k] = true;
				i = normal.indexOf(t, i + t.length);
			}
		}
		let html = "";
		let aberto = false;
		for (let k = 0; k < original.length; k++) {
			if (marcas[k] && !aberto) (html += "<mark>"), (aberto = true);
			if (!marcas[k] && aberto) (html += "</mark>"), (aberto = false);
			html += dm_esc(original[k]);
		}
		return html + (aberto ? "</mark>" : "");
	}

	html_esqueleto() {
		return Array.from({ length: 6 }, () => `<div class="dm-linha dm-esqueleto"><div></div><div></div><div></div></div>`).join("");
	}

	// --- registry lookup card ---------------------------------------------

	render_consulta() {
		const $c = this.$body.find(".dm-consulta");
		const dominio = dm_como_dominio(this.query);
		const gerido = this.dominios.some((d) => d.name === dominio || dm_normal(d.nome_do_dominio) === dominio);

		if (!dm_parece_dominio(dominio) || (gerido && !this.consulta)) {
			$c.empty();
			return;
		}
		const r = this.consulta;
		if (!r) {
			$c.html(`
				<button class="dm-consulta-convite">
					<span>🔎 ${__("Consultar <b>{0}</b> no registo", [dm_esc(dominio)])}</span>
					<span class="dm-tecla">Enter ↵</span>
				</button>`);
			$c.find(".dm-consulta-convite").on("click", () => this.consultar_registo(dominio));
			return;
		}
		if (r.a_carregar) {
			$c.html(`<div class="dm-consulta-cartao"><div class="dm-consulta-a-carregar">${__("A consultar {0} no registo…", [dm_esc(r.dominio)])}</div></div>`);
			return;
		}

		let estado, corpo, accoes = "";
		if (r.erro) {
			estado = dm_pilula("Erro", "vermelho");
			corpo = `<div class="dm-consulta-texto">${dm_esc(r.erro)}</div>`;
		} else if (!r.registado) {
			estado = dm_pilula("Disponível", "verde");
			corpo = `<div class="dm-consulta-texto">${__("Este domínio não está registado: está livre para registo.")}</div>`;
		} else {
			const dias = r.whois_expiry_date ? frappe.datetime.get_diff(r.whois_expiry_date, frappe.datetime.get_today()) : null;
			estado = dm_pilula("Registado", "azul");
			corpo = `
				<div class="dm-grelha">
					${this.campo(__("Expira"), `${dm_data(r.whois_expiry_date)} <span class="dm-muted">· ${dm_esc(dm_quando(dias))}</span>`)}
					${this.campo(__("Registado em"), dm_data(r.whois_created_date))}
					${this.campo(__("Registrar"), dm_esc(r.whois_registrar || "—"))}
					${this.campo(__("Estado no registo"), dm_esc(r.whois_status || "—"))}
				</div>
				${this.html_nameservers(r.whois_nameservers)}`;
		}
		if (r.gerido) {
			accoes = `<button class="btn btn-default btn-xs dm-consulta-abrir">${__("Ver na lista")}</button>`;
		} else if (r.registado && this.pode_criar) {
			accoes = `<button class="btn btn-primary btn-xs dm-consulta-adicionar">+ ${__("Adicionar à gestão")}</button>`;
		}
		$c.html(`
			<div class="dm-consulta-cartao">
				<div class="dm-consulta-cabecalho">
					<div><span class="dm-consulta-dominio">${dm_esc(r.dominio)}</span> ${estado}</div>
					<div class="dm-consulta-accoes">${accoes}<button class="btn btn-link btn-xs dm-consulta-fechar">${__("Fechar")}</button></div>
				</div>
				${corpo}
			</div>`);
		$c.find(".dm-consulta-fechar").on("click", () => this.limpar_pesquisa());
		$c.find(".dm-consulta-abrir").on("click", () => this.seleccionar(r.gerido));
		$c.find(".dm-consulta-adicionar").on("click", () =>
			frappe.new_doc("Domain Management", {
				nome_do_dominio: r.dominio,
				data_de_inicio: r.whois_created_date,
				data_de_fim: r.whois_expiry_date,
			})
		);
	}

	// --- detail ------------------------------------------------------------

	seleccionar(nome, { manter_foco } = {}) {
		this.seleccionado = nome;
		this.$body.find(".dm-linha").removeClass("dm-linha-activa");
		const $linha = this.$body.find(`.dm-linha[data-nome="${CSS.escape(nome)}"]`).addClass("dm-linha-activa");
		if ($linha.length) $linha[0].scrollIntoView({ block: "nearest" });
		this.render_detalhe();
		if (!manter_foco) $linha.trigger("focus");
	}

	fechar_detalhe() {
		this.seleccionado = null;
		this.$body.find(".dm-linha").removeClass("dm-linha-activa");
		this.$body.find(".dm-detalhe").removeClass("dm-aberto").html(this.html_detalhe_vazio());
	}

	html_detalhe_vazio() {
		return `
			<div class="dm-detalhe-vazio">
				<div class="dm-detalhe-vazio-icone">🌐</div>
				<div>${__("Escolha um domínio para ver tudo sobre ele.")}</div>
				<div class="dm-dica">${__("/ para pesquisar · ↑ ↓ para navegar · Esc para fechar")}</div>
			</div>`;
	}

	render_detalhe() {
		const d = this.dominios.find((x) => x.name === this.seleccionado);
		const $det = this.$body.find(".dm-detalhe");
		if (!d) {
			this.fechar_detalhe();
			return;
		}
		$det.addClass("dm-aberto");
		const extra = this.detalhes[d.name];
		const renovacao_aberta = ["Pendente", "Pago"].includes(d.renovacao_estado);
		const tom_dias = d.dias == null ? "" : d.dias < 0 ? "vermelho" : d.dias <= (this.dias_abrir_renovacao || 40) ? "laranja" : "verde";

		$det.html(`
			<div class="dm-detalhe-cabecalho">
				<button class="dm-fechar" title="${__("Fechar (Esc)")}">×</button>
				<div class="dm-detalhe-nome">
					${dm_esc(d.name)}
					<a href="https://${dm_esc(d.name)}" target="_blank" rel="noopener noreferrer" title="${__("Abrir o site")}">↗</a>
				</div>
				<div class="dm-detalhe-cliente">${d.customer ? `<a href="/app/customer/${encodeURIComponent(d.customer)}">${dm_esc(d.customer)}</a>` : "—"}</div>
				<div class="dm-pilulas">
					${dm_pilula(d.estado, DM_CORES_ESTADO[d.estado])}
					${d.renovacao_estado ? dm_pilula(d.renovacao_estado, DM_CORES_RENOVACAO[d.renovacao_estado]) : ""}
					${d.nots === "Não" ? dm_pilula("Sem notificações", "cinza") : ""}
				</div>
			</div>

			<div class="dm-contador dm-texto-${tom_dias}">
				<div class="dm-contador-valor">${dm_esc(dm_quando(d.dias))}</div>
				<div class="dm-muted">${d.whois_expiry_date ? __("segundo o registo") : __("segundo o ERP (ainda sem consulta ao registo)")}</div>
			</div>

			${d.alertas.length ? `<div class="dm-alertas">${d.alertas.map((a) => `<div class="dm-alerta dm-alerta-${a.nivel}">${dm_esc(a.texto)}</div>`).join("")}</div>` : ""}

			<div class="dm-accoes">
				${
					renovacao_aberta
						? `<button class="btn btn-primary btn-sm dm-abrir-renovacao">${__("Abrir renovação")}</button>`
						: d.estado !== "Cancelado"
							? `<button class="btn btn-default btn-sm dm-nova-renovacao">${__("Nova renovação")}</button>`
							: ""
				}
				<button class="btn btn-default btn-sm dm-consultar-agora">↻ ${__("Consultar registo")}</button>
				<button class="btn btn-default btn-sm dm-abrir-ficha">${__("Abrir ficha")}</button>
			</div>

			<div class="dm-seccao">
				<div class="dm-seccao-titulo">${__("Datas")}</div>
				<div class="dm-grelha">
					${this.campo(__("Expira no registo"), dm_data(d.whois_expiry_date))}
					${this.campo(__("Data de renovação (ERP)"), dm_data(d.data_de_fim))}
					${this.campo(__("Início"), dm_data(d.data_de_inicio))}
					${this.campo(__("Última renovação"), d.ultima_renovacao ? frappe.datetime.str_to_user(d.ultima_renovacao.split(" ")[0]) : "—")}
					${this.campo(__("Período"), dm_esc(d.periodo || "—"))}
					${this.campo(__("Valor"), d.valor ? format_currency(d.valor) : "—")}
				</div>
			</div>

			<div class="dm-seccao">
				<div class="dm-seccao-titulo">${__("Registo")}
					<span class="dm-muted dm-seccao-nota">${d.whois_last_checked ? __("consultado {0}", [comment_when(d.whois_last_checked)]) : __("nunca consultado")}</span>
				</div>
				<div class="dm-grelha">
					${this.campo(__("Registrar"), dm_esc(d.whois_registrar || "—"))}
					${this.campo(__("Estado no registo"), dm_esc(d.whois_status || "—"))}
					${this.campo(__("Registado em"), dm_data(d.whois_created_date))}
				</div>
				${this.html_nameservers(d.whois_nameservers)}
				${d.whois_error ? `<div class="dm-alerta dm-alerta-aviso">${dm_esc(d.whois_error)}</div>` : ""}
			</div>

			<div class="dm-seccao">
				<div class="dm-seccao-titulo">${__("Contacto")}</div>
				<div class="dm-grelha">
					${this.campo(__("Email"), d.email ? `<a href="mailto:${dm_esc(d.email)}">${dm_esc(d.email)}</a>` : "—")}
					${this.campo(__("Telemóvel"), d.telemovel ? `<a href="tel:${dm_esc(d.telemovel)}">${dm_esc(d.telemovel)}</a>` : "—")}
				</div>
			</div>

			<div class="dm-seccao dm-extra">${extra ? this.html_extra(extra) : `<div class="dm-muted">${__("A carregar histórico…")}</div>`}</div>
		`);

		$det.find(".dm-fechar").on("click", () => this.fechar_detalhe());
		$det.find(".dm-abrir-ficha").on("click", () => frappe.set_route("Form", "Domain Management", d.name));
		$det.find(".dm-abrir-renovacao").on("click", () => frappe.set_route("Form", "Domain Renewal", d.renovacao_actual));
		$det.find(".dm-nova-renovacao").on("click", () =>
			frappe
				.xcall("entre_erp.painel_dominios.abrir_renovacao", { nome: d.name })
				.then((nome) => frappe.set_route("Form", "Domain Renewal", nome))
		);
		$det.find(".dm-consultar-agora").on("click", (e) => {
			const $b = $(e.currentTarget).prop("disabled", true).text(__("A consultar…"));
			frappe
				.xcall("entre_erp.painel_dominios.consultar_agora", { nome: d.name })
				.then(() => this.carregar())
				.then(() => frappe.show_alert({ message: __("Registo actualizado"), indicator: "green" }))
				.finally(() => $b.prop("disabled", false));
		});
		$det.find(".dm-extra").on("click", ".dm-ver-registo", (e) => {
			$(e.currentTarget).next(".dm-registo-bruto").toggle();
		});

		if (!extra) {
			frappe.xcall("entre_erp.painel_dominios.obter_detalhe", { nome: d.name }).then((r) => {
				this.detalhes[d.name] = r;
				if (this.seleccionado === d.name) this.$body.find(".dm-extra").html(this.html_extra(r));
			});
		}
	}

	html_extra(extra) {
		const renovacoes = extra.renovacoes.length
			? extra.renovacoes
					.map(
						(r) => `
						<a class="dm-renovacao" href="/app/domain-renewal/${encodeURIComponent(r.name)}">
							<span>${dm_pilula(r.estado, DM_CORES_RENOVACAO[r.estado])}</span>
							<span class="dm-renovacao-datas">${dm_data(r.expira_em)} → ${dm_data(r.nova_expiracao)}</span>
							<span class="dm-muted">${r.confirmado_automaticamente ? __("auto") : r.sem_pagamento ? __("confiança") : ""}</span>
							<span class="dm-renovacao-valor">${r.valor_pago ? format_currency(r.valor_pago) : ""}</span>
						</a>`
					)
					.join("")
			: `<div class="dm-muted">${__("Ainda sem renovações registadas.")}</div>`;

		// Info comments are written by the app, with registry values already escaped.
		const historico = extra.historico.length
			? extra.historico
					.map(
						(h) => `
						<div class="dm-evento">
							<div class="dm-evento-quando">${comment_when(h.creation)}</div>
							<div>${h.content}</div>
						</div>`
					)
					.join("")
			: `<div class="dm-muted">${__("Sem alterações registadas.")}</div>`;

		return `
			<div class="dm-seccao-titulo">${__("Renovações")}</div>
			<div class="dm-renovacoes">${renovacoes}</div>
			<div class="dm-seccao-titulo dm-espaco">${__("Histórico")}</div>
			<div class="dm-historico">${historico}</div>
			${
				extra.whois_raw
					? `<button class="btn btn-link btn-xs dm-ver-registo">${__("Ver resposta completa do registo")}</button>
					   <pre class="dm-registo-bruto" style="display:none">${dm_esc(extra.whois_raw)}</pre>`
					: ""
			}`;
	}

	html_nameservers(texto) {
		const servidores = (texto || "").split(/\s+/).filter(Boolean);
		if (!servidores.length) return "";
		return `<div class="dm-ns">${servidores.map((s) => `<span class="dm-ns-chip">${dm_esc(s)}</span>`).join("")}</div>`;
	}

	campo(rotulo, valor_html) {
		return `<div class="dm-campo"><div class="dm-campo-rotulo">${dm_esc(rotulo)}</div><div class="dm-campo-valor">${valor_html}</div></div>`;
	}
}

function dm_inject_styles() {
	if (document.getElementById("dm-painel-style")) return;
	const style = document.createElement("style");
	style.id = "dm-painel-style";
	style.innerHTML = `
		.dm-wrapper .container { max-width: 100% !important; }
		.dm-painel {
			--dm-verde: #16a34a; --dm-vermelho: #dc2626; --dm-laranja: #d97706;
			--dm-azul: #2563eb; --dm-roxo: #7c3aed; --dm-cinza: #6b7280;
			--dm-raio: 10px;
			padding-bottom: 40px;
		}
		html[data-theme="dark"] .dm-painel {
			--dm-verde: #4ade80; --dm-vermelho: #f87171; --dm-laranja: #fbbf24;
			--dm-azul: #60a5fa; --dm-roxo: #a78bfa; --dm-cinza: #9ca3af;
		}
		.dm-muted { color: var(--text-muted); font-size: 12px; }
		.dm-texto-verde { color: var(--dm-verde); } .dm-texto-vermelho { color: var(--dm-vermelho); }
		.dm-texto-laranja { color: var(--dm-laranja); } .dm-texto-cinza { color: var(--dm-cinza); }
		.dm-fundo-verde { background: var(--dm-verde); } .dm-fundo-vermelho { background: var(--dm-vermelho); }
		.dm-fundo-laranja { background: var(--dm-laranja); } .dm-fundo-cinza { background: var(--dm-cinza); }

		/* search */
		.dm-topo { display: flex; gap: 12px; align-items: center; margin: 4px 0 16px; flex-wrap: wrap; }
		.dm-pesquisa { position: relative; flex: 1; min-width: 280px; }
		.dm-pesquisa-input {
			width: 100%; height: 48px; padding: 0 76px 0 44px; font-size: 15px;
			border-radius: 12px; border: 1px solid var(--border-color);
			background: var(--fg-color); color: var(--text-color);
			box-shadow: 0 1px 2px rgba(0,0,0,.04); transition: border-color .15s, box-shadow .15s;
		}
		.dm-pesquisa-input:focus { outline: none; border-color: var(--dm-azul); box-shadow: 0 0 0 4px rgba(37,99,235,.15); }
		.dm-lupa { position: absolute; left: 15px; top: 15px; color: var(--text-muted); }
		.dm-limpar {
			position: absolute; right: 12px; top: 10px; width: 28px; height: 28px; border-radius: 50%;
			border: 0; background: var(--control-bg); color: var(--text-muted); font-size: 18px; line-height: 1;
		}
		.dm-pesquisa > .dm-tecla { position: absolute; right: 14px; top: 13px; }
		.dm-tecla {
			display: inline-block; padding: 1px 7px; font-size: 11px; font-family: var(--font-family-monospace, monospace);
			border: 1px solid var(--border-color); border-bottom-width: 2px; border-radius: 5px; color: var(--text-muted);
			background: var(--fg-color);
		}
		.dm-topo-accoes { display: flex; gap: 8px; }

		/* filter cards */
		.dm-cards { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
		.dm-card {
			text-align: left; padding: 12px 14px; border-radius: var(--dm-raio); cursor: pointer;
			background: var(--fg-color); border: 1px solid var(--border-color); transition: transform .1s, border-color .15s;
		}
		.dm-card:hover { transform: translateY(-1px); border-color: var(--text-muted); }
		.dm-card-activo { border-color: var(--dm-azul) !important; box-shadow: inset 0 0 0 1px var(--dm-azul); }
		.dm-card-valor { font-size: 24px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
		.dm-card-rotulo { font-size: 12px; color: var(--text-muted); font-weight: 500; }
		.dm-card-nota { font-size: 11px; color: var(--text-muted); opacity: .8; }
		.dm-tom-laranja .dm-card-valor { color: var(--dm-laranja); }
		.dm-tom-vermelho .dm-card-valor { color: var(--dm-vermelho); }
		.dm-tom-azul .dm-card-valor { color: var(--dm-azul); }

		/* layout */
		.dm-corpo { display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 16px; align-items: start; }
		.dm-barra-lista { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
		.dm-contagem { font-size: 12px; color: var(--text-muted); }
		.dm-ordem { width: auto !important; height: 28px; font-size: 12px; }

		/* list */
		.dm-lista { border: 1px solid var(--border-color); border-radius: var(--dm-raio); background: var(--fg-color); overflow: hidden; }
		.dm-linha {
			display: grid; grid-template-columns: minmax(0, 1fr) auto 170px; gap: 12px; align-items: center;
			padding: 11px 14px; border-bottom: 1px solid var(--border-color); cursor: pointer; outline: none;
			transition: background .1s;
		}
		.dm-linha:last-child { border-bottom: 0; }
		.dm-linha:hover { background: var(--control-bg); }
		.dm-linha-activa { background: rgba(37,99,235,.08) !important; box-shadow: inset 3px 0 0 var(--dm-azul); }
		.dm-linha-cancelada { opacity: .55; }
		.dm-nome { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }
		.dm-sub { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.dm-linha mark { background: rgba(250, 204, 21, .4); color: inherit; padding: 0; border-radius: 2px; }
		.dm-pilulas { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
		.dm-expira { text-align: right; }
		.dm-dias { font-size: 12px; font-weight: 600; }
		.dm-barra { height: 4px; border-radius: 2px; background: var(--control-bg); margin: 4px 0 3px; overflow: hidden; }
		.dm-barra span { display: block; height: 100%; border-radius: 2px; margin-left: auto; }
		.dm-data { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
		.dm-alerta-ponto {
			display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px;
			border-radius: 9px; font-size: 11px; font-weight: 700; color: #fff;
		}
		.dm-alerta-ponto.dm-vermelho { background: var(--dm-vermelho); }
		.dm-alerta-ponto.dm-laranja { background: var(--dm-laranja); }
		.dm-lista-vazia { padding: 40px; text-align: center; color: var(--text-muted); }
		.dm-esqueleto { cursor: default; }
		.dm-esqueleto div { height: 14px; border-radius: 4px; background: linear-gradient(90deg, var(--control-bg) 25%, var(--border-color) 50%, var(--control-bg) 75%); background-size: 200% 100%; animation: dm-brilho 1.2s infinite; }
		@keyframes dm-brilho { to { background-position: -200% 0; } }

		/* pills */
		.dm-pilula { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
		.dm-pilula.dm-verde { color: var(--dm-verde); background: color-mix(in srgb, var(--dm-verde) 14%, transparent); }
		.dm-pilula.dm-vermelho { color: var(--dm-vermelho); background: color-mix(in srgb, var(--dm-vermelho) 14%, transparent); }
		.dm-pilula.dm-laranja { color: var(--dm-laranja); background: color-mix(in srgb, var(--dm-laranja) 16%, transparent); }
		.dm-pilula.dm-azul { color: var(--dm-azul); background: color-mix(in srgb, var(--dm-azul) 14%, transparent); }
		.dm-pilula.dm-roxo { color: var(--dm-roxo); background: color-mix(in srgb, var(--dm-roxo) 14%, transparent); }
		.dm-pilula.dm-cinza { color: var(--dm-cinza); background: color-mix(in srgb, var(--dm-cinza) 14%, transparent); }

		/* registry lookup */
		.dm-consulta:empty { display: none; }
		.dm-consulta { margin-bottom: 10px; }
		.dm-consulta-convite {
			width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 12px 14px;
			border: 1px dashed var(--dm-azul); border-radius: var(--dm-raio); background: rgba(37,99,235,.05);
			color: var(--text-color); font-size: 13px; cursor: pointer;
		}
		.dm-consulta-convite:hover { background: rgba(37,99,235,.1); }
		.dm-consulta-cartao { padding: 14px; border: 1px solid var(--dm-azul); border-radius: var(--dm-raio); background: var(--fg-color); }
		.dm-consulta-cabecalho { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
		.dm-consulta-dominio { font-size: 16px; font-weight: 700; margin-right: 6px; }
		.dm-consulta-accoes { display: flex; gap: 6px; align-items: center; }
		.dm-consulta-texto { font-size: 13px; }
		.dm-consulta-a-carregar { color: var(--text-muted); font-size: 13px; animation: dm-pulsar 1s infinite alternate; }
		@keyframes dm-pulsar { from { opacity: .5; } to { opacity: 1; } }

		/* detail */
		.dm-detalhe {
			position: sticky; top: calc(var(--navbar-height, 48px) + 16px); max-height: calc(100vh - var(--navbar-height, 48px) - 32px);
			overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--dm-raio); background: var(--fg-color); padding: 18px;
		}
		.dm-detalhe-vazio { text-align: center; color: var(--text-muted); padding: 48px 12px; font-size: 13px; }
		.dm-detalhe-vazio-icone { font-size: 32px; margin-bottom: 8px; }
		.dm-dica { margin-top: 10px; font-size: 11px; opacity: .8; }
		.dm-detalhe-cabecalho { position: relative; padding-right: 28px; }
		.dm-fechar { position: absolute; right: -6px; top: -8px; border: 0; background: none; font-size: 22px; color: var(--text-muted); }
		.dm-detalhe-nome { font-size: 20px; font-weight: 700; word-break: break-all; }
		.dm-detalhe-nome a { font-size: 15px; margin-left: 4px; color: var(--text-muted); text-decoration: none; }
		.dm-detalhe-cliente { font-size: 13px; margin: 2px 0 8px; }
		.dm-detalhe-cabecalho .dm-pilulas { justify-content: flex-start; }
		.dm-contador { margin: 14px 0; padding: 12px 14px; border-radius: var(--dm-raio); background: var(--control-bg); }
		.dm-contador-valor { font-size: 18px; font-weight: 700; }
		.dm-alertas { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
		.dm-alerta { padding: 7px 10px; border-radius: 7px; font-size: 12px; border-left: 3px solid; }
		.dm-alerta-erro { border-color: var(--dm-vermelho); background: color-mix(in srgb, var(--dm-vermelho) 9%, transparent); }
		.dm-alerta-aviso { border-color: var(--dm-laranja); background: color-mix(in srgb, var(--dm-laranja) 10%, transparent); }
		.dm-alerta-info { border-color: var(--dm-cinza); background: var(--control-bg); }
		.dm-accoes { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
		.dm-seccao { padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--border-color); }
		.dm-seccao-titulo { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); margin-bottom: 8px; }
		.dm-seccao-nota { text-transform: none; letter-spacing: 0; font-weight: 400; margin-left: 6px; }
		.dm-espaco { margin-top: 16px; }
		.dm-grelha { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
		.dm-campo-rotulo { font-size: 11px; color: var(--text-muted); }
		.dm-campo-valor { font-size: 13px; font-weight: 500; word-break: break-word; }
		.dm-ns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
		.dm-ns-chip { font-family: var(--font-family-monospace, monospace); font-size: 11px; padding: 2px 8px; border-radius: 6px; background: var(--control-bg); }
		.dm-renovacoes { display: flex; flex-direction: column; }
		.dm-renovacao {
			display: grid; grid-template-columns: 92px 1fr auto auto; gap: 8px; align-items: center;
			padding: 7px 4px; border-bottom: 1px solid var(--border-color); color: var(--text-color); font-size: 12px; text-decoration: none !important;
		}
		.dm-renovacao:hover { background: var(--control-bg); }
		.dm-renovacao-valor { font-variant-numeric: tabular-nums; }
		.dm-historico { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
		.dm-evento { padding-left: 12px; border-left: 2px solid var(--border-color); }
		.dm-evento-quando { font-size: 11px; color: var(--text-muted); }
		.dm-registo-bruto { margin-top: 8px; max-height: 280px; overflow: auto; font-size: 11px; background: var(--control-bg); padding: 10px; border-radius: 6px; white-space: pre-wrap; }

		@media (max-width: 1200px) {
			.dm-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
		}
		@media (max-width: 991px) {
			.dm-corpo { grid-template-columns: 1fr; }
			.dm-detalhe { display: none; position: fixed; inset: 0; top: var(--navbar-height, 48px); max-height: none; border-radius: 0; z-index: 1030; }
			.dm-detalhe.dm-aberto { display: block; }
			.dm-linha { grid-template-columns: minmax(0, 1fr) 120px; }
			.dm-linha .dm-pilulas { display: none; }
		}
		@media (max-width: 600px) {
			.dm-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
			.dm-topo-accoes { width: 100%; justify-content: flex-end; }
		}
	`;
	document.head.appendChild(style);
}
