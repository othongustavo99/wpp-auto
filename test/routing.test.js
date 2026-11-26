import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRoutes,applyRoutes,lookupRoute,routeSelection,forpNumbers} from '../src/routing.js';
import {decide,branches} from '../src/automation.js';
const select=(id,open)=>decide({type:'interactive',interactive:{type:'list_reply',list_reply:{id}}},'menu',open);
test('mapa opcional, aceita varias unidades por numero e rejeita destinos desconhecidos',()=>{
 assert.equal(parseRoutes(undefined),null);
 assert.deepEqual(parseRoutes('{}'),{});
 assert.deepEqual(parseRoutes('{"cambui":"forp_01","monte_verde":"forp_01","braganca":null}'),{cambui:'forp_01',monte_verde:'forp_01',braganca:null});
 for(const raw of ['[]','null','{"foo":"forp_01"}','{"cambui":"meta_test"}','{"cambui":"5511999999999"}','{"__proto__":"forp_01"}','{'])assert.throws(()=>parseRoutes(raw));
});
test('atualiza cinco unidades atomicamente; sem mapa preserva banco',async()=>{
 const calls=[];let released=false;const pool={connect:async()=>({query:async(q,args)=>{calls.push([q,args]);return {rowCount:1}},release:()=>{released=true}})};
 assert.equal(await applyRoutes(pool,null),null);assert.equal(calls.length,0);
 assert.equal(await applyRoutes(pool,{cambui:'forp_01',braganca:'forp_03'}),2);
 const updates=calls.filter(([q])=>q.startsWith('UPDATE'));
 assert.equal(updates.length,5);assert.deepEqual(updates.find(([,p])=>p[0]==='monte_verde')[1],['monte_verde',null]);
 assert.equal(calls.at(-1)[0],'COMMIT');assert.equal(released,true);
});
test('rollback se unidade nao existir',async()=>{
 const calls=[];const pool={connect:async()=>({query:async(q)=>{calls.push(q);return {rowCount:0}},release:()=>{}})};
 await assert.rejects(applyRoutes(pool,{cambui:'forp_01'}));assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));
});
test('consulta banco e valida numero contra destinos confirmados',async()=>{
 const mock=row=>({query:async(q,args)=>{assert.deepEqual(args,['cambui']);assert.match(q,/NOT n.is_test/);return {rows:row?[row]:[]}}});
 assert.deepEqual(await lookupRoute(mock({id:'forp_02',display_number:forpNumbers.forp_02}),'cambui'),{numberId:'forp_02',phone:forpNumbers.forp_02});
 assert.equal(await lookupRoute(mock({id:'forp_02',display_number:'5511999999999'}),'cambui'),null);
 assert.equal(await lookupRoute(mock(null),'cambui'),null);
});
test('links corretos para cinco unidades, dias e horarios; nao envia ao destino',()=>{
 for(const [i,b] of branches.entries()){
  const numberId=`forp_0${i%3+1}`,phone=forpNumbers[numberId];
  for(const open of [true,false]){
   const out=routeSelection(select(b.id,open),{numberId,phone},open);
   assert.equal(out.next,'handoff');assert.equal(out.routeStatus,'link_offered');assert.match(out.payload.text.body,/não é transferida automaticamente/);
   const url=new URL(out.payload.text.body.match(/https:\/\/wa\.me\/[^\s]+/)[0]);assert.equal(url.pathname,`/${phone}`);assert.match(url.searchParams.get('text'),new RegExp(b.name));
   assert.equal(out.payload.text.body.includes('fora do expediente'),!open);
  }
 }
});
test('unidade sem destino nao promete encaminhamento nem gera link',()=>{
 const out=routeSelection(select('cambui',true),null,true);assert.equal(out.routeStatus,'unassigned');assert.match(out.payload.text.body,/Nenhum atendimento foi encaminhado/);assert.ok(!out.payload.text.body.includes('wa.me'));
});
