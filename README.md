# 40Hz Connect — Fase 07 (v0.7.0)

Painel administrativo web integrado ao backend Node.js existente. Inclui as fases anteriores, sem novo serviço de hospedagem, sem nova dependência e sem alteração das credenciais da Meta. Interface em HTML/CSS/JavaScript, não Flutter Web: decisão para simplificar a instalação e acelerar esta entrega. Os números oficiais permanecem inativos; a automação real ainda se restringe à linha de teste e à lista de destinatários autorizados.

## Instalação

Faça backup do projeto e banco. Extraia o ZIP sobre a raiz atual do repositório, preservando `.git`, `.env` e o banco. Node 22+, dependência `pg` 8.16.3. Não há novo lockfile no ZIP; execute `npm install` para sincronizar o existente.

```powershell
npm install
npm test
git add .
git commit -m "Fase 07 - Diagnostico e validacao integrada"
git push
```

Se ainda não estiver configurada, no serviço `wpp-auto` do Railway, adicione `ADMIN_PASSWORD` com uma senha exclusiva de 24 a 256 caracteres. Gere uma chave forte no terminal, por exemplo:

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
```

Copie o resultado diretamente para a variável no Railway, guarde-o em gerenciador de senhas e não compartilhe prints nem credenciais. Aplique as variáveis e faça deploy. Se `ADMIN_PASSWORD` estiver ausente, o painel permanece desativado. Senha definida mas curta causa falha de inicialização: use o tamanho recomendado.

Mantenha as variáveis existentes: PORT, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, META_GRAPH_API_VERSION, DATABASE_URL, TZ, WHATSAPP_AUTOMATION_ENABLED, WHATSAPP_TEST_RECIPIENTS. `FORP_TEST_PROFILE` continua opcional (padrão forp_02). A variável `FORP_BRANCH_ROUTES`, se existente, deve conter o mapa correto:

```json
{"cambui":"forp_02","camanducaia":"forp_02","monte_verde":"forp_02","joanopolis":"forp_03","braganca":"forp_01"}
```

A migração 003 cria `connect_diagnostics` automaticamente; as migrações anteriores continuam idempotentes. As configurações ficam em `connect_profiles.settings`. O campo novo `automationEnabled` usa true quando ausente, preservando comportamento anterior. Não é necessário alterar o webhook.

## Uso

Acesse https://wpp-auto-production.up.railway.app/admin e entre com ADMIN_PASSWORD. Se o domínio foi alterado, utilize o domínio HTTPS atual seguido de /admin. GET /health retorna phase 7 e database ok quando o banco está acessível.

- Selecione o número: 2444 Bragança Paulista; 3346 Joanópolis; 0459 Monte Verde, Camanducaia e Cambuí.
- Edite dias, início/fim do expediente, aviso manual de equipe ocupada e nove modelos de mensagem. Use `{unidade}` e `{horario}` nos modelos, até 700 caracteres por campo. No menu inicial não existe unidade escolhida ainda; não use `{unidade}` nesses modelos.
- Selecione período e filial e clique em Atualizar prévia para simular a conversa com o motor real de decisões. A prévia não grava alterações e não envia mensagens.
- Salvar alterações grava o perfil no banco. O worker consulta o perfil a cada novo evento. O aviso de espera não detecta ocupação humana. Pausar o perfil impede novas respostas desse perfil; mensagens já em trânsito não são canceladas. Envie MENU no teste para reiniciar a sessão depois de alterações.
- A situação da linha comercial permanece inativa. O painel não registra números na Meta, não modifica WABA, IDs, credenciais, nem muda os vínculos confirmados das filiais. O perfil de teste ativo ainda depende de FORP_TEST_PROFILE e exige deploy para mudança. A chave WHATSAPP_AUTOMATION_ENABLED continua o interruptor global.

O expediente padrão continua seg–sex, 08:00–17:00, fuso America/Sao_Paulo, sem feriados, até confirmação dos dias. Não armazena conteúdo livre de mensagens recebidas nem anexos. O painel não é uma caixa de entrada, nem distribui atendimento para funcionários.

## Segurança

Senha única para um administrador; API exige sessão assinada de oito horas, cookie HttpOnly/Secure/SameSite=Strict, proteção de mutações via cabeçalho customizado e sem CORS, limitação de oito tentativas de login por minuto por processo, CSP e dados sem cache. Senha e segredos ficam exclusivamente no servidor. Logout apaga o cookie do navegador; o token de sessão é stateless e, se copiado, só deixa de valer na expiração ou após troca da senha/chave secreta. Rotação de ADMIN_PASSWORD invalida sessões existentes. Use somente HTTPS; mantenha o painel restrito a administradores autorizados. Em produção multiusuário serão necessários controle individual de acessos, revogação de sessões e limites distribuídos. Edições concorrentes do mesmo perfil usam a última gravação, sem versionamento.

## Fase 7 — Diagnóstico integrado

Novo cartão no painel administrativo: **Diagnóstico da Meta → Verificar integração**. Consulta a Graph API somente para leitura (GET do ID de telefone, lista de números da WABA e apps inscritos). Não envia mensagens, não altera WABA ou configurações de webhook. Para confirmar a inscrição do aplicativo específico, adicione `META_APP_ID` (ID do aplicativo 40Hz Connect em Configurações do app → Básico). O valor é um identificador, não é a chave secreta. Sem ele, o diagnóstico indica configuração pendente somente na checagem de inscrição. Mantém a versão Graph já configurada. Respostas paginadas sem correspondência na primeira página são tratadas como não confirmadas.

A migração 003 registra eventos distintos por tipo e HMAC de ID, limitados ao número de teste configurado e aos destinatários autorizados. Não registra texto, anexos, números de destinatários, tokens ou resposta bruta da Meta nessa tabela. Registra tipos incoming, accepted, sent, delivered, read, failed e send_error, horários de observação e códigos numéricos. Limpeza a cada hora e na inicialização, após sete dias. O painel mostra contagens, fila e até dez falhas recentes. Não é uma métrica de taxa de entrega, nem confirma a origem real versus simulada de um evento com os mesmos identificadores. Eventos anteriores à instalação não serão recuperados. A resposta accepted não confirma entrega. Valide no celular.

### Roteiro de validação após deploy

1. `/health`: phase 7, database ok. Logs: database_migrated, server_started.
2. `/admin`: autenticar, clicar Verificar integração. Se erro 190, renovar token e fazer deploy. Se falta permissão para listar números/inscrições, verificar acesso ao WABA e permissão whatsapp_business_management; sucesso de envio não garante permissão de gerenciamento. Se inscrição não encontrada, conferir aplicativo/WABA corretos e inscrição em `messages` no painel da Meta. Não tente inscrever automaticamente uma conta comercial do cliente.
3. Confira WHATSAPP_TEST_RECIPIENTS e WHATSAPP_AUTOMATION_ENABLED=true apenas durante testes. Mantenha o número de teste como origem. Confirme o número no painel Meta antes de abrir a conversa. Envie MENU ou Olá do destinatário autorizado para o número de teste.
4. Clique novamente Verificar integração (cache de consultas Meta de 15 segundos). Procure incoming, accepted, sent e delivered; confira a mensagem no telefone. Se não houver incoming, verifique inscrição no WABA, campo messages, modo do app e restrições do ambiente de teste. Se accepted sem delivered, consulte falhas e códigos. Se não houver eventos novos, não conclua que houve entrega.
5. Teste FORP_TEST_PROFILE=forp_02: menu de Monte Verde, Camanducaia, Cambuí; cada escolha deve permanecer no mesmo chat. Teste forp_01 e forp_03 (alterar variável e fazer deploy entre perfis): saudação direta de Bragança Paulista/Joanópolis. Envie MENU para reiniciar. Teste pausa e aviso de ocupação, confira prévia fora do horário, salve e recarregue o painel. Não use números comerciais nessa etapa.
6. Antes de produção, confirmar entrega real, recebimento, persistência, autorização da FORP, titularidade dos ativos e elegibilidade para coexistência em cada número. Nenhum cadastro/migração de número nesta fase. A automação permanece tecnicamente limitada à linha de teste; a fase 8 deverá implementar autorização e ativação de produção de forma explícita.

Documentação oficial da inscrição da WABA: https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/subscribed_apps/

## Testes e limites

`node --test`: 30 aprovados, 0 falhas, 1 opcional ignorado (PostgreSQL real sem TEST_DATABASE_URL). Inclui teste integrado HTTP assinado → fila simulada → worker → Graph simulado → status delivered simulado, diagnóstico com erros e autorização do painel. O resultado não comprova comunicação com a Meta real. PostgreSQL real e navegador real não foram testados neste ambiente. Dependência pg permanece a mesma; execute npm install para sincronizar o lockfile existente. O teste PostgreSQL opcional altera a configuração de teste; use exclusivamente banco descartável isolado, nunca o banco da FORP ou de produção. Nenhum token foi utilizado nesta execução.
