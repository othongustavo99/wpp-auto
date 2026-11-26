# 40Hz Connect — Fase 11 — Correção 03 (v0.11.3)

Base: ZIP 40hzconnect.zip fornecido pelo usuário, fase 10. Adiciona controle autenticado da sessão piloto WAHA `connect_test`: criar/iniciar, status, QR e pausar. Nenhuma linha comercial é conectada ou ativada nesta etapa. As funcionalidades anteriores e o banco são mantidos. WAHA é integração não oficial; há risco de suspensão e desconexão. Não use números comerciais ou conversas de pacientes no piloto.

## Instalação

1. Backup do banco e do projeto. Extraia o ZIP na raiz do projeto, mantendo `.git`, `.env` privados. Não há arquivos a excluir.
2. Em `waha` (serviço Docker privado), confirme volume `/app/.sessions`, API key e porta 3000. Adicione `WAHA_EVENTS_DOWNLOAD_MEDIA=false` e `WAHA_API_DOWNLOAD_MEDIA=false` para reduzir o tratamento de anexos; mantenha `WAHA_PRINT_QR=false`. Não exponha o serviço publicamente.
3. Em `wpp-auto`, mantenha todas as variáveis anteriores. Configure `WAHA_TEST_NUMBER` com o número separado que vai ser pareado (55 + DDD + número, somente dígitos). `WHATSAPP_TEST_RECIPIENTS` precisa conter outro número autorizado que enviará mensagens ao piloto; lista separada por vírgulas, sem espaços. Nenhum dos três números FORP pode ser usado. Mantenha `WAHA_AUTOMATION_ENABLED=false`, `WHATSAPP_AUTOMATION_ENABLED=false`, `FORP_PRODUCTION_ENABLED=false`. `WAHA_WEBHOOK_URL` é opcional; o padrão é `http://wpp-auto.railway.internal:8080/webhook/waha`. A assinatura HMAC usa a chave `WAHA_WEBHOOK_SECRET` já existente, sem expô-la ao browser.
4. Execute `npm ci`, `npm test`, `git add .`, `git commit -m "Fase 11 - Pareamento WAHA"`, `git push`.
5. Após deploy, abra https://wpp-auto-production.up.railway.app/health : esperado `{"service":"40Hz Connect","status":"ok","phase":11,"database":"ok","provider":"waha"}`. Health não valida a API WAHA. Entre no painel `/admin`, clique Verificar integração: API WAHA deve indicar OK antes do pareamento. Se indisponível, confira rede privada, bind e porta, não exponha o serviço para contornar o problema. HTTP 401/403: confira chave da API original e referência entre serviços.

## Pareamento

No painel, seção Conexão de teste, clique Preparar conexão. Atualize o estado até aparecer Aguardando leitura do QR; clique Mostrar / atualizar QR. No telefone de teste, WhatsApp > Aparelhos conectados > Conectar um aparelho, escaneie o código. Não compartilhe a imagem. Clique Atualizar estado; esperado Conectada (WORKING), identidade confirmada. Se número incorreto, pause e desvincule pelo telefone. QR é temporário e desaparece após 25 segundos ou atualização do estado. Caso expire, solicite outro. Se o WhatsApp pedir passkey, use os procedimentos oficiais do aparelho ou pause; esta versão não implementa confirmação de passkey. O botão Pausar sessão interrompe a sessão sem apagar o vínculo, para desvincular definitivamente use Aparelhos conectados no telefone. Sessões existentes sem marca de propriedade do Connect não são adotadas/modificadas.

Com automação ainda desligada, envie uma mensagem de teste do destinatário autorizado para a linha pareada. Verifique se o contador Recebidas do Diagnóstico aumenta. O evento deve ser direto, texto recente, não próprio, sem anexo, e com identidade e destinatário esperados. JIDs @lid e aliases são aceitos somente se os metadados autenticados do remetente ou as consultas check-exists e /api/{session}/lids confirmarem o vínculo com um número autorizado. O endereço verificado fica temporariamente em memória para enviar a resposta à mesma conversa. Se não houver correspondência, o evento é descartado. Logs indicam o motivo sem expor IDs ou conteúdo. Se não incrementar, confira logs privados e o webhook HMAC; não compartilhe payloads nem chaves. Com WAHA_AUTOMATION_ENABLED=true, o piloto responde aos contatos autorizados. Fase 12 vai validar o envio/entrega e persistência após reiniciar o WAHA antes de ativar qualquer linha comercial.

## Testes e limitações

48 testes aprovados, 1 ignorado (PostgreSQL real indisponível). Testes usam WAHA simulado, incluindo rotas HTTP autenticadas, criação, QR, pausa e identidade incorreta. Pareamento real, webhook pela rede privada, compatibilidade do motor WEBJS e renderização visual ainda precisam de validação no Railway. Não há mudanças nas migrações ou dependências nesta fase. Código legado da Meta continua presente apenas para regressão, não é usado no runtime WAHA. O QR não é salvo no banco nem incluído nos logs do Connect; o WAHA mantém credenciais no volume, que deve ser protegido. A sessão vinculada pode acessar conversas do aparelho; não use dados reais de pacientes neste piloto.

Docs: https://waha.devlike.pro/docs/how-to/sessions/ ; https://waha.devlike.pro/docs/how-to/events/ ; https://waha.devlike.pro/docs/how-to/config/ .

## Correção 11.2 — recipient_unresolved

Base: ZIP 40hzconnect(1).zip enviado pelo usuário. Atualização sem novas variáveis, migrações ou dependências. O retorno check-exists pode usar um identificador distinto do recebido pelo webhook. Esta correção utiliza remoteJidAlt/senderPn quando associados à mensagem direta autenticada, consulta as rotas específicas de LID nos dois sentidos e verifica aliases através da API. Mantém a lista de telefones autorizados e a verificação da identidade da sessão antes de enfileirar/enviar. Se não houver prova de correspondência, continua descartando o evento. Não ativa o Store do NOWEB, pois ele pode importar histórico pessoal. Os endpoints LID podem não funcionar sem Store; se não houver metadados ou mapeamento confirmado, não se deve liberar o filtro. Use uma conta dedicada a testes para qualquer investigação com Store.

Segurança: deixe WAHA_LOG_LEVEL=info e não compartilhe logs de debug, QR, dados brutos de eventos ou credenciais. Se as chaves de sessão foram expostas, desative WAHA_AUTOMATION_ENABLED, desvincule o aparelho WAHA no WhatsApp, e faça novo pareamento com uma conta de teste autorizada. Após conferir a identidade e uma mensagem de teste reconhecida, habilite a automação.

Validação: 55 testes aprovados, zero falhas, um ignorado (PostgreSQL real indisponível). WAHA real e entrega ainda pendentes. Logs de descarte agora acrescentam apenas o tipo de endereço e a disponibilidade de endereço alternativo, sem revelar IDs.

Documentação: https://waha.devlike.pro/docs/how-to/contacts/ e https://waha.devlike.pro/docs/engines/noweb/.


## Correção 11.3 — estado da conversa e atendimento humano

Base: Correção 11.2. A entrega de mensagens foi confirmada pelo usuário; o menu repetia em vez de avançar. O código anterior gravava a etapa somente depois de interpretar a resposta de envio. Nesta versão o piloto WAHA grava a etapa antes da chamada de envio, sob o lock do worker. Uma falha ou confirmação ambígua do envio não reinicia automaticamente o menu; `MENU` permite recuperar explicitamente o fluxo. Uma falha no banco antes do envio impede a resposta. A entrega real continua sendo verificada no telefone.

- `1` = Monte Verde, `2` = Camanducaia, `3` = Cambuí; nomes também aceitos. Confirmação inclui a unidade mesmo se o texto personalizado não contiver `{unidade}`.
- Após seleção ou saudação direta, o bot fica silencioso durante o atendimento humano. O prazo de 24 horas de inatividade é renovado a cada mensagem autorizada processada em handoff. `MENU` reabre o atendimento. Uma opção inválida antes da seleção gera no máximo um aviso por ciclo.
- Respostas do WAHA com identificador simples ou aninhado são reconhecidas. Se não houver identificador, o envio fica incerto, sem repetição automática.
- Novos logs: `automation_state_saved` com `state` e eventualmente `branch`; `automation_send_failed` com `statePreserved`; `automation_db_error` com SQLSTATE seguro quando disponível.
- Nenhuma nova variável, migração ou dependência. Preserve o volume e o pareamento. Não altere o filtro de contatos. Mantenha `WAHA_LOG_LEVEL=info`.

Instalação: extraia sobre o projeto, execute `npm ci`, `npm test`, commit e push. Confira `40hz-connect@0.11.3 start` no Railway e `WAHA_AUTOMATION_ENABLED=true` apenas durante o piloto autorizado. Envie `MENU`, escolha `1`, envie uma frase comum (não deve haver resposta); repita com `MENU` e opções `2` e `3`.

Validação local: 62 testes aprovados, 1 ignorado (PostgreSQL real indisponível). Novos testes exercitam o webhook adaptado, fila e persistência simuladas, as três escolhas, reinício do worker, falha de envio após entrega, falha no banco, expiração e perfis diretos. Validação em produção permanece pendente. Nenhuma linha comercial ativada.
