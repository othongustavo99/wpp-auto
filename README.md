# 40Hz Connect — Fase 04 (v0.4.0)

Atualização completa sobre o ZIP exato da Fase 3. Adiciona roteamento por unidade usando o vínculo `connect_branches.number_id` que já existia no PostgreSQL. Mantém o webhook, a fila persistente, a deduplicação, a janela de atendimento, a lista de unidades e a proteção por destinatários autorizados. Node.js 22+ e pg 8.16.3 (mesma dependência anterior).

## Atualizar

Extraia sobre a raiz do repositório atual, substituindo os arquivos existentes. Não exclua `.git`, `.env`, o banco ou as variáveis. O ZIP não inclui `package-lock.json`: rode `npm install` para atualizar o lock da Fase 3 para a versão 0.4.0, depois `npm test`. Inclua o lock atualizado no Git.

```powershell
npm install
npm test
git add .
git commit -m "Fase 04 - Direcionamento por unidade"
git push
```

Railway fará o deploy se estiver conectado ao repositório. Não é necessário recriar banco, domínio ou webhook. Antes do deploy em ambiente ativo, mantenha backup do banco e dos arquivos. Não execute testes de integração contra o banco do cliente.

## Variáveis

Mantenha as 11 anteriores: PORT=8080, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, META_GRAPH_API_VERSION=v25.0, DATABASE_URL, TZ=America/Sao_Paulo, WHATSAPP_AUTOMATION_ENABLED=true, WHATSAPP_TEST_RECIPIENTS. Use somente números pessoais autorizados para teste, separados por vírgula. Renove token temporário se expirado. Não exponha segredos. O backend ainda usa apenas o número de teste, e os números FORP permanecem desativados para automação.

Nova variável **opcional** `FORP_BRANCH_ROUTES`: JSON objeto com as chaves das unidades e valores `forp_01`, `forp_02`, `forp_03` ou `null`. Não crie a variável até confirmar os vínculos com a FORP. Ausente ou vazia preserva o banco. Se fornecida, é a configuração completa: unidades omitidas ou nulas ficam sem vínculo. `{}` remove todos os vínculos. Aplicação transacional na inicialização, sem alterar número, IDs Meta ou habilitação. JSON inválido interrompe a inicialização; corrija o valor e faça novo deploy.

| Identificador | Número comercial confirmado |
|---|---|
| forp_01 | (11) 91462-2444 |
| forp_02 | (35) 98885-0459 |
| forp_03 | (11) 99990-3346 |

| Chave | Unidade |
|---|---|
| cambui | Cambuí |
| camanducaia | Camanducaia |
| monte_verde | Monte Verde |
| joanopolis | Joanópolis |
| braganca | Bragança Paulista |

Exemplo de formato sem qualquer associação presumida:

```json
{"cambui":null,"camanducaia":null,"monte_verde":null,"joanopolis":null,"braganca":null}
```

Depois de confirmar os responsáveis, substitua cada `null` pelo identificador correto entre aspas. Duas ou mais unidades podem compartilhar o mesmo número. Não confunda o vínculo com a ativação da automação no número comercial.

## Fluxo

O número de teste recebe mensagem de destinatário autorizado, apresenta lista das cinco unidades e, após seleção, consulta o PostgreSQL. Se houver destino válido, responde **ao destinatário de teste** com link `https://wa.me/` e texto pré-preenchido mencionando a unidade. O cliente precisa abrir o link e enviar a mensagem; não há transferência de histórico, envio automático ao telefone da filial nem distribuição interna de conversas. O link leva a um WhatsApp real da FORP se o vínculo for configurado: não envie a mensagem de teste à equipe sem autorização. Sem destino, informa explicitamente que o direcionamento não está configurado. A sessão para de responder até `MENU` ou expiração. Horários: segunda a sexta, 8–17h, sem feriados, dias provisórios. O texto fora do expediente indica o horário; não presume disponibilidade humana. Nenhum conteúdo médico é solicitado.

## Verificação

GET /health: {"service":"40Hz Connect","status":"ok","phase":4,"database":"ok"}. Logs: `database_migrated`, `server_started`, `branch_routes_configured` (somente com variável de mapa fornecida), `automation_queued`, `automation_sent` com `branch` e `routeStatus` (`link_offered` ou `unassigned`) ao selecionar unidade. `automation_send_failed` informa códigos de erro Meta; `message_status` registra eventos de entrega. `link_offered` não significa que cliente clicou, nem entrega confirmada.

Teste primeiro sem mapa: envie MENU no número de teste, selecione uma unidade e confira que não há encaminhamento incorreto. Após confirmar o mapa, configure a variável, reinicie o deploy, envie MENU e selecione cada unidade, confira o destino do link e o texto preenchido sem enviar mensagem real não autorizada. Se a API não entregar ou o webhook não receber evento real, confira assinatura do campo messages, inscrição WABA, requisitos de publicação, destinatário permitido e validade do token.

## Testes e limites

`npm test` cobre roteamento, validação do mapa, transação e rollback com mocks, links das cinco unidades, ausência de vínculo, envio somente ao destinatário de teste, segurança do webhook e persistência simulada. Teste real PostgreSQL opcional com `TEST_DATABASE_URL` apontando para banco vazio e descartável. Neste ambiente não houve conexão real ao PostgreSQL nem envio ao WhatsApp. O ZIP não inclui lockfile atualizado. A instalação da dependência pg deve ocorrer no ambiente do usuário. Não há painel administrativo, fila humana real, detecção de atendente ocupado nem automação ativa nos três números. A integração de produção depende da autorização da FORP, configuração de contas e IDs Meta, tokens, permissões, requisitos de coexistência e validação de entrega. Não migre nem exclua os WhatsApps Business existentes.

A Fase 3 mantém seus limites: eventos recebidos persistidos antes de HTTP 200, deduplicação por HMAC, mensagens ambíguas/timeout não são reenviadas automaticamente, sessões expiram e eventos finalizados são limpos. O backend não guarda conteúdo livre nem anexos; destinatário fica temporariamente na fila. Rotação de META_APP_SECRET altera hashes anteriores. Use uma réplica no piloto. Não confunda status interno da fila com entrega ao cliente.
