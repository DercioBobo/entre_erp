# Manutenção Programada — Templates de email

Textos para colar nas Notifications (desk → Notification), DocType **Manutencao Programada**.

Todas usam o evento **Method**: é o ERP que as dispara, no momento certo,
com `doc.run_method("<método>")`. Por isso:

- os botões do formulário mostram o email **antes** de o enviar (com a alteração já aplicada: nova data, etc.);
- **Emails → Pré-visualizar emails** mostra qualquer uma, com os destinatários reais;
- se não houver Notification para um método, a acção faz-se na mesma e o ERP avisa que nada foi enviado.

Substitua `[ASSINATURA]` pela assinatura (pode ser uma imagem: `<img src="https://.../assinatura.png">`).

---

## Configuração comum

**Document Type:** `Manutencao Programada` · **Event:** `Method` · **Channel:** `Email`
**Sender:** a conta de email de suporte (ex.: `suporte@entretech.co.mz`)

**Recipients** (emails para o cliente — 1 a 7):

| Campo | Valor |
|---|---|
| Receiver By Document Field | `email (destinatarios)` — o email da tabela **Para** (valor interno `email,destinatarios`) |
| CC | `{{ doc.destinatarios_cc \| map(attribute="email") \| join(",") }}` |

Confirme na pré-visualização do formulário que o **Para** e o **CC** saem como esperado.

### Métodos

| Método | Quando é disparado |
|---|---|
| `enviar_aviso` | **Agendar** (à mão, ou automaticamente para as preventivas) · **Reenviar aviso** |
| `enviar_lembrete` | No dia, à *Hora do lembrete* (só se o aviso não saiu nesse mesmo dia) · **Enviar lembrete agora** |
| `enviar_adiamento` | **Adiar** |
| `enviar_inicio` | Ao começar (automático à hora de início, ou **Começar agora**) — opcional, ex.: para a equipa |
| `enviar_prolongamento` | **Prolongar** |
| `enviar_fim_da_janela` | A hora de fim passou e a manutenção continua Em Curso — para a equipa |
| `enviar_conclusao` | **Concluir** · **Reenviar conclusão** |
| `enviar_cancelamento` | **Cancelar** |
| `enviar_relatorio` | **Relatório → Enviar relatório** (só com Deployment Plan) |

### Funções disponíveis nos templates

| Função | Exemplo do resultado |
|---|---|
| `periodo_manutencao(doc)` | `na segunda-feira, dia 19 de Outubro, entre as 21h00 e as 04h00 do dia 20 de Outubro` |
| | `hoje, dia 09 de Setembro, entre as 21h00 e as 04h00 do dia 10 de Setembro` |
| | `amanhã, terça-feira, dia 12 de Maio, entre as 21h00 e as 04h00 do dia 13 de Maio` |
| `periodo_manutencao(doc, artigo=False)` | `segunda-feira, dia 19 de Outubro, …` (sem o "na") |
| `periodo_manutencao(doc, anterior=True)` | a janela antes do último **Adiar** |
| `quando_manutencao(doc.fim)` | `na terça-feira, dia 20 de Outubro, às 04h00` / `hoje, dia 20 de Outubro, às 04h00` |
| `quando_manutencao(doc.inicio, hora=False)` | `na segunda-feira, dia 19 de Outubro` |

"hoje", "amanhã" e o dia da semana são calculados quando o email sai — nunca ficam errados.
O ano só aparece quando não é o ano corrente.

### Bloco do impacto

Os emails 1, 2 e 3 usam este bloco. Com os **Canais** em branco (o caso habitual) fala do sistema todo:

```jinja
{% set efeito = {"Total": "totalmente", "Parcial": "parcialmente"}.get(doc.impacto, "total ou parcialmente") %}
{% if doc.canais_afectados %}
<p>Durante este período, poderão estar {{ efeito }} indisponíveis: <b>{{ doc.canais_afectados }}</b>.</p>
{% else %}
<p>Durante este período, o acesso ao {{ doc.aplicacao }} e às suas funcionalidades poderá estar {{ efeito }} interrompido.</p>
{% endif %}
{% if doc.canais_operacionais %}
<p>Permanecerão operacionais, podendo ser utilizados normalmente: <b>{{ doc.canais_operacionais }}</b>.</p>
{% endif %}
```

---

## 1. Aviso

**Método:** `enviar_aviso`

**Assunto:**
```
Aviso de Manutenção Programada — {{ doc.aplicacao }}
```

**Mensagem:**
```jinja
{% set efeito = {"Total": "totalmente", "Parcial": "parcialmente"}.get(doc.impacto, "total ou parcialmente") %}
{% if doc.tipo == "Correctiva" %}
  {% set ambito = "Com vista à correcção de anomalias identificadas e para garantir a estabilidade do " ~ doc.aplicacao %}
{% elif doc.tipo == "Actualização" %}
  {% set ambito = "No âmbito da actualização do " ~ doc.aplicacao ~ " e da disponibilização de novas funcionalidades" %}
{% else %}
  {% set ambito = "No âmbito das melhorias contínuas, visando garantir melhor desempenho e maior estabilidade do " ~ doc.aplicacao %}
{% endif %}
<p>Prezados,</p>
<p>Espero que esta mensagem os encontre bem.</p>
{% if doc.canais_afectados %}
<p>{{ ambito }}, informamos que serão realizados trabalhos de manutenção programada {{ periodo_manutencao(doc) }}.</p>
<p>Durante este período, poderão estar {{ efeito }} indisponíveis: <b>{{ doc.canais_afectados }}</b>.</p>
{% else %}
<p>{{ ambito }}, informamos que o sistema estará temporariamente indisponível <b>{{ periodo_manutencao(doc) }}</b>, devido à realização de trabalhos de manutenção programada.</p>
<p>Durante este período, o acesso ao {{ doc.aplicacao }} e às suas funcionalidades poderá estar {{ efeito }} interrompido.</p>
{% endif %}
{% if doc.canais_operacionais %}
<p>Permanecerão operacionais, podendo ser utilizados normalmente: <b>{{ doc.canais_operacionais }}</b>.</p>
{% endif %}
<p>Agradecemos desde já a vossa compreensão e colaboração.</p>
<p>Com os melhores cumprimentos,<br>[ASSINATURA]</p>
```

---

## 2. Lembrete (no dia)

**Método:** `enviar_lembrete`

**Assunto:**
```
Lembrete: Manutenção Programada do {{ doc.aplicacao }} — {{ quando_manutencao(doc.inicio) }}
```

**Mensagem:**
```jinja
{% set efeito = {"Total": "totalmente", "Parcial": "parcialmente"}.get(doc.impacto, "total ou parcialmente") %}
<p>Prezados,</p>
<p>Conforme informado, relembramos que serão realizados trabalhos de manutenção programada no {{ doc.aplicacao }} <b>{{ periodo_manutencao(doc) }}</b>.</p>
{% if doc.canais_afectados %}
<p>Durante este período, poderão estar {{ efeito }} indisponíveis: <b>{{ doc.canais_afectados }}</b>.</p>
{% else %}
<p>Durante este período, o acesso ao {{ doc.aplicacao }} e às suas funcionalidades poderá estar {{ efeito }} interrompido.</p>
{% endif %}
{% if doc.canais_operacionais %}
<p>Permanecerão operacionais, podendo ser utilizados normalmente: <b>{{ doc.canais_operacionais }}</b>.</p>
{% endif %}
<p>Recomendamos que as operações urgentes sejam concluídas antes do início da manutenção.</p>
<p>Com os melhores cumprimentos,<br>[ASSINATURA]</p>
```

---

## 3. Adiamento

**Método:** `enviar_adiamento`

**Assunto:**
```
Reagendamento da Manutenção Programada — {{ doc.aplicacao }}
```

**Mensagem:**
```jinja
{% set efeito = {"Total": "totalmente", "Parcial": "parcialmente"}.get(doc.impacto, "total ou parcialmente") %}
<p>Prezados,</p>
<p>Informamos que a manutenção programada do {{ doc.aplicacao }}, inicialmente prevista para {{ periodo_manutencao(doc, anterior=True, artigo=False) }}, foi reagendada para <b>{{ periodo_manutencao(doc, artigo=False) }}</b>.</p>
{% if doc.canais_afectados %}
<p>Durante o novo período, poderão estar {{ efeito }} indisponíveis: <b>{{ doc.canais_afectados }}</b>.</p>
{% else %}
<p>Durante o novo período, o acesso ao {{ doc.aplicacao }} e às suas funcionalidades poderá estar {{ efeito }} interrompido.</p>
{% endif %}
<p>Até lá, o sistema funciona normalmente. Lamentamos qualquer inconveniente.</p>
<p>Com os melhores cumprimentos,<br>[ASSINATURA]</p>
```

---

## 4. Prolongamento

**Método:** `enviar_prolongamento`

**Assunto:**
```
Prolongamento da Manutenção Programada — {{ doc.aplicacao }}
```

**Mensagem:**
```jinja
<p>Prezados,</p>
<p>Os trabalhos de manutenção programada do {{ doc.aplicacao }} necessitam de mais tempo do que o inicialmente previsto.</p>
<p>Prevemos que o sistema esteja novamente disponível <b>{{ quando_manutencao(doc.fim) }}</b>.</p>
<p>Informaremos assim que os trabalhos estiverem concluídos. Lamentamos o inconveniente e agradecemos a vossa compreensão.</p>
<p>Com os melhores cumprimentos,<br>[ASSINATURA]</p>
```

---

## 5. Conclusão — serviço reposto

**Método:** `enviar_conclusao`

**Assunto:**
```
Manutenção concluída — {{ doc.aplicacao }} disponível
```

**Mensagem:**
```jinja
<p>Prezados,</p>
<p>Informamos que os trabalhos de manutenção programada do {{ doc.aplicacao }} foram concluídos {{ quando_manutencao(doc.fim_real) }} e que o sistema se encontra novamente disponível.</p>
{% if doc.deployment_plan %}
<p>Em breve partilharemos o resumo das novidades e melhorias implementadas.</p>
{% endif %}
<p>Caso detectem alguma anomalia, por favor contactem o suporte.</p>
<p>Agradecemos a vossa compreensão e colaboração.</p>
<p>Com os melhores cumprimentos,<br>[ASSINATURA]</p>
```

---

## 6. Cancelamento

**Método:** `enviar_cancelamento`
**Condição:** `doc.aviso_enviado_em` — só faz sentido se o cliente já tinha sido avisado.

**Assunto:**
```
Cancelada: Manutenção Programada — {{ doc.aplicacao }}
```

**Mensagem:**
```jinja
<p>Prezados,</p>
<p>Informamos que a manutenção programada do {{ doc.aplicacao }} prevista para {{ periodo_manutencao(doc, artigo=False) }} foi cancelada.</p>
<p>O sistema funcionará normalmente durante esse período. Caso seja reagendada, voltaremos a informar.</p>
<p>Com os melhores cumprimentos,<br>[ASSINATURA]</p>
```

---

## 7. Relatório — novidades e melhorias

**Método:** `enviar_relatorio`
**Condição:** `doc.relatorio`

O texto vem do campo **Novidades e melhorias** (secção Relatório, visível com um Deployment Plan).
**Relatório → Preencher relatório do Deployment Plan** preenche-o com as tarefas do ClickUp; reveja antes de enviar.

**Assunto:**
```
Resumo da Manutenção Programada — {{ doc.aplicacao }}
```

**Mensagem:**
```jinja
<p>Saudações,</p>
<p>Espero que esta mensagem os encontre bem.</p>
<p>No âmbito da manutenção realizada {{ quando_manutencao(doc.inicio, hora=False) }}, informamos que foram alcançados os seguintes pontos:</p>
{{ doc.relatorio }}
<p>Para qualquer esclarecimento, estamos ao dispor.</p>
<p>Com os melhores cumprimentos,<br>[ASSINATURA]</p>
```

---

## 8. Equipa — a janela terminou

**Método:** `enviar_fim_da_janela`
**Recipients:** o papel da equipa técnica (ex.: `Tech Lead`) — **não** os destinatários do cliente.

**Assunto:**
```
Manutenção {{ doc.name }} ({{ doc.aplicacao }}): a janela terminou
```

**Mensagem:**
```jinja
<p>A janela da manutenção <b>{{ doc.name }}</b> do {{ doc.aplicacao }} terminou {{ quando_manutencao(doc.fim) }} e continua <b>Em Curso</b>.</p>
<p>Se o sistema já está disponível: <b>Concluir</b> (o cliente recebe o aviso de serviço reposto).<br>
Se ainda não: <b>Prolongar</b> (o cliente recebe a nova hora prevista).</p>
<p><a href="{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}">Abrir manutenção</a></p>
```

---

## 9. Equipa — começou (opcional)

**Método:** `enviar_inicio`
**Recipients:** o papel da equipa técnica

**Assunto:**
```
Começou: manutenção {{ doc.name }} ({{ doc.aplicacao }})
```

**Mensagem:**
```jinja
<p>A manutenção <b>{{ doc.name }}</b> do {{ doc.aplicacao }} começou. Fim previsto: {{ quando_manutencao(doc.fim) }}.</p>
<p><a href="{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}">Abrir manutenção</a></p>
```
