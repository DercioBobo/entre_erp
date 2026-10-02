# Domínios — Templates de email

Textos para colar nas Notifications (desk → Notification), DocType **Domain Management**.
Só usam campos do documento (`doc.*`), por isso funcionam sem código extra.

Substitua `[CONTACTO]` e `[COMO PAGAR]` pelos dados da empresa.

Condição sugerida para os lembretes ao cliente:

```python
doc.nots == "Sim" and doc.estado != "Cancelado" and not doc.arquivado and doc.renovacao_estado not in ("Pago", "Renovado")
```

Destinatários (cliente): campos `email` e `email_alternativo`.

---

## 1. Renovação próxima — 40 dias antes

**Evento:** Days Before · `data_de_fim` · 40

**Assunto:**
```
Renovação do domínio {{ doc.nome_do_dominio }}
```

**Mensagem:**
```jinja
<p>Olá,</p>
<p>O domínio <b>{{ doc.nome_do_dominio }}</b> expira a <b>{{ frappe.utils.formatdate(doc.data_de_fim) }}</b>.</p>
<p>Valor da renovação ({{ doc.periodo }}): <b>{{ frappe.utils.fmt_money(doc.valor, currency="MZN") }}</b></p>
<p>Como pagar: [COMO PAGAR]</p>
<p>Após o pagamento, envie-nos o comprovativo.</p>
<p>Obrigado,<br>[CONTACTO]</p>
```

---

## 2. Lembrete — 20 dias antes

**Evento:** Days Before · `data_de_fim` · 20

**Assunto:**
```
Lembrete: {{ doc.nome_do_dominio }} expira a {{ frappe.utils.formatdate(doc.data_de_fim) }}
```

**Mensagem:**
```jinja
<p>Olá,</p>
<p>Ainda não recebemos o pagamento da renovação do domínio <b>{{ doc.nome_do_dominio }}</b>,
que expira a <b>{{ frappe.utils.formatdate(doc.data_de_fim) }}</b>.</p>
<p>Valor: <b>{{ frappe.utils.fmt_money(doc.valor, currency="MZN") }}</b></p>
<p>Como pagar: [COMO PAGAR]</p>
<p>Obrigado,<br>[CONTACTO]</p>
```

---

## 3. Urgente — 7 dias antes

**Evento:** Days Before · `data_de_fim` · 7

**Assunto:**
```
Urgente: {{ doc.nome_do_dominio }} expira dentro de 7 dias
```

**Mensagem:**
```jinja
<p>Olá,</p>
<p>O domínio <b>{{ doc.nome_do_dominio }}</b> expira a <b>{{ frappe.utils.formatdate(doc.data_de_fim) }}</b>.
Sem renovação, o site e os emails deixam de funcionar.</p>
<p>Valor: <b>{{ frappe.utils.fmt_money(doc.valor, currency="MZN") }}</b></p>
<p>Como pagar: [COMO PAGAR]</p>
<p>Obrigado,<br>[CONTACTO]</p>
```

---

## 4. Expirado — 1 dia depois

**Evento:** Days After · `data_de_fim` · 1

**Assunto:**
```
O domínio {{ doc.nome_do_dominio }} expirou
```

**Mensagem:**
```jinja
<p>Olá,</p>
<p>O domínio <b>{{ doc.nome_do_dominio }}</b> expirou a {{ frappe.utils.formatdate(doc.data_de_fim) }}.
Ainda é possível renová-lo, mas por pouco tempo.</p>
<p>Valor: <b>{{ frappe.utils.fmt_money(doc.valor, currency="MZN") }}</b></p>
<p>Como pagar: [COMO PAGAR]</p>
<p>Obrigado,<br>[CONTACTO]</p>
```

---

## 5. Renovado — confirmação

**Evento:** Value Change · `ultima_renovacao`
**Condição:** `doc.nots == "Sim" and doc.ultima_renovacao`

**Assunto:**
```
O domínio {{ doc.nome_do_dominio }} foi renovado
```

**Mensagem:**
```jinja
<p>Olá,</p>
<p>Confirmamos a renovação do domínio <b>{{ doc.nome_do_dominio }}</b>.
Nova data de validade: <b>{{ frappe.utils.formatdate(doc.data_de_fim) }}</b>.</p>
<p>Obrigado pela confiança,<br>[CONTACTO]</p>
```

---

## 6. Equipa — pago, renovar

**Evento:** Value Change · `renovacao_estado`
**Condição:** `doc.renovacao_estado == "Pago"`
**Destinatários:** papel da equipa de suporte

**Assunto:**
```
Pago: renovar {{ doc.nome_do_dominio }}
```

**Mensagem:**
```jinja
<p>O cliente pagou a renovação de <b>{{ doc.nome_do_dominio }}</b> (expira a {{ frappe.utils.formatdate(doc.data_de_fim) }}).</p>
<p>Renovar no registrar e depois <b>Confirmar renovação</b> no ERP.</p>
<p><a href="{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}">Abrir domínio</a></p>
```

---

## 7. Equipa — por pagar, 7 dias antes

**Evento:** Days Before · `data_de_fim` · 7
**Condição:** `doc.estado != "Cancelado" and not doc.arquivado and doc.renovacao_estado in ("Pendente", "", None)`
**Destinatários:** papel da equipa de suporte

**Assunto:**
```
Por pagar: {{ doc.nome_do_dominio }} expira em 7 dias
```

**Mensagem:**
```jinja
<p><b>{{ doc.nome_do_dominio }}</b> ({{ doc.customer }}) expira a {{ frappe.utils.formatdate(doc.data_de_fim) }} e ainda não foi pago.</p>
<p>Contactar o cliente: {{ doc.email or "" }} {{ doc.telemovel or "" }}</p>
<p><a href="{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}">Abrir domínio</a></p>
```
