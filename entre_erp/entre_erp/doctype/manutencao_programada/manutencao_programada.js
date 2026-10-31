// Rascunho → Agendada → Em Curso → Concluída (or Cancelada). Every step is a
// button calling the server; before it, the email it sends is previewed with
// the change applied (pre_visualizar with accao), so what you see is what goes.

const esc = (texto) => frappe.utils.escape_html(texto || "");

function html_do_email(email) {
	if (!email) {
		return `<div class="text-muted">${__(
			"Não há nenhuma Notification activa para este email: a acção é feita sem enviar nada. Veja docs/manutencao_programada_emails.md."
		)}</div>`;
	}
	if (email.erro) {
		return `<div class="alert alert-danger">${__("Erro na Notification {0}:", [esc(email.nome)])} ${esc(email.erro)}</div>`;
	}
	const linha = (rotulo, valor) =>
		`<div><span class="text-muted">${rotulo}:</span> ${esc(valor) || "<span class='text-muted'>—</span>"}</div>`;
	const condicao = email.condicao_ok
		? ""
		: `<div class="alert alert-warning">${__("A condição desta Notification não se verifica: não seria enviado.")}</div>`;
	return `${condicao}
		<div class="mb-3">
			${linha(__("Para"), email.para.join(", "))}
			${linha(__("CC"), email.cc.join(", "))}
			${linha(__("Assunto"), email.assunto)}
		</div>
		<div class="border rounded p-3" style="max-height: 60vh; overflow: auto">${email.mensagem}</div>`;
}

// accoes: [[label, fn], ...]; the first is the primary button.
function mostrar_emails(frm, { emails, avisos }, { titulo, accoes = [] }) {
	const avisos_html = avisos.length
		? `<div class="alert alert-warning">${avisos.map(esc).join("<br>")}</div>`
		: "";
	const d = new frappe.ui.Dialog({
		title: titulo || __("Pré-visualizar email"),
		size: "large",
		fields: [
			{ fieldname: "avisos", fieldtype: "HTML", options: avisos_html },
			{
				fieldname: "email",
				fieldtype: "Select",
				label: __("Notification"),
				options: emails.map((e) => e.nome),
				default: emails.length ? emails[0].nome : null,
				hidden: emails.length < 2,
				change: () => mostrar(),
			},
			{ fieldname: "corpo", fieldtype: "HTML" },
		],
	});
	const mostrar = () => {
		const email = emails.find((e) => e.nome === d.get_value("email")) || emails[0];
		d.fields_dict.corpo.$wrapper.html(html_do_email(email));
	};
	const [principal, secundaria] = accoes;
	if (principal) {
		d.set_primary_action(principal[0], () => {
			d.hide();
			principal[1]();
		});
	}
	if (secundaria) {
		d.set_secondary_action_label(secundaria[0]);
		d.set_secondary_action(() => {
			d.hide();
			secundaria[1]();
		});
	}
	d.show();
	mostrar();
}

function pre_visualizar(frm, args, opcoes = {}) {
	const abrir = () =>
		frm
			.call({ method: "pre_visualizar", doc: frm.doc, args, freeze: true })
			.then(({ message }) => mostrar_emails(frm, message, opcoes));
	return frm.is_dirty() ? frm.save().then(abrir) : abrir();
}

function chamar(frm, method, args = {}) {
	return frm.call({ method, doc: frm.doc, args, freeze: true }).then(() => frm.reload_doc());
}

// An action that may send an email: ask for its values with the window picker
// (if any), preview the email with them applied, then do it with or without
// sending. picker: the picker's options + valores(picked) → the action's args.
function accao(frm, { accao, metodo, titulo, rotulo, picker }) {
	const executar = (valores = {}) =>
		pre_visualizar(
			frm,
			{ metodo, accao, valores },
			{
				titulo,
				accoes: [
					[__("{0} e enviar", [rotulo]), () => chamar(frm, accao, { ...valores, enviar: 1 })],
					[__("{0} sem enviar", [rotulo]), () => chamar(frm, accao, { ...valores, enviar: 0 })],
				],
			}
		);
	if (!picker) return executar();
	const { valores, ...opcoes } = picker;
	entre_erp.janela.dialogo({ ...opcoes, titulo, rotulo: __("Pré-visualizar"), accao: (v) => executar(valores(v)) });
}

function enviar_email(frm, metodo, titulo) {
	pre_visualizar(frm, { metodo }, { titulo, accoes: [[__("Enviar"), () => chamar(frm, "enviar_email", { metodo })]] });
}

function preencher_do_modelo(frm) {
	frappe.db.get_doc("Modelo de Manutencao", frm.doc.modelo).then((modelo) => {
		for (const campo of [
			"aplicacao",
			"customer",
			"tipo",
			"impacto",
			"canais_afectados",
			"canais_operacionais",
			"enviar_lembrete",
			"hora_do_lembrete",
		]) {
			frm.set_value(campo, modelo[campo]);
		}
		for (const tabela of ["destinatarios", "destinatarios_cc"]) {
			frm.clear_table(tabela);
			for (const { email, nome } of modelo[tabela] || []) frm.add_child(tabela, { email, nome });
			frm.refresh_field(tabela);
		}
		frm.__modelo_janela = { inicio: modelo.hora_inicio, fim: modelo.hora_fim };
		const janela = ligar_pickers(frm);
		// A day already picked takes the modelo's hours.
		if (frm.doc.inicio) {
			janela.definir({ inicio: `${frm.doc.inicio.slice(0, 10)} ${modelo.hora_inicio}` });
		}
	});
}

// The window and the reminder hour use the picker (public/js/janela_picker.js);
// the real fields stay hidden underneath. The window is fixed once announced:
// it changes through Adiar / Prolongar.
function ligar_pickers(frm) {
	const horas = frm.__modelo_janela;
	const janela = entre_erp.janela.ligar(frm, "janela", {
		modo: "janela",
		campos: { inicio: "inicio", fim: "fim" },
		readonly: frm.doc.estado !== "Rascunho",
		padrao: horas ? { ini: minutos(horas.inicio), fim: minutos(horas.fim) } : undefined,
	});
	entre_erp.janela.ligar(frm, "lembrete", {
		modo: "hora",
		campos: { hora: "hora_do_lembrete" },
		rotulo: __("Hora do lembrete"),
		padrao: { ini: 8 * 60 },
		readonly: ["Concluída", "Cancelada"].includes(frm.doc.estado),
	});
	return janela;
}

const minutos = (hora) => {
	const [h, m] = String(hora).split(":").map(Number);
	return h * 60 + (m || 0);
};

function botoes(frm) {
	const estado = frm.doc.estado;
	const agora = frappe.datetime.now_datetime();

	if (estado === "Rascunho") {
		frm.add_custom_button(__("Agendar"), () =>
			accao(frm, { accao: "agendar", metodo: "enviar_aviso", titulo: __("Agendar manutenção"), rotulo: __("Agendar") })
		).addClass("btn-primary");
	}
	if (estado === "Agendada") {
		frm.add_custom_button(__("Adiar"), () =>
			accao(frm, {
				accao: "adiar",
				metodo: "enviar_adiamento",
				titulo: __("Adiar manutenção"),
				rotulo: __("Adiar"),
				picker: {
					modo: "janela",
					valor: { inicio: frm.doc.inicio, fim: frm.doc.fim },
					valores: ({ inicio, fim }) => ({ inicio, fim }),
				},
			})
		);
		frm.add_custom_button(__("Reenviar aviso"), () => enviar_email(frm, "enviar_aviso", __("Reenviar aviso")), __("Emails"));
		frm.add_custom_button(__("Enviar lembrete agora"), () => enviar_email(frm, "enviar_lembrete", __("Enviar lembrete")), __("Emails"));
		frm.add_custom_button(__("Começar agora"), () =>
			frappe.confirm(__("Marcar a manutenção como Em Curso?"), () => chamar(frm, "iniciar")), __("Mais")
		);
	}
	if (estado === "Em Curso") {
		frm.add_custom_button(__("Concluir"), () =>
			accao(frm, {
				accao: "concluir",
				metodo: "enviar_conclusao",
				titulo: __("Concluir manutenção"),
				rotulo: __("Concluir"),
				picker: {
					modo: "momento",
					rotulo: __("Terminou às"),
					valor: { momento: agora },
					dias: [-2, 3],
					valores: ({ momento }) => ({ fim_real: momento }),
				},
			})
		).addClass("btn-primary");
		frm.add_custom_button(__("Prolongar"), () =>
			accao(frm, {
				accao: "prolongar",
				metodo: "enviar_prolongamento",
				titulo: __("Prolongar manutenção"),
				rotulo: __("Prolongar"),
				picker: {
					modo: "momento",
					rotulo: __("Novo fim"),
					valor: { momento: frm.doc.fim },
					dias: [-1, 4],
					valores: ({ momento }) => ({ fim: momento }),
				},
			})
		);
	}
	if (estado === "Rascunho" || estado === "Agendada") {
		frm.add_custom_button(__("Cancelar"), () =>
			accao(frm, { accao: "cancelar", metodo: "enviar_cancelamento", titulo: __("Cancelar manutenção"), rotulo: __("Cancelar") }),
			__("Mais")
		);
	}
	if (estado === "Concluída") {
		frm.add_custom_button(__("Reenviar conclusão"), () => enviar_email(frm, "enviar_conclusao", __("Reenviar conclusão")), __("Emails"));
	}
	if (frm.doc.deployment_plan) {
		frm.add_custom_button(__("Preencher relatório do Deployment Plan"), () =>
			frm.call("relatorio_do_deployment_plan").then(({ message }) => {
				if (!message) return frappe.msgprint(__("O Deployment Plan não tem tarefas nem descrição."));
				frm.set_value("relatorio", message);
			}), __("Relatório")
		);
		if (estado === "Concluída" && frm.doc.relatorio) {
			frm.add_custom_button(__("Enviar relatório"), () => enviar_email(frm, "enviar_relatorio", __("Enviar relatório")), __("Relatório"));
		}
		frm.add_custom_button(__("Deployment Plan"), () => frappe.set_route("Form", "Deployment Plan", frm.doc.deployment_plan));
	}
	frm.add_custom_button(__("Pré-visualizar emails"), () => pre_visualizar(frm, {}, {}), __("Emails"));
}

// Warnings only: the header card (public/js/manutencao_cartao.js) shows the rest.
function intro(frm) {
	const linhas = [...(frm.doc.__onload?.avisos || [])];
	if (frm.doc.estado === "Em Curso" && frm.doc.fim < frappe.datetime.now_datetime()) {
		linhas.unshift(__("A janela já terminou: conclua (o cliente recebe o aviso de serviço reposto) ou prolongue."));
	}
	if (linhas.length) frm.set_intro(linhas.map(esc).join("<br>"), "orange");
}

frappe.ui.form.on("Manutencao Programada", {
	setup(frm) {
		frm.set_query("deployment_plan", () => (frm.doc.aplicacao ? { filters: { application: frm.doc.aplicacao } } : {}));
	},
	refresh(frm) {
		ligar_pickers(frm);
		if (frm.is_new()) return;
		botoes(frm);
		intro(frm);
	},
	modelo(frm) {
		if (frm.doc.modelo && frm.doc.estado === "Rascunho") preencher_do_modelo(frm);
	},
	deployment_plan(frm) {
		if (!frm.doc.deployment_plan) return;
		frappe.db
			.get_value("Deployment Plan", frm.doc.deployment_plan, ["application", "implementation_datetime"])
			.then(({ message: plano }) => {
				if (!frm.doc.aplicacao && plano.application) frm.set_value("aplicacao", plano.application);
				if (!frm.doc.inicio && plano.implementation_datetime && frm.doc.estado === "Rascunho") {
					// The picker then fills the end from the default window.
					ligar_pickers(frm).definir({ inicio: plano.implementation_datetime });
				}
			});
	},
});
