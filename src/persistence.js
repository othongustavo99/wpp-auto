import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {branches,decide,isOpen} from './automation.js';
const DAY=86400000;
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
// Store only commands recognized by the bot; never store free text or attachments.
export function sanitizeIntent(msg){
  if(msg.type==='text'){
    const typed=normalize(msg.text?.body);
    const branch=branches.find((b,i)=>typed===String(i+1)||typed===normalize(b.name));
    return {type:'text',text:{body:typed==='menu'?'menu':branch?branch.name:''}};
  }
  if(msg.type==='interactive'){
    const id=msg.interactive?.type==='list_reply'?msg.interactive.list_reply?.id:'';
    return {type:'interactive',interactive:{type:'list_reply',list_reply:{id:branches.some(b=>b.id===id)?id:''}}};
  }
  return {type:msg.type};
}
export async function migrate(pool){
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(40400301)');
    await c.query(await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8'));await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function registerTest(pool,{phoneId,wabaId}){
  if(!/^\d+$/.test(phoneId??'')||!/^\d+$/.test(wabaId??''))throw new Error('IDs de teste invalidos');
  await pool.query(`INSERT INTO connect_numbers(id,label,phone_id,waba_id,enabled,is_test) VALUES ('meta_test','Meta teste',$1,$2,true,true)
    ON CONFLICT(id) DO UPDATE SET phone_id=EXCLUDED.phone_id,waba_id=EXCLUDED.waba_id,enabled=true,is_test=true`,[phoneId,wabaId]);
}
export function createPersistentAutomation({pool,phoneId,wabaId,testRecipients,send,secret,log=console.log,now=Date.now,tz='America/Sao_Paulo'}){
  if(!/^\d+$/.test(phoneId??'')||!/^\d+$/.test(wabaId??'')||!testRecipients?.length||!testRecipients.every(x=>/^\d{8,15}$/.test(x))||!secret)throw new Error('Configuracao de teste invalida');
  new Intl.DateTimeFormat('en-US',{timeZone:tz});
  const allowed=new Set(testRecipients), hash=s=>createHmac('sha256',secret).update(s).digest('hex');
  const emit=(event,extra={})=>log(JSON.stringify({event,...extra}));
  async function enqueue(entryId,metadata,msg){
    if(String(entryId)!==wabaId||String(metadata?.phone_number_id)!==phoneId||!allowed.has(msg?.from)||typeof msg?.id!=='string'||!['text','interactive','image','audio','video','document','sticker','location','contacts'].includes(msg?.type))return false;
    const stamp=Number(msg.timestamp)*1000,t=now();
    if(!Number.isFinite(stamp)||stamp<=0||t-stamp>=DAY||stamp-t>300000)return false;
    const r=await pool.query(`INSERT INTO connect_events(number_id,message_hash,contact_hash,recipient,intent,occurred_at)
      SELECT id,$3,$4,$5,$6::jsonb,$7 FROM connect_numbers WHERE phone_id=$1 AND waba_id=$2 AND enabled AND is_test
      ON CONFLICT DO NOTHING`,[phoneId,wabaId,hash(msg.id),hash(`${phoneId}:${msg.from}`),msg.from,JSON.stringify(sanitizeIntent(msg)),new Date(stamp)]);
    if(r.rowCount)emit('automation_queued');return r.rowCount>0;
  }
  // A session-level advisory lock serializes workers across replicas. Claim is committed BEFORE any API send.
  let busy=false;
  async function tick(){
    if(busy)return;busy=true;let c,locked=false,broken=false;
    try{
      c=await pool.connect();locked=(await c.query('SELECT pg_try_advisory_lock(40400302) AS locked')).rows[0].locked;
      if(!locked)return;
      await c.query(`UPDATE connect_events SET status='uncertain',recipient=NULL,intent=NULL,finished_at=now() WHERE status='processing' AND claimed_at<now()-interval '2 minutes'`);
      await c.query(`UPDATE connect_events SET status='expired',recipient=NULL,intent=NULL,finished_at=now() WHERE status='pending' AND occurred_at<=now()-interval '24 hours'`);
      await c.query(`DELETE FROM connect_events WHERE finished_at<now()-interval '7 days'`);
      await c.query('DELETE FROM connect_sessions WHERE expires_at<=now()');
      const r=await c.query(`UPDATE connect_events e SET status='processing',claimed_at=now() WHERE (e.number_id,e.message_hash)=(
        SELECT e2.number_id,e2.message_hash FROM connect_events e2 JOIN connect_numbers n ON n.id=e2.number_id WHERE e2.status='pending' AND n.enabled AND n.is_test AND n.phone_id=$1 AND n.waba_id=$2 ORDER BY e2.created_at,e2.message_hash LIMIT 1 FOR UPDATE OF e2 SKIP LOCKED) RETURNING e.*`,[phoneId,wabaId]);
      const job=r.rows[0];if(!job)return;
      const args=[job.number_id,job.message_hash];
      const finish=async status=>c.query('UPDATE connect_events SET status=$3,recipient=NULL,intent=NULL,finished_at=now() WHERE number_id=$1 AND message_hash=$2',[...args,status]);
      if(!allowed.has(job.recipient)||now()-new Date(job.occurred_at).getTime()>=DAY){await finish('expired');return;}
      const state=(await c.query('SELECT state,branch_id FROM connect_sessions WHERE number_id=$1 AND contact_hash=$2 AND expires_at>now()',[job.number_id,job.contact_hash])).rows[0];
      const plan=decide(job.intent,state?.state,isOpen(new Date(now()),tz));
      if(!plan){await finish('done');return;}
      let out;
      try{out=await send(phoneId,job.recipient,plan.payload);}catch(e){await finish(e.httpStatus?'failed':'uncertain');emit('automation_send_failed',{httpStatus:e.httpStatus,metaCode:e.metaCode,metaSubcode:e.metaSubcode});return;}
      await c.query('BEGIN');
      try{await c.query(`INSERT INTO connect_sessions(number_id,contact_hash,state,branch_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT(number_id,contact_hash) DO UPDATE SET state=EXCLUDED.state,branch_id=EXCLUDED.branch_id,expires_at=EXCLUDED.expires_at`,[job.number_id,job.contact_hash,plan.next,plan.branch??null]);await finish('done');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
      emit('automation_sent',{messageIdSuffix:out.slice(-8),...(plan.branch?{branch:plan.branch}:{})});
    }catch{broken=true;emit('automation_db_error');}finally{if(c){if(locked&&!broken)try{await c.query('SELECT pg_advisory_unlock(40400302)');}catch{broken=true;}c.release(broken);}busy=false;}
  }
  return {enqueue,tick};
}
