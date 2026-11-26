import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdmin} from '../src/admin.js';
import {createApp} from '../src/server.js';
import {confirmedRoutes,decideProfile,makeProfile} from '../src/profiles.js';
const password='1234567890-long-test-password';
const setup=async fn=>{
 let now=Date.now();const settings=new Map();const writes=[];
 const pool={query:async(sql,params)=>{const [id,json]=params;if(sql.includes('SELECT p.settings'))return {rows:[{settings:settings.get(id)??{},branch_ids:Object.keys(confirmedRoutes).filter(k=>confirmedRoutes[k]===id)}]};if(sql.startsWith('UPDATE connect_profiles')){writes.push(params);settings.set(id,JSON.parse(json));return {rowCount:1};}throw Error('Unexpected SQL');}};
 const admin=createAdmin({pool,password,appSecret:'app-secret',enabled:true,now:()=>now,log:()=>{}});
 const server=createApp({admin,verifyToken:'token',appSecret:'app-secret',log:()=>{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const req=(path,method='GET',body,session,csrf=true)=>fetch(base+path,{method,headers:{...(csrf?{'X-Connect-Admin':'1'}:{}),...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const login=async()=>{const r=await req('/admin/api/login','POST',{password});assert.equal(r.status,200);const c=r.headers.get('set-cookie');assert.match(c,/HttpOnly; Secure; SameSite=Strict/);return c.split(';')[0];};
 try{await fn({req,login,writes,advance:ms=>now+=ms});}finally{await new Promise(r=>server.close(r));}
};
test('painel, assets e API protegida; sessão expira e cookie adulterado falha',async()=>setup(async({req,login,advance})=>{
 const html=await req('/admin');assert.equal(html.status,200);assert.match(await html.text(),/Configurações de atendimento/);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal((await req('/admin/app.js')).status,200);assert.equal((await req('/admin/style.css')).status,200);
 assert.equal((await req('/admin/api/profiles')).status,401);assert.equal((await req('/admin/api/login','POST',{password:'wrong'})).status,401);assert.equal((await req('/admin/api/login','POST',{password},null,false)).status,403);
 const c=await login();const r=await req('/admin/api/profiles','GET',undefined,c);assert.equal(r.status,200);const body=await r.json();assert.equal(body.profiles.length,3);assert.ok(body.profiles.every(p=>!p.commercialActive));assert.equal((await req('/admin/api/profiles','GET',undefined,c+'f')).status,401);advance(8*3600000);assert.equal((await req('/admin/api/profiles','GET',undefined,c)).status,401);
}));
test('edita somente perfil permitido; valida horário e protege mutações; prévia não salva',async()=>setup(async({req,login,writes})=>{
 const c=await login(),path='/admin/api/profiles/forp_01';
 assert.equal((await req(path,'PUT',{settings:{busy:true}})).status,401);
 assert.equal((await req(path,'PUT',{settings:{busy:true}},c,false)).status,403);
 for(const bad of [{start:'25:00'},{automationEnabled:'false'},{days:[]},{messages:{unknown:'x'}},{commercialActive:true}])assert.equal((await req(path,'PUT',{settings:bad},c)).status,400);
 assert.equal((await req('/admin/api/profiles/meta_test','PUT',{settings:{}},c)).status,404);
 const s={busy:true,start:'09:00',messages:{directOpen:'Olá, {unidade}!'}};
 const r=await req(path+'/preview','POST',{settings:s,open:true},c);assert.equal(r.status,200);assert.match((await r.json()).first.text.body,/Olá, Bragança Paulista!.*\n\nNossa equipe está em atendimento/s);assert.equal(writes.length,0);
 assert.equal((await req(path,'PUT',{settings:s},c)).status,200);assert.equal(writes.length,1);assert.equal(writes[0][0],'forp_01');const profiles=(await (await req('/admin/api/profiles','GET',undefined,c)).json()).profiles;assert.equal(profiles[0].settings.start,'09:00');assert.equal(profiles[1].settings.start,'08:00');
 const logoff=await req('/admin/api/logout','POST',undefined,c);assert.match(logoff.headers.get('set-cookie'),/Max-Age=0/);
}));
test('prévia do menu mineiro e pausa por perfil',async()=>setup(async({req,login,writes})=>{
 const c=await login(),path='/admin/api/profiles/forp_02/preview';const r=await req(path,'POST',{settings:{},open:false,branch:'cambui'},c);const b=await r.json();assert.deepEqual(b.first.interactive.action.sections[0].rows.map(x=>x.title),['Monte Verde','Camanducaia','Cambuí']);assert.match(b.second.text.body,/Cambuí.*fora do expediente/);assert.equal(writes.length,0);
 const paused=await (await req(path,'POST',{settings:{automationEnabled:false},open:true},c)).json();assert.equal(paused.first,null);assert.equal(decideProfile({type:'text',text:{body:'MENU'}},null,makeProfile('forp_01',['braganca'],{automationEnabled:false}),true),null);
}));
test('limite de tentativas e painel sem senha desativado',async()=>setup(async({req,advance})=>{
 for(let i=0;i<8;i++)assert.equal((await req('/admin/api/login','POST',{password:'wrong'})).status,401);assert.equal((await req('/admin/api/login','POST',{password})).status,429);advance(60001);assert.equal((await req('/admin/api/login','POST',{password})).status,200);assert.throws(()=>createAdmin({password:'short',appSecret:'x'}));
}));
