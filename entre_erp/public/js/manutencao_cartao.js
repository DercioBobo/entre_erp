// The header card of Manutenção Programada and Modelo de Manutenção: what,
// when, where it stands and which emails went, at a glance. Rendered into the
// `cabecalho` HTML field and kept up to date as the form changes; styles in
// public/css/manutencao.css.
frappe.provide("entre_erp.manutencao");

(() => {
	const { extenso, hhmm, minutos, SEMANA, SEMANA_LONGA, MESES } = entre_erp.janela.util;
	const esc = (texto) => frappe.utils.escape_html(texto || "");
	const dois = (n) => String(n).padStart(2, "0");

	const ESTADOS = ["Rascunho", "Agendada", "Em Curso", "Concluída"];
	const COR_ESTADO = { Rascunho: "gray", Agendada: "blue", "Em Curso": "orange", "Concluída": "green", Cancelada: "red" };
	const COR_TIPO = { Correctiva: "red", Preventiva: "blue", "Actualização": "purple" };
	const COR_IMPACTO = { Total: "red", "Total ou parcial": "orange", Parcial: "yellow" };

	const pill = (texto, cor) => (texto ? `<span class="indicator-pill ${cor || "gray"}">${esc(texto)}</span>` : "");
	const cor_css = (cor) => `--em-cor: var(--${cor}-500, var(--primary))`;
	const minutos_ate = (momento) => moment(momento).diff(moment(frappe.datetime.now_datetime()), "minutes");

	// 45 → "45 min", 135 → "2h15", 4320 → "3 dias"
	function distancia(min) {
		const m = Math.abs(Math.round(min));
		if (m < 60) return `${m} min`;
		if (m < 48 * 60) return m % 60 ? `${Math.floor(m / 60)}h${dois(m % 60)}` : `${m / 60}h`;
		return __("{0} dias", [Math.round(m / 1440)]);
	}
	const relativo = (min) => (min >= 0 ? __("daqui a {0}", [distancia(min)]) : __("há {0}", [distancia(min)]));
	const curta = (momento) => {
		const d = moment(momento);
		return `${d.date()} ${MESES[d.month()]}, ${d.format("HH")}h${d.format("mm")}`;
	};

	// A calendar leaf: weekday / day / month.
	function folha(dia, classe = "") {
		if (!dia) return `<div class="em-folha vazia"><span>&nbsp;</span><b>?</b><span>&nbsp;</span></div>`;
		const d = moment(dia);
		return `<div class="em-folha ${classe}"><span>${SEMANA[d.day()]}</span><b>${d.date()}</b><span>${MESES[d.month()]}</span></div>`;
	}

	function janela(inicio, fim) {
		const dia = inicio.slice(0, 10);
		const dias = moment(fim.slice(0, 10)).diff(moment(dia), "days");
		const ate_dia =
			dias === 1 ? ` ${__("de")} ${SEMANA_LONGA[moment(fim).day()]}` : dias > 1 ? ` ${__("de")} ${extenso(fim.slice(0, 10))}` : "";
		const dur = moment(fim).diff(moment(inicio), "minutes");
		return `${extenso(dia)} · <b>${hhmm(minutos(inicio))} → ${hhmm(minutos(fim))}</b>${ate_dia} <span class="em-mudo">· ${distancia(dur)}</span>`;
	}

	// [css class, text] of where the maintenance stands right now.
	function situacao(doc) {
		const { estado, inicio, fim } = doc;
		if (estado === "Cancelada") return ["alerta", __("Cancelada.")];
		if (!inicio || !fim) return ["", __("Escolha a janela abaixo.")];
		if (estado === "Concluída") {
			const de = doc.inicio_real || inicio;
			const ate = doc.fim_real || fim;
			let texto = __("Concluída {0} · {1} → {2}, durou {3}", [
				relativo(minutos_ate(ate)),
				hhmm(minutos(de)),
				hhmm(minutos(ate)),
				distancia(moment(ate).diff(moment(de), "minutes")),
			]);
			const alem = moment(ate).diff(moment(fim), "minutes");
			if (alem > 0) texto += __(" ({0} além da janela)", [distancia(alem)]);
			return ["ok", texto];
		}
		if (estado === "Em Curso") {
			const resta = minutos_ate(fim);
			const desde = doc.inicio_real ? __("Começou às {0} · ", [hhmm(minutos(doc.inicio_real))]) : "";
			return resta >= 0
				? ["agora", desde + __("A decorrer, termina {0}", [relativo(resta)])]
				: ["alerta", desde + __("A janela terminou {0}", [relativo(resta)])];
		}
		const falta = minutos_ate(inicio);
		return falta < 0 ? ["alerta", __("Devia ter começado {0}", [relativo(falta)])] : ["", __("Começa {0}", [relativo(falta)])];
	}

	function passos(estado) {
		// Concluída is the end: every step done.
		const actual = estado === "Concluída" ? ESTADOS.length : ESTADOS.indexOf(estado || "Rascunho");
		const html = ESTADOS.map((e, i) => {
			const classe = i < actual ? "feito" : i === actual ? "actual" : "";
			return `<div class="em-passo ${classe}"><span class="em-bola">${i < actual ? "✓" : i + 1}</span>${__(e)}</div>`;
		}).join(`<div class="em-traco"></div>`);
		return `<div class="em-passos${estado === "Cancelada" ? " cancelada" : ""}">${html}</div>`;
	}

	function envios(doc) {
		const itens = [[__("Aviso"), doc.aviso_enviado_em, __("Sai ao agendar")]];
		if (doc.enviar_lembrete) {
			const quando = doc.hora_do_lembrete ? __("No dia, às {0}", [hhmm(minutos(doc.hora_do_lembrete))]) : "";
			itens.push([__("Lembrete"), doc.lembrete_enviado_em, quando]);
		}
		itens.push([__("Conclusão"), doc.conclusao_enviada_em, __("Sai ao concluir")]);
		if (doc.deployment_plan) {
			itens.push([__("Relatório"), doc.relatorio_enviado_em, doc.relatorio ? __("Pronto a enviar") : __("Por preencher")]);
		}
		return itens
			.map(([nome, enviado, pendente]) => {
				const nota = enviado ? __("Enviado a {0}", [curta(enviado)]) : doc.estado === "Cancelada" ? __("Não enviado") : pendente;
				return `<div class="em-envio${enviado ? " feito" : ""}">
					<span class="em-icone">${enviado ? "✓" : "✉"}</span>
					<div><b>${nome}</b><small>${esc(nota)}</small></div>
				</div>`;
			})
			.join("");
	}

	function iniciais({ nome, email }) {
		const partes = (nome || (email || "").split("@")[0]).replace(/[._-]+/g, " ").trim().split(/\s+/).filter(Boolean);
		if (!partes.length) return "?";
		return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
	}

	function pessoas(doc) {
		const para = (doc.destinatarios || []).filter((d) => d.email);
		const cc = (doc.destinatarios_cc || []).filter((d) => d.email);
		if (!para.length && !cc.length) return `<div class="em-pessoas"><span class="em-mudo">${__("Sem destinatários")}</span></div>`;
		const avatares = para
			.slice(0, 5)
			.map((d) => `<span class="em-avatar" title="${esc(d.nome ? `${d.nome} <${d.email}>` : d.email)}">${esc(iniciais(d))}</span>`)
			.join("");
		const mais = para.length > 5 ? `<span class="em-avatar mais">+${para.length - 5}</span>` : "";
		const texto = [para.length && __("{0} em Para", [para.length]), cc.length && __("{0} em CC", [cc.length])]
			.filter(Boolean)
			.join(" · ");
		return `<div class="em-pessoas"><div class="em-avatares">${avatares}${mais}</div><span>${texto}</span></div>`;
	}

	entre_erp.manutencao.cartao = (frm) => {
		const $w = frm.fields_dict.cabecalho?.$wrapper;
		if (!$w) return;
		const doc = frm.doc;
		const estado = doc.estado || "Rascunho";
		const cor = COR_ESTADO[estado] || "gray";
		const [classe, texto] = situacao(doc);
		const marcas = [
			pill(__(estado), cor),
			doc.tipo ? pill(__(doc.tipo), COR_TIPO[doc.tipo]) : "",
			doc.impacto ? pill(__("Impacto {0}", [__(doc.impacto).toLowerCase()]), COR_IMPACTO[doc.impacto]) : "",
			doc.adiamentos ? pill(__("Adiada {0}×", [doc.adiamentos]), "orange") : "",
			doc.prolongamentos ? pill(__("Prolongada {0}×", [doc.prolongamentos]), "orange") : "",
		].join("");

		const rodape = [];
		const modelo = doc.__onload?.modelo;
		if (doc.modelo) {
			let linha = __("Modelo {0}", [frappe.utils.get_form_link("Modelo de Manutencao", doc.modelo, true)]);
			if (modelo?.repete && modelo.activo && modelo.proxima_data) {
				linha += ` · ${esc(modelo.repete)}, ${__("próxima a {0}", [frappe.datetime.str_to_user(modelo.proxima_data)])}`;
			}
			rodape.push(linha);
		}
		if (doc.deployment_plan) rodape.push(__("Deployment Plan {0}", [frappe.utils.get_form_link("Deployment Plan", doc.deployment_plan, true)]));
		if (doc.inicio_anterior) rodape.push(__("Antes do adiamento: {0}", [curta(doc.inicio_anterior)]));

		$w.html(`
			<div class="em-cartao" style="${cor_css(cor)}">
				<div class="em-topo">
					${folha(doc.inicio)}
					<div class="em-centro">
						<div class="em-titulo">${esc(doc.aplicacao) || __("Nova manutenção")}${
			doc.customer ? ` <span class="em-mudo">· ${esc(doc.customer)}</span>` : ""
		}</div>
						<div class="em-pills">${marcas}</div>
						${doc.inicio && doc.fim ? `<div class="em-quando">${janela(doc.inicio, doc.fim)}</div>` : ""}
						<div class="em-conta ${classe}">${esc(texto)}</div>
					</div>
					${pessoas(doc)}
				</div>
				${passos(estado)}
				<div class="em-envios">${envios(doc)}</div>
				${rodape.length ? `<div class="em-rodape">${rodape.join(" · ")}</div>` : ""}
			</div>`);
	};

	// datas: the next dates from the server (proximas_datas), when it repeats.
	entre_erp.manutencao.cartao_modelo = (frm, datas) => {
		const $w = frm.fields_dict.cabecalho?.$wrapper;
		if (!$w) return;
		const doc = frm.doc;
		const cor = doc.activo ? COR_TIPO[doc.tipo] || "blue" : "gray";

		let horas = "";
		if (doc.hora_inicio && doc.hora_fim) {
			const [ini, fim] = [minutos(doc.hora_inicio), minutos(doc.hora_fim)];
			const dur = (fim - ini + 1440) % 1440 || 1440;
			horas = `<b>${hhmm(ini)} → ${hhmm(fim)}</b>${fim <= ini ? ` ${__("do dia seguinte")}` : ""} <span class="em-mudo">· ${distancia(dur)}</span>`;
		}
		const onde = [esc(doc.aplicacao), doc.customer ? `<span class="em-mudo">${esc(doc.customer)}</span>` : "", horas]
			.filter(Boolean)
			.join(" · ");

		let proximas = "";
		if (doc.periodicidade && !doc.activo) {
			proximas = `<div class="em-proximas"><span class="em-mudo">${__("Inactivo: não são criadas manutenções automaticamente.")}</span></div>`;
		} else if (datas?.length) {
			const criada = frappe.datetime.add_days(datas[0], -(doc.dias_de_antecedencia || 0));
			const depois = doc.agendar_automaticamente ? __(" e o aviso enviado nesse dia") : __(", em Rascunho");
			proximas = `<div class="em-proximas">
				<span class="em-rotulo">${__("Próximas")}</span>
				${datas.map((d, i) => folha(d, i ? "apagada" : "")).join("")}
				<span class="em-mudo">${__("A próxima é criada a {0}{1}.", [frappe.datetime.str_to_user(criada), depois])}</span>
			</div>`;
		}

		$w.html(`
			<div class="em-cartao" style="${cor_css(cor)}">
				<div class="em-topo">
					<div class="em-folha"><span>${__("Modelo")}</span><b>${doc.periodicidade ? "↻" : "≡"}</b><span>${esc(
			__(doc.periodicidade || "à mão")
		)}</span></div>
					<div class="em-centro">
						<div class="em-titulo">${esc(doc.titulo) || __("Novo modelo")}</div>
						<div class="em-pills">${doc.activo ? pill(__("Activo"), "green") : pill(__("Inactivo"), "gray")}${
			doc.tipo ? pill(__(doc.tipo), COR_TIPO[doc.tipo]) : ""
		}${doc.impacto ? pill(__("Impacto {0}", [__(doc.impacto).toLowerCase()]), COR_IMPACTO[doc.impacto]) : ""}</div>
						${onde ? `<div class="em-quando">${onde}</div>` : ""}
						${doc.periodicidade && doc.repete ? `<div class="em-conta">${esc(doc.repete)}</div>` : ""}
					</div>
					${pessoas(doc)}
				</div>
				${proximas}
			</div>`);
	};

	// Wiring: render on refresh and whenever a field the card shows changes.
	const handlers = (campos, fn) => Object.fromEntries(campos.map((c) => [c, fn]));
	const TABELAS = ["destinatarios_add", "destinatarios_remove", "destinatarios_cc_add", "destinatarios_cc_remove"];

	const cartao = (frm) => entre_erp.manutencao.cartao(frm);
	frappe.ui.form.on(
		"Manutencao Programada",
		handlers(
			["refresh", "inicio", "fim", "tipo", "impacto", "aplicacao", "customer", "enviar_lembrete", "hora_do_lembrete", "deployment_plan", "modelo", "relatorio", ...TABELAS],
			cartao
		)
	);

	const cartao_modelo = (frm) => entre_erp.manutencao.cartao_modelo(frm, frm.__proximas);
	frappe.ui.form.on("Modelo de Manutencao", {
		...handlers(
			["titulo", "activo", "aplicacao", "customer", "tipo", "impacto", "hora_inicio", "hora_fim", "periodicidade", "dias_de_antecedencia", "agendar_automaticamente", ...TABELAS],
			cartao_modelo
		),
		refresh(frm) {
			frm.__proximas = null;
			cartao_modelo(frm);
			if (frm.is_new() || !frm.doc.periodicidade || !frm.doc.activo) return;
			frm.call("proximas_datas").then(({ message }) => {
				frm.__proximas = message || [];
				cartao_modelo(frm);
			});
		},
	});

	// A recipient's email or name typed into either table.
	const actualizar = (frm) => (frm.doctype === "Modelo de Manutencao" ? cartao_modelo(frm) : cartao(frm));
	frappe.ui.form.on("Destinatario de Manutencao", { email: actualizar, nome: actualizar });
})();
