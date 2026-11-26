import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWahaClient,createWahaTransport,readWahaConfig,formatPayload} from '../src/waha.js';

const expected='5511999991111', recipient='5511999992222', session='connect_test';
const config=readWahaConfig({WAHA_BASE_URL:'http://waha.railway.internal:3000',WAHA_API_KEY:'fake',CONNECT_SECRET:'a'.repeat(64),WAHA_WEBHOOK_SECRET:'b'.repeat(64),WAHA_TEST_NUMBER:expected,WHATSAPP_TEST_RECIPIENTS:recipient,WAHA_AUTOMATION_ENABLED:'true'});
const units=['monte_verde','camanducaia','cambui'];
const names=['Monte Verde','Camanducaia','Cambuí'];
const start=Date.parse('2026-11-26T13:00:00Z');
function fixture({profile='forp_02',failSend=false,failState=false}={}){
 let time=start,seq=0, sendFailure=failSend, stateFailure=failState;
 const events=new Map(),states=new Map(),sent=[],logs=[],diagnostics=[];
 const query=async(sql,args=[])=>{
  if(sql.includes('INSERT INTO connect_events')){
   const key=args[2];if(events.has(key))return {rowCount:0};
   events.set(key,{number_id:args[8],message_hash:key,contact_hash:args[3],recipient:args[4],intent:JSON.parse(args[5]),occurred_at:args[6],status:'pending'});return {rowCount:1};
  }
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(sql.includes('RETURNING e.*')){const j=[...events.values()].find(e=>e.status==='pending');if(j)j.status='processing';return {rows:j?[j]:[]};}
  if(sql.startsWith('SELECT state')){const state=states.get(args[1]);return {rows:state&&state.expires>time?[state]:[]};}
  if(sql.includes('FROM connect_profiles'))return {rows:[{branch_ids:profile==='forp_02'?units:profile==='forp_01'?['braganca']:['joanopolis'],settings:{}}]};
  if(sql.includes('INSERT INTO connect_sessions')){if(stateFailure)throw Object.assign(Error('db error'),{code:'23503'});states.set(args[1],{state:args[2],branch_id:args[3],expires:time+86400000});return {rowCount:1};}
  if(sql.startsWith('UPDATE connect_sessions SET expires_at')){const s=states.get(args[1]);if(s)s.expires=time+86400000;return {rowCount:1};}
  if(sql.startsWith('UPDATE connect_events SET status=$3')){const e=events.get(args[1]);e.status=args[2];e.recipient=null;e.intent=null;return {rowCount:1};}
  if(sql.startsWith('DELETE FROM connect_sessions')){for(const [k,v] of states)if(v.expires<=time)states.delete(k);}
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release:()=>{}})};
 const client={checkIdentity:async()=>true,remember:()=>{},send:async(_s,to,payload)=>{
  assert.equal(to,recipient);assert.ok(states.size,'state must be durable before transport call');sent.push(formatPayload(payload));
  if(sendFailure){sendFailure=false;throw Object.assign(Error('response lost after delivery'),{safeReason:'missing_message_id'});}
  return 'out-'+sent.length;
 }};
 const create=()=>createWahaTransport({pool,config,client,diagnostics:{record:async(...args)=>diagnostics.push(args)},testProfile:profile,now:()=>time,log:x=>logs.push(JSON.parse(x))});
 let transport=create();
 const message=async(body)=>{time+=1000;const event={event:'message',session,me:{id:expected+'@c.us'},payload:{id:'msg-'+(++seq),from:recipient+'@c.us',fromMe:false,hasMedia:false,body,timestamp:Math.floor(time/1000)}};assert.equal(await transport.receive(event),true);await transport.tick();return event;};
 return {message,states,events,sent,logs,diagnostics,restart:()=>{transport=create()},advance:ms=>{time+=ms},recoverState:()=>{stateFailure=false}};
}
test('WAHA: each of the three choices persists independently; handoff survives worker restart',async()=>{
 for(let i=0;i<3;i++){
  const f=fixture();await f.message('MENU');assert.match(f.sent[0],/1 — Monte Verde\n2 — Camanducaia\n3 — Cambuí/);
  f.restart();await f.message(String(i+1));assert.match(f.sent[1],new RegExp(names[i]));assert.equal([...f.states.values()][0].branch_id,units[i]);
  f.restart();await f.message('Preciso de ajuda');await f.message('obrigado');await f.message('1');assert.equal(f.sent.length,2);assert.ok(f.logs.some(x=>x.event==='automation_state_saved'&&x.state==='handoff'));
  await f.message('MENU');assert.equal(f.sent.length,3);assert.match(f.sent[2],/1 — Monte Verde/);
 }
});
test('WAHA: after uncertain send response, never repeat greeting on next ordinary message',async()=>{
 const f=fixture({failSend:true});await f.message('oi');assert.equal([...f.events.values()][0].status,'uncertain');assert.equal([...f.states.values()][0].state,'menu');f.restart();await f.message('2');assert.match(f.sent[1],/Camanducaia/);await f.message('oi de novo');assert.equal(f.sent.length,2);assert.ok(f.logs.some(x=>x.event==='automation_send_failed'&&x.statePreserved));
});
test('WAHA: failed state write prevents send; logs safe SQLSTATE',async()=>{
 const f=fixture({failState:true});await f.message('oi');assert.equal(f.sent.length,0);assert.ok(f.logs.some(x=>x.event==='automation_db_error'&&x.sqlstate==='23503'));f.recoverState();await f.message('MENU');assert.equal(f.sent.length,1);
});
test('WAHA: invalid option gets at most one reminder; selection still works',async()=>{
 const f=fixture();await f.message('oi');await f.message('9');assert.equal(f.sent.length,2);await f.message('não sei');assert.equal(f.sent.length,2);await f.message('Cambuí');assert.match(f.sent[2],/Cambuí/);await f.message('obrigado');assert.equal(f.sent.length,3);
});
test('WAHA: handoff lasts 24h of inactivity, not 24h since greeting',async()=>{
 const f=fixture();await f.message('oi');await f.message('1');f.advance(23*3600000);await f.message('olá novamente');f.advance(23*3600000);await f.message('seguindo');assert.equal(f.sent.length,2);f.advance(25*3600000);await f.message('novo contato');assert.equal(f.sent.length,3);assert.match(f.sent[2],/1 — Monte Verde/);
});
test('WAHA: direct profiles greet once without unit menu',async()=>{
 for(const [profile,name] of [['forp_01','Bragança Paulista'],['forp_03','Joanópolis']]){const f=fixture({profile});await f.message('oi');assert.match(f.sent[0],new RegExp(name));assert.doesNotMatch(f.sent[0],/1 — Monte Verde/);f.restart();await f.message('mais');assert.equal(f.sent.length,1);}
});
test('WAHA: compatible send acknowledgement shapes, unknown acknowledgement fails closed',async()=>{
 for(const response of [{id:'out1'},{id:{_serialized:'out2'}},{key:{id:'out3'}},{_data:{key:{id:'out4'}}},{}]){
  const client=createWahaClient({...config,fetchImpl:async(url)=>new Response(JSON.stringify(url.endsWith('/sendText')?response:url.includes('/contacts/')?{numberExists:true,chatId:recipient+'@c.us'}:{name:session,status:'WORKING',me:{id:expected+'@c.us'}}),{headers:{'Content-Type':'application/json'}})});
  if(Object.keys(response).length)assert.match(await client.send(session,recipient,{type:'text',text:{body:'test'}}),/^out[1-4]$/);else await assert.rejects(()=>client.send(session,recipient,{type:'text',text:{body:'test'}}),e=>e.safeReason==='missing_message_id');
 }
});
