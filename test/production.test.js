import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCommercial,preflight,configureCommercial} from '../src/production.js';
import {createPersistentAutomation} from '../src/persistence.js';
const recipient='5511999990000',now=Date.now();
const env={FORP_PRODUCTION_ENABLED:'true',FORP_01_MODE:'pilot',FORP_01_PHONE_ID:'321',FORP_01_WABA_ID:'654',FORP_01_ACCESS_TOKEN:'test-secret-token',FORP_01_PILOT_RECIPIENTS:recipient,META_APP_ID:'789',META_APP_SECRET:'local-test',WHATSAPP_PHONE_NUMBER_ID:'123'};
const good=async url=>new Response(JSON.stringify(url.includes('/phone_numbers')?{data:[{id:'321'}]}:url.includes('/subscribed_apps')?{data:[{whatsapp_business_api_data:{id:'789'}}]}:{id:'321',display_phone_number:'+55 11 91462-2444',is_on_biz_app:true,platform_type:'CLOUD_API'}));
test('commercial defaults off; explicit pilot, unique IDs, recipient restriction',()=>{
 assert.deepEqual(readCommercial({...env,FORP_PRODUCTION_ENABLED:'false'}),[]);
 assert.equal(readCommercial(env)[0].id,'forp_01');
 assert.throws(()=>readCommercial({...env,FORP_01_PILOT_RECIPIENTS:''}));
 assert.throws(()=>readCommercial({...env,FORP_01_PHONE_ID:'123'}));
 assert.throws(()=>readCommercial({...env,FORP_01_MODE:'oops'}));
 assert.equal(readCommercial({...env,FORP_01_MODE:'live',FORP_01_PILOT_RECIPIENTS:''})[0].mode,'live');
});
test('preflight checks exact phone number, WABA and app subscription',async()=>{
 const line=readCommercial(env)[0];assert.equal(await preflight(line,{appId:'789',fetchImpl:good}),true);
 assert.equal(await preflight(line,{appId:'789',fetchImpl:async url=>url.includes('?fields=id,display_phone_number')?new Response(JSON.stringify({id:'321',display_phone_number:'+55 11 91462-2444',is_on_biz_app:false,platform_type:'CLOUD_API'})):good(url)}),false);
 assert.equal(await preflight({...line,expected:'5511999903346'},{appId:'789',fetchImpl:good}),false);
 assert.equal(await preflight(line,{appId:'111',fetchImpl:good}),false);
 assert.equal(await preflight(line,{appId:'789',fetchImpl:async()=>new Response('{}',{status:401})}),false);
});
test('failed preflight blocks activation; success registers only expected line',async()=>{
 const calls=[],pool={connect:async()=>({query:async(sql,args)=>{calls.push([sql,args]);return {rowCount:1,rows:[]}},release(){}})};
 let c=await configureCommercial({pool,env,fetchImpl:async()=>new Response('{}',{status:401}),log:()=>{}});assert.equal(c.states.forp_01,'blocked');assert.equal(c.workers.length,0);assert.ok(!calls.some(([s])=>s.includes('SET enabled=true')));
 c=await configureCommercial({pool,env,fetchImpl:good,log:()=>{}});assert.equal(c.states.forp_01,'pilot');assert.equal(c.states.forp_02,'off');assert.equal(c.workers.length,1);assert.ok(calls.some(([s,a])=>s.includes('SET enabled=true')&&a[0]==='forp_01'&&a[3]==='5511914622444'));assert.ok(!JSON.stringify(calls).includes(env.FORP_01_ACCESS_TOKEN));
});
test('commercial pilot and live filter exact line, time, mode and data',async()=>{
 const calls=[],pool={query:async(...args)=>{calls.push(args);return {rowCount:1}}};
 const opts={pool,phoneId:'321',wabaId:'654',testRecipients:[recipient],secret:'test',now:()=>now,send:async()=>'',log:()=>{},testProfile:'forp_01',commercialProfile:'forp_01',runtimeKey:'key',activatedAt:now-3000};
 const m={id:'wamid.pilot',timestamp:String(Math.floor(now/1000)),from:recipient,type:'text',text:{body:'medical private'}};
 const a=createPersistentAutomation(opts);assert.equal(await a.enqueue('654',{phone_number_id:'123'},m),false);assert.equal(await a.enqueue('654',{phone_number_id:'321'},{...m,from:'5511111111111'}),false);assert.equal(await a.enqueue('654',{phone_number_id:'321'},{...m,timestamp:String(Math.floor(now/1000)-10)}),false);assert.equal(await a.enqueue('654',{phone_number_id:'321'},m),true);assert.deepEqual(calls[0][1].slice(7),[false,'forp_01','key']);assert.ok(!JSON.stringify(calls).includes('medical private'));
 const live=createPersistentAutomation({...opts,mode:'live',testRecipients:[]});assert.equal(await live.enqueue('654',{phone_number_id:'321'},{...m,from:'5511111111111'}),true);
});
test('commercial worker sends only from its own line and selected profile',async()=>{
 const sent=[],queries=[];const c={query:async(sql,args)=>{queries.push([sql,args]);if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};if(sql.includes('RETURNING e.*'))return {rows:[{number_id:'forp_03',message_hash:'m',contact_hash:'c',recipient,intent:{type:'text',text:{body:''},testProfile:'forp_03'},occurred_at:new Date(now)}]};if(sql.includes('FROM connect_profiles'))return {rows:[{branch_ids:['joanopolis'],settings:{}}]};return {rows:[]};},release(){}};
 const a=createPersistentAutomation({pool:{connect:async()=>c},phoneId:'333',wabaId:'666',testRecipients:[recipient],secret:'test',now:()=>now,send:async(...args)=>{sent.push(args);return 'wamid.commercial'},log:()=>{},testProfile:'forp_03',commercialProfile:'forp_03',runtimeKey:'key'});
 await a.tick();assert.equal(sent.length,1);assert.equal(sent[0][0],'333');assert.match(sent[0][2].text.body,/Joanópolis/);assert.deepEqual(queries.find(([q])=>q.includes('RETURNING e.*'))[1],['333','666',false,'forp_03','key']);
});
