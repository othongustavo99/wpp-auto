import {branches} from './automation.js';

export const confirmedRoutes=Object.freeze({cambui:'forp_02',camanducaia:'forp_02',monte_verde:'forp_02',joanopolis:'forp_03',braganca:'forp_01'});
export const profileIds=Object.freeze(['forp_01','forp_02','forp_03']);
export const defaults=Object.freeze({days:['Mon','Tue','Wed','Thu','Fri'],start:'08:00',end:'17:00',busy:false,automationEnabled:true,messages:{
 directOpen:'Olá! Seja bem-vindo à FORP — unidade {unidade}. Recebemos seu contato. Nossa equipe dará continuidade ao atendimento assim que possível.',
 directClosed:'Olá! Seja bem-vindo à FORP — unidade {unidade}. No momento, estamos fora do expediente. Nosso horário de atendimento é {horario}. Retornaremos no próximo expediente.',
 menuOpen:'Olá! Seja bem-vindo à FORP Segurança & Saúde do Trabalho. Para direcionarmos seu atendimento, selecione uma das nossas unidades abaixo.',
 menuClosed:'Olá! Seja bem-vindo à FORP Segurança & Saúde do Trabalho. No momento, estamos fora do expediente ({horario}). Selecione a unidade desejada para adiantar seu atendimento.',
 selectedOpen:'Você selecionou a unidade FORP — {unidade}. Nossa equipe dará continuidade ao atendimento assim que possível.',
 selectedClosed:'Você selecionou a unidade FORP — {unidade}. Nossa equipe está fora do expediente ({horario}) e retornará no próximo horário de atendimento.',
 busy:'Nossa equipe está em atendimento no momento. Por gentileza, aguarde; retornaremos assim que possível.',
 prompt:'Para agilizar, informe seu nome, empresa e motivo do contato, sem enviar dados médicos ou informações sensíveis.',
 invalid:'Não identificamos a unidade. Selecione uma opção na lista ou digite MENU para abrir novamente.'
}});
const dayNames={Mon:'segunda',Tue:'terça',Wed:'quarta',Thu:'quinta',Fri:'sexta',Sat:'sábado',Sun:'domingo'};
const timeValid=s=>typeof s==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function validateSettings(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid profile settings');
 if(Object.keys(raw).some(k=>!Object.hasOwn(defaults,k))||('messages' in raw&&(!raw.messages||typeof raw.messages!=='object'||Array.isArray(raw.messages))))throw Error('Invalid profile fields');
 const s={...defaults,...raw,messages:{...defaults.messages,...raw.messages}};
 if(!Array.isArray(s.days)||!s.days.length||new Set(s.days).size!==s.days.length||!s.days.every(d=>Object.hasOwn(dayNames,d))||!timeValid(s.start)||!timeValid(s.end)||s.start>=s.end||typeof s.busy!=='boolean'||typeof s.automationEnabled!=='boolean')throw Error('Invalid schedule');
 for(const [k,v] of Object.entries(s.messages))if(!Object.hasOwn(defaults.messages,k)||typeof v!=='string'||!v.trim()||v.length>700||/\{(?!unidade\}|horario\})/.test(v))throw Error('Invalid profile message');
 return s;
}
export function profileOpen(date,s,tz='America/Sao_Paulo'){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
 const hm=`${p.hour}:${p.minute}`;return s.days.includes(p.weekday)&&hm>=s.start&&hm<s.end;
}
function render(template,s,branch=''){
 const days=['Mon','Tue','Wed','Thu','Fri'].every(d=>s.days.includes(d))&&s.days.length===5?'de segunda a sexta-feira':s.days.map(d=>dayNames[d]).join(', ');
 return template.replaceAll('{unidade}',branch).replaceAll('{horario}',`${days}, das ${s.start} às ${s.end}`);
}
const text=body=>({type:'text',text:{body,preview_url:false}});
const order=['monte_verde','camanducaia','cambui','braganca','joanopolis'];
export function makeProfile(id,ids,raw={}){
 if(!profileIds.includes(id)||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(x=>!branches.some(b=>b.id===x)))throw Error('Invalid branch profile');
 return {id,branches:order.filter(x=>ids.includes(x)).map(x=>branches.find(b=>b.id===x)),settings:validateSettings(raw)};
}
export async function loadProfile(client,id){
 const r=await client.query(`SELECT p.settings,ARRAY(SELECT b.id FROM connect_branches b WHERE b.number_id=p.number_id ORDER BY b.id) AS branch_ids FROM connect_profiles p WHERE p.number_id=$1`,[id]);
 if(!r.rows[0])throw Error('Profile not configured');
 return makeProfile(id,r.rows[0].branch_ids,r.rows[0].settings);
}
export function decideProfile(msg,state,profile,open){
 const {settings:s,branches:units}=profile,m=s.messages;
 if(!s.automationEnabled)return null;
 const typed=msg.type==='text'?normalize(msg.text?.body):'';
 const selected=msg.type==='interactive'&&msg.interactive?.type==='list_reply'?msg.interactive.list_reply?.id:'';
 const welcome=(branch,kind)=>({next:'handoff',branch:branch.id,routeStatus:'same_number',payload:text([kind.startsWith('selected')&&!m[kind].includes('{unidade}')?`Unidade selecionada: ${branch.name}.`: '',render(m[kind],s,branch.name),open&&s.busy?render(m.busy,s,branch.name):'',render(m.prompt,s,branch.name)].filter(Boolean).join('\n\n'))});
 if(units.length===1){if(!state||typed==='menu')return welcome(units[0],open?'directOpen':'directClosed');return null;}
 const show=()=>({next:'menu',payload:{type:'interactive',interactive:{type:'list',body:{text:render(m[open?'menuOpen':'menuClosed'],s)},footer:{text:'FORP | Atendimento'},action:{button:'Escolher unidade',sections:[{title:'Unidades FORP',rows:units.map(b=>({id:b.id,title:b.name}))}]}}}});
 if(typed==='menu'||!state)return show();
 if(state==='handoff')return null;
 const b=units.find((b,i)=>selected===b.id||typed===String(i+1)||typed===normalize(b.name));
 if(b)return welcome(b,open?'selectedOpen':'selectedClosed');
 if(state==='menu'&&['text','interactive'].includes(msg.type))return {next:'reminded',payload:text(render(m.invalid,s))};
 return null;
}
