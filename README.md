# 40Hz Connect — Fase 02 (v0.2.0)

Backend Node.js 22, sem dependências externas. Mantém o webhook da Fase 1 e acrescenta o motor de automação de demonstração, limitado a uma conta e número de teste e destinatários explicitamente autorizados.

## Atualização

Extraia este ZIP sobre a raiz do repositório atual (onde fica package.json). Substitua os arquivos de mesmo nome. Não exclua .git, .env ou variáveis do Railway. Não há arquivos a excluir. Execute `npm ci` e `npm test`. Depois `git add .`, `git commit -m "Fase 02 - Motor de automacao"` e `git push`.

## Railway

Mantenha PORT=8080, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN (renove caso expirado/exposto), WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, META_GRAPH_API_VERSION=v25.0 e TZ=America/Sao_Paulo. DATABASE_URL fica reservada para a Fase 3. Adicione WHATSAPP_TEST_RECIPIENTS com seu número de teste cadastrado e autorizado pela Meta, somente dígitos internacionais, sem +, espaços ou hífen (vários separados por vírgula; use o wa_id real do destinatário se a Meta normalizar o número). Adicione WHATSAPP_AUTOMATION_ENABLED=true somente depois de publicar esta versão. Para desligar, defina false e redeploy. Nunca adicione números de clientes à lista de teste.

GET /health deve retornar phase:2. Mantenha o callback HTTPS /webhook e seu token; não é necessário recriar. Confirme assinatura messages e inscrição da aplicação na WABA de teste. O aviso da Meta sobre app não publicado significa que eventos reais podem não chegar até a publicação; cumpra os requisitos do painel se necessário. Teste sintético do painel não é uma mensagem real; a automação filtra IDs, remetentes e horário do evento para evitar responder a exemplos fictícios. Não altere a conta/números oficiais para resolver testes.

## Teste real

Abra a conversa com o número de teste da Meta e envie Olá. Se a Meta entregar o evento ao backend, ele responderá com lista de cinco unidades. Escolha uma unidade; receberá uma confirmação e o bot deixa de responder a mensagens comuns naquela sessão. Digite MENU para reabrir. Aceita também 1 a 5 ou nome da unidade após abrir o menu. Horário padrão de segunda a sexta 08:00 inclusive até 17:00 exclusive, fuso America/Sao_Paulo. Dias úteis são uma hipótese ainda a validar; feriados não são tratados. Mensagens são enviadas somente em resposta a evento recente do usuário (janela de 24 h); não há envio espontâneo.

Logs: incoming_message (evento recebido, inclusive sintético), automation_sent (API aceitou resposta, não confirma entrega), automation_send_failed (HTTP e código Meta, se disponíveis), message_status (sent/delivered/read/failed). Não expõe tokens ou conteúdo de conversas nos logs. Se não houver evento real, verifique inscrição WABA, assinatura messages e publicação/restrições Meta. Se houver evento real mas nenhum envio, confira os IDs e wa_id permitido, validade do token e flag. Se accepted mas não chegar, procure status failed e código no log. A API real não foi acessada nos testes locais.

## Escopo e limitações

Fase 2 é um protótipo de teste, não produção. Deduplicação (7 dias, até 10 mil entradas), estado de conversa (24h a partir da última resposta automática) e fila limitada ficam em memória de uma única instância; reinícios, múltiplas réplicas ou estouro de limite podem perder eventos/estado. Sem reenvio automático após erro/timeout para reduzir duplicidade; não é garantia de entrega exatamente uma vez. Não há integração PostgreSQL, painel, fila humana real, detecção de equipe ocupada, transferência ou redirecionamento por link nesta fase. O texto de confirmação não significa que um atendente recebeu uma fila. Próxima fase: persistência, roteamento por número/filial, configurações e atendimento humano. Não solicitar dados médicos.

Unidades confirmadas: Cambuí, Camanducaia, Monte Verde, Joanópolis e Bragança Paulista. Números FORP confirmados (todos Business): (11) 91462-2444, (35) 98885-0459, (11) 99990-3346. Não ativados nem associados a filiais no código; mapeamento ainda pendente. Verificar coexistência, autorização e propriedade empresarial antes de integrar.

Documentação: https://developers.facebook.com/documentation/business-messaging/whatsapp/overview/
