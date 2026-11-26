import {createHmac,timingSafeEqual} from 'node:crypto';
import {createPersistentAutomation} from './persistence.js';
import {forpNumbers} from './routing.js';
const digits=v=>typeof v==='string'&&/^\d{8,15}$/.test(v);
const userId=v=>typeof v==='string'&&/^\d{8,15}@c\.us$/.test(v)?v.split('@')[0]:null;
const directChat=v=>typeof v==='string'&&/^\d{8,20}@(c\.us|lid)$/.test(v);
// Only normalize explicit phone JIDs; a LID is never a phone number.
const normalizeChat=v=>typeof v==='string'?v.replace(/^(\d{8,15})@s\.whatsapp\.net$/,'$1@c.us'):null;
function alternatePhone(payload){
 const key=payload?._data?.key, from=normalizeChat(payload?.from);
 if(!key||key.fromMe!==false||normalizeChat(key.remoteJid)!==from||!from?.endsWith('@lid')||key.participant)return null;
 const candidates=[key.remoteJidAlt,key.senderPn].map(normalizeChat).filter(x=>userId(x));
 return new Set(candidates).size===1?candidates[0]:null;
}
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
 // A verified incoming address is used to answer in the same conversation.
 // In-memory only; no raw message, LID or mapping written to logs or the database.
 const verified=new Map();
 const remember=(to,chatId)=>{if(recipients.includes(to)&&to!==expected&&directChat(chatId)&&userId(chatId)!==expected)verified.set(to,{chatId,expires:Date.now()+600000});};
 const sessionApi='/api/'+encodeURIComponent(session);
 async function optionalLookup(path){try{return await request(path);}catch{return null;}}
 async function resolveRecipient(to){
  if(!recipients.includes(to)||to===expected)throw Error('WAHA recipient not authorized');
  const data=await request('/api/contacts/check-exists?'+new URLSearchParams({phone:to,session}));
  const chat=normalizeChat(data?.chatId),pn=normalizeChat(data?.pn);
  return data?.numberExists===true&&directChat(chat)&&userId(chat)!==expected&&userId(pn)!==expected?chat:null;
 }
 async function matchRecipient(chatId,payload){
  chatId=normalizeChat(chatId);if(!directChat(chatId)||userId(chatId)===expected)return null;
  const alt=alternatePhone(payload);
  // First, authenticated direct-message metadata from NOWEB/Baileys.
  const exact=userId(chatId)||userId(alt);
  if(exact===expected)return null;
  if(exact&&recipients.includes(exact)){remember(exact,chatId);return exact;}
  // Then ask WAHA's dedicated mapping API (may be unavailable without Store).
  const reverse=chatId.endsWith('@lid')?await optionalLookup(sessionApi+'/lids/'+encodeURIComponent(chatId)):null;
  const mapped=reverse?.lid===chatId?userId(normalizeChat(reverse.pn)):null;
  if(mapped===expected||exact&&mapped&&exact!==mapped)return null;
  if(mapped&&recipients.includes(mapped)){remember(mapped,chatId);return mapped;}
  const matches=[];
  for(const to of recipients){
   const data=await optionalLookup('/api/contacts/check-exists?'+new URLSearchParams({phone:to,session}));
   const resolved=normalizeChat(data?.chatId),pn=normalizeChat(data?.pn);
   if(userId(resolved)===expected||userId(pn)===expected)continue;
   if(data?.numberExists===true&&(resolved===chatId||!!exact&&(userId(resolved)===exact||userId(pn)===exact)||!!mapped&&(userId(resolved)===mapped||userId(pn)===mapped))){matches.push(to);continue;}
   if(chatId.endsWith('@lid')){
    const forward=await optionalLookup(sessionApi+'/lids/pn/'+encodeURIComponent(to+'@c.us'));
    if(forward?.lid===chatId&&userId(normalizeChat(forward.pn))===to)matches.push(to);
   }
  }
  if(matches.length!==1)return null;remember(matches[0],chatId);return matches[0];
 }
 async function send(_session,to,payload){
  if(_session!==session||!digits(to)||!recipients.includes(to)||to===expected||!await checkIdentity())throw Error('WAHA identity not confirmed');
  const cached=verified.get(to);
  const chatId=cached&&cached.expires>Date.now()?cached.chatId:await resolveRecipient(to);if(!chatId)throw Error('WAHA recipient not resolved');
  const data=await request('/api/sendText',{session,chatId,text:formatPayload(payload),linkPreview:false});
  const id=[data?.id,data?.id?._serialized,data?.key?.id,data?._data?.key?.id].find(v=>typeof v==='string'&&v.length>0&&v.length<=1024);
  if(!id)throw Object.assign(Error('WAHA message id unavailable'),{safeReason:'missing_message_id'});return id;
 }
 const sessionPath=name=>'/api/sessions/'+encodeURIComponent(name);
 const createSession=body=>request('/api/sessions',body);
 const updateSession=(name,body)=>request(sessionPath(name),body,'PUT');
 const startSession=name=>request(sessionPath(name)+'/start',{});
 const stopSession=name=>request(sessionPath(name)+'/stop',{});
 const getQR=name=>request('/api/'+encodeURIComponent(name)+'/auth/qr?format=image');
 return {list,own,checkIdentity,send,matchRecipient,remember,createSession,updateSession,startSession,stopSession,getQR};
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
function inspectIncoming(event,{session=SESSION,expected,recipients,now=Date.now()},resolved=null){
 const p=event?.payload;
 if(event?.event!=='message'||event.session!==session)return {reason:'event_or_session'};
 if(!expected||userId(event.me?.id)!==expected)return {reason:'identity'};
 if(p?.fromMe!==false)return {reason:'own_message'};
 if(!directChat(normalizeChat(p.from))||userId(normalizeChat(p.from))===expected)return {reason:'not_direct'};
 if(typeof p.id!=='string'||!p.id||p.id.length>1024||p.hasMedia!==false||typeof p.body!=='string')return {reason:'not_text'};
 const stamp=Number(p.timestamp)*1000;if(!Number.isFinite(stamp)||stamp<=0||now-stamp>600000||stamp-now>300000)return {reason:'timestamp'};
 const from=resolved||userId(normalizeChat(p.from));
 if(!from||from===expected||!recipients.includes(from))return {reason:'recipient_unresolved'};
 return {msg:{id:p.id,from,timestamp:String(p.timestamp),type:'text',text:{body:p.body}}};
}
export function parseIncoming(event,config){return inspectIncoming(event,config).msg??null;}
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
  const context={...config,now:now()};let result=inspectIncoming(event,context);
  if(result.reason==='recipient_unresolved'&&client.matchRecipient){
   try{if(await client.checkIdentity()){const match=await client.matchRecipient(event.payload.from,event.payload);if(match)result=inspectIncoming(event,context,match);}}
   catch{log(JSON.stringify({event:'waha_message_ignored',reason:'recipient_lookup_failed'}));return false;}
  }
  if(!result.msg){if(event?.event==='message'&&event.session===config.session)log(JSON.stringify({event:'waha_message_ignored',reason:result.reason,...(result.reason==='recipient_unresolved'?{addressType:normalizeChat(event.payload?.from)?.endsWith('@lid')?'lid':'phone',alternateAvailable:!!alternatePhone(event.payload)}:{})}));return false;}
  const msg=result.msg;await diagnostics.record('incoming',msg.id);
  log(JSON.stringify({event:'waha_message_received',automationEnabled:config.enabled}));if(!automation)return false;
  if(!await client.checkIdentity()){log(JSON.stringify({event:'waha_message_ignored',reason:'identity_check_failed'}));return false;}
  client.remember?.(msg.from,normalizeChat(event.payload.from));
  const queued=await automation.enqueue('waha',{phone_number_id:config.session},msg);
  if(!queued)log(JSON.stringify({event:'waha_message_ignored',reason:'not_queued'}));return queued;
 },tick:()=>automation?.tick()};
}
