import {createHmac,createHash,timingSafeEqual,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {profileIds,loadProfile,validateSettings,makeProfile,decideProfile} from './profiles.js';
const assets=new Map([['/admin',['index.html','text/html; charset=utf-8']],['/admin/',['index.html','text/html; charset=utf-8']],['/admin/style.css',['style.css','text/css; charset=utf-8']],['/admin/app.js',['app.js','text/javascript; charset=utf-8']]].map(([path,[file,type]])=>[path,{type,body:readFileSync(new URL('../public/'+file,import.meta.url))}]));
const same=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());
const COOKIE='__Host-connect_session', TTL=8*60*60;
const cookie=(value,age)=>`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function readJson(req){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw Object.assign(Error('Formato inválido'),{status:415});
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32768)throw Object.assign(Error('Corpo muito grande'),{status:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('JSON inválido'),{status:400});}
}
export function createAdmin({pool,diagnostics,commercial,password,appSecret,enabled=false,testProfile='forp_02',now=Date.now,log=console.log}){
 if(typeof password!=='string'||password.length<24||password.length>256||!appSecret)throw Error('ADMIN_PASSWORD deve ter 24 a 256 caracteres');
 const key=createHmac('sha256',appSecret).update('admin-v1:'+password).digest();
 const sign=s=>createHmac('sha256',key).update(s).digest('hex');
 const issue=()=>{const s=`${Math.floor(now()/1000)+TTL}.${randomBytes(24).toString('hex')}`;return s+'.'+sign(s);};
 const auth=req=>{const v=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)??'';if(!/^\d{1,12}\.[a-f0-9]{48}\.[a-f0-9]{64}$/.test(v))return false;const [exp,nonce,sig]=v.split('.');return Number(exp)>Math.floor(now()/1000)&&same(sig,sign(`${exp}.${nonce}`));};
 let attempts=[];
 return async function admin(req,res,url){
 const send=(status,body,type='application/json; charset=utf-8',headers={})=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",...headers});res.end(type.startsWith('application/json')?JSON.stringify(body):body);};
 const path=url.pathname;
 try{
  if(req.method==='GET'&&assets.has(path)){const a=assets.get(path);return send(200,a.body,a.type);}
  if(!path.startsWith('/admin/api/'))return send(404,{error:'Não encontrado'});
  if(req.method!=='GET'&&req.headers['x-connect-admin']!=='1')return send(403,{error:'Solicitação não autorizada'});
  if(path==='/admin/api/login'&&req.method==='POST'){
   attempts=attempts.filter(t=>now()-t<60000);if(attempts.length>=8)return send(429,{error:'Muitas tentativas. Aguarde um minuto.'});attempts.push(now());
   const data=await readJson(req);if(typeof data?.password!=='string'||!same(data.password,password))return send(401,{error:'Senha incorreta'});
   attempts=[];return send(200,{ok:true},undefined,{'Set-Cookie':cookie(issue(),TTL)});
  }
  if(!auth(req))return send(401,{error:'Entre novamente no painel'});
  if(path==='/admin/api/logout'&&req.method==='POST')return send(200,{ok:true},undefined,{'Set-Cookie':cookie('',0)});
  if(path==='/admin/api/diagnostics'&&req.method==='GET'){
   if(!diagnostics)return send(503,{error:'Diagnóstico indisponível'});
   return send(200,await diagnostics.report());
  }
  if(path==='/admin/api/commercial'&&req.method==='GET'){
   const states=commercial?.states??{};const lines=await Promise.all(profileIds.map(async id=>({id,mode:states[id]||'off',diagnostics:commercial?.diagnostics[id]?await commercial.diagnostics[id].report():null})));return send(200,{lines});
  }
  if(path==='/admin/api/profiles'&&req.method==='GET'){
   const profiles=await Promise.all(profileIds.map(async id=>{const p=await loadProfile(pool,id);return {...p,commercialActive:['pilot','live'].includes(commercial?.states[id]),commercialMode:commercial?.states[id]||'off'};}));
   return send(200,{profiles,automationEnabled:enabled,testProfile,environment:Object.values(commercial?.states??{}).some(x=>x==='pilot'||x==='live')?'commercial':'test'});
  }
  const match=/^\/admin\/api\/profiles\/(forp_0[123])(?:\/(preview))?$/.exec(path);
  if(!match)return send(404,{error:'Não encontrado'});
  const [,id,preview]=match;
  if(!((preview&&req.method==='POST')||(!preview&&req.method==='PUT')))return send(405,{error:'Método inválido'});
  const body=await readJson(req);let settings;
  try{settings=validateSettings(body?.settings);if(!body?.settings)throw Error('missing');}catch{return send(400,{error:'Confira os horários, dias, mensagens e variáveis permitidas.'});}
  if(preview){
   const p=await loadProfile(pool,id);const profile=makeProfile(id,p.branches.map(b=>b.id),settings);const open=body.open===true;
   const first=decideProfile({type:'text',text:{body:'MENU'}},null,profile,open);
   const branch=profile.branches.find(b=>b.id===body.branch);const second=first?.next==='menu'&&branch?decideProfile({type:'interactive',interactive:{type:'list_reply',list_reply:{id:branch.id}}},'menu',profile,open):null;
   return send(200,{first:first?.payload??null,second:second?.payload??null});
  }
  const result=await pool.query('UPDATE connect_profiles SET settings=$2::jsonb WHERE number_id=$1',[id,JSON.stringify(settings)]);
  if(result.rowCount!==1)return send(404,{error:'Perfil não encontrado'});
  log(JSON.stringify({event:'admin_profile_updated',profile:id}));return send(200,{ok:true,settings});
 }catch(e){if(e.status)return send(e.status,{error:e.message});log(JSON.stringify({event:'admin_request_error'}));return send(500,{error:'Não foi possível concluir a solicitação'});}
 };
}
