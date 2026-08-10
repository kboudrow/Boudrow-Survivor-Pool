import { createClient } from '@supabase/supabase-js'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if(!url||!anonKey||!serviceKey||process.env.ALLOW_TEST_POOL_MUTATIONS!=='true') throw new Error('Missing test environment or mutation opt-in.')
const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const emails=['survivesunday1@gmail.com','taylor@swift.com','serena@williams.com']
const clients={}; const ids={}; const pools=[]
const assert=(ok,message)=>{if(!ok)throw new Error(message)}
const rpc=async(client,name,args={})=>{const r=await client.rpc(name,args);if(r.error)throw new Error(`${name}: ${r.error.message}`);return r.data}
const reject=async(action,pattern)=>{let message='';try{await action()}catch(e){message=e.message}assert(pattern.test(message),`Expected rejection, got: ${message||'none'}`);return message}

for(const email of emails){
  const link=await service.auth.admin.generateLink({type:'magiclink',email});if(link.error)throw link.error
  const client=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const verified=await client.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'magiclink'});if(verified.error)throw verified.error
  clients[email]=client;ids[email]=verified.data.user.id
}

async function pool(name,{start=1,playoffs=false}={}){
  const inserted=await service.from('pools').insert({name,created_by:ids[emails[0]],is_public:true,visibility:'public',allow_discovery:false,
    start_week:start,include_playoffs:playoffs,strikes_allowed:'0',tie_rule:'loss',ties:'loss',deadline_mode:'rolling',deadline_fixed:'13:00',
    season:2026,double_pick_weeks:[],max_members:20,allow_multiple_entries:true,max_entries_per_user:2,
    activation_status:'active',payment_status:'not_required',test_mode:false}).select('id').single()
  if(inserted.error)throw inserted.error; pools.push(inserted.data.id)
  const members=await service.from('pool_members').insert([
    {pool_id:inserted.data.id,profile_id:ids[emails[0]],role:'admin',status:'alive',entry_number:1},
    {pool_id:inserted.data.id,profile_id:ids[emails[0]],role:'admin',status:'alive',entry_number:2},
    {pool_id:inserted.data.id,profile_id:ids[emails[1]],role:'member',status:'alive',entry_number:1},
    {pool_id:inserted.data.id,profile_id:ids[emails[2]],role:'member',status:'alive',entry_number:1},
  ]);if(members.error)throw members.error
  await rpc(clients[emails[0]],'superadmin_set_pool_test_mode',{p_pool_id:inserted.data.id,p_enabled:true})
  return inserted.data.id
}
const entries=async id=>rpc(clients[emails[0]],'superadmin_pool_entries',{p_pool_id:id})
const games=async(id,week)=>rpc(clients[emails[0]],'superadmin_test_pool_week_options',{p_pool_id:id,p_week:week})
const save=(client,id,entry,week,team)=>rpc(client,'save_entry_draft_pick',{p_pool_id:id,p_entry_id:entry,p_week:week,p_slot:1,p_team_abbr:team})
const clock=(id,week,stage)=>rpc(clients[emails[0]],'superadmin_set_test_pool_clock',{p_pool_id:id,p_week:week,p_stage:stage})
const setOutcome=(id,week,game,outcome)=>rpc(clients[emails[0]],'superadmin_set_test_game_outcome',{
  p_pool_id:id,p_week:week,p_away_team:game.away_team,p_home_team:game.home_team,p_outcome:outcome})

try{
  const wipeout=await pool(`Logic Audit Wipeout ${Date.now()}`)
  let roster=await entries(wipeout)
  const owner=roster.filter(r=>r.email===emails[0]);const taylor=roster.find(r=>r.email===emails[1]);const serena=roster.find(r=>r.email===emails[2])
  const actors=[{entry:owner[0],client:clients[emails[0]]},{entry:owner[1],client:clients[emails[0]]},{entry:taylor,client:clients[emails[1]]},{entry:serena,client:clients[emails[2]]}]
  const used=new Map(actors.map(a=>[a.entry.entry_id,new Set()]))

  await clock(wipeout,1,'before_week');let opts=await games(wipeout,1)
  for(let i=0;i<actors.length;i++){const team=opts[i].home_team;used.get(actors[i].entry.entry_id).add(team);await save(actors[i].client,wipeout,actors[i].entry.entry_id,1,team)}
  await clock(wipeout,1,'week_done');for(let i=0;i<actors.length;i++)await setOutcome(wipeout,1,opts[i],'away')
  await rpc(clients[emails[0]],'superadmin_score_test_pool_week',{p_pool_id:wipeout,p_week:1})
  roster=await entries(wipeout)
  assert(roster.every(r=>!r.eliminated&&r.losses===1),'Mass elimination did not preserve every losing entry with its loss.')
  const grace=await service.from('pool_entry_survival_graces').select('entry_id,week,strike_credits').eq('pool_id',wipeout)
  assert(!grace.error&&grace.data.length===4&&grace.data.every(g=>g.week===1&&g.strike_credits===1),'Persistent wipeout grace was not recorded correctly.')

  await clock(wipeout,2,'before_week');opts=await games(wipeout,2)
  for(let i=0;i<actors.length;i++){
    const game=opts.find((g,index)=>index>=i&&!used.get(actors[i].entry.entry_id).has(g.home_team))
    actors[i].game=game;used.get(actors[i].entry.entry_id).add(game.home_team)
    await save(actors[i].client,wipeout,actors[i].entry.entry_id,2,game.home_team)
  }
  await clock(wipeout,2,'week_done')
  for(let i=0;i<actors.length;i++)await setOutcome(wipeout,2,actors[i].game,i<2?'home':'away')
  await rpc(clients[emails[0]],'superadmin_score_test_pool_week',{p_pool_id:wipeout,p_week:2})
  let winner=await rpc(clients[emails[0]],'pool_winner_status',{p_pool_id:wipeout})
  assert(winner[0].alive_entries===2&&winner[0].alive_members===1&&!winner[0].is_decided,'Two entries owned by one user were incorrectly collapsed into one survivor.')

  await clock(wipeout,3,'before_week');opts=await games(wipeout,3)
  for(let i=0;i<2;i++){
    const game=opts.find((g,index)=>index>=i&&!used.get(actors[i].entry.entry_id).has(g.home_team));actors[i].game=game
    await save(actors[i].client,wipeout,actors[i].entry.entry_id,3,game.home_team)
  }
  await clock(wipeout,3,'week_done');await setOutcome(wipeout,3,actors[0].game,'away');await setOutcome(wipeout,3,actors[1].game,'home')
  await rpc(clients[emails[0]],'superadmin_score_test_pool_week',{p_pool_id:wipeout,p_week:3})
  winner=await rpc(clients[emails[0]],'pool_winner_status',{p_pool_id:wipeout})
  assert(winner[0].is_decided&&winner[0].alive_entries===1&&/Entry 2/.test(winner[0].winner_name),'Entry-based winner was not declared or labeled correctly.')

  const postseason=await pool(`Logic Audit Postseason ${Date.now()}`,{start:18,playoffs:true})
  const postEntry=(await entries(postseason)).find(r=>r.email===emails[0]&&r.entry_number===1)
  await clock(postseason,18,'before_week');const w18=await games(postseason,18);const w19=await games(postseason,19);const w20=await games(postseason,20)
  const teamsFor=x=>new Set(x.flatMap(g=>[g.home_team,g.away_team]))
  const overlap=[...teamsFor(w18)].find(team=>teamsFor(w19).has(team));assert(overlap,'No regular/postseason overlap found.')
  await rpc(clients[emails[0]],'admin_override_entry_final_pick',{p_pool_id:postseason,p_entry_id:postEntry.entry_id,p_week:18,p_slot:1,p_team_abbr:overlap,p_reason:'phase reset test'})
  await clock(postseason,19,'before_week');await save(clients[emails[0]],postseason,postEntry.entry_id,19,overlap)
  const postseasonRepeat=[...teamsFor(w19)].find(team=>teamsFor(w20).has(team));assert(postseasonRepeat,'No repeatable postseason team found.')
  if(postseasonRepeat!==overlap)await save(clients[emails[0]],postseason,postEntry.entry_id,19,postseasonRepeat)
  await clock(postseason,20,'before_week')
  const duplicateMessage=await reject(()=>save(clients[emails[0]],postseason,postEntry.entry_id,20,postseasonRepeat),/already used.*postseason/i)

  const wipeoutIntegrity=await rpc(clients[emails[0]],'admin_pool_scoring_integrity',{p_pool_id:wipeout})
  const postseasonIntegrity=await rpc(clients[emails[0]],'admin_pool_scoring_integrity',{p_pool_id:postseason})
  assert(wipeoutIntegrity.every(row=>row.issue_count===0),`Grace-aware integrity failed: ${JSON.stringify(wipeoutIntegrity)}`)
  assert(postseasonIntegrity.every(row=>row.issue_count===0),`Postseason integrity failed: ${JSON.stringify(postseasonIntegrity)}`)

  console.log(JSON.stringify({massElimination:'all entries advanced; losses and teams retained',graceRows:grace.data.length,
    multiEntryWinner:'two entries remained separate competitors; Entry 2 won only after Entry 1 lost',
    playoffReuse:'regular-season team accepted again in Week 19',postseasonDuplicate:duplicateMessage,
    integrity:'both clarified-rule pools passed every commissioner check',pools},null,2))
}finally{
  if(pools.length)await service.from('pools').update({archived:true,archived_at:new Date().toISOString()}).in('id',pools)
}
