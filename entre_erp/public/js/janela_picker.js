// A friendlier picker for maintenance windows: tap a day, the start hour and
// the end hour (or a duration) instead of typing datetimes. It reads and
// writes the same Datetime/Time fields, so the server sees no difference.
//
//   entre_erp.janela.ligar(frm, "janela", { modo: "janela", campos: { inicio: "inicio", fim: "fim" } })
//   entre_erp.janela.criar(wrapper, { modo: "momento", valor: { momento }, on_change })
//
// Modes and their values:
//   janela  { inicio, fim }           day + start + end (the end may be the next day)
//   horas   { hora_inicio, hora_fim } start + end, no day (a Modelo's window)
//   momento { momento }               day + time
//   hora    { hora }                  time only
frappe.provide("entre_erp.janela");

(() => {
	const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
	const SEMANA_LONGA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
	const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
	const PERIODOS = [
		["Manhã", [6, 7, 8, 9, 10, 11]],
		["Tarde", [12, 13, 14, 15, 16, 17]],
		["Noite", [18, 19, 20, 21, 22, 23]],
		["Madrugada", [0, 1, 2, 3, 4, 5]],
	];
	const MINUTOS = [0, 15, 30, 45];
	const DURACOES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
	const DIA = 1440;
	// Most maintenance runs 21h00 → 04h00.
	const PADRAO = { ini: 21 * 60, fim: 4 * 60 };

	const COM_DIA = ["janela", "momento"];
	const COM_FIM = ["janela", "horas"];

	const dois = (n) => String(n).padStart(2, "0");
	const hhmm = (min) => `${dois(Math.floor(min / 60))}h${dois(min % 60)}`;
	const hora_str = (min) => `${dois(Math.floor(min / 60))}:${dois(min % 60)}:00`;
	// "21:00:00", "2026-10-19 21:00:00" or "2026-10-19 21:00:00.000000" → 1260
	const minutos = (texto) => {
		if (!texto) return null;
		const s = String(texto);
		const [h, m] = (s.includes(" ") ? s.split(" ")[1] : s).split(":").map(Number);
		return h * 60 + (m || 0);
	};
	const duracao = (ini, fim) => (fim - ini + DIA) % DIA || DIA;
	const dia_de = (texto) => (texto ? String(texto).slice(0, 10) : null);
	const somar_dias = (dia, n) => moment(dia).add(n, "days").format("YYYY-MM-DD");
	const hoje = () => frappe.datetime.get_today();

	function rotulo_dia(dia) {
		const diff = moment(dia).diff(moment(hoje()), "days");
		const d = moment(dia);
		if (diff === 0) return ["Hoje", `${d.date()} ${MESES[d.month()]}`];
		if (diff === 1) return ["Amanhã", `${d.date()} ${MESES[d.month()]}`];
		if (diff === -1) return ["Ontem", `${d.date()} ${MESES[d.month()]}`];
		return [SEMANA[d.day()], `${d.date()} ${MESES[d.month()]}`];
	}

	function extenso(dia) {
		const d = moment(dia);
		const ano = d.year() === moment().year() ? "" : ` ${d.year()}`;
		return `${SEMANA_LONGA[d.day()]}, ${d.date()} ${MESES[d.month()]}${ano}`;
	}

	function estilos() {
		if (document.getElementById("entre-janela-css")) return;
		const css = `
		.ej { display: flex; flex-direction: column; gap: 14px; }
		.ej-linha { display: flex; flex-direction: column; gap: 6px; }
		.ej-rotulo { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
		.ej-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
		.ej-chip { border: 1px solid var(--border-color); background: var(--control-bg); color: var(--text-color);
			border-radius: 8px; padding: 4px 10px; font-size: 13px; cursor: pointer; line-height: 1.3; min-width: 44px; text-align: center; }
		.ej-chip:hover { border-color: var(--primary); }
		.ej-chip small { display: block; font-size: 11px; color: var(--text-muted); }
		.ej-chip.activo { background: var(--primary); border-color: var(--primary); color: #fff; }
		.ej-chip.activo small { color: rgba(255, 255, 255, .85); }
		.ej-chip.fora { opacity: .55; }
		.ej-grelha { display: grid; grid-template-columns: 82px repeat(6, minmax(40px, 1fr)); gap: 4px; align-items: center; max-width: 460px; }
		.ej-grelha .ej-periodo { font-size: 12px; color: var(--text-muted); }
		.ej-grelha .ej-chip { padding: 5px 0; min-width: 0; }
		.ej-outro { max-width: 150px; height: 30px; font-size: 13px; }
		.ej-resumo { border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px; background: var(--fg-color); }
		.ej-texto { font-size: 14px; font-weight: 600; }
		.ej-texto .ej-dur { font-weight: 400; color: var(--text-muted); }
		.ej-barra { position: relative; height: 10px; border-radius: 5px; background: var(--control-bg); margin: 10px 0 4px; }
		.ej-faixa { position: absolute; top: 0; bottom: 0; border-radius: 5px; background: var(--primary); }
		.ej-marca { position: absolute; top: -3px; bottom: -3px; width: 1px; background: var(--border-color); }
		.ej-marca.meia-noite { background: var(--text-muted); }
		.ej-escala { position: relative; height: 14px; font-size: 10px; color: var(--text-muted); }
		.ej-escala span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
		.ej-nota { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
		.ej-nota.alerta { color: var(--red-600, #c0392b); }
		`;
		document.head.insertAdjacentHTML("beforeend", `<style id="entre-janela-css">${css}</style>`);
	}

	class Janela {
		constructor(wrapper, { modo = "janela", valor = {}, padrao = {}, readonly = false, dias = [0, 10], periodos, rotulo, on_change }) {
			estilos();
			this.$w = $(wrapper);
			this.modo = modo;
			// e.g. ["Manhã", "Tarde"] for a reminder hour
			this.periodos = periodos ? PERIODOS.filter(([p]) => periodos.includes(p)) : PERIODOS;
			this.rotulo = rotulo;
			this.readonly = readonly;
			this.dias = dias;
			this.on_change = on_change;
			this.padrao = { ...PADRAO, ...padrao };
			this.definir(valor, false);
			this.$w.off("click.ej change.ej");
			this.$w.on("click.ej", "[data-accao]", (e) => this.clicar(e.currentTarget.dataset));
			this.$w.on("change.ej", ".ej-outro", (e) => e.target.value && this.mudar({ dia: e.target.value }));
		}

		definir(valor = {}, emitir = true) {
			const v = valor || {};
			if (this.modo === "janela") {
				this.dia = dia_de(v.inicio);
				this.ini = minutos(v.inicio) ?? this.padrao.ini;
				this.fim = minutos(v.fim) ?? this.padrao.fim;
			} else if (this.modo === "horas") {
				this.ini = minutos(v.hora_inicio) ?? this.padrao.ini;
				this.fim = minutos(v.hora_fim) ?? this.padrao.fim;
			} else if (this.modo === "momento") {
				this.dia = dia_de(v.momento);
				this.ini = minutos(v.momento) ?? this.padrao.ini;
			} else {
				this.ini = minutos(v.hora) ?? this.padrao.ini;
			}
			this.render();
			if (emitir) this.emitir();
		}

		completo() {
			return !COM_DIA.includes(this.modo) || !!this.dia;
		}

		valor() {
			if (!this.completo()) return null;
			if (this.modo === "janela") {
				const dia_fim = this.fim <= this.ini ? somar_dias(this.dia, 1) : this.dia;
				return { inicio: `${this.dia} ${hora_str(this.ini)}`, fim: `${dia_fim} ${hora_str(this.fim)}` };
			}
			if (this.modo === "horas") return { hora_inicio: hora_str(this.ini), hora_fim: hora_str(this.fim) };
			if (this.modo === "momento") return { momento: `${this.dia} ${hora_str(this.ini)}` };
			return { hora: hora_str(this.ini) };
		}

		emitir() {
			const v = this.valor();
			if (v && this.on_change) this.on_change(v);
		}

		mudar(alteracoes) {
			Object.assign(this, alteracoes);
			this.render();
			this.emitir();
		}

		clicar({ accao, valor }) {
			if (this.readonly) return;
			const n = Number(valor);
			const dur = COM_FIM.includes(this.modo) ? duracao(this.ini, this.fim) : 0;
			if (accao === "dia") return this.mudar({ dia: valor });
			// A new start keeps the duration: the end moves with it.
			if (accao === "ini-h") return this.mudar({ ini: n * 60 + (this.ini % 60), fim: (n * 60 + (this.ini % 60) + dur) % DIA });
			if (accao === "ini-m") {
				const ini = this.ini - (this.ini % 60) + n;
				return this.mudar({ ini, fim: (ini + dur) % DIA });
			}
			if (accao === "fim-h") return this.mudar({ fim: n * 60 + (this.fim % 60) });
			if (accao === "fim-m") return this.mudar({ fim: this.fim - (this.fim % 60) + n });
			if (accao === "dur") return this.mudar({ fim: (this.ini + n * 60) % DIA });
		}

		// Day chips

		html_dias() {
			const [desde, quantos] = this.dias;
			const base = hoje();
			const dias = Array.from({ length: quantos }, (_, i) => somar_dias(base, desde + i));
			if (this.dia && !dias.includes(this.dia)) dias.push(this.dia);
			const chips = dias
				.map((dia) => {
					const [cima, baixo] = rotulo_dia(dia);
					const fds = [0, 6].includes(moment(dia).day()) ? " fora" : "";
					const activo = dia === this.dia ? " activo" : "";
					return `<button type="button" class="ej-chip${activo}${fds}" data-accao="dia" data-valor="${dia}">${cima}<small>${baixo}</small></button>`;
				})
				.join("");
			return `<div class="ej-linha"><div class="ej-rotulo">${__("Dia")}</div>
				<div class="ej-chips">${chips}
					<input type="date" class="form-control ej-outro" title="${__("Outro dia")}" value="${this.dia || ""}">
				</div></div>`;
		}

		// Hour grid (by part of the day) + minutes

		html_horas(rotulo, prefixo, actual) {
			const linhas = this.periodos.map(([periodo, horas]) => {
				const chips = horas
					.map((h) => {
						const activo = Math.floor(actual / 60) === h ? " activo" : "";
						return `<button type="button" class="ej-chip${activo}" data-accao="${prefixo}-h" data-valor="${h}">${dois(h)}h</button>`;
					})
					.join("");
				return `<span class="ej-periodo">${__(periodo)}</span>${chips}`;
			}).join("");
			const mins = MINUTOS.map((m) => {
				const activo = actual % 60 === m ? " activo" : "";
				return `<button type="button" class="ej-chip${activo}" data-accao="${prefixo}-m" data-valor="${m}">:${dois(m)}</button>`;
			}).join("");
			return `<div class="ej-linha"><div class="ej-rotulo">${rotulo}</div>
				<div class="ej-grelha">${linhas}</div>
				<div class="ej-chips"><span class="ej-periodo text-muted small" style="width: 78px">${__("Minutos")}</span>${mins}</div></div>`;
		}

		html_duracoes() {
			const actual = duracao(this.ini, this.fim);
			const chips = DURACOES.map((h) => {
				const activo = actual === h * 60 ? " activo" : "";
				return `<button type="button" class="ej-chip${activo}" data-accao="dur" data-valor="${h}">${h}h</button>`;
			}).join("");
			return `<div class="ej-linha"><div class="ej-rotulo">${__("Duração")}</div><div class="ej-chips">${chips}</div></div>`;
		}

		// Summary + a 24h bar starting 3h before the start

		html_resumo() {
			if (!this.completo()) {
				return `<div class="ej-resumo"><div class="ej-texto text-muted">${__("Escolha o dia")}</div></div>`;
			}
			const tem_fim = COM_FIM.includes(this.modo);
			const dur = tem_fim ? duracao(this.ini, this.fim) : 0;
			const dia_seguinte = tem_fim && this.fim <= this.ini;

			let texto = "";
			if (this.modo === "janela") {
				const fim = dia_seguinte ? ` ${__("de")} ${SEMANA_LONGA[moment(this.dia).add(1, "days").day()]}` : "";
				texto = `${extenso(this.dia)} · ${hhmm(this.ini)} → ${hhmm(this.fim)}${fim}`;
			} else if (this.modo === "horas") {
				texto = `${hhmm(this.ini)} → ${hhmm(this.fim)}${dia_seguinte ? ` (${__("dia seguinte")})` : ""}`;
			} else if (this.modo === "momento") {
				texto = `${extenso(this.dia)} · ${hhmm(this.ini)}`;
			} else {
				texto = hhmm(this.ini);
			}
			if (dur) texto += ` <span class="ej-dur">· ${Math.floor(dur / 60)}h${dois(dur % 60)}</span>`;

			const notas = [];
			const valor = this.valor();
			const agora = frappe.datetime.now_datetime();
			const inicio = valor.inicio || valor.momento;
			if (!this.readonly && this.modo === "janela" && inicio < agora) {
				notas.push(`<div class="ej-nota alerta">${__("Este início já passou.")}</div>`);
			}
			if (this.modo === "janela" && [0, 6].includes(moment(this.dia).day())) {
				notas.push(`<div class="ej-nota">${__("Fim de semana.")}</div>`);
			}

			return `<div class="ej-resumo"><div class="ej-texto">${texto}</div>${this.html_barra(dur)}${notas.join("")}</div>`;
		}

		html_barra(dur) {
			const origem = (Math.floor(this.ini / 60) - 3 + 24) % 24; // hour at the bar's left edge
			const pos = (min) => ((((min - origem * 60) % DIA) + DIA) % DIA) / DIA * 100;
			const marcas = [];
			const escala = [];
			for (let i = 0; i <= 24; i += 3) {
				const h = (origem + i) % 24;
				const esquerda = (i / 24) * 100;
				const meia_noite = h === 0 && i > 0 && i < 24;
				marcas.push(`<div class="ej-marca${meia_noite ? " meia-noite" : ""}" style="left: ${esquerda}%"></div>`);
				const rotulo = meia_noite && this.dia
					? `00h ${SEMANA[moment(this.dia).add(1, "days").day()]}`
					: `${dois(h)}h`;
				escala.push(`<span style="left: ${Math.min(Math.max(esquerda, 3), 97)}%">${rotulo}</span>`);
			}
			const largura = dur ? (dur / DIA) * 100 : 0.8;
			const faixa = `<div class="ej-faixa" style="left: ${pos(this.ini)}%; width: ${largura}%"></div>`;
			return `<div class="ej-barra">${marcas.join("")}${faixa}</div><div class="ej-escala">${escala.join("")}</div>`;
		}

		render() {
			const partes = [];
			if (!this.readonly) {
				if (COM_DIA.includes(this.modo)) partes.push(this.html_dias());
				const rotulo_ini = this.rotulo || (COM_FIM.includes(this.modo) ? __("Início") : __("Hora"));
				partes.push(this.html_horas(rotulo_ini, "ini", this.ini));
				if (COM_FIM.includes(this.modo)) {
					partes.push(this.html_duracoes());
					partes.push(this.html_horas(__("Fim"), "fim", this.fim));
				}
			}
			partes.push(this.html_resumo());
			this.$w.html(`<div class="ej">${partes.join("")}</div>`);
		}
	}

	entre_erp.janela.criar = (wrapper, opcoes) => new Janela(wrapper, opcoes);
	// For the header cards (manutencao_cartao.js).
	entre_erp.janela.util = { extenso, hhmm, minutos, SEMANA, SEMANA_LONGA, MESES };

	// Show the picker in an HTML field in place of the real fields (hidden),
	// which it keeps up to date. campos: { key of the mode's value: fieldname }.
	entre_erp.janela.ligar = (frm, campo_html, { campos, readonly = false, ...opcoes }) => {
		const wrapper = frm.fields_dict[campo_html]?.$wrapper;
		if (!wrapper) return;
		frm.toggle_display(Object.values(campos), false);
		const valor = {};
		for (const [chave, campo] of Object.entries(campos)) valor[chave] = frm.doc[campo];
		const valores = Object.values(valor);
		const parcial = valores.some((v) => v) && valores.some((v) => !v);
		const janela = new Janela(wrapper, {
			...opcoes,
			valor,
			readonly,
			on_change(v) {
				for (const [chave, campo] of Object.entries(campos)) {
					if (frm.doc[campo] !== v[chave]) frm.set_value(campo, v[chave]);
				}
			},
		});
		// e.g. a start came from the Deployment Plan but no end yet: fill it in.
		if (parcial && !readonly) janela.emitir();
		return janela;
	};

	// A dialog with just the picker. accao(valor) gets the mode's value.
	entre_erp.janela.dialogo = ({ titulo, rotulo, accao, ...opcoes }) => {
		const d = new frappe.ui.Dialog({
			title: titulo,
			size: "large",
			fields: [{ fieldname: "picker", fieldtype: "HTML" }],
			primary_action_label: rotulo || __("Continuar"),
			primary_action() {
				const v = janela.valor();
				if (!v) return frappe.msgprint(__("Escolha o dia."));
				d.hide();
				accao(v);
			},
		});
		const janela = new Janela(d.fields_dict.picker.$wrapper, opcoes);
		d.show();
		return d;
	};
})();
