import {createHmac,timingSafeEqual} from 'node:crypto';
import {createPersistentAutomation} from './persistence.js';
import {forpNumbers} from './routing.js';
const digits=v=>typeof v==='string'&&/^\d{8,15}$/.test(v);
const userId=v=>typeof v==='string'&&/^\d{8,15}@c\.us$/.test(v)?v.split('@')[0]:null;
export const SESSION='connect_test';
export function readWahaConfig(env){
 const enabled=env.WAHA_AUTOMATION_ENABLED==='true',base=new URL(env.WAHA_BASE_URL||'http://waha.railway.internal:3000');
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('WAHA_BASE_URL invalida');
 if(!env.WAHA_API_KEY||!env.WAHA_WEBHOOK_SECRET||env.WAHA_WEBHOOK_SECRET.length<32||!env.CONNECT_SECRET||env.CONNECT_SECRET.length<32)throw Error('Credenciais WAHA/CONNECT incompletas');
 const expected=env.WAHA_TEST_NUMBER||'',recipients=(env.WHATSAPP_TEST_RECIPIENTS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(recipients.some(x=>!digits(x)||Object.values(forpNumbers).includes(x))||expected&&(!digits(expected)||Object.values(forpNumbers).includes(expected))||enabled&&(!expected||!recipients.length||recipients.includes(expected)))throw Error('Numero de teste/ destinatarios invalidos');
 return {base:base.origin,key:env.WAHA_API_KEY,hookSecret:env.WAHA_WEBHOOK_SECRET,secret:env.CONNECT_SECRET,enabled,expected,recipients,session:SESSION};
}
export function createWahaClient({base,key,session=SESSION,expected,recipients=[],fetchImpl=fetch}){
 async function request(path,body,method=body===undefined?'GET':'POST'){
  const r=await fetchImpl(base+path,{method,headers:{'X-Api-Key':key,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(method==='GET'?8000:25000)});
  const data=await r.json().catch(()=>null);if(!r.ok||data===null){const e=Error('WAHA request failed');e.httpStatus=r.status;throw e;}return data;
 }
 const list=()=>request('/api/sessions?all=true');
 const own=()=>request('/api/sessions/'+encodeURIComponent(session));
 async function checkIdentity(){const s=await own();return !!expected&&s.name===session&&s.status==='WORKING'&&userId(s.me?.id)===expected;}
 async function send(_session,to,payload){
  if(_session!==session||!digits(to)||!recipients.includes(to)||to===expected||!await checkIdentity())throw Error('WAHA identity not confirmed');
  const data=await request('/api/sendText',{session,chatId:to+'@c.us',text:formatPayload(payload),linkPreview:false});
  if(typeof data?.id!=='string'||!data.id)throw Error('WAHA message id unavailable');return data.id;
 }
 const sessionPath=name=>'/api/sessions/'+encodeURIComponent(name);
 const createSession=body=>request('/api/sessions',body);
 const updateSession=(name,body)=>request(sessionPath(name),body,'PUT');
 const startSession=name=>request(sessionPath(name)+'/start',{});
 const stopSession=name=>request(sessionPath(name)+'/stop',{});
 const getQR=name=>request('/api/'+encodeURIComponent(name)+'/auth/qr?format=image');
 return {list,own,checkIdentity,send,createSession,updateSession,startSession,stopSession,getQR};
}
export function formatPayload(payload){
 if(payload?.type==='text'&&typeof payload.text?.body==='string')return payload.text.body;
 if(payload?.type==='interactive'&&payload.interactive?.type==='list'){
  const x=payload.interactive;return [x.body.text,...x.action.sections.flatMap(s=>s.rows).map((r,i)=>`${i+1} — ${r.title}`),'Responda com o número ou nome da unidade.'].join('\n');
 }throw Error('WAHA payload not supported');
}
export function checkSignature(raw,headers,key){
 const sig=headers['x-webhook-hmac'];if(headers['x-webhook-hmac-algorithm']!=='sha512'||typeof sig!=='string'||! /^[a-fA-F0-9]{128}$/.test(sig))return false;
 return timingSafeEqual(Buffer.from(sig,'hex'),createHmac('sha512',key).update(raw).digest());
}
export function parseIncoming(event,{session=SESSION,expected,recipients,now=Date.now()}){
 const p=event?.payload,from=userId(p?.from);if(event?.event!=='message'||event.session!==session||!expected||userId(event.me?.id)!==expected||p?.fromMe!==false||!from||from===expected||!recipients.includes(from)||typeof p.id!=='string'||!p.id||p.id.length>1024||p.hasMedia!==false||typeof p.body!=='string')return null;
 const stamp=Number(p.timestamp)*1000;if(!Number.isFinite(stamp)||stamp<=0||now-stamp>600000||stamp-now>300000)return null;
 return {id:p.id,from,timestamp:String(p.timestamp),type:'text',text:{body:p.body}};
}
export async function registerWahaTest(pool,session=SESSION){
 await pool.query(`INSERT INTO connect_numbers(id,label,phone_id,waba_id,enabled,is_test) VALUES ('waha_test','WAHA teste',$1,'waha',true,true) ON CONFLICT(id) DO UPDATE SET phone_id=EXCLUDED.phone_id,waba_id='waha',enabled=true,is_test=true`,[session]);
}
export function createWahaDiagnostics({pool,client,config,log=console.log}){
 async function record(kind,id,errorCodes=[]){if(typeof id!=='string'||!id||id.length>1024)return;try{const hash=createHmac('sha256',config.secret).update(`waha:${kind}:${id}`).digest('hex');await pool.query(`INSERT INTO connect_diagnostics(event_key,kind,error_codes,scope) VALUES($1,$2,$3,'waha_test') ON CONFLICT DO NOTHING`,[hash,kind,errorCodes.filter(Number.isSafeInteger)]);}catch{log(JSON.stringify({event:'waha_diagnostics_write_failed'}));}}
 async function report(){
  let api={connection:{state:'unavailable'},session:{state:'unknown'},identity:{state:'unknown'}};
  try{const list=await client.list();if(!Array.isArray(list))throw Error('unexpected response');api.connection={state:'ok'};const s=list.find(x=>x.name===config.session);api.session={state:s?.status==='WORKING'?'ok':s?'not_ready':'not_found',...(s&&['STARTING','SCAN_QR_CODE','WORKING','FAILED','STOPPED'].includes(s.status)?{detail:s.status}:{})};api.identity={state:!config.expected?'not_configured':s?.status!=='WORKING'?'unknown':userId(s.me?.id)===config.expected?'ok':'mismatch'};}catch(e){api.connection={state:e.httpStatus?'error':'unavailable',...(e.httpStatus?{errorCode:e.httpStatus}:{})};}
  const [history,queue,errors]=await Promise.all([pool.query("SELECT kind,count(*)::int AS count FROM connect_diagnostics WHERE scope='waha_test' AND observed_at>now()-interval '7 days' GROUP BY kind"),pool.query("SELECT status,count(*)::int AS count FROM connect_events WHERE number_id='waha_test' GROUP BY status"),pool.query("SELECT kind,error_codes,observed_at FROM connect_diagnostics WHERE scope='waha_test' AND kind IN ('failed','send_error') AND observed_at>now()-interval '7 days' ORDER BY observed_at DESC LIMIT 10")]);
  return {provider:'waha',api,history:history.rows,queue:queue.rows,errors:errors.rows,authorizedRecipients:config.recipients.length};
 }
 return {record,report};
}
export function createWahaTransport({pool,config,client,diagnostics,testProfile,tz,log=console.log,now=Date.now}){
 const automation=config.enabled?createPersistentAutomation({pool,phoneId:config.session,wabaId:'waha',testNumberId:'waha_test',testRecipients:config.recipients,send:client.send,secret:config.secret,diagnostics,testProfile,tz,now,log,activatedAt:now()}):null;
 return {hookSecret:config.hookSecret,async receive(event){
  const msg=parseIncoming(event,{...config,now:now()});if(!msg)return false;
  await diagnostics.record('incoming',msg.id);if(!automation)return false;
  if(!await client.checkIdentity())return false;
  return automation.enqueue('waha',{phone_number_id:config.session},msg);
 },tick:()=>automation?.tick()};
}
