import { createClient } from '@supabase/supabase-js'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if(!url||!anonKey||!serviceKey||process.env.ALLOW_TEST_POOL_MUTATIONS!=='true')throw new Error('Missing environment or mutation approval flag.')
const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});const anon=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
const emails=['survivesunday1@gmail.com','taylor@swift.com','serena@williams.com'];const clients={};const ids={};const poolIds=[];const passed=[]
const assert=(ok,msg)=>{if(!ok)throw new Error(msg)}
const rpc=async(c,n,a={})=>{const r=await c.rpc(n,a);if(r.error)throw new Error(`${n}: ${r.error.message}`);return r.data}
const reject=async(label,fn,re)=>{let m='';try{await fn()}catch(e){m=e.message}assert(m&&re.test(m),`${label}: expected ${re}, received ${m||'success'}`);passed.push(label);return m}
async function auth(email){const l=await service.auth.admin.generateLink({type:'magiclink',email});if(l.error)throw l.error;const c=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});const v=await c.auth.verifyOtp({token_hash:l.data.properties.hashed_token,type:'magiclink'});if(v.error)throw v.error;return {client:c,id:v.data.user.id}}
for(const email of emails){const a=await auth(email);clients[email]=a.client;ids[email]=a.id}
const secondTaylor=(await auth(emails[1])).client

async function createPool(name){
  const r=await service.from('pools').insert({name,created_by:ids[emails[0]],is_public:true,visibility:'public',allow_discovery:false,start_week:1,
    include_playoffs:false,strikes_allowed:'0',tie_rule:'loss',ties:'loss',deadline_mode:'rolling',deadline_fixed:'13:00',season:2026,
    double_pick_weeks:[1],max_members:20,allow_multiple_entries:true,max_entries_per_user:2,activation_status:'active',payment_status:'not_required',test_mode:false}).select('id').single()
  if(r.error)throw r.error;poolIds.push(r.data.id)
  const m=await service.from('pool_members').insert({pool_id:r.data.id,profile_id:ids[emails[0]],role:'admin',status:'alive',entry_number:1}).select('id').single()
  if(m.error)throw m.error;return {poolId:r.data.id,ownerEntry:m.data.id}
}

try{
  const {poolId,ownerEntry}=await createPool(`Adversarial QA ${Date.now()}`);const password='Correct Horse Battery Staple'
  await rpc(clients[emails[0]],'admin_update_pool_visibility',{p_pool_id:poolId,p_is_public:false,p_password:password})

  const anonPrivate=await anon.from('pools').select('id,name').eq('id',poolId);assert(!anonPrivate.error&&anonPrivate.data.length===0,'Anonymous client could read a private pool row.');passed.push('private pool hidden by RLS')
  const guessed=await anon.from('pools').select('id').eq('id','11111111-1111-4111-8111-111111111111');assert(!guessed.error&&guessed.data.length===0,'Random pool UUID exposed data.');passed.push('random pool ID manipulation')
  await reject('private pool wrong password',()=>rpc(clients[emails[1]],'join_pool',{p_pool_id:poolId,p_password:'wrong',p_token:null}),/incorrect.*password/i)
  let membership=await service.from('pool_members').select('id').eq('pool_id',poolId).eq('profile_id',ids[emails[1]]);assert(membership.data.length===0,'Wrong password created membership.')
  await reject('overlong bcrypt password rejected',()=>rpc(clients[emails[1]],'join_pool',{p_pool_id:poolId,p_password:'x'.repeat(73),p_token:null}),/72 bytes/i)

  const joins=await Promise.allSettled([
    rpc(clients[emails[1]],'join_pool',{p_pool_id:poolId,p_password:password,p_token:null}),
    rpc(secondTaylor,'join_pool',{p_pool_id:poolId,p_password:password,p_token:null}),
  ]);assert(joins.every(x=>x.status==='fulfilled'),'Concurrent idempotent joins did not both finish safely.')
  membership=await service.from('pool_members').select('id,entry_number').eq('pool_id',poolId).eq('profile_id',ids[emails[1]]);assert(membership.data.length===1,'Concurrent joins created duplicate membership.');passed.push('concurrent duplicate join')

  const adds=await Promise.allSettled([
    rpc(clients[emails[1]],'add_pool_entry',{p_pool_id:poolId}),rpc(secondTaylor,'add_pool_entry',{p_pool_id:poolId}),
  ]);assert(adds.filter(x=>x.status==='fulfilled').length===1&&adds.filter(x=>x.status==='rejected').length===1,'Concurrent entry limit was not serialized.')
  membership=await service.from('pool_members').select('id,entry_number').eq('pool_id',poolId).eq('profile_id',ids[emails[1]]).order('entry_number');assert(membership.data.length===2,'Entry count exceeded or missed configured maximum.');passed.push('concurrent duplicate entries and maximum')
  await reject('entry limit direct replay',()=>rpc(clients[emails[1]],'add_pool_entry',{p_pool_id:poolId}),/entry limit/i)
  await rpc(clients[emails[0]],'join_pool',{p_pool_id:poolId,p_password:null,p_token:null})
  await rpc(clients[emails[2]],'join_pool',{p_pool_id:poolId,p_password:password,p_token:null})

  await reject('normal member commissioner RPC',()=>rpc(clients[emails[1]],'admin_update_pool_member_limit',{p_pool_id:poolId,p_max_members:30}),/authorized/i)
  await reject('normal member commissioner overview',()=>rpc(clients[emails[1]],'admin_pool_entry_week_overview',{p_pool_id:poolId,p_week:1}),/authorized/i)

  const removed=await rpc(clients[emails[0]],'admin_remove_pool_member',{p_pool_id:poolId,p_profile_id:ids[emails[1]]});assert(removed===2,'Admin removal did not remove both test entries.')
  const removedPool=await clients[emails[1]].from('pools').select('id').eq('id',poolId);assert(!removedPool.error&&removedPool.data.length===0,'Removed member retained private pool access.')
  const removedMembers=await clients[emails[1]].from('pool_members').select('id').eq('pool_id',poolId);assert(!removedMembers.error&&removedMembers.data.length===0,'Removed member retained roster access.');passed.push('access revoked after removal')
  await rpc(clients[emails[1]],'join_pool',{p_pool_id:poolId,p_password:password,p_token:null})

  const sensitive=await clients[emails[1]].from('pools').select('join_password_hash,stripe_checkout_session_id').eq('id',poolId)
  assert(sensitive.error,'Browser role could select password/payment secrets.');passed.push('pool secrets denied at column privilege')
  const safePool=await clients[emails[1]].from('pools').select('id,name,deadline_mode').eq('id',poolId).single();assert(!safePool.error&&safePool.data.id===poolId,'Safe pool fields became unreadable.')

  await reject('direct pool table mutation',async()=>{const r=await clients[emails[1]].from('pools').update({name:'pwned'}).eq('id',poolId);if(r.error)throw r.error},/permission|denied/i)
  await reject('direct member table mutation',async()=>{const r=await clients[emails[1]].from('pool_members').insert({pool_id:poolId,profile_id:ids[emails[1]],entry_number:9});if(r.error)throw r.error},/permission|denied/i)
  await reject('direct final pick mutation',async()=>{const r=await clients[emails[1]].from('pool_picks').insert({pool_id:poolId,user_id:ids[emails[1]],entry_id:membership.data[0]?.id||ownerEntry,week:1,slot:1,team_abbr:'BUF',locked_at:new Date().toISOString()});if(r.error)throw r.error},/permission|denied/i)

  const baseCreate={p_name:'Attack Pool',p_is_public:true,p_password:null,p_start_week:1,p_include_playoffs:false,p_strikes_allowed:'0',p_tie_rule:'loss',p_deadline_mode:'fixed',p_deadline_fixed:'13:00',p_notes:null,p_image_url:null,p_season:2026,p_double_pick_weeks:[],p_max_members:25,p_allow_multiple_entries:false,p_max_entries_per_user:1}
  await reject('malformed strikes direct RPC',()=>rpc(clients[emails[0]],'create_pool_with_owner',{...baseCreate,p_strikes_allowed:'not-a-number'}),/strikes allowed/i)
  await reject('negative strikes direct RPC',()=>rpc(clients[emails[0]],'create_pool_with_owner',{...baseCreate,p_strikes_allowed:'-1'}),/strikes allowed/i)
  await reject('invalid fixed deadline direct RPC',()=>rpc(clients[emails[0]],'create_pool_with_owner',{...baseCreate,p_deadline_fixed:'99:99'}),/valid 24-hour/i)
  await reject('extremely long pool name',()=>rpc(clients[emails[0]],'create_pool_with_owner',{...baseCreate,p_name:'x'.repeat(101)}),/100 characters/i)
  await reject('extremely long notes',()=>rpc(clients[emails[0]],'create_pool_with_owner',{...baseCreate,p_notes:'x'.repeat(2001)}),/2,000/i)
  await reject('unexpected season',()=>rpc(clients[emails[0]],'create_pool_with_owner',{...baseCreate,p_season:999999}),/season is invalid/i)
  const invalidService=await service.from('pools').insert({...safePool.data,id:undefined,name:'Bad Settings',created_by:ids[emails[0]],strikes_allowed:'NaN',season:2026,is_public:true,start_week:1,include_playoffs:false,visibility:'public',allow_discovery:false,activation_status:'active',payment_status:'not_required',max_members:20,allow_multiple_entries:false,max_entries_per_user:1,double_pick_weeks:[]})
  assert(invalidService.error,'Table trigger accepted invalid service-side scoring settings.');passed.push('table trigger rejects malformed pool settings')

  await rpc(clients[emails[0]],'superadmin_set_pool_test_mode',{p_pool_id:poolId,p_enabled:true})
  await rpc(clients[emails[0]],'superadmin_set_test_pool_clock',{p_pool_id:poolId,p_week:1,p_stage:'before_week'})
  const roster=await rpc(clients[emails[0]],'superadmin_pool_entries',{p_pool_id:poolId});const taylor=roster.find(r=>r.email===emails[1]);const serena=roster.find(r=>r.email===emails[2]);const options=await rpc(clients[emails[0]],'superadmin_test_pool_week_options',{p_pool_id:poolId,p_week:1})
  const save=(c,entry,week,slot,team)=>rpc(c,'save_entry_draft_pick',{p_pool_id:poolId,p_entry_id:entry,p_week:week,p_slot:slot,p_team_abbr:team})
  await reject('modify another user entry',()=>save(clients[emails[1]],ownerEntry,1,1,options[0].home_team),/does not belong/i)
  await reject('empty pick',()=>save(clients[emails[1]],taylor.entry_id,1,1,'   '),/choose a team/i)
  await reject('extremely long team',()=>save(clients[emails[1]],taylor.entry_id,1,1,'X'.repeat(5000)),/not scheduled/i)
  await reject('negative week',()=>save(clients[emails[1]],taylor.entry_id,-1,1,options[0].home_team),/starts|outside/i)
  await reject('week above season',()=>save(clients[emails[1]],taylor.entry_id,23,1,options[0].home_team),/after week|allows|playable/i)
  await reject('slot zero',()=>save(clients[emails[1]],taylor.entry_id,1,0,options[0].home_team),/slot|pick/i)
  await reject('slot above double week',()=>save(clients[emails[1]],taylor.entry_id,1,3,options[0].home_team),/slot|pick/i)
  await reject('random entry UUID',()=>save(clients[emails[1]],'11111111-1111-4111-8111-111111111111',1,1,options[0].home_team),/entry not found/i)

  const repeated=await Promise.allSettled(Array.from({length:12},()=>save(Math.random()<0.5?clients[emails[1]]:secondTaylor,taylor.entry_id,1,1,options[0].home_team)))
  assert(repeated.every(x=>x.status==='fulfilled'),'Repeated identical multi-session pick requests were not idempotent.')
  let drafts=await service.from('pool_pick_drafts').select('team_abbr').eq('pool_id',poolId).eq('entry_id',taylor.entry_id).eq('week',1).eq('slot',1);assert(drafts.data.length===1,'Repeated pick requests created duplicate draft rows.');passed.push('repeated pick and two-session replay')
  const changes=await Promise.allSettled(options.slice(1,7).map(g=>save(Math.random()<0.5?clients[emails[1]]:secondTaylor,taylor.entry_id,1,1,g.home_team)))
  assert(changes.every(x=>x.status==='fulfilled'),'Rapid valid pick changes failed rather than serializing.')
  drafts=await service.from('pool_pick_drafts').select('team_abbr').eq('pool_id',poolId).eq('entry_id',taylor.entry_id).eq('week',1).eq('slot',1);assert(drafts.data.length===1,'Rapid changes created multiple rows.');passed.push('rapid pick changes last-write serialization')
  const currentTeam=drafts.data[0].team_abbr
  await reject('same team twice in double week',()=>save(clients[emails[1]],taylor.entry_id,1,2,currentTeam),/already used|different team/i)

  await save(clients[emails[2]],serena.entry_id,1,1,options[0].home_team)
  await rpc(clients[emails[0]],'superadmin_set_test_pool_clock',{p_pool_id:poolId,p_week:1,p_stage:'first_kickoff'})
  await reject('direct RPC after early kickoff',()=>save(clients[emails[2]],serena.entry_id,1,1,options[0].away_team),/locked|deadline/i)
  const later=options.find(g=>new Date(g.game_time)>new Date(options[0].game_time));assert(later,'No later game for rolling deadline test.')
  await save(clients[emails[2]],serena.entry_id,1,2,later.home_team);passed.push('rolling later game remains open after early kickoff')

  await reject('stale settings page after start',()=>rpc(clients[emails[0]],'admin_update_pool_entry_settings',{p_pool_id:poolId,p_allow_multiple_entries:false,p_max_entries_per_user:1}),/cannot be changed after|already started/i)
  await rpc(clients[emails[0]],'superadmin_set_test_pool_clock',{p_pool_id:poolId,p_week:2,p_stage:'before_week'})
  await reject('past week manipulated request',()=>save(clients[emails[2]],serena.entry_id,1,1,options[0].home_team),/already locked|locked/i)
  const serenaUsed=new Set([options[0].home_team,later.home_team])
  const week2=await rpc(clients[emails[0]],'superadmin_test_pool_week_options',{p_pool_id:poolId,p_week:2});const week2Game=week2.find(g=>!serenaUsed.has(g.home_team));assert(week2Game,'No unused Week 2 team.');serenaUsed.add(week2Game.home_team);await save(clients[emails[2]],serena.entry_id,2,1,week2Game.home_team)
  const week3=await rpc(clients[emails[0]],'superadmin_test_pool_week_options',{p_pool_id:poolId,p_week:3});const week3Game=week3.find(g=>!serenaUsed.has(g.home_team));assert(week3Game,'No unused Week 3 team.');await save(clients[emails[2]],serena.entry_id,3,1,week3Game.home_team);passed.push('future week accepted intentionally within season')

  await service.from('pool_member_stats').upsert({pool_id:poolId,user_id:ids[emails[2]],entry_id:serena.entry_id,wins:0,losses:1,pushes:0,strikes_used:1,eliminated:true,eliminated_week:1})
  await service.from('pool_members').update({status:'eliminated',eliminated_week:1}).eq('id',serena.entry_id)
  await reject('eliminated entry direct RPC',()=>save(clients[emails[2]],serena.entry_id,2,1,week2[1].home_team),/eliminated/i)

  const noAuthAdmin=await anon.rpc('admin_pool_entry_week_overview',{p_pool_id:poolId,p_week:1});assert(noAuthAdmin.error,'Anonymous commissioner RPC unexpectedly succeeded.');passed.push('unauthenticated commissioner RPC')
  const cronLock=await fetch('https://www.survivesunday.com/api/cron/lock-picks');const cronScore=await fetch('https://www.survivesunday.com/api/cron/sync-scores');assert(cronLock.status===401&&cronScore.status===401,'Cron endpoint accepted missing secret.');passed.push('unauthenticated cron routes')
  const malformedMonitoring=await fetch('https://www.survivesunday.com/api/monitoring/events',{method:'POST',headers:{'content-type':'application/json'},body:'not-json'});assert(malformedMonitoring.status===400,'Malformed monitoring body was accepted.');passed.push('malformed API body')

  await service.from('pools').update({archived:true,archived_at:new Date().toISOString()}).eq('id',poolId)
  await reject('stale page after pool archived',()=>save(clients[emails[1]],taylor.entry_id,2,1,week2[2].home_team),/not accepting picks/i)
  console.log(JSON.stringify({passedCount:passed.length,passed,pools:poolIds},null,2))
}finally{
  if(poolIds.length)await service.from('pools').update({archived:true,archived_at:new Date().toISOString()}).in('id',poolIds)
}
