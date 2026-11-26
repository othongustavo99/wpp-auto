import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmedRoutes,makeProfile,decideProfile,profileOpen,validateSettings,loadProfile} from '../src/profiles.js';
import {sanitizeIntent} from '../src/persistence.js';
const profile=(id,settings={})=>makeProfile(id,Object.keys(confirmedRoutes).filter(k=>confirmedRoutes[k]===id),settings);
const text=body=>({type:'text',text:{body}});
const click=id=>({type:'interactive',interactive:{type:'list_reply',list_reply:{id}}});
test('saudação direta para 2444 e 3346, sem menu nem repetição',()=>{
 for(const [id,name,branch] of [['forp_01','Bragança Paulista','braganca'],['forp_03','Joanópolis','joanopolis']]){
  const p=profile(id);for(const open of [true,false]){
   const plan=decideProfile(text('oi'),null,p,open);
   assert.equal(plan.branch,branch);assert.equal(plan.payload.type,'text');assert.equal(plan.routeStatus,'same_number');assert.match(plan.payload.text.body,new RegExp(name));assert.equal(plan.payload.text.body.includes('fora do expediente'),!open);assert.doesNotMatch(plan.payload.text.body,/wa\.me/);assert.equal(decideProfile(text('mais'),plan.next,p,open),null);
  }
 }
});
test('0459 mostra apenas as três unidades mineiras e mantém a conversa',()=>{
 const p=profile('forp_02');for(const open of [true,false]){
  const first=decideProfile(text('oi'),null,p,open);assert.equal(first.next,'menu');
  assert.deepEqual(first.payload.interactive.action.sections[0].rows.map(r=>r.id),['monte_verde','camanducaia','cambui']);
  for(const [i,b] of p.branches.entries()){
   for(const msg of [click(b.id),sanitizeIntent(text(String(i+1))),text(b.name)]){
    const plan=decideProfile(msg,'menu',p,open);assert.equal(plan.branch,b.id);assert.equal(plan.routeStatus,'same_number');assert.match(plan.payload.text.body,new RegExp(b.name));assert.doesNotMatch(plan.payload.text.body,/wa\.me/);assert.equal(plan.payload.text.body.includes('fora do expediente'),!open);
   }
  }
  assert.equal(decideProfile(click('braganca'),'menu',p,open).next,'reminded');assert.equal(decideProfile(text('5'),'reminded',p,open),null);assert.equal(decideProfile(text('MENU'),'handoff',p,open).next,'menu');
 }
});
test('horário configurável, minuto exato, fuso, dias e espera manual',()=>{
 const s=validateSettings({days:['Mon'],start:'08:30',end:'16:15',busy:true,messages:{directOpen:'Bem-vindo à {unidade}.'}});
 assert.equal(profileOpen(new Date('2026-11-30T11:29:00Z'),s),false);assert.equal(profileOpen(new Date('2026-11-30T11:30:00Z'),s),true);assert.equal(profileOpen(new Date('2026-11-30T19:15:00Z'),s),false);assert.equal(profileOpen(new Date('2026-12-01T13:00:00Z'),s),false);
 const p=profile('forp_01',s);assert.match(decideProfile(text('oi'),null,p,true).payload.text.body,/Bem-vindo à Bragança Paulista.*\n\nNossa equipe está em atendimento/s);assert.doesNotMatch(decideProfile(text('oi'),null,p,false).payload.text.body,/está em atendimento no momento/);
 assert.doesNotMatch(decideProfile(text('oi'),null,profile('forp_01'),true).payload.text.body,/está em atendimento no momento/);
});
test('configuração inválida falha fechada e perfil carregado do banco',async()=>{
 for(const bad of [{start:'25:00'},{days:[]},{end:'07:00'},{busy:'true'},{messages:{menuOpen:'{invalid}'}},{messages:{prompt:'x'.repeat(701)}}])assert.throws(()=>validateSettings(bad));
 const mock={query:async(q,args)=>{assert.deepEqual(args,['forp_03']);return {rows:[{branch_ids:['joanopolis'],settings:{start:'09:00'}}]};}};
 const p=await loadProfile(mock,'forp_03');assert.equal(p.settings.start,'09:00');assert.equal(p.branches[0].id,'joanopolis');assert.throws(()=>makeProfile('forp_03',[]));
});
