# 40Hz Connect — Fase 03 (v0.3.0)

Atualização do ZIP da Fase 2: PostgreSQL, cadastro de números e filiais, fila de eventos e sessões persistentes. Mantém a API e o webhook existentes. Node.js 22+, dependência pg 8.16.3.

## Atualização obrigatória

Extraia sobre a raiz do repositório atual, substituindo arquivos existentes. Não exclua `.git`, `.env` ou variáveis. O ZIP não traz package-lock.json porque o ambiente de geração não teve acesso ao npm. Antes de enviar ao GitHub, execute `npm install` (não `npm ci` inicialmente), que atualiza o lock existente, e `npm test`. Depois `git add .`, `git commit -m "Fase 03 - PostgreSQL e persistencia"`, `git push`. Inclua package-lock.json gerado no commit. Railway fará o deploy. Não é necessário reconfigurar webhook.

## Variáveis

Mantenha as 11 variáveis existentes, sem adicionar outras: PORT=8080, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, META_GRAPH_API_VERSION=v25.0, DATABASE_URL (referência privada do Postgres no mesmo projeto), TZ=America/Sao_Paulo, WHATSAPP_AUTOMATION_ENABLED=true, WHATSAPP_TEST_RECIPIENTS (números pessoais autorizados, dígitos internacionais, separados por vírgula). Renove tokens temporários expirados. Mantenha o aplicativo e banco na mesma rede Railway. Não divulgue segredos. Alterar META_APP_SECRET também altera o HMAC usado para pseudonimização, invalidando a deduplicação/sessões anteriores. Não habilite números FORP ainda.

## Verificação do deploy

GET /health: {"service":"40Hz Connect","status":"ok","phase":3,"database":"ok"}. Falha de consulta ao banco responde 503. Logs: database_migrated, server_started, automation_queued, automation_sent, automation_send_failed, automation_db_error, message_status. Se startup_failed, confira DATABASE_URL, variáveis e instalação pg; não exponha credenciais. Migration idempotente aplicada na inicialização (001_core.sql). Use uma única réplica no piloto; o worker também usa advisory lock no banco. Testes locais não executaram SQL real: o ambiente não tem PostgreSQL nem acesso ao registry npm. Teste de integração opcional: crie um banco descartável vazio e defina TEST_DATABASE_URL para ele, nunca para o banco do cliente; execute npm test. Testes locais usam mocks para banco e Meta. Não houve teste real de entrega.

## Estrutura de dados

- connect_numbers: três números FORP cadastrados com enabled=false, sem IDs Meta. Número de teste registrado na inicialização quando a automação estiver ativa.
- connect_branches: Cambuí, Camanducaia, Monte Verde, Joanópolis, Bragança Paulista; number_id nulo até confirmar o mapeamento.
- connect_sessions: estado de conversa por número e contato pseudonimizado, unidade escolhida, expiração após 24h da última resposta.
- connect_events: fila persistente, deduplicação por número e hash HMAC de ID da mensagem, situação de processamento. Eventos aceitos são persistidos antes do HTTP 200. O worker processa um evento por vez. Guarda destinatário temporariamente e apenas intenção reconhecida, não texto livre nem anexos. Remove destinatário e intenção após conclusão/expiração; registros finalizados são removidos após 7 dias, sessões após expiração. Limpeza ocorre enquanto o worker está ligado. Não guarda histórico de conversas.

## Teste funcional

Confirme inscrição messages e WABA, requisitos de publicação e autorização do destinatário de teste. Envie Olá ao número de teste. O menu deve listar cinco unidades. Escolha uma e reinicie o deploy: se a sessão estiver ativa, o bot não deve repetir a saudação quando receber nova mensagem comum. Digite MENU para abrir novamente. A regra de atendimento permanece segunda a sexta, 08h–17h (dias provisórios), sem feriados. Eventos de teste do painel não garantem recebimento de mensagens reais. A API aceita uma solicitação sem garantir entrega; procure message_status=failed e código de erro. Eventos de status são registrados nos logs, não persistidos como histórico. O banco guarda o estado de processamento interno, não o status de entrega final.

## Limitações e segurança

Não existe garantia de entrega exatamente uma vez: se o processo parar após reclamar evento e antes de concluir o envio, o evento fica processing e depois uncertain, sem reenvio automático, para evitar duplicidade. Falha de rede/timeout também não é reenviada. Falha na persistência do webhook retorna 500 e a Meta pode repetir o evento; eventos já inseridos são deduplicados. Alterações no número de teste podem exigir limpeza controlada dos estados; não use o cadastro para alternar contas. Não existe ainda painel, transferência real, roteamento por número comercial, controle de ocupação de atendentes, gestão de tokens por empresa ou fila humana. A base permite múltiplos registros, mas nesta fase somente o número de teste configurado no ambiente é processado. Números FORP: (11) 91462-2444, (35) 98885-0459, (11) 99990-3346; sem associação às unidades. Não remover WhatsApp Business, não migrar números sem autorização e verificação de coexistência. Não solicitar dados médicos. Antes de produção: retenção/privacidade, política de acesso, integração real e validação dos fluxos.
