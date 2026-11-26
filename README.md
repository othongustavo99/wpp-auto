# 40Hz Connect — Fase 05 (v0.5.0)

Atualização completa sobre o ZIP da Fase 4. A automação utiliza perfis por número, horários e mensagens personalizáveis, e a associação das cinco unidades confirmada pelo usuário. A comunicação real continua limitada ao número de teste da Meta e aos destinatários autorizados. Nenhum número comercial será ativado nesta versão.

## Atualizar

Extraia sobre a raiz atual do repositório, mantendo `.git`, `.env`, banco e variáveis. Faça backup antes de atualizar. Node 22+, mesma dependência `pg` 8.16.3; o ZIP não contém lockfile atualizado. Execute:

```powershell
npm install
npm test
git add .
git commit -m "Fase 05 - Perfis de atendimento FORP"
git push
```

O Railway deve efetuar o deploy caso esteja ligado ao repositório. As migrações 001 e 002 são executadas automaticamente. A migração 002 insere três perfis e aplica uma única vez a associação confirmada, sem apagar conversas, registros ou credenciais. Sessões de teste antigas não serão reutilizadas: o hash passa a incluir o perfil simulado. Eventos pendentes sem perfil ou de perfil diferente serão expirados para evitar respostas incorretas durante a transição.

## Números, perfis e variáveis

| Perfil | WhatsApp comercial | Unidades |
|---|---|---|
| forp_01 | (11) 91462-2444 | Bragança Paulista |
| forp_02 | (35) 98885-0459 | Monte Verde, Camanducaia, Cambuí |
| forp_03 | (11) 99990-3346 | Joanópolis |

Mantenha as 11 variáveis anteriores: PORT=8080, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, META_GRAPH_API_VERSION=v25.0, DATABASE_URL, TZ=America/Sao_Paulo, WHATSAPP_AUTOMATION_ENABLED=true, WHATSAPP_TEST_RECIPIENTS. Renove o token temporário se estiver vencido. Não compartilhe segredos.

Se existir a variável `FORP_BRANCH_ROUTES` da Fase 4, substitua seu valor pelo JSON a seguir (ou remova a variável antes do primeiro deploy desta fase, para que a migração aplique os vínculos). Um valor antigo na variável sobrescreverá a migração em cada inicialização. Se quiser corrigir um deploy que já aplicou um mapa antigo, forneça o JSON abaixo e faça novo deploy.

```json
{"cambui":"forp_02","camanducaia":"forp_02","monte_verde":"forp_02","joanopolis":"forp_03","braganca":"forp_01"}
```

`FORP_TEST_PROFILE` é uma variável opcional. Padrão `forp_02`. Altere para `forp_01` ou `forp_03` para testar as saudações diretas. A alteração exige novo deploy e todas as mensagens ainda são enviadas pelo número de teste da Meta. Aguarde a fila terminar antes de trocar o perfil e envie MENU para reiniciar. Nenhum link leva aos números comerciais nos fluxos normais desta fase.

## Fluxos

- 2444: saudação Bragança Paulista, dentro ou fora do expediente; segue para atendimento humano na mesma conversa.
- 3346: saudação Joanópolis, dentro ou fora do expediente; segue para atendimento humano na mesma conversa.
- 0459: lista interativa Monte Verde, Camanducaia, Cambuí; resposta identifica a unidade escolhida, sem redirecionamento para outro número. Pode escolher pelo menu, nome ou 1/2/3. Uma opção de outra unidade é rejeitada. A seleção fica na sessão persistida; não há ainda distribuição automática entre funcionários.
- Em todos os perfis, depois da saudação direta ou da seleção, a automação não responde repetidamente. MENU reinicia o fluxo. Sessão expira 24 h após a última resposta automatizada.
- Expediente padrão segunda a sexta, 08:00 a 17:00, fuso America/Sao_Paulo, sem calendário de feriados. Dias úteis são uma hipótese anterior, ainda a confirmar.
- O modo de espera por equipe ocupada é uma configuração manual (`busy`), desligada por padrão. Mesmo desligado, a saudação informa que a equipe dará continuidade assim que possível. Não há detecção real de ocupação ou fila humana. O painel da próxima fase deverá expor essa configuração.
- Não solicita dados médicos. Não armazena texto livre ou anexos; somente intenções reconhecidas, identificadores derivados por HMAC e destinatário temporário da fila.

## Personalização (estrutura para o painel futuro)

`connect_profiles.settings` é um JSONB por número. A configuração é consultada durante o processamento, sem redeploy. Os valores omitidos usam os padrões de `src/profiles.js`. Campos: `days` (Mon, Tue, Wed, Thu, Fri, Sat, Sun), `start` e `end` (HH:MM, mesmo dia), `busy` (booleano), `messages` (objeto). Mensagens: directOpen, directClosed, menuOpen, menuClosed, selectedOpen, selectedClosed, busy, prompt, invalid. Variáveis de texto: `{unidade}`, `{horario}`. Máximo 700 caracteres por modelo. Alterações inválidas falham sem enviar uma resposta. O painel da Fase 6 será o meio normal de editar os dados; não há necessidade de SQL para instalar esta fase.

Exemplo opcional para administrador do banco, não executar se não quiser mudar o estado de espera:

```sql
UPDATE connect_profiles SET settings=jsonb_set(settings,'{busy}','true'::jsonb,true) WHERE number_id='forp_02';
-- voltar ao padrão:
UPDATE connect_profiles SET settings=jsonb_set(settings,'{busy}','false'::jsonb,true) WHERE number_id='forp_02';
```

## Validação

GET /health: {"service":"40Hz Connect","status":"ok","phase":5,"database":"ok"}. Logs: database_migrated, server_started, automation_queued, automation_sent (branch e routeStatus=same_number na saudação direta/seleção), automation_send_failed e message_status. O estado interno não comprova entrega da Meta.

Com perfil forp_02, envie MENU ao número de teste da Meta, confira as três unidades, selecione uma, confira a resposta e envie nova mensagem para verificar que não se repete. Troque o perfil para forp_01/03 e confirme a saudação direta. Se não houver evento real, verifique assinatura messages, inscrição WABA, token, destinatário e exigências do modo/publicação do app. Não adicione/migre os números comerciais nesta fase.

## Testes e limites

21 testes locais passaram, 1 teste opcional de PostgreSQL real foi ignorado (TEST_DATABASE_URL ausente). Não foi possível validar banco real nem envio/entrega WhatsApp neste ambiente. O teste opcional exige banco descartável, jamais o banco da FORP. Os utilitários de roteamento da Fase 4 permanecem disponíveis e testados, mas o fluxo padrão da Fase 5 mantém as conversas no mesmo número. Não existe painel administrativo nem integração de produção nesta versão. Os números comerciais permanecem desativados. Produção exige autorização, credenciais e IDs dos números comerciais, permissões, avaliação da coexistência e teste de entrega. Não exclua os aplicativos WhatsApp Business existentes.
