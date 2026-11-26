import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentAutomation,sanitizeIntent,migrate,registerTest} from '../src/persistence.js';
import {createApp} from '../src/server.js';
import {applyRoutes} from '../src/routing.js';
const stamp=Date.parse('2026-11-26T13:00:00Z'), recipient='5511999990000';
const message=(extra={})=>({id:'wamid.test',from:recipient,timestamp:String(stamp/1000),type:'text',text:{body:'conteudo privado'},...extra});
test('minimiza dados persistidos e valida comandos',()=>{
 assert.deepEqual(sanitizeIntent(message()),{type:'text',text:{body:''}});
 assert.equal(sanitizeIntent(message({text:{body:'  MONTE VERDE '}})).text.body,'Monte Verde');
 assert.equal(sanitizeIntent(message({text:{body:'MENU'}})).text.body,'menu');
 assert.deepEqual(sanitizeIntent({type:'document',document:{id:'privado'}}),{type:'document'});
 assert.equal(sanitizeIntent({type:'interactive',interactive:{type:'list_reply'}}).interactive.list_reply.id,'');
});
test('fila persistente: aceita somente origem e destinatário permitidos; hashes e parâmetros',async()=>{
 const calls=[]; const pool={query:async(...args)=>{calls.push(args);return {rowCount:calls.length===1?1:0}}};
 const a=createPersistentAutomation({pool,phoneId:'123',wabaId:'456',testRecipients:[recipient],secret:'test-secret',now:()=>stamp,send:async()=>{throw Error('not used')},log:()=>{}});
 assert.equal(await a.enqueue('456',{phone_number_id:'999'},message()),false);
 assert.equal(await a.enqueue('999',{phone_number_id:'123'},message()),false);
 assert.equal(await a.enqueue('456',{phone_number_id:'123'},message({from:'5511111111111'})),false);
 assert.equal(await a.enqueue('456',{phone_number_id:'123'},message()),true);
 assert.equal(await a.enqueue('456',{phone_number_id:'123'},message()),false);
 assert.equal(calls.length,2);assert.match(calls[0][0],/ON CONFLICT DO NOTHING/);
 assert.match(calls[0][1][2],/^[a-f0-9]{64}$/);assert.equal(calls[0][1][2],calls[1][1][2]);
 assert.ok(!JSON.stringify(calls).includes('conteudo privado'));
});
test('worker confirma envio e estado em uma transação; libera lock',async()=>{
 const queries=[],sent=[];let release;
 const c={query:async(sql,args)=>{queries.push([sql,args]);if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};if(sql.includes('RETURNING e.*'))return {rows:[{number_id:'meta_test',message_hash:'mh',contact_hash:'ch',recipient,intent:{type:'text',text:{body:'Cambuí'},testProfile:'forp_02'},occurred_at:new Date(stamp)}]};if(sql.startsWith('SELECT state'))return {rows:[{state:'menu'}]};if(sql.includes('FROM connect_profiles'))return {rows:[{branch_ids:['cambui','camanducaia','monte_verde'],settings:{}}]};return {rows:[]};},release:x=>{release=x}};
 const a=createPersistentAutomation({pool:{connect:async()=>c},phoneId:'123',wabaId:'456',testRecipients:[recipient],secret:'test',now:()=>stamp,send:async(...args)=>{sent.push(args);return 'wamid.test12345'},log:()=>{}});
 await a.tick();assert.equal(sent.length,1);assert.match(sent[0][2].text.body,/Cambuí/);
 assert.ok(queries.some(([q,v])=>q.includes('INSERT INTO connect_sessions')&&v[3]==='cambui'));
 assert.ok(queries.some(([q])=>q==='COMMIT'));assert.ok(queries.some(([q])=>q.includes('pg_advisory_unlock')));assert.equal(release,false);
});
test('worker consulta perfil persistido e mantém conversa no numero de teste',async()=>{
 const sent=[],queries=[];
 const c={query:async(sql,args)=>{queries.push([sql,args]);if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};if(sql.includes('RETURNING e.*'))return {rows:[{number_id:'meta_test',message_hash:'mh',contact_hash:'ch',recipient,intent:{type:'text',text:{body:'Cambuí'},testProfile:'forp_02'},occurred_at:new Date(stamp)}]};if(sql.startsWith('SELECT state'))return {rows:[{state:'menu'}]};if(sql.includes('FROM connect_profiles'))return {rows:[{branch_ids:['cambui','camanducaia','monte_verde'],settings:{}}]};if(sql.includes('JOIN connect_numbers n ON n.id=b.number_id'))return {rows:[{id:'forp_02',display_number:'5535988850459'}]};return {rows:[]};},release:()=>{}};
 const a=createPersistentAutomation({pool:{connect:async()=>c},phoneId:'123',wabaId:'456',testRecipients:[recipient],secret:'test',now:()=>stamp,send:async(...args)=>{sent.push(args);return 'wamid.test12345'},log:()=>{}});
 await a.tick();assert.equal(sent.length,1);assert.equal(sent[0][0],'123');assert.equal(sent[0][1],recipient);assert.match(sent[0][2].text.body,/Cambuí/);assert.doesNotMatch(sent[0][2].text.body,/wa\.me/);assert.ok(queries.some(([q,v])=>q.includes('INSERT INTO connect_sessions')&&v[3]==='cambui'));
});
test('health confirma banco ou retorna 503',async()=>{
 let fail=false;const s=createApp({verifyToken:'x',appSecret:'y',databaseCheck:async()=>{if(fail)throw Error('db')}});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));try{const url=`http://127.0.0.1:${s.address().port}/health`;const ok=await fetch(url);assert.deepEqual(await ok.json(),{service:'40Hz Connect',status:'ok',phase:8,database:'ok'});fail=true;assert.equal((await fetch(url)).status,503);}finally{await new Promise(r=>s.close(r));}
});
// Opt-in only, disposable test database. Never run against the client's production database.
test('PostgreSQL real: migration, dedup, persistent session and cleanup',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const {Pool}=await import('pg');const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});const sent=[];
 try{await migrate(pool);await registerTest(pool,{phoneId:'123',wabaId:'456'});await applyRoutes(pool,{cambui:'forp_02',camanducaia:'forp_02',monte_verde:'forp_02',joanopolis:'forp_03',braganca:'forp_01'});const now=Date.now();const opts={pool,phoneId:'123',wabaId:'456',testRecipients:[recipient],secret:'integration-test',now:()=>now,send:async(...args)=>{sent.push(args);return 'wamid.integration'},log:()=>{}};
 const a=createPersistentAutomation(opts);const id=`integration-${now}`;const m=message({id,timestamp:String(Math.floor(now/1000))});assert.equal(await a.enqueue('456',{phone_number_id:'123'},m),true);assert.equal(await a.enqueue('456',{phone_number_id:'123'},m),false);await a.tick();assert.equal(sent.length,1);
 const b=createPersistentAutomation(opts);await b.enqueue('456',{phone_number_id:'123'},message({id:id+'2',timestamp:m.timestamp,text:{body:'Cambuí'}}));await b.tick();assert.equal(sent.length,2);assert.match(sent[1][2].text.body,/Cambuí/);assert.doesNotMatch(sent[1][2].text.body,/wa\.me/);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM connect_numbers WHERE enabled=false AND id LIKE 'forp_%'")).rows[0].n,3);
 }finally{await pool.end();}
});
