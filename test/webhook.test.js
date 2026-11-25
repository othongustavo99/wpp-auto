import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createApp} from '../src/server.js';
test('health, verification, signature and status logging',async()=>{
 const logs=[]; const server=createApp({verifyToken:'token-local',appSecret:'secret-local',log:x=>logs.push(JSON.parse(x))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  assert.equal((await fetch(base+'/health')).status,200);
  const good=await fetch(base+'/webhook?hub.mode=subscribe&hub.verify_token=token-local&hub.challenge=123');
  assert.equal(good.status,200); assert.equal(await good.text(),'123');
  assert.equal((await fetch(base+'/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123')).status,403);
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{statuses:[{id:'wamid.1234567890',status:'failed',recipient_id:'private-number',errors:[{code:131026}]}],messages:[{id:'wamid.1234567891',text:{body:'private-text'}}]}}]}]});
  const headers={'content-type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256','secret-local').update(body).digest('hex')};
  assert.equal((await fetch(base+'/webhook',{method:'POST',body})).status,401);
  assert.equal((await fetch(base+'/webhook',{method:'POST',headers,body})).status,200);
  assert.equal(logs.find(x=>x.event==='message_status').errorCodes[0],131026);
  assert.ok(logs.some(x=>x.event==='incoming_message'));
  assert.ok(!JSON.stringify(logs).includes('private-'));
 } finally {await new Promise(resolve=>server.close(resolve));}
});
