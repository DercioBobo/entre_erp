// A friendlier picker for maintenance windows: tap a day, then type or nudge
// the start and end (21 / 2130 / 21h30, − and + by 15 min), drag the window on
// a 24h bar, or take a common one in one tap. It reads and writes the same
// Datetime/Time fields, so the server sees no difference.
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
	const DIA = 1440;
	const PASSO = 15;
	// Most maintenance runs 21h00 → 04h00.
	const PADRAO = { ini: 21 * 60, fim: 4 * 60 };
	// One-tap windows (after the default / the modelo's own) and reminder hours.
	const JANELAS = [[21 * 60, 4 * 60], [22 * 60, 2 * 60], [23 * 60, 5 * 60], [20 * 60, 23 * 60]];
	const HORAS = [7, 8, 9, 10, 12, 14].map((h) => h * 60);

	const COM_DIA = ["janela", "momento"];
	const COM_FIM = ["janela", "horas"];

	const dois = (n) => String(n).padStart(2, "0");
	const hhmm = (min) => `${dois(Math.floor(min / 60))}h${dois(min % 60)}`;
	const curta = (min) => (min % 60 ? hhmm(min) : `${dois(min / 60)}h`);
	const hora_input = (min) => `${dois(Math.floor(min / 60))}:${dois(min % 60)}`;
	const hora_str = (min) => `${hora_input(min)}:00`;
	const limitar = (v, min, max) => Math.min(Math.max(v, min), max);
	// "21:00:00", "2026-10-19 21:00:00" or "2026-10-19 21:00:00.000000" → 1260
	const minutos = (texto) => {
		if (!texto) return null;
		const s = String(texto);
		const [h, m] = (s.includes(" ") ? s.split(" ")[1] : s).split(":").map(Number);
		return h * 60 + (m || 0);
	};
	// What people type: "21", "9", "2130", "21:30", "21h30", "21h" → minutes, or null
	const ler_hora = (texto) => {
		const m = String(texto).trim().toLowerCase().replace(/\s/g, "").match(/^(\d{1,2})(?:[:h.]?(\d{2}))?h?$/);
		if (!m) return null;
		const [h, mi] = [Number(m[1]), Number(m[2] || 0)];
		return h > 24 || mi > 59 ? null : (h % 24) * 60 + mi;
	};
	const duracao = (ini, fim) => (fim - ini + DIA) % DIA || DIA;
	const texto_duracao = (min) => `${Math.floor(min / 60)}h${min % 60 ? dois(min % 60) : ""}`;
	const dia_de = (texto) => (texto ? String(texto).slice(0, 10) : null);
	const somar_dias = (dia, n) => moment(dia).add(n, "days").format("YYYY-MM-DD");
	const hoje = () => frappe.datetime.get_today();

	function rotulo_dia(dia) {
		const diff = moment(dia).diff(moment(hoje()), "days");
		const d = moment(dia);
		const data = `${d.date()} ${MESES[d.month()]}`;
		if (diff === 0) return ["Hoje", data];
		if (diff === 1) return ["Amanhã", data];
		if (diff === -1) return ["Ontem", data];
		return [SEMANA[d.day()], data];
	}

	function extenso(dia) {
		const d = moment(dia);
		const ano = d.year() === moment().year() ? "" : ` ${d.year()}`;
		return `${SEMANA_LONGA[d.day()]}, ${d.date()} ${MESES[d.month()]}${ano}`;
	}

	function estilos() {
		if (document.getElementById("entre-janela-css")) return;
		const subtil = (pct) => `color-mix(in srgb, var(--text-color) ${pct}%, transparent)`;
		const css = `
		.ej { display: flex; flex-direction: column; gap: 10px; max-width: 640px; }
		.ej-linha { display: flex; flex-direction: column; gap: 6px; }
		.ej-rotulo, .ej-tok-rot { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
		.ej-chips, .ej-sugestoes { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
		.ej-chip { border: 1px solid var(--border-color); background: var(--control-bg); color: var(--text-color);
			border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer; line-height: 1.3; min-width: 44px; text-align: center; }
		.ej-chip:hover { border-color: var(--text-muted); }
		.ej-chip small { display: block; font-size: 10px; color: var(--text-muted); }
		.ej-chip.activo { background: var(--primary); border-color: var(--primary); color: #fff; }
		.ej-chip.activo small { color: rgba(255, 255, 255, .8); }
		.ej-chip.fora { opacity: .55; }
		.ej-outro { max-width: 150px; height: 30px; font-size: 12px; }
		.ej-caixa { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--border-color);
			border-radius: 12px; background: var(--fg-color); }
		.ej-toks { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
		.ej-tok { display: flex; flex-direction: column; gap: 4px; }
		.ej-tok-caixa { display: flex; align-items: center; border: 1px solid var(--border-color); border-radius: 10px;
			background: var(--control-bg); overflow: hidden; }
		.ej-tok-caixa:focus-within { border-color: var(--primary); }
		.ej-tok-caixa button { border: 0; background: transparent; width: 30px; height: 40px; font-size: 16px; line-height: 1;
			color: var(--text-muted); cursor: pointer; }
		.ej-tok-caixa button:hover { color: var(--text-color); background: ${subtil(6)}; }
		.ej-input { width: 62px; border: 0; padding: 0; background: transparent; text-align: center; outline: none;
			font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-color); }
		.ej-seta { padding-bottom: 10px; font-size: 18px; color: var(--text-muted); }
		.ej-dur { padding-bottom: 11px; font-size: 13px; color: var(--text-muted); }
		.ej-dur b { color: var(--text-color); }
		.ej-trilho { position: relative; height: 40px; border-radius: 8px; background: var(--control-bg); overflow: hidden;
			cursor: crosshair; touch-action: none; user-select: none; }
		.ej-trilho.parado { cursor: default; height: 26px; }
		.ej-hora { position: absolute; top: 0; bottom: 0; border-left: 1px solid ${subtil(5)}; }
		.ej-hora.tres { border-left-color: ${subtil(12)}; }
		.ej-hora.noite { background: ${subtil(5)}; }
		.ej-meia-noite { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text-muted); opacity: .45; }
		.ej-camada { position: absolute; inset: 0; }
		.ej-faixa { position: absolute; top: 5px; bottom: 5px; border-radius: 6px; background: var(--primary); color: #fff;
			display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; white-space: nowrap;
			overflow: hidden; cursor: grab; box-shadow: 0 1px 3px rgba(0, 0, 0, .18); }
		.ej-trilho.parado .ej-faixa { top: 4px; bottom: 4px; cursor: default; }
		.ej-faixa:active { cursor: grabbing; }
		.ej-pega { position: absolute; top: 0; bottom: 0; width: 12px; display: flex; align-items: center; justify-content: center; cursor: ew-resize; }
		.ej-pega::after { content: ""; width: 3px; height: 14px; border-radius: 2px; background: rgba(255, 255, 255, .75); }
		.ej-pega.ini { left: 0; }
		.ej-pega.fim { right: 0; }
		.ej-ponto { position: absolute; top: 4px; bottom: 4px; width: 6px; margin-left: -3px; border-radius: 3px; background: var(--primary); cursor: ew-resize; }
		.ej-escala { position: relative; height: 14px; margin-top: -6px; font-size: 10px; color: var(--text-muted); }
		.ej-escala span { position: absolute; transform: translateX(-50%); white-space: nowrap; font-variant-numeric: tabular-nums; }
		.ej-dica { font-size: 11px; color: var(--text-muted); }
		.ej-resumo { font-size: 13px; font-weight: 600; color: var(--text-color); }
		.ej-resumo .ej-mudo { font-weight: 400; color: var(--text-muted); }
		.ej-nota { font-size: 12px; font-weight: 400; color: var(--text-muted); margin-top: 2px; }
		.ej-nota.alerta { color: var(--red-600, #c0392b); }
		`;
		document.head.insertAdjacentHTML("beforeend", `<style id="entre-janela-css">${css}</style>`);
	}

	class Janela {
		constructor(wrapper, { modo = "janela", valor = {}, padrao = {}, readonly = false, dias = [0, 10], rotulo, on_change }) {
			estilos();
			this.$w = $(wrapper);
			this.modo = modo;
			this.rotulo = rotulo;
			this.readonly = readonly;
			this.dias = dias;
			this.on_change = on_change;
			this.padrao = { ...PADRAO, ...padrao };
			this.definir(valor, false);
			this.$w.off(".ej");
			this.$w.on("click.ej", "[data-accao]", (e) => this.clicar(e.currentTarget.dataset));
			this.$w.on("change.ej", ".ej-outro", (e) => e.target.value && this.mudar({ dia: e.target.value }));
			this.$w.on("change.ej", ".ej-input", (e) => this.escrever(e.target.dataset.campo, e.target.value));
			this.$w.on("keydown.ej", ".ej-input", (e) => {
				if (e.key !== "Enter") return;
				e.preventDefault();
				e.stopPropagation();
				e.target.blur();
			});
			this.$w.on("pointerdown.ej", ".ej-trilho", (e) => this.agarrar(e));
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
			this.ajustar_origem();
			this.render();
			if (emitir) this.emitir();
		}

		tem_fim() {
			return COM_FIM.includes(this.modo);
		}

		completo() {
			return !COM_DIA.includes(this.modo) || !!this.dia;
		}

		dur() {
			return this.tem_fim() ? duracao(this.ini, this.fim) : 0;
		}

		chave() {
			return this.tem_fim() ? `${this.ini}-${this.fim}` : `${this.ini}`;
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

		// Full redraw, for anything but dragging.
		mudar(alteracoes) {
			Object.assign(this, alteracoes);
			this.ajustar_origem();
			this.render();
			this.emitir();
		}

		clicar({ accao, valor }) {
			if (this.readonly) return;
			const passo = accao?.endsWith("-mais") ? PASSO : -PASSO;
			if (accao === "dia") return this.mudar({ dia: valor });
			// A new start keeps the duration: the end moves with it.
			if (accao === "ini-mais" || accao === "ini-menos") {
				return this.mudar({ ini: (this.ini + passo + DIA) % DIA, fim: this.tem_fim() ? (this.fim + passo + DIA) % DIA : this.fim });
			}
			if (accao === "fim-mais" || accao === "fim-menos") {
				const fim = (this.fim + passo + DIA) % DIA;
				return fim === this.ini ? null : this.mudar({ fim });
			}
			if (accao === "pre") {
				const [ini, fim] = valor.split("-").map(Number);
				return this.mudar(this.tem_fim() ? { ini, fim } : { ini });
			}
			if (accao === "agora") return this.mudar({ dia: hoje(), ini: minutos(frappe.datetime.now_datetime()) });
		}

		escrever(campo, texto) {
			const v = ler_hora(texto);
			if (v === null || (campo === "fim" && v === this.ini)) return this.render(); // put the old value back
			if (campo === "fim") return this.mudar({ fim: v });
			return this.mudar({ ini: v, fim: this.tem_fim() ? (v + this.dur()) % DIA : this.fim });
		}

		// The 24h bar starts at `origem`: noon for evening windows (so 21h → 04h
		// sits in the middle), a little before the start otherwise; 00h for a
		// single time. Fixed while dragging so the bar does not move under you.
		ajustar_origem() {
			if (!this.tem_fim()) {
				this.origem = 0;
				return;
			}
			let origem = this.ini >= 720 ? 720 : Math.max(0, Math.floor(this.ini / 180) * 180 - 180);
			if (this.ini - origem + this.dur() > DIA) origem = this.ini - (this.ini % 60);
			this.origem = origem;
		}

		rel(min) {
			return (((min - this.origem) % DIA) + DIA) % DIA;
		}

		// Dragging on the bar: the window's body moves it, its ends resize it,
		// empty space draws a new one (a plain click moves the start there).
		agarrar(e) {
			const ev = e.originalEvent || e;
			if (this.readonly || ev.button > 0) return;
			const trilho = e.currentTarget;
			const caixa = trilho.getBoundingClientRect();
			const posicao = (x) => Math.round((limitar((x - caixa.left) / caixa.width, 0, 1) * DIA) / PASSO) * PASSO;
			const alvo = ev.target.closest("[data-arrasto]")?.dataset.arrasto || "novo";
			const inicio = { p: posicao(ev.clientX), r: this.rel(this.ini), dur: this.dur() };
			let moveu = false;
			const mover = (m) => {
				const p = posicao(m.clientX);
				if (!moveu && Math.abs(p - inicio.p) < PASSO) return;
				moveu = true;
				this.arrastar(alvo, p, inicio);
			};
			const largar = () => {
				trilho.removeEventListener("pointermove", mover);
				trilho.removeEventListener("pointerup", largar);
				trilho.removeEventListener("pointercancel", largar);
				if (!moveu && (alvo === "novo" || alvo === "ponto")) this.arrastar("clique", inicio.p, inicio);
				this.emitir();
			};
			trilho.setPointerCapture?.(ev.pointerId);
			trilho.addEventListener("pointermove", mover);
			trilho.addEventListener("pointerup", largar);
			trilho.addEventListener("pointercancel", largar);
			ev.preventDefault();
		}

		// p and inicio.p: positions on the bar in minutes from its left edge.
		arrastar(alvo, p, inicio) {
			const abs = (x) => (this.origem + x) % DIA;
			if (!this.tem_fim()) {
				this.ini = abs(Math.min(p, DIA - PASSO));
				return this.actualizar();
			}
			// With a day, the start stays before midnight: after it is another day.
			const ultimo = COM_DIA.includes(this.modo) ? DIA - this.origem - PASSO : DIA - PASSO;
			const { r, dur } = inicio;
			if (alvo === "mover" || alvo === "clique") {
				const x = limitar(alvo === "mover" ? r + p - inicio.p : p, 0, Math.min(DIA - dur, ultimo));
				this.ini = abs(x);
				this.fim = abs(x + dur);
			} else if (alvo === "ini") {
				this.ini = abs(limitar(p, 0, Math.min(r + dur - PASSO, ultimo)));
			} else if (alvo === "fim") {
				this.fim = abs(limitar(p, r + PASSO, DIA));
			} else {
				const a = Math.min(inicio.p, p, ultimo);
				this.ini = abs(a);
				this.fim = abs(Math.max(inicio.p, p, a + PASSO));
			}
			this.actualizar();
		}

		// Light redraw while dragging: the window, the inputs and the summary.
		actualizar() {
			this.$w.find(".ej-camada").html(this.html_faixa());
			this.$w.find(".ej-dur").html(this.html_dur());
			this.$w.find(".ej-resumo").html(this.html_resumo());
			this.$w.find(".ej-input").each((_, el) => {
				if (el !== document.activeElement) el.value = hora_input(el.dataset.campo === "fim" ? this.fim : this.ini);
			});
			this.$w.find('[data-accao="pre"]').each((_, el) => el.classList.toggle("activo", el.dataset.valor === this.chave()));
		}

		// Day chips

		html_dias() {
			const [desde, quantos] = this.dias;
			const dias = Array.from({ length: quantos }, (_, i) => somar_dias(hoje(), desde + i));
			if (this.dia && !dias.includes(this.dia)) dias.push(this.dia);
			const chips = dias
				.map((dia) => {
					const [cima, baixo] = rotulo_dia(dia);
					const fds = [0, 6].includes(moment(dia).day()) ? " fora" : "";
					const activo = dia === this.dia ? " activo" : "";
					return `<button type="button" class="ej-chip${activo}${fds}" data-accao="dia" data-valor="${dia}">${__(cima)}<small>${baixo}</small></button>`;
				})
				.join("");
			return `<div class="ej-linha"><div class="ej-rotulo">${__("Dia")}</div>
				<div class="ej-chips">${chips}
					<input type="date" class="form-control ej-outro" title="${__("Outro dia")}" value="${this.dia || ""}">
				</div></div>`;
		}

		// Start (→ end) inputs with − / +

		html_tokens() {
			const token = (campo, rotulo, valor) => `
				<div class="ej-tok"><span class="ej-tok-rot">${rotulo}</span>
					<div class="ej-tok-caixa">
						<button type="button" data-accao="${campo}-menos" title="${__("−15 min")}">−</button>
						<input class="ej-input" data-campo="${campo}" value="${hora_input(valor)}" inputmode="numeric" maxlength="5" aria-label="${rotulo}">
						<button type="button" data-accao="${campo}-mais" title="${__("+15 min")}">+</button>
					</div></div>`;
			let html = token("ini", this.rotulo || (this.tem_fim() ? __("Início") : __("Hora")), this.ini);
			if (this.tem_fim()) html += `<span class="ej-seta">→</span>${token("fim", __("Fim"), this.fim)}<span class="ej-dur">${this.html_dur()}</span>`;
			return `<div class="ej-toks">${html}</div>`;
		}

		html_dur() {
			if (!this.tem_fim()) return "";
			let html = `<b>${texto_duracao(this.dur())}</b>`;
			if (this.fim <= this.ini) {
				html += this.modo === "janela" && this.dia
					? ` · ${__("termina {0}", [SEMANA_LONGA[moment(this.dia).add(1, "days").day()]])}`
					: ` · ${__("termina no dia seguinte")}`;
			}
			return html;
		}

		// The 24h bar

		html_trilho() {
			const horas = Array.from({ length: 24 }, (_, i) => {
				const h = (this.origem / 60 + i) % 24;
				const classes = `${h >= 18 || h < 6 ? " noite" : ""}${i % 3 === 0 ? " tres" : ""}`;
				return `<div class="ej-hora${classes}" style="left: ${(i / 24) * 100}%; width: ${100 / 24}%"></div>`;
			}).join("");
			const meia_noite = this.origem ? `<div class="ej-meia-noite" style="left: ${((DIA - this.origem) / DIA) * 100}%"></div>` : "";
			const escala = [];
			for (let i = 0; i <= 24; i += 3) {
				const h = (this.origem / 60 + i) % 24;
				const rotulo = h === 0 && i > 0 && i < 24 && this.modo === "janela" && this.dia
					? `00h ${SEMANA[moment(this.dia).add(1, "days").day()]}`
					: `${dois(h)}h`;
				escala.push(`<span style="left: ${limitar((i / 24) * 100, 3, 97)}%">${rotulo}</span>`);
			}
			const dica = this.readonly
				? ""
				: `<div class="ej-dica">${
						this.tem_fim()
							? __("Arraste na barra para marcar a janela, ou puxe as pontas para ajustar.")
							: __("Toque na barra para escolher a hora.")
				  }</div>`;
			return `<div>
				<div class="ej-trilho${this.readonly ? " parado" : ""}">${horas}${meia_noite}<div class="ej-camada">${this.html_faixa()}</div></div>
				<div class="ej-escala">${escala.join("")}</div></div>${dica}`;
		}

		html_faixa() {
			if (!this.tem_fim()) {
				return `<div class="ej-ponto" data-arrasto="ponto" style="left: ${(this.rel(this.ini) / DIA) * 100}%"></div>`;
			}
			const largura = (this.dur() / DIA) * 100;
			const texto = largura > 16 ? `${hhmm(this.ini)} – ${hhmm(this.fim)}` : "";
			const pegas = this.readonly ? "" : `<span class="ej-pega ini" data-arrasto="ini"></span><span class="ej-pega fim" data-arrasto="fim"></span>`;
			return `<div class="ej-faixa" data-arrasto="mover" style="left: ${(this.rel(this.ini) / DIA) * 100}%; width: ${largura}%">${pegas}<span>${texto}</span></div>`;
		}

		html_sugestoes() {
			let itens;
			if (this.tem_fim()) {
				const janelas = [[this.padrao.ini, this.padrao.fim], ...JANELAS];
				itens = janelas
					.filter(([a, b], i) => janelas.findIndex(([c, d]) => a === c && b === d) === i)
					.map(([a, b]) => [`${a}-${b}`, `${curta(a)} – ${curta(b)}`]);
			} else if (this.modo === "hora") {
				itens = [...new Set([this.padrao.ini, ...HORAS])].sort((a, b) => a - b).map((m) => [`${m}`, curta(m)]);
			} else {
				return `<div class="ej-sugestoes"><button type="button" class="ej-chip" data-accao="agora">${__("Agora")}</button></div>`;
			}
			const chips = itens
				.map(([valor, rotulo]) => {
					const activo = valor === this.chave() ? " activo" : "";
					return `<button type="button" class="ej-chip${activo}" data-accao="pre" data-valor="${valor}">${rotulo}</button>`;
				})
				.join("");
			return `<div class="ej-sugestoes"><span class="ej-dica">${__("Rápido:")}</span>${chips}</div>`;
		}

		html_resumo() {
			if (!this.completo()) return `<span class="ej-mudo">${__("Escolha o dia")}</span>`;
			const dur = this.tem_fim() ? ` <span class="ej-mudo">· ${texto_duracao(this.dur())}</span>` : "";
			let texto;
			if (this.modo === "janela") {
				const fim = this.fim <= this.ini ? ` ${__("de")} ${SEMANA_LONGA[moment(this.dia).add(1, "days").day()]}` : "";
				texto = `${extenso(this.dia)} · ${hhmm(this.ini)} → ${hhmm(this.fim)}${fim}`;
			} else if (this.modo === "horas") {
				texto = `${hhmm(this.ini)} → ${hhmm(this.fim)}${this.fim <= this.ini ? ` ${__("do dia seguinte")}` : ""}`;
			} else if (this.modo === "momento") {
				texto = `${extenso(this.dia)} · ${hhmm(this.ini)}`;
			} else {
				texto = hhmm(this.ini);
			}
			const notas = [];
			if (this.modo === "janela") {
				if (!this.readonly && this.valor().inicio < frappe.datetime.now_datetime()) {
					notas.push(`<div class="ej-nota alerta">${__("Este início já passou.")}</div>`);
				}
				if ([0, 6].includes(moment(this.dia).day())) notas.push(`<div class="ej-nota">${__("Fim de semana.")}</div>`);
			}
			return `${texto}${dur}${notas.join("")}`;
		}

		render() {
			const caixa = [];
			if (!this.readonly) caixa.push(this.html_tokens());
			if (this.modo !== "hora") caixa.push(this.html_trilho());
			if (!this.readonly) caixa.push(this.html_sugestoes());
			if (this.modo !== "hora" || this.readonly) caixa.push(`<div class="ej-resumo">${this.html_resumo()}</div>`);
			const dias = !this.readonly && COM_DIA.includes(this.modo) ? this.html_dias() : "";
			this.$w.html(`<div class="ej">${dias}<div class="ej-caixa">${caixa.join("")}</div></div>`);
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
