# 40Hz Connect — Fase 06 (v0.6.0)

Painel administrativo web integrado ao backend Node.js existente. Inclui as fases anteriores, sem novo serviço de hospedagem, sem nova dependência e sem alteração das credenciais da Meta. Interface em HTML/CSS/JavaScript, não Flutter Web: decisão para simplificar a instalação e acelerar esta entrega. Os números oficiais permanecem inativos; a automação real ainda se restringe à linha de teste e à lista de destinatários autorizados.

## Instalação

Faça backup do projeto e banco. Extraia o ZIP sobre a raiz atual do repositório, preservando `.git`, `.env` e o banco. Node 22+, dependência `pg` 8.16.3. Não há novo lockfile no ZIP; execute `npm install` para sincronizar o existente.

```powershell
npm install
npm test
git add .
git commit -m "Fase 06 - Painel administrativo"
git push
```

No serviço `wpp-auto` do Railway, adicione `ADMIN_PASSWORD` com uma senha exclusiva de 24 a 256 caracteres. Gere uma chave forte no terminal, por exemplo:

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

Copie o resultado diretamente para a variável no Railway, guarde-o em gerenciador de senhas e não compartilhe prints nem credenciais. Aplique as variáveis e faça deploy. Se `ADMIN_PASSWORD` estiver ausente, o painel permanece desativado. Senha definida mas curta causa falha de inicialização: use o tamanho recomendado.

Mantenha as variáveis existentes: PORT, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, META_GRAPH_API_VERSION, DATABASE_URL, TZ, WHATSAPP_AUTOMATION_ENABLED, WHATSAPP_TEST_RECIPIENTS. `FORP_TEST_PROFILE` continua opcional (padrão forp_02). A variável `FORP_BRANCH_ROUTES`, se existente, deve conter o mapa correto:

```json
{"cambui":"forp_02","camanducaia":"forp_02","monte_verde":"forp_02","joanopolis":"forp_03","braganca":"forp_01"}
```

Não há nova migração: as configurações ficam no JSONB `connect_profiles.settings`. As migrações 001 e 002 continuam idempotentes. O campo novo `automationEnabled` usa true quando ausente, preservando comportamento anterior. Não é necessário alterar o webhook.

## Uso

Acesse https://wpp-auto-production.up.railway.app/admin e entre com ADMIN_PASSWORD. Se o domínio foi alterado, utilize o domínio HTTPS atual seguido de /admin. GET /health retorna phase 6 e database ok quando o banco está acessível.

- Selecione o número: 2444 Bragança Paulista; 3346 Joanópolis; 0459 Monte Verde, Camanducaia e Cambuí.
- Edite dias, início/fim do expediente, aviso manual de equipe ocupada e nove modelos de mensagem. Use `{unidade}` e `{horario}` nos modelos, até 700 caracteres por campo. No menu inicial não existe unidade escolhida ainda; não use `{unidade}` nesses modelos.
- Selecione período e filial e clique em Atualizar prévia para simular a conversa com o motor real de decisões. A prévia não grava alterações e não envia mensagens.
- Salvar alterações grava o perfil no banco. O worker consulta o perfil a cada novo evento. O aviso de espera não detecta ocupação humana. Pausar o perfil impede novas respostas desse perfil; mensagens já em trânsito não são canceladas. Envie MENU no teste para reiniciar a sessão depois de alterações.
- A situação da linha comercial permanece inativa. O painel não registra números na Meta, não modifica WABA, IDs, credenciais, nem muda os vínculos confirmados das filiais. O perfil de teste ativo ainda depende de FORP_TEST_PROFILE e exige deploy para mudança. A chave WHATSAPP_AUTOMATION_ENABLED continua o interruptor global.

O expediente padrão continua seg–sex, 08:00–17:00, fuso America/Sao_Paulo, sem feriados, até confirmação dos dias. Não armazena conteúdo livre de mensagens recebidas nem anexos. O painel não é uma caixa de entrada, nem distribui atendimento para funcionários.

## Segurança

Senha única para um administrador; API exige sessão assinada de oito horas, cookie HttpOnly/Secure/SameSite=Strict, proteção de mutações via cabeçalho customizado e sem CORS, limitação de oito tentativas de login por minuto por processo, CSP e dados sem cache. Senha e segredos ficam exclusivamente no servidor. Logout apaga o cookie do navegador; o token de sessão é stateless e, se copiado, só deixa de valer na expiração ou após troca da senha/chave secreta. Rotação de ADMIN_PASSWORD invalida sessões existentes. Use somente HTTPS; mantenha o painel restrito a administradores autorizados. Em produção multiusuário serão necessários controle individual de acessos, revogação de sessões e limites distribuídos. Edições concorrentes do mesmo perfil usam a última gravação, sem versionamento.

## Testes e limites

`node --test`: 25 aprovados, 0 falhas, 1 teste opcional de PostgreSQL real ignorado (TEST_DATABASE_URL ausente). Testes HTTP e de banco simulado incluem autenticação, sessão expirada/adulterada, rejeição de requisições sem cabeçalho, limite de login, salvamento, isolamento de perfis, prévias e pausa. JavaScript verificado com `node --check`. A tentativa de teste visual automatizado no Chromium foi bloqueada pelo ambiente (`ERR_BLOCKED_BY_ADMINISTRATOR`). Não foi possível testar a interface real no navegador, banco real ou entrega real WhatsApp neste ambiente. O teste opcional exige banco descartável; nunca use o banco da FORP para ele.

Após deploy, verifique /health, login no /admin, três perfis, prévia dentro/fora do expediente, salve uma edição e recarregue a página para conferir persistência. Confirme o fluxo de WhatsApp usando exclusivamente o número de teste; se a entrega ainda falhar, examine message_status e automation_send_failed nos logs. Nenhuma ativação comercial faz parte desta fase. A próxima fase é validação integrada, seguida de preparação da coexistência e implantação oficial.
