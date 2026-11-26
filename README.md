# 40Hz Connect — Fase 10 (v0.10.0)

Migração da camada de comunicação para WAHA. Base: ZIP da Fase 8. O runtime agora exige WAHA e não consulta a Cloud API. O código/testes históricos da integração Meta foram mantidos apenas para regressão/rollback; o endpoint antigo `/webhook` responde 404 no runtime novo. As tabelas, perfis, painel e configurações anteriores são preservados. A fila antiga pendente é expirada sem envio (identificadores de destinatário e intent são apagados dessas tarefas). Faça backup do PostgreSQL antes do deploy.

## 1. Railway

No serviço `wpp-auto` (não no `waha`):

| Variável | Valor |
|---|---|
| WHATSAPP_PROVIDER | waha |
| WAHA_BASE_URL | http://waha.railway.internal:3000 |
| WAHA_API_KEY | ${{waha.WAHA_API_KEY}} (chave original, não hash) |
| CONNECT_SECRET | chave aleatória independente de 32 bytes em hex |
| WAHA_WEBHOOK_SECRET | outra chave aleatória independente de 32 bytes em hex |
| WAHA_AUTOMATION_ENABLED | false |
| DATABASE_URL | referência ao PostgreSQL existente |
| ADMIN_PASSWORD | senha administrativa existente |
| PORT | 8080 |
| TZ | America/Sao_Paulo |

Gere as duas chaves novas executando duas vezes `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Não compartilhe os valores. CONNECT_SECRET protege o painel e hashes internos; WAHA_WEBHOOK_SECRET será usado para assinatura do webhook. Não reutilize chaves. A troca da chave de assinatura do painel invalida cookies anteriores: entre novamente com ADMIN_PASSWORD.

Mantenha `WHATSAPP_TEST_RECIPIENTS` como destinatários privados de teste e `FORP_TEST_PROFILE` (opcional). Não defina `WAHA_TEST_NUMBER` ainda, ou deixe vazio. Os três números da FORP são proibidos no piloto. Mantenha `WHATSAPP_AUTOMATION_ENABLED=false` e `FORP_PRODUCTION_ENABLED=false` durante a migração. Após o deploy e verificação, os IDs/tokens antigos da Meta são dispensáveis e podem ser removidos do serviço; não remova as variáveis de banco, administração ou teste. Não é necessário abrir o Meta Developers.

No WAHA, mantenha a API autenticada, rede privada e volume `/app/.sessions`. Não gere domínio público. A configuração da sessão e seu webhook será feita na Fase 11; não conecte números nesta fase. Documentação: https://waha.devlike.pro/docs/how-to/sessions/ e https://waha.devlike.pro/docs/how-to/events/ .

## 2. Aplicar ZIP

Sobreponha arquivos na raiz do projeto, mantendo `.git` e `.env` privados. Execute `npm install`, `npm test`, `git add .`, `git commit -m "Fase 10 - Integracao WAHA"`, `git push`. O ZIP não inclui lockfile: npm install atualiza o existente. Não recrie o banco.

## 3. Validação real

Abra https://wpp-auto-production.up.railway.app/health — esperado: `{"service":"40Hz Connect","status":"ok","phase":10,"database":"ok","provider":"waha"}`. Health não testa WAHA.

Abra `/admin`, entre novamente se necessário e clique Verificar integração em Diagnóstico do WAHA. API WAHA (rede privada) deve indicar OK. Sessão connect_test: Não encontrado é normal antes do QR; identidade: Configuração incompleta. Se HTTP 401/403: confira chave original idêntica nos serviços. Se indisponível: confira nome privado do serviço, porta 3000, logs e configuração de rede. Não exponha a API para contornar falhas. O diagnóstico consulta GET /api/sessions?all=true, não retorna segredos da sessão e não envia mensagens.

## 4. Funcionamento do piloto preparado (não habilitar nesta fase)

O novo endpoint POST `/webhook/waha` exige HMAC SHA512 em hex do corpo bruto, cabeçalhos X-Webhook-Hmac e X-Webhook-Hmac-Algorithm. Na próxima fase configurar webhook da sessão `connect_test` para `http://wpp-auto.railway.internal:8080/webhook/waha`, evento `message`, chave WAHA_WEBHOOK_SECRET via config.hmac.key (não usar chave de API). O processamento aceita apenas conversas diretas de texto, recentes, com identidade do número de teste verificada, destinatários autorizados e sem mensagens próprias, grupos ou anexos. JIDs @lid ficam fora até suportarmos resolução segura. O banco usa `waha_test` separado de `meta_test`, reutilizando fila, deduplicação, horários e sessões. Antes de enviar, confirma que a sessão WORKING corresponde ao número de teste. Não há integração comercial nesta fase, nem leitura/entrega real confirmada. Menu de MG usa texto numerado (1 Monte Verde, 2 Camanducaia, 3 Cambuí), não lista interativa. A prévia apresenta as opções numeradas. A confirmação do envio pelo WAHA não comprova entrega; eventos de ACK ainda não implementados.

## 5. Testes e limitações

Node 22: 43 testes aprovados, 1 PostgreSQL real ignorado sem TEST_DATABASE_URL. Inclui testes com API WAHA simulada, HMAC, bloqueio de origens e destinatários inválidos, diagnóstico e fila. Não testado com WAHA/WhatsApp reais, PostgreSQL real ou navegador real neste ambiente. `npm install` é necessário para dependência pg. O WAHA não é oficial e pode provocar bloqueios de números, instabilidade e desconexões. Não é indicado conectar números comerciais antes de avaliar riscos, autorização da FORP e proteção de dados (incluindo dados de saúde). O WAHA/volume pode armazenar dados de sessão/mensagens fora do nosso banco; não presumir ausência de dados sensíveis. Teste com número separado e sem dados de pacientes. Não desative restrições impostas pelo WhatsApp.
