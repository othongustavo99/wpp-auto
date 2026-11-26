import { createServer } from 'node:http';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createMetaSender } from './automation.js';
import { migrate, registerTest, createPersistentAutomation } from './persistence.js';

const equal = (a,b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const safeCode = v => typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined;
const maskId = v => typeof v === 'string' && v.length > 8 ? v.slice(-8) : undefined;
export function createApp({ verifyToken, appSecret, automation, databaseCheck, log = console.log }) {
  if (!verifyToken || !appSecret) throw new Error('Defina WHATSAPP_VERIFY_TOKEN e META_APP_SECRET');
  return createServer(async (req, res) => {
    const send = (code, text, type = 'text/plain; charset=utf-8') => { res.writeHead(code, {'Content-Type':type,'Cache-Control':'no-store'}); res.end(text); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && ['/', '/health'].includes(url.pathname)) {
        let db='not_configured';try{if(databaseCheck){await databaseCheck();db='ok';}}catch{db='unavailable';}
        return send(db==='unavailable'?503:200, JSON.stringify({service:'40Hz Connect',status:db==='unavailable'?'degraded':'ok',phase:3,database:db}), 'application/json');
      }
      if (url.pathname !== '/webhook') return send(404,'Not found');
      if (req.method === 'GET') {
        const challenge = url.searchParams.get('hub.challenge');
        if (url.searchParams.get('hub.mode') === 'subscribe' && challenge !== null && equal(url.searchParams.get('hub.verify_token') ?? '',verifyToken)) {
          log(JSON.stringify({event:'webhook_verified'}));
          return send(200,challenge);
        }
        return send(403,'Forbidden');
      }
      if (req.method !== 'POST') return send(405,'Method not allowed');
      const chunks=[]; let size=0;
      for await (const chunk of req) { size+=chunk.length; if(size>1024*1024) { send(413,'Payload too large'); return; } chunks.push(chunk); }
      const raw=Buffer.concat(chunks);
      const expected='sha256='+createHmac('sha256',appSecret).update(raw).digest('hex');
      if (!equal(req.headers['x-hub-signature-256'] ?? '',expected)) return send(401,'Invalid signature');
      let body; try { body=JSON.parse(raw.toString('utf8')); } catch { return send(400,'Invalid JSON'); }
      if (body?.object !== 'whatsapp_business_account') return send(200,'OK');
      for (const entry of Array.isArray(body.entry)?body.entry:[]) {
        for (const change of Array.isArray(entry?.changes)?entry.changes:[]) {
          if (change?.field !== 'messages') continue;
          const value=change.value;
          for(const status of Array.isArray(value?.statuses)?value.statuses:[]) {
            const allowed=['sent','delivered','read','failed','deleted','warning'];
            log(JSON.stringify({event:'message_status',status:allowed.includes(status?.status)?status.status:'unknown',messageIdSuffix:maskId(status?.id),errorCodes:(Array.isArray(status?.errors)?status.errors:[]).map(x=>safeCode(x?.code)).filter(x=>x!==undefined)}));
          }
          for(const msg of Array.isArray(value?.messages)?value.messages:[]) {
            log(JSON.stringify({event:'incoming_message',messageIdSuffix:maskId(msg?.id)}));
            await automation?.enqueue(entry?.id,value?.metadata,msg);
          }
          if (!value?.statuses?.length && !value?.messages?.length) log(JSON.stringify({event:'messages_webhook_received'}));
        }
      }
      return send(200,'OK');
    } catch { log(JSON.stringify({event:'request_error'})); if(!res.headersSent) send(500,'Internal error'); else res.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env=process.env;
  const port=Number(env.PORT||8080),enabled=env.WHATSAPP_AUTOMATION_ENABLED==='true';
  async function start(){
    if(!env.DATABASE_URL)throw new Error('DATABASE_URL required');
    const {Pool}=await import('pg');
    const pool=new Pool({connectionString:env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:5000});
    pool.on('error',()=>console.error(JSON.stringify({event:'database_pool_error'})));
    await migrate(pool);console.log(JSON.stringify({event:'database_migrated',phase:3}));
    let automation;
    if(enabled){
      const phoneId=env.WHATSAPP_PHONE_NUMBER_ID,wabaId=env.WHATSAPP_BUSINESS_ACCOUNT_ID;
      await registerTest(pool,{phoneId,wabaId});
      automation=createPersistentAutomation({pool,phoneId,wabaId,testRecipients:(env.WHATSAPP_TEST_RECIPIENTS??'').split(',').map(s=>s.trim()).filter(Boolean),secret:env.META_APP_SECRET,send:createMetaSender({token:env.WHATSAPP_ACCESS_TOKEN,version:env.META_GRAPH_API_VERSION||'v25.0'}),tz:env.TZ||'America/Sao_Paulo'});
    }
    const server=createApp({verifyToken:env.WHATSAPP_VERIFY_TOKEN,appSecret:env.META_APP_SECRET,automation,databaseCheck:()=>pool.query('SELECT 1')});
    const timer=automation?setInterval(()=>void automation.tick(),1000):undefined;
    server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_started',port,automationEnabled:enabled,phase:3})));
    const stop=()=>{clearInterval(timer);server.close(()=>{void pool.end().finally(()=>process.exit(0));});};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }
  start().catch(()=>{console.error(JSON.stringify({event:'startup_failed',hint:'Check DATABASE_URL, pg installation, Meta variables and database permissions'}));process.exit(1);});
}
