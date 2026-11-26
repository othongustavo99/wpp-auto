// Administrative control for a single, explicitly authorized test line.
import {SESSION} from './waha.js';
const known=new Set(['STOPPED','STARTING','SCAN_QR_CODE','WORKING','FAILED','PASSKEY_REQUIRED','PASSKEY_CONFIRMATION_REQUIRED']);
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const phone=id=>typeof id==='string'&&/^\d{8,15}@c\.us$/.test(id)?id.split('@')[0]:null;
const masked=n=>n?'••••'+n.slice(-4):null;
export function createSessionControl({client,config,webhookUrl='http://wpp-auto.railway.internal:8080/webhook/waha'}){
 const url=new URL(webhookUrl);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/webhook/waha'||!(url.protocol==='https:'||url.protocol==='http:'&&url.hostname.endsWith('.railway.internal')))throw Error('WAHA_WEBHOOK_URL invalida');
 const session=SESSION;let changing=false;
 const sessionConfig={metadata:{'connect.owner':'40hz-connect-test'},webhooks:[{url:url.href,events:['message','session.status'],hmac:{key:config.hookSecret}}],ignore:{status:true,groups:true,broadcast:true,channels:true}};
 async function find(){const list=await client.list();if(!Array.isArray(list))throw fail('Resposta WAHA inesperada',502);return list.find(s=>s.name===session);}
 const ready=()=>!!config.expected&&config.recipients.length>0&&!config.recipients.includes(config.expected);
 const owned=s=>(s?.config?.metadata??s?.metadata)?.['connect.owner']==='40hz-connect-test';
 function summarize(s){const n=phone(s?.me?.id);return {session,status:s?(known.has(s.status)?s.status:'UNKNOWN'):'NOT_FOUND',owned:!!owned(s),configured:ready(),expected:masked(config.expected),connected:masked(n),identity:s?.status==='WORKING'?(n&&n===config.expected?'ok':'mismatch'):'unknown',automationEnabled:config.enabled};}
 async function exclusive(fn){if(changing)throw fail('Outra operação em andamento');changing=true;try{return await fn();}finally{changing=false;}}
 function guard(){if(config.enabled)throw fail('Desative WAHA_AUTOMATION_ENABLED antes de alterar a conexão.');if(!ready())throw fail('Configure WAHA_TEST_NUMBER e um destinatário de teste diferente.');}
 return {
  async status(){return summarize(await find());},
  async start(){return exclusive(async()=>{guard();const s=await find();if(!s){await client.createSession({name:session,start:true,config:sessionConfig});}else{if(!owned(s))throw fail('Sessão existente não pertence ao painel. Não será modificada.');if(s.status==='STOPPED'){await client.updateSession(session,{name:session,config:sessionConfig});await client.startSession(session);}else if(s.status==='FAILED'){throw fail('Sessão falhou. Pare a sessão antes de tentar novamente.');}}return summarize(await find());});},
  async stop(){return exclusive(async()=>{const s=await find();if(s&&!owned(s))throw fail('Sessão existente não pertence ao painel.');if(s&&s.status!=='STOPPED')await client.stopSession(session);return summarize(await find());});},
  async qr(){guard();if(changing)throw fail('Outra operação em andamento');const s=await find();if(!owned(s)||s.status!=='SCAN_QR_CODE')throw fail('QR indisponível: atualize o estado da sessão.');const image=await client.getQR(session);if(image?.mimetype!=='image/png'||typeof image.data!=='string'||image.data.length>400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)||!Buffer.from(image.data,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw fail('Imagem QR inválida',502);return {mimetype:'image/png',data:image.data};}
 };
}
