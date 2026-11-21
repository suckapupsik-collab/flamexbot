import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLiveBusiness, loadBusinessStatuses, grantedRights } from '../src/features/status.js';

test('live Business status comes from Telegram edge function', async()=>{
 let called=false;
 const sb={functions:{invoke:async(name,{body})=>{called=name==='flamexbot-business-status'&&body.profile_id==='p1';return {data:{connected:true,rights:{can_reply:true}},error:null};}}};
 const r=await checkLiveBusiness(sb,'p1');
 assert.equal(called,true);assert.equal(r.live,true);assert.equal(r.connected,true);
 assert.deepEqual(grantedRights(r.rights),['can_reply']);
});
test('cached Business status is marked stale when live check fails',async()=>{
 const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{is_enabled:true,rights:{can_reply:true}},error:null})};
 const sb={functions:{invoke:async()=>({data:null,error:{message:'timeout'}})},from:()=>query};
 const r=await checkLiveBusiness(sb,'p1');
 assert.equal(r.ok,false);assert.equal(r.cached,true);assert.equal(r.connected,true);
});
test('admin Business status uses protected RPC',async()=>{
 let called=false;
 const sb={rpc:async(name,args)=>{called=name==='admin_get_flamexbot_business_status'&&args.p_user_ids[0]==='p1';return {data:[{profile_id:'p1',is_enabled:true}],error:null};}};
 const map=await loadBusinessStatuses(sb,[{id:'p1'},{id:'p2'}]);
 assert.equal(called,true);assert.equal(map.get('p1').is_enabled,true);assert.equal(map.has('p2'),false);
});
