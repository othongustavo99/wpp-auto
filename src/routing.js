import {branches} from './automation.js';

export const forpNumbers=Object.freeze({
  forp_01:'5511914622444',
  forp_02:'5535988850459',
  forp_03:'5511999903346',
});
const branchIds=new Set(branches.map(b=>b.id));
const own=(obj,key)=>Object.hasOwn(obj,key);

// Undefined means preserve existing database configuration. A supplied object is
// the complete desired mapping; omitted branches become unassigned.
export function parseRoutes(raw){
  if(raw===undefined || raw.trim()==='')return null;
  let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('FORP_BRANCH_ROUTES: JSON invalido');}
  if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error('FORP_BRANCH_ROUTES: objeto esperado');
  for(const [branch,number] of Object.entries(parsed)){
    if(!branchIds.has(branch) || !(number===null || (typeof number==='string' && own(forpNumbers,number))))throw new Error('FORP_BRANCH_ROUTES: unidade ou numero invalido');
  }
  return parsed;
}
export async function applyRoutes(pool,routes){
  if(routes===null)return null;
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(40400301)');
    for(const b of branches){
      const r=await c.query('UPDATE connect_branches SET number_id=$2 WHERE id=$1',[b.id,own(routes,b.id)?routes[b.id]:null]);
      if(r.rowCount!==1)throw new Error('Unidade ausente no banco');
    }
    await c.query('COMMIT');
    return Object.values(routes).filter(Boolean).length;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
export async function lookupRoute(client,branchId){
  const r=await client.query(`SELECT n.id,n.display_number FROM connect_branches b JOIN connect_numbers n ON n.id=b.number_id WHERE b.id=$1 AND NOT n.is_test`,[branchId]);
  const row=r.rows[0];
  // Only explicitly approved FORP destinations; a wrong database value fails closed.
  if(!row || !own(forpNumbers,row.id) || forpNumbers[row.id]!==row.display_number)return null;
  return {numberId:row.id,phone:row.display_number};
}
export function routeSelection(plan,route,open){
  if(!plan?.branch)return plan;
  const branch=branches.find(b=>b.id===plan.branch);
  if(!branch)throw new Error('Unidade invalida');
  const heading=`Você selecionou a unidade FORP — ${branch.name}.`;
  const hours=open?'Nossa equipe atende das 8h às 17h.':'No momento, estamos fora do expediente. Nosso atendimento é de segunda a sexta-feira, das 8h às 17h.';
  let body;
  if(route && own(forpNumbers,route.numberId) && forpNumbers[route.numberId]===route.phone){
    const link=`https://wa.me/${route.phone}?text=${encodeURIComponent(`Olá! Gostaria de atendimento na unidade FORP — ${branch.name}.`)}`;
    body=`${heading}\n${hours}\nPara continuar, abra o WhatsApp da unidade pelo link abaixo e envie a mensagem. A conversa não é transferida automaticamente.\n${link}\nPor favor, não envie dados médicos por aqui.\nPara escolher outra unidade, digite MENU.`;
  }else{
    body=`${heading}\n${hours}\nO direcionamento desta unidade ainda não está configurado. Nenhum atendimento foi encaminhado.\nPara escolher outra unidade, digite MENU.`;
  }
  return {...plan,payload:{type:'text',text:{body,preview_url:false}},routeStatus:route&&body.includes('https://wa.me/')?'link_offered':'unassigned'};
}
