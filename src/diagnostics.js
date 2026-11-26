import {createHmac} from 'node:crypto';
const kinds=new Set(['incoming','sent','delivered','read','failed','accepted','send_error']);
const digits=v=>typeof v==='string'&&/^\d+$/.test(v);
const codes=values=>[...new Set((Array.isArray(values)?values:[]).filter(n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647))].slice(0,10);
export function createDiagnostics({pool,phoneId,wabaId,appId,token,version='v25.0',secret,testRecipients=[],fetchImpl=fetch,log=console.log}){
 const allowed=new Set(testRecipients),configured=digits(phoneId)&&digits(wabaId)&&!!token&&/^v\d+\.\d+$/.test(version);
 const matches=(entry,metadata)=>configured&&String(entry)===wabaId&&String(metadata?.phone_number_id)===phoneId;
 async function record(kind,id,errorCodes=[]){
  if(!configured||!secret||!kinds.has(kind)||typeof id!=='string'||!id||id.length>1024)return;
  try{const key=createHmac('sha256',secret).update(`${phoneId}:${kind}:${id}`).digest('hex');
   await pool.query(`INSERT INTO connect_diagnostics(event_key,kind,error_codes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[key,kind,codes(errorCodes)]);
  }catch{log(JSON.stringify({event:'diagnostics_write_failed'}));}
 }
 async function status(entry,metadata,s){if(matches(entry,metadata)&&allowed.has(s?.recipient_id)&&['sent','delivered','read','failed'].includes(s?.status))await record(s.status,s.id,Array.isArray(s.errors)?s.errors.map(e=>e?.code):[]);}
 async function incoming(entry,metadata,m){if(matches(entry,metadata)&&allowed.has(m?.from))await record('incoming',m.id);}
 async function get(path){
  try{const r=await fetchImpl(`https://graph.facebook.com/${version}/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(6000),redirect:'error'});const body=await r.json().catch(()=>null);if(!r.ok||!body||body.error)return {state:'error',httpStatus:r.status,errorCode:codes([body?.error?.code])[0]};return {state:'ok',body};}catch{return {state:'unavailable'};}
 }
 const result=(r,state)=>({state:r.state==='ok'?state:r.state,...(r.httpStatus?{httpStatus:r.httpStatus}:{}),...(r.errorCode!==undefined?{errorCode:r.errorCode}:{})});
 let cached, cachedAt=0, inFlight;
 async function meta(){
  if(!configured)return {phone:{state:'not_configured'},membership:{state:'not_configured'},subscription:{state:'not_configured'}};
  if(cached&&Date.now()-cachedAt<15000)return cached;
  if(inFlight)return inFlight;
  inFlight=(async()=>{
   const [phone,numbers,apps]=await Promise.all([get(`${phoneId}?fields=id`),get(`${wabaId}/phone_numbers?fields=id&limit=100`),get(`${wabaId}/subscribed_apps?limit=100`)]);
   const membership=numbers.body?.data?.some?.(x=>String(x?.id)===phoneId);
   const subscribed=apps.body?.data?.some?.(x=>String(x?.whatsapp_business_api_data?.id??x?.id)===appId);
   const answer={phone:result(phone,String(phone.body?.id)===phoneId?'ok':'unknown'),membership:result(numbers,membership?'ok':numbers.body?.paging?.next?'unknown':Array.isArray(numbers.body?.data)?'not_found':'unknown'),subscription:!digits(appId)?{state:'app_id_required'}:result(apps,subscribed?'ok':apps.body?.paging?.next?'unknown':Array.isArray(apps.body?.data)?'not_found':'unknown')};
   cached=answer;cachedAt=Date.now();return answer;
  })();try{return await inFlight;}finally{inFlight=undefined;}
 }
 async function report(){
  const [api,history,queue]=await Promise.all([meta(),pool.query(`SELECT kind,count(*)::int AS count,max(observed_at) AS last_at FROM connect_diagnostics WHERE observed_at>now()-interval '7 days' GROUP BY kind`),pool.query(`SELECT status,count(*)::int AS count FROM connect_events WHERE number_id='meta_test' GROUP BY status`)]);
  const errors=await pool.query(`SELECT kind,error_codes,observed_at FROM connect_diagnostics WHERE kind IN ('failed','send_error') AND observed_at>now()-interval '7 days' ORDER BY observed_at DESC LIMIT 10`);
  return {environment:'test',configured,authorizedRecipients:allowed.size,api,history:history.rows,queue:queue.rows,errors:errors.rows};
 }
 return {status,incoming,record,report};
}
