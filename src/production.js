import {createHmac} from 'node:crypto';
import {forpNumbers} from './routing.js';
import {createMetaSender} from './automation.js';
import {createDiagnostics} from './diagnostics.js';
import {createPersistentAutomation} from './persistence.js';
const digits=x=>typeof x==='string'&&/^\d+$/.test(x);
const phone=x=>String(x??'').replace(/[^0-9]/g,'');
export function readCommercial(env){
 const active=env.FORP_PRODUCTION_ENABLED==='true';
 const lines=[];const seen=new Set([env.WHATSAPP_PHONE_NUMBER_ID]);
 if(!active)return lines;
 for(const id of Object.keys(forpNumbers)){
  const prefix=id.toUpperCase(),mode=env[prefix+'_MODE']||'off';
  if(mode==='off')continue;
  const phoneId=env[prefix+'_PHONE_ID'],wabaId=env[prefix+'_WABA_ID'],token=env[prefix+'_ACCESS_TOKEN'];
  const recipients=(env[prefix+'_PILOT_RECIPIENTS']||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!['pilot','live'].includes(mode)||!digits(phoneId)||!digits(wabaId)||seen.has(phoneId)||!token||!digits(env.META_APP_ID)||!recipients.every(x=>/^\d{8,15}$/.test(x))||(mode==='pilot'&&!recipients.length))throw Error('Configuracao comercial invalida: '+id);
  seen.add(phoneId);lines.push({id,mode,phoneId,wabaId,token,recipients,expected:forpNumbers[id]});
 }
 return lines;
}
// Read-only identity check: exact public number, membership, subscription. No registration or migration.
export async function preflight(line,{appId,version='v25.0',fetchImpl=fetch}){
 if(!digits(appId)||!/^v\d+\.\d+$/.test(version))return false;
 const get=async path=>{const r=await fetchImpl(`https://graph.facebook.com/${version}/${path}`,{headers:{Authorization:`Bearer ${line.token}`},redirect:'error',signal:AbortSignal.timeout(6000)});const b=await r.json();if(!r.ok||b.error)throw Error('Meta check failed');return b;};
 try{const [p,n,a]=await Promise.all([get(`${line.phoneId}?fields=id,display_phone_number,is_on_biz_app,platform_type`),get(`${line.wabaId}/phone_numbers?fields=id&limit=100`),get(`${line.wabaId}/subscribed_apps?limit=100`)]);
 return String(p.id)===line.phoneId&&p.is_on_biz_app===true&&p.platform_type==='CLOUD_API'&&phone(p.display_phone_number)===line.expected&&n.data?.some(x=>String(x.id)===line.phoneId)===true&&a.data?.some(x=>String(x.whatsapp_business_api_data?.id??x.id)===appId)===true;
 }catch{return false;}
}
export async function configureCommercial({pool,env,log=console.log,fetchImpl=fetch}){
 const lines=readCommercial(env),version=env.META_GRAPH_API_VERSION||'v25.0';
 const checked=await Promise.all(lines.map(async line=>({line,ok:await preflight(line,{appId:env.META_APP_ID,version,fetchImpl}),runtimeKey:createHmac('sha256',env.META_APP_SECRET).update(JSON.stringify(line)).digest('hex')})));
 const activatedAt=Math.floor(Date.now()/1000)*1000;
 const states=Object.fromEntries(Object.keys(forpNumbers).map(id=>[id,'off']));
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(40400301)');
 // Same lock as workers, to prevent sends while updating activation.
 await c.query('SELECT pg_advisory_xact_lock(40400302)');
 await c.query("UPDATE connect_numbers SET enabled=false,phone_id=NULL,waba_id=NULL,runtime_key=NULL WHERE NOT is_test AND id IN ('forp_01','forp_02','forp_03')");
 for(const {line,ok,runtimeKey} of checked){if(!ok){states[line.id]='blocked';log(JSON.stringify({event:'commercial_preflight_failed',line:line.id}));continue;}
 const r=await c.query('UPDATE connect_numbers SET enabled=true,phone_id=$2,waba_id=$3,runtime_key=$5 WHERE id=$1 AND NOT is_test AND display_number=$4',[line.id,line.phoneId,line.wabaId,line.expected,runtimeKey]);if(r.rowCount!==1)throw Error('Linha comercial nao encontrada');states[line.id]=line.mode;}
 // Discard pending commercial messages on deploy; never replay stale customer messages.
 await c.query("UPDATE connect_events SET status='expired',recipient=NULL,intent=NULL,finished_at=now() WHERE status='pending' AND number_id IN ('forp_01','forp_02','forp_03')");
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 const workers=[],diagnostics={};
 for(const {line,ok,runtimeKey} of checked){if(!ok)continue;
 const d=createDiagnostics({pool,phoneId:line.phoneId,wabaId:line.wabaId,appId:env.META_APP_ID,token:line.token,version,secret:env.META_APP_SECRET,testRecipients:line.recipients,scope:line.id,allRecipients:line.mode==='live',fetchImpl});diagnostics[line.id]=d;
 workers.push(createPersistentAutomation({pool,phoneId:line.phoneId,wabaId:line.wabaId,testRecipients:line.recipients,secret:env.META_APP_SECRET,send:createMetaSender({token:line.token,version,fetchImpl}),tz:env.TZ||'America/Sao_Paulo',testProfile:line.id,commercialProfile:line.id,mode:line.mode,runtimeKey,activatedAt,diagnostics:d}));}
 return {states,workers,diagnostics};
}
