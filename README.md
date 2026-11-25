# 40Hz Connect — Fase 1
Servidor de diagnóstico de webhook WhatsApp Cloud API. Node.js 22+, sem dependências externas. Não é ainda o chatbot e não envia mensagens automaticamente. Não armazena conversas ou dados de pacientes. Logs registram apenas eventos, sufixo do identificador da mensagem e códigos de falha.

## Local
`npm ci` e `npm test`. Para executar, copie `.env.example` para `.env`, preencha as duas chaves e rode `npm start`. Nunca faça commit de `.env`.

## Railway
Suba o conteúdo desta pasta na raiz de um repo privado. Crie um serviço a partir do repo no Railway. Em Variables, defina `WHATSAPP_VERIFY_TOKEN` (gere uma chave aleatória, por exemplo `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`) e `META_APP_SECRET` (Meta Developers > Configurações do app > Básico > Chave secreta do app). Aplique as alterações. O start command é `npm start`. Gere o domínio público em Settings > Networking e abra `https://SEU-DOMINIO/health`.

## Meta
Na configuração do WhatsApp, use callback `https://SEU-DOMINIO/webhook` e o mesmo `WHATSAPP_VERIFY_TOKEN`. Verifique e salve. Assine o campo `messages` do objeto `whatsapp_business_account`. Teste pelo painel. Caso necessário, confira se o app está inscrito na WABA de teste (`GET /{WABA_ID}/subscribed_apps` com token autorizado; `POST` para inscrever, quando necessário). A Meta pode exigir publicação para eventos reais, conforme aviso do painel. Não publique ou migre números sem revisar os requisitos. Veja logs do Railway e procure `webhook_verified`, `message_status` e `incoming_message`.

A fase não precisa do access token de envio. Revogue o token exposto anteriormente e use outro nos testes de envio. Não compartilhe chaves em screenshots. Logs não são armazenamento durável, e mensagens podem gerar eventos repetidos; deduplicação persistente e automação serão fases posteriores.
