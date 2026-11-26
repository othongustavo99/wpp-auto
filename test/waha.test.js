import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createApp} from '../src/server.js';
import {readWahaConfig,createWahaClient,parseIncoming,checkSignature,formatPayload,createWahaDiagnostics,createWahaTransport} from '../src/waha.js';
import {makeProfile,decideProfile} from '../src/profiles.js';
const expected='5511999991111',to='5511999992222',secret='a'.repeat(64),hookSecret='b'.repeat(64),base='http://waha.railway.internal:3000',session='connect_test',now=Date.now();
const env={WAHA_BASE_URL:base,WAHA_API_KEY:'key',CONNECT_SECRET:secret,WAHA_WEBHOOK_SECRET:hookSecret,WAHA_TEST_NUMBER:expected,WHATSAPP_TEST_RECIPIENTS:to};
const config=readWahaConfig(env);
const event={event:'message',session,me:{id:expected+'@c.us'},payload:{id:'in-123',from:to+'@c.us',fromMe:false,hasMedia:false,body:'Olá',timestamp:Math.floor(now/1000)}};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const sign=raw=>({'x-webhook-hmac':createHmac('sha512',hookSecret).update(raw).digest('hex'),'x-webhook-hmac-algorithm':'sha512'});
test('WAHA config sem Meta; falha fechada e rejeita numeros FORP no piloto',()=>{
 assert.equal(config.enabled,false);assert.equal(readWahaConfig({...env,WAHA_AUTOMATION_ENABLED:'true'}).enabled,true);assert.throws(()=>readWahaConfig({...env,WAHA_TEST_NUMBER:'5511914622444'}));assert.throws(()=>readWahaConfig({...env,WAHA_AUTOMATION_ENABLED:'true',WAHA_TEST_NUMBER:''}));assert.throws(()=>readWahaConfig({...env,CONNECT_SECRET:''}));assert.throws(()=>readWahaConfig({...env,WAHA_BASE_URL:'http://x/api'}));
});
test('HMAC documentado: aceita assinatura valida e rejeita adulteracao e algoritmo diferente',()=>{
 const raw=Buffer.from(JSON.stringify(event));assert.ok(checkSignature(raw,sign(raw),hookSecret));assert.ok(!checkSignature(Buffer.from('{}'),sign(raw),hookSecret));assert.ok(!checkSignature(raw,{...sign(raw),'x-webhook-hmac-algorithm':'sha256'},hookSecret));
});
test('normaliza somente mensagens diretas recentes, sem anexos, do teste autorizado',()=>{
 assert.equal(parseIncoming(event,{...config,now}).from,to);
 for(const extra of [{fromMe:true},{from:'123@g.us'},{from:'status@broadcast'},{from:'123@lid'},{from:expected+'@c.us'},{hasMedia:true},{timestamp:1}])assert.equal(parseIncoming({...event,payload:{...event.payload,...extra}},{...config,now}),null);
 for(const e of [{...event,session:'forp_01'},{...event,event:'message.any'},{...event,me:{id:'1234567890@c.us'}}])assert.equal(parseIncoming(e,{...config,now}),null);
});
test('menu WAHA numerado com a ordem correta; seleção pelo numero e nome',()=>{
 const p=makeProfile('forp_02',['cambui','monte_verde','camanducaia']);const plan=decideProfile({type:'text',text:{body:'oi'}},null,p,true);
 assert.match(formatPayload(plan.payload),/1 — Monte Verde\n2 — Camanducaia\n3 — Cambuí/);assert.equal(decideProfile({type:'text',text:{body:'2'}},'menu',p,true).branch,'camanducaia');assert.equal(decideProfile({type:'text',text:{body:'Cambuí'}},'menu',p,true).branch,'cambui');
});
test('WAHA REST autenticada, checagem de identidade antes do envio; sem credenciais no corpo',async()=>{
 const calls=[];let own=expected;const client=createWahaClient({...config,fetchImpl:async(url,opts)=>{calls.push([url,opts]);return json(url.endsWith('/sendText')?{id:'out-123'}:{name:session,status:'WORKING',me:{id:own+'@c.us'}});}});
 assert.equal(await client.send(session,to,{type:'text',text:{body:'Olá'}}),'out-123');assert.equal(calls[0][1].headers['X-Api-Key'],'key');assert.deepEqual(JSON.parse(calls[1][1].body),{session,chatId:to+'@c.us',text:'Olá',linkPreview:false});own='5511914622444';await assert.rejects(()=>client.send(session,to,{type:'text',text:{body:'Olá'}}));assert.equal(calls.filter(c=>c[0].endsWith('/sendText')).length,1);await assert.rejects(()=>client.send(session,'5511999993333',{type:'text',text:{body:'Olá'}}));
});
test('diagnóstico WAHA não retorna dados de sessão sensíveis nem marca sessão ausente como OK',async()=>{
 const pool={query:async()=>({rows:[]})};const d=createWahaDiagnostics({pool,config,client:{list:async()=>[]}});assert.deepEqual((await d.report()).api,{connection:{state:'ok'},session:{state:'not_found'},identity:{state:'unknown'}});
 const d2=createWahaDiagnostics({pool,config,client:{list:async()=>[{name:session,status:'WORKING',me:{id:expected+'@c.us'},config:{secret:'secret-private'}}]}});const r=await d2.report();assert.equal(r.api.identity.state,'ok');assert.ok(!JSON.stringify(r).includes('secret-private'));assert.ok(!JSON.stringify(r).includes(expected));
});
test('motor desligado não insere fila nem envia; webhook antigo desativado no runtime WAHA',async()=>{
 let received=0;const waha=createWahaTransport({pool:{query:async()=>{throw Error('unexpected')}},config,client:{checkIdentity:async()=>{throw Error('unexpected')}},diagnostics:{record:async()=>received++},testProfile:'forp_02',now:()=>now});const s=createApp({waha,databaseCheck:async()=>{},log:()=>{}});await new Promise(r=>s.listen(0,'127.0.0.1',r));const u=`http://127.0.0.1:${s.address().port}`;
 try{assert.equal((await (await fetch(u+'/health')).json()).phase,11);assert.equal((await fetch(u+'/webhook')).status,404);const raw=JSON.stringify(event);assert.equal((await fetch(u+'/webhook/waha',{method:'POST',body:raw})).status,401);assert.equal((await fetch(u+'/webhook/waha',{method:'POST',body:raw,headers:sign(raw)})).status,200);assert.equal(received,1);await waha.tick();}finally{await new Promise(r=>s.close(r));}
});
test('motor piloto WAHA enfileira com namespace separado e sem conteúdo livre',async()=>{
 const calls=[];const c={...config,enabled:true};const waha=createWahaTransport({pool:{query:async(...args)=>{calls.push(args);return {rowCount:1}}},config:c,client:{checkIdentity:async()=>true},diagnostics:{record:async()=>{}},testProfile:'forp_02',now:()=>Math.floor(now/1000)*1000});assert.equal(await waha.receive(event),true);assert.equal(calls[0][1][8],'waha_test');assert.equal(calls[0][1][0],session);assert.ok(!JSON.stringify(calls).includes('Olá'));
});
