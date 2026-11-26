import { createHash } from 'node:crypto';

export const branches = Object.freeze([
  {id:'cambui',name:'Cambuí'}, {id:'camanducaia',name:'Camanducaia'},
  {id:'monte_verde',name:'Monte Verde'}, {id:'joanopolis',name:'Joanópolis'},
  {id:'braganca',name:'Bragança Paulista'},
]);
const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function isOpen(date, tz='America/Sao_Paulo') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
  return ['Mon','Tue','Wed','Thu','Fri'].includes(parts.weekday) && Number(parts.hour)>=8 && Number(parts.hour)<17;
}
export function menu(open) {
  return {type:'interactive',interactive:{type:'list',body:{text:open
    ? 'Olá! Seja bem-vindo à FORP Segurança & Saúde do Trabalho. 👋\nPara direcionarmos seu atendimento, selecione a unidade desejada.'
    : 'Olá! Seja bem-vindo à FORP Segurança & Saúde do Trabalho. 👋\nNo momento, estamos fora do expediente (segunda a sexta, das 8h às 17h). Selecione a unidade desejada para adiantar sua solicitação.'},footer:{text:'FORP | Atendimento'},action:{button:'Escolher unidade',sections:[{title:'Unidades FORP',rows:branches.map(b=>({id:b.id,title:b.name}))}]}}};
}
const text = body => ({type:'text',text:{body,preview_url:false}});
export function decide(msg,state,open) {
  const typed = msg.type==='text' ? normalize(msg.text?.body) : '';
  const selected = msg.type==='interactive' && msg.interactive?.type==='list_reply' ? msg.interactive.list_reply?.id : '';
  const branch=branches.find((b,i)=>selected===b.id || typed===String(i+1) || typed===normalize(b.name));
  if (typed==='menu' || !state) return {next:'menu',payload:menu(open)};
  if (state==='handoff') return null;
  if (branch) return {next:'handoff',payload:text(open
    ? `Você selecionou a unidade FORP — ${branch.name}.\nNossa equipe dará continuidade ao atendimento assim que possível. Para agilizar, informe seu nome, empresa e motivo do contato. Por favor, não envie dados médicos por aqui. Agradecemos pela preferência!`
    : `Você selecionou a unidade FORP — ${branch.name}.\nNossa equipe poderá atender no próximo expediente. Você pode adiantar sua solicitação informando nome, empresa e motivo do contato. Por favor, não envie dados médicos por aqui. Agradecemos pela compreensão!`),branch:branch.id};
  // One reminder per session; no repeated bot messages for arbitrary text.
  if(state==='menu' && (msg.type==='text' || msg.type==='interactive')) return {next:'reminded',payload:text('Para direcionar seu atendimento, selecione uma unidade na lista acima ou digite MENU para abrir novamente.')};
  return null;
}
export function createMetaSender({token,version='v25.0',fetchImpl=fetch}) {
  if(!token || !/^v\d+\.\d+$/.test(version)) throw new Error('Credenciais API inválidas');
  return async (phoneId,to,payload)=>{
    const response=await fetchImpl(`https://graph.facebook.com/${version}/${phoneId}/messages`,{
      method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,...payload}),signal:AbortSignal.timeout(8000)
    });
    const data=await response.json().catch(()=>null);
    if(!response.ok || !data?.messages?.[0]?.id){const error=new Error('Meta send failed');error.httpStatus=response.status;error.metaCode=Number.isSafeInteger(data?.error?.code)?data.error.code:undefined;error.metaSubcode=Number.isSafeInteger(data?.error?.error_subcode)?data.error.error_subcode:undefined;throw error;}
    return data.messages[0].id;
  };
}
const hash = s => createHash('sha256').update(s).digest('hex');
export function createAutomation({phoneId,wabaId,testRecipients,send,log=console.log,now=()=>Date.now(),tz='America/Sao_Paulo'}) {
  if(!/^\d+$/.test(phoneId??'') || !/^\d+$/.test(wabaId??'') || !testRecipients?.length || !testRecipients.every(x=>/^\d{8,15}$/.test(x))) throw new Error('Configure IDs e WHATSAPP_TEST_RECIPIENTS');
  new Intl.DateTimeFormat('en-US',{timeZone:tz});
  const allowed=new Set(testRecipients), seen=new Map(), sessions=new Map();
  const day=86400000, max=10000; let tail=Promise.resolve(), pending=0;
  const emit=(event,extra={})=>log(JSON.stringify({event,...extra}));
  function prune(map,t){for(const [k,v] of map){if(v.expires<=t)map.delete(k);}while(map.size>=max)map.delete(map.keys().next().value);}
  function enqueue(entryId,metadata,msg){
    if(String(entryId)!==wabaId || String(metadata?.phone_number_id)!==phoneId || !allowed.has(msg?.from) || typeof msg?.id!=='string' || !['text','interactive','image','audio','video','document','sticker','location','contacts'].includes(msg?.type)) return false;
    const t=now(), stamp=Number(msg.timestamp)*1000;
    if(!Number.isFinite(stamp)||stamp<=0||t-stamp>=day||stamp-t>300000){emit('automation_skipped_timestamp');return false;}
    prune(seen,t); const id=hash(msg.id); if(seen.has(id))return false;
    if(pending>=100){emit('automation_queue_full');return false;}
    seen.set(id,{expires:t+day*7});pending++;
    tail=tail.then(async()=>{
      const current=now(); if(current-stamp>=day)return;
      prune(sessions,current);const key=hash(`${phoneId}:${msg.from}`);const state=sessions.get(key)?.state;
      const plan=decide(msg,state,isOpen(new Date(current),tz));
      if(!plan)return;
      try{const out=await send(phoneId,msg.from,plan.payload);sessions.set(key,{state:plan.next,expires:now()+day});emit('automation_sent',{messageIdSuffix:out.slice(-8),...(plan.branch?{branch:plan.branch}:{})});}
      catch(e){emit('automation_send_failed',{httpStatus:e.httpStatus,metaCode:e.metaCode,metaSubcode:e.metaSubcode});}
    }).catch(()=>emit('automation_error')).finally(()=>pending--);
    return true;
  }
  return {enqueue,idle:()=>tail};
}
