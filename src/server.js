import { createServer } from 'node:http';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const equal = (a,b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const safeCode = v => typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined;
const maskId = v => typeof v === 'string' && v.length > 8 ? v.slice(-8) : undefined;
export function createApp({ verifyToken, appSecret, log = console.log }) {
  if (!verifyToken || !appSecret) throw new Error('Defina WHATSAPP_VERIFY_TOKEN e META_APP_SECRET');
  return createServer(async (req, res) => {
    const send = (code, text, type = 'text/plain; charset=utf-8') => { res.writeHead(code, {'Content-Type':type,'Cache-Control':'no-store'}); res.end(text); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && ['/', '/health'].includes(url.pathname)) return send(200, JSON.stringify({service:'40Hz Connect',status:'ok',phase:1}), 'application/json');
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
          }
          if (!value?.statuses?.length && !value?.messages?.length) log(JSON.stringify({event:'messages_webhook_received'}));
        }
      }
      return send(200,'OK');
    } catch { log(JSON.stringify({event:'request_error'})); if(!res.headersSent) send(500,'Internal error'); else res.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT || 3000);
  createApp({verifyToken:process.env.WHATSAPP_VERIFY_TOKEN,appSecret:process.env.META_APP_SECRET}).listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_started',port})));
}
