import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'
import { adminProxy, defaultProxyModels, defaultRelayRoutes, encryptProxyKey, relayModel, proxyCatalog, recoverProxyReservations, validateModels, normalizeRoutes } from './model-relay.js'
import { upstreamOutput } from './gemini-upstream.js'
import { discoverModels, providerRequest, providerOutput, providerResponse } from './relay-providers.js'
let sqlite, env
const user = { id:1,role:'admin' }
function d1(db) {
  return { prepare(sql) { let values=[]; const statement={bind(...args){values=args;return statement},first:async()=>db.prepare(sql).get(...values)||null,all:async()=>({results:db.prepare(sql).all(...values)}),run:async()=>({success:true,meta:db.prepare(sql).run(...values)})};return statement },
    batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}} }
}
function migrate(name) { sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8')) }
beforeEach(async()=>{
  vi.stubGlobal('crypto',webcrypto); sqlite=new DatabaseSync(':memory:')
  sqlite.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,login TEXT,role TEXT);INSERT INTO users VALUES(1,'fixture','fixture','admin'),(2,'another','another','user')")
  migrate('0008_qwen_proxy.sql'); migrate('0009_qwen_protocol.sql')
  sqlite.exec("INSERT INTO qwen_quota_grants(user_id,admin_id,amount) VALUES(1,1,100);UPDATE qwen_proxy_config SET enabled=1,encrypted_key='old-qwen-key',key_iv='old-iv';INSERT INTO qwen_usage(id,user_id,model,purpose,cost) VALUES('old-log',1,'qwen3.8-flash','translation',1);UPDATE qwen_usage SET status='failed' WHERE id='old-log'")
  migrate('0010_community_model_relay.sql')
  migrate('0011_relay_credentials.sql')
  migrate('0012_relay_quota_adjustments.sql')
  migrate('0013_signup_quota.sql')
  migrate('0014_relay_failover.sql')
  env={DB:d1(sqlite),CLIENT_ACCESS_SECRET:'test-only-secret'}
})
afterEach(()=>{sqlite.close();vi.unstubAllGlobals()})
const request=(body={},path='/api/v1/relay',method='POST')=>new Request(`https://nstrans.221129.xyz${path}`,{method,headers:{'content-type':'application/json'},...(method!=='GET'?{body:JSON.stringify({purpose:'translation',prompt:'fixture text',...body})}:{})})
const result=()=>Response.json({responseId:'fixture',candidates:[{finishReason:'STOP',content:{parts:[{text:'{"translations":["你好"]}'}]}}],usageMetadata:{promptTokenCount:123,candidatesTokenCount:9,cachedContentTokenCount:40}})
const quota=()=>sqlite.prepare('SELECT * FROM model_relay_quotas WHERE user_id=1').get()
async function enable() {
  const key=await encryptProxyKey('fixture-google-key',env)
  sqlite.prepare('UPDATE model_relay_config SET enabled=1,encrypted_key=?,key_iv=?,models_json=?').run(key.encrypted_key,key.key_iv,JSON.stringify(defaultProxyModels))
}
describe('Community model relay',()=>{
  it.each(['translation','search','vision'])('fails over %s in priority order, reserving and charging just once',async purpose=>{
    await enable()
    const first='gemini-2.5-flash-lite', second='gemini-2.5-flash'
    const models=defaultProxyModels.map(m=>({...m,[`${purpose}Cost`]:m.id===first?3:9}))
    sqlite.prepare('UPDATE model_relay_config SET routes_json=?,models_json=?').run(JSON.stringify({...defaultRelayRoutes,[purpose]:[first,second]}),JSON.stringify(models))
    const fetcher=vi.fn(async(url,init)=>{
      const payload=JSON.parse(init.body)
      if(purpose==='vision') expect(payload.contents[0].parts[1].inlineData.data).toBe('AAAA')
      if(purpose==='search') expect(payload.tools).toEqual([{google_search:{}}])
      if(fetcher.mock.calls.length===1) return new Response('sensitive upstream body',{status:429})
      return result()
    })
    const response=await relayModel(request({purpose,...(purpose==='vision'?{imageDataUrl:'data:image/png;base64,AAAA'}:{})}),env,user,fetcher)
    expect(response.status).toBe(200);expect((await response.json()).cost).toBe(3)
    expect(fetcher.mock.calls.map(([url])=>url.match(/models\/(.+):/u)[1])).toEqual([first,second])
    expect(quota()).toMatchObject({balance:97,spent:3})
    const logs=sqlite.prepare("SELECT * FROM model_relay_usage WHERE id!='old-log'").all()
    expect(logs).toHaveLength(1);expect(logs[0].model).toBe(second)
    expect(JSON.parse(logs[0].attempts_json)).toMatchObject([{model:first,error:'UPSTREAM_429'},{model:second,status:'success'}])
    expect(JSON.stringify(logs)).not.toContain('sensitive upstream body')
  })
  it('falls back after a timeout or malformed answer and preserves uncertain attempts for audit',async()=>{
    await enable()
    sqlite.prepare('UPDATE model_relay_config SET routes_json=?').run(JSON.stringify({...defaultRelayRoutes,translation:['gemini-2.5-flash-lite','gemini-2.5-flash']}))
    for(const failure of [()=>{throw new DOMException('timeout','TimeoutError')},()=>new Response('not JSON')]) {
      let calls=0
      const response=await relayModel(request(),env,user,async()=>++calls===1?failure():result())
      expect(response.status).toBe(200);expect(calls).toBe(2)
    }
    expect(quota()).toMatchObject({balance:98,spent:2})
    const logs=sqlite.prepare("SELECT attempts_json FROM model_relay_usage WHERE status='success'").all()
    expect(logs.every(log=>JSON.parse(log.attempts_json)[0].status==='uncertain')).toBe(true)
  })
  it('refunds once when every candidate rejects; retains once when any outcome is uncertain',async()=>{
    await enable()
    sqlite.prepare('UPDATE model_relay_config SET routes_json=?').run(JSON.stringify({...defaultRelayRoutes,translation:['gemini-2.5-flash-lite','gemini-2.5-flash']}))
    let calls=0
    expect((await relayModel(request(),env,user,async()=>{calls++;return new Response('',{status:503})})).status).toBe(502)
    expect(calls).toBe(2);expect(quota()).toMatchObject({balance:100,spent:0})
    calls=0
    expect((await relayModel(request(),env,user,async()=>{if(++calls===1)throw new Error('network');return new Response('',{status:401})})).status).toBe(502)
    expect(calls).toBe(2);expect(quota()).toMatchObject({balance:99,spent:1})
  })
  it('does not bypass safety refusals and validates priority lists',async()=>{
    await enable()
    const routes={...defaultRelayRoutes,translation:['gemini-2.5-flash-lite','gemini-2.5-flash']}
    sqlite.prepare('UPDATE model_relay_config SET routes_json=?').run(JSON.stringify(routes))
    const fetcher=vi.fn(async()=>Response.json({candidates:[{finishReason:'SAFETY'}]}))
    expect((await relayModel(request(),env,user,fetcher)).status).toBe(502)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(normalizeRoutes(defaultRelayRoutes).translation).toEqual(['gemini-2.5-flash-lite'])
    expect(()=>normalizeRoutes({translation:['a','a']})).toThrow()
    expect(()=>normalizeRoutes({translation:['a','b','c','d','e','f']})).toThrow()
    const path='/api/admin/relay/config', config={enabled:true,maxConcurrency:2,models:defaultProxyModels,routes}
    expect((await adminProxy(request(config,path,'PATCH'),env,user)).status).toBe(200)
    expect((await(await adminProxy(request({},path,'GET'),env,user)).json()).routes.translation).toEqual(routes.translation)
    expect((await adminProxy(request({...config,routes:{translation:['unknown']}},path,'PATCH'),env,user)).status).toBe(400)
  })
  it('gives new accounts thirty points once, leaving existing balances and repeated logins untouched',async()=>{
    expect(quota().balance).toBe(100)
    expect(sqlite.prepare('SELECT * FROM model_relay_quotas WHERE user_id=2').get()).toBeUndefined()
    sqlite.exec("INSERT INTO users VALUES(3,'new-native','native','user'),(4,'new-github','github','user')")
    for (const id of [3,4]) {
      expect(sqlite.prepare('SELECT balance,granted,spent FROM model_relay_quotas WHERE user_id=?').get(id)).toMatchObject({balance:30,granted:30,spent:0})
      expect(sqlite.prepare('SELECT amount FROM model_relay_signup_grants WHERE user_id=?').get(id).amount).toBe(30)
    }
    sqlite.exec("UPDATE model_relay_quotas SET balance=0 WHERE user_id=4;INSERT INTO users VALUES(4,'new-github','renamed','user') ON CONFLICT(id) DO UPDATE SET login=excluded.login")
    expect(sqlite.prepare('SELECT balance,granted FROM model_relay_quotas WHERE user_id=4').get()).toMatchObject({balance:0,granted:30})
    expect(sqlite.prepare('SELECT COUNT(*) count FROM model_relay_signup_grants WHERE user_id=4').get().count).toBe(1)
  })
  it('defaults to ten points, supports signed batch adjustments and clearing without erasing totals',async()=>{
    const path='/api/admin/relay/grants'
    expect((await adminProxy(request({userIds:[1,2]},path),env,user)).status).toBe(200)
    expect(quota()).toMatchObject({balance:110,granted:110,spent:0})
    expect((await adminProxy(request({userIds:[1,2],amount:-20},path),env,user)).status).toBe(200)
    expect(quota()).toMatchObject({balance:90,granted:110})
    expect(sqlite.prepare('SELECT balance,granted FROM model_relay_quotas WHERE user_id=2').get()).toMatchObject({balance:0,granted:10})
    expect(sqlite.prepare('SELECT amount FROM model_relay_grants WHERE user_id=2 ORDER BY id DESC LIMIT 1').get().amount).toBe(-10)
    expect((await adminProxy(request({userIds:[1,2],action:'clear'},path),env,user)).status).toBe(200)
    expect(quota()).toMatchObject({balance:0,granted:110,spent:0})
    expect(sqlite.prepare('SELECT action,amount FROM model_relay_grants WHERE user_id=1 ORDER BY id DESC LIMIT 1').get()).toMatchObject({action:'clear',amount:-90})
    for(const amount of [0,1.5,-1000001]) expect((await adminProxy(request({userIds:[1],amount},path),env,user)).status).toBe(400)
  })
  it('rolls back a whole batch if a deduction or clear hits an in-flight request',async()=>{
    await enable()
    sqlite.exec("INSERT INTO model_relay_usage(id,user_id,model,purpose,cost) VALUES('pending-clear',1,'test','translation',1)")
    const path='/api/admin/relay/grants'
    for (const body of [{amount:-10},{action:'clear'}]) {
      expect((await adminProxy(request({userIds:[2,1],...body},path),env,user)).status).toBe(409)
      expect(quota().balance).toBe(99)
      expect(sqlite.prepare('SELECT * FROM model_relay_quotas WHERE user_id=2').get()).toBeUndefined()
    }
    expect((await adminProxy(request({userIds:[1],amount:10},path),env,user)).status).toBe(200)
    expect(quota().balance).toBe(109)
  })
  it('encrypts platform credentials, never returns secrets, allows rename and deletes unused keys',async()=>{
    const path='/api/admin/relay/credentials'
    const created=await(await adminProxy(request({platform:'deepseek',name:'测试',apiKey:'secret-deepseek'},path),env,user)).json()
    expect(created.id).toBeTruthy()
    let listing=await(await adminProxy(request({},path,'GET'),env,user)).json()
    expect(JSON.stringify(listing)).not.toMatch(/secret-deepseek|encrypted_key|key_iv/u)
    expect((await adminProxy(request({id:created.id,name:'更新',workspace:''},path,'PATCH'),env,user)).status).toBe(200)
    expect(sqlite.prepare('SELECT encrypted_key FROM model_relay_credentials').get().encrypted_key).not.toBe('secret-deepseek')
    expect((await adminProxy(request({id:created.id},path,'DELETE'),env,user)).status).toBe(200)
    listing=await(await adminProxy(request({},path,'GET'),env,user)).json();expect(listing.credentials).toEqual([])
  })
  it('discovers official models, rejects forged search capability, routes DeepSeek with its own key',async()=>{
    const created=await(await adminProxy(request({platform:'deepseek',name:'DeepSeek',apiKey:'fixture-deepseek'},'/api/admin/relay/credentials'),env,user)).json()
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      expect(url).toBe('https://api.deepseek.com/models');expect(init.headers.authorization).toBe('Bearer fixture-deepseek')
      return Response.json({data:[{id:'deepseek-flash',input_modalities:['text','image'],output_modalities:['text']}]})
    }))
    const list=await(await adminProxy(request({keyId:created.id},'/api/admin/relay/discover'),env,user)).json()
    expect(list.models[0]).toMatchObject({vision:true,search:false})
    const model={id:'custom-deepseek',platform:'deepseek',model:'deepseek-flash',keyId:created.id,enabled:true,capability:'vision-only',translationCost:1,searchCost:2,visionCost:2}
    const config={enabled:true,maxConcurrency:2,models:[model],routes:{translation:model.id,vision:model.id,search:''}}
    expect((await adminProxy(request({...config,models:[{...model,capability:'multimodal-search'}]},'/api/admin/relay/config','PATCH'),env,user)).status).toBe(400)
    expect((await adminProxy(request(config,'/api/admin/relay/config','PATCH'),env,user)).status).toBe(200)
    expect((await adminProxy(request({id:created.id},'/api/admin/relay/credentials','DELETE'),env,user)).status).toBe(400)
    const response=await relayModel(request(),env,user,async(url,init)=>{
      expect(url).toBe('https://api.deepseek.com/chat/completions');expect(init.headers.authorization).toBe('Bearer fixture-deepseek')
      expect(JSON.parse(init.body).model).toBe('deepseek-flash')
      return Response.json({id:'upstream',choices:[{finish_reason:'stop',message:{content:'你好'}}],usage:{prompt_tokens:10,completion_tokens:3}})
    })
    expect(response.status).toBe(200);expect(quota().balance).toBe(99)
    expect((await relayModel(request({purpose:'search'}),env,user)).status).toBe(503)
    expect((await adminProxy(request({...config,enabled:false,models:[],routes:{}},'/api/admin/relay/config','PATCH'),env,user)).status).toBe(200)
    expect((await(await adminProxy(request({},'/api/admin/relay/config','GET'),env,user)).json()).models).toEqual([])
  })
  it('preserves configured Google keys and both models in the credential migration',async()=>{
    sqlite.exec('DROP TABLE model_relay_catalog;DROP TABLE model_relay_credentials')
    await enable();migrate('0011_relay_credentials.sql')
    const config=await(await adminProxy(request({},'/api/admin/relay/config','GET'),env,user)).json()
    expect(config.models).toHaveLength(2);expect(config.models[0]).toMatchObject({platform:'google',keyId:'legacy-google'})
    expect(sqlite.prepare('SELECT encrypted_key FROM model_relay_credentials').get().encrypted_key).toBeTruthy()
    expect((await relayModel(request(),env,user,async()=>result())).status).toBe(200)
  })
  it('paginates Google directory and reads Bailian official capability metadata',async()=>{
    const fetcher=vi.fn(async url=>Response.json(url.includes('pageToken=next')?{models:[{name:'models/gemini-2.5-flash-lite',supportedGenerationMethods:['generateContent']}]}:{models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']}],nextPageToken:'next'}))
    expect(await discoverModels({platform:'google'},'test',fetcher)).toHaveLength(2)
    const models=await discoverModels({platform:'bailian',workspace:'workspace-123'},'test',async(url,init)=>{
      expect(url).toContain('https://workspace-123.cn-beijing.maas.aliyuncs.com/api/v1/models?');expect(init.redirect).toBe('manual')
      return Response.json({output:{total:1,models:[{model:'qwen3.8-flash',capabilities:['TG','VU'],features:['web-search']}]}})
    })
    expect(models).toEqual([{id:'qwen3.8-flash',name:'qwen3.8-flash',vision:true,search:true}])
    const req=providerRequest('bailian',{workspace:'workspace-123'},{model:'qwen3.8-flash',prompt:'test',search:true},'key')
    expect(req.payload).toMatchObject({enable_search:true,search_options:{forced_search:true}})
    expect(()=>providerOutput('deepseek',{choices:[{finish_reason:'length',message:{content:'partial'}}]})).toThrow()
    await expect(discoverModels({platform:'bailian',workspace:'host.evil/path'},'key',fetcher)).rejects.toThrow()
  })
  it('collects Bailian search streams without exposing partial or reasoning content',async()=>{
    const request=providerRequest('bailian',{workspace:'test'},{model:'qwen3.8-flash',prompt:'search',search:true},'key')
    expect(request.payload).toMatchObject({stream:true,stream_options:{include_usage:true}})
    const chunks=[{id:'test',choices:[{index:0,delta:{reasoning_content:'private'}}]},
      {choices:[{index:0,delta:{content:'译名'},finish_reason:'stop'}]},
      {choices:[],usage:{prompt_tokens:10,completion_tokens:5}}]
    const wire=chunks.map(c=>`data: ${JSON.stringify(c)}\r\n\r\n`).join('')+'data: [DONE]\n\n'
    const response=new Response(wire,{headers:{'content-type':'text/event-stream'}})
    const normalized=providerOutput('bailian',await providerResponse('bailian',response))
    expect(normalized).toMatchObject({text:'译名',input:10,output:5})
    await expect(providerResponse('bailian',new Response(wire.replace('data: [DONE]',''),{headers:{'content-type':'text/event-stream'}}))).rejects.toThrow('UPSTREAM_OUTPUT_INCOMPLETE')
  })
  it('migrates safely, disables old service, clears key and retains quota/history',async()=>{
    expect(sqlite.prepare('SELECT * FROM model_relay_config').get()).toMatchObject({enabled:0,encrypted_key:null,key_iv:null})
    expect(quota()).toMatchObject({balance:100,spent:0})
    expect(sqlite.prepare("SELECT model FROM model_relay_usage WHERE id='old-log'").get().model).toBe('qwen3.8-flash')
    expect((await relayModel(request(),env,user)).status).toBe(503)
  })
  it('never returns concrete models or upstream keys in the client catalog',async()=>{
    await enable(); const catalog=await(await proxyCatalog(env,user)).json()
    expect(catalog).toMatchObject({enabled:true,costs:{translation:1,search:2,vision:2},quota:{balance:100}})
    expect(JSON.stringify(catalog)).not.toMatch(/gemini|qwen|fixture-google-key|encrypted_key/u)
    expect((await(await proxyCatalog(env,{id:2})).json()).quota.balance).toBe(0)
    expect(JSON.stringify(await(await adminProxy(request({},'/api/admin/relay/config','GET'),env,user)).json())).not.toContain('fixture-google-key')
  })
  it.each(['translation','search','vision'])('routes %s by purpose, maps Gemini payload and records tokens not content',async purpose=>{
    await enable()
    const fetcher=vi.fn(async(url,init)=>{
      expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${defaultRelayRoutes[purpose]}:generateContent`)
      expect(init.headers['x-goog-api-key']).toBe('fixture-google-key')
      expect(init.headers.authorization).toBeUndefined();expect(init.redirect).toBe('manual')
      const payload=JSON.parse(init.body)
      expect(payload.contents[0].parts[0]).toEqual({text:'fixture text'})
      expect(payload.tools).toEqual(purpose==='search'?[{google_search:{}}]:undefined)
      if(purpose==='vision')expect(payload.contents[0].parts[1]).toEqual({inlineData:{mimeType:'image/png',data:'AAAA'}})
      return result()
    })
    expect((await relayModel(request({purpose,...(purpose==='vision'?{imageDataUrl:'data:image/png;base64,AAAA'}:{})}),env,user,fetcher)).status).toBe(200)
    expect(quota().balance).toBe(purpose==='translation'?99:98)
    const log=sqlite.prepare("SELECT * FROM model_relay_usage WHERE id!='old-log'").get()
    expect(log).toMatchObject({input_tokens:123,output_tokens:9,cached_tokens:40,status:'success'})
    expect(JSON.stringify(log)).not.toMatch(/fixture text|你好|fixture-google-key/u)
  })
  it('rejects client model selection, forged purpose and images outside vision before spending',async()=>{
    await enable();const fetcher=vi.fn()
    for(const body of [{model:'qwen3.8-flash'},{model:'gemini-2.5-flash'},{purpose:'invalid'},{enableSearch:true},{purpose:'vision'},{imageDataUrl:'data:image/png;base64,AAAA'},{purpose:'vision',imageDataUrl:'https://internal/private'},{prompt:'x'.repeat(24001)}]) {
      expect((await relayModel(request(body),env,user,fetcher)).status).toBe(400)
    }
    expect(fetcher).not.toHaveBeenCalled();expect(quota().balance).toBe(100)
  })
  it('preserves atomic quota, duplicate protection and concurrency after table migration',async()=>{
    await enable();let finish;const pending=new Promise(resolve=>{finish=resolve}),fetcher=vi.fn(()=>pending.then(r=>r.clone()))
    const id=crypto.randomUUID(),first=relayModel(request({requestId:id}),env,user,fetcher),second=relayModel(request(),env,user,fetcher)
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2))
    expect((await relayModel(request({requestId:id}),env,user,fetcher)).status).toBe(409)
    expect((await relayModel(request(),env,user,fetcher)).status).toBe(429)
    finish(result());expect((await Promise.all([first,second])).every(r=>r.status===200)).toBe(true)
    expect(quota()).toMatchObject({balance:98,spent:2})
    sqlite.exec('UPDATE model_relay_quotas SET balance=0')
    expect((await relayModel(request(),env,user,fetcher)).status).toBe(402)
  })
  it('refunds HTTP failures and retains uncertain calls without storing sensitive errors',async()=>{
    await enable()
    const failed=await relayModel(request(),env,user,async()=>new Response('sensitive error',{status:429}))
    expect(failed.status).toBe(502);expect(await failed.text()).not.toContain('sensitive')
    expect(quota()).toMatchObject({balance:100,spent:0})
    expect((await relayModel(request(),env,user,async()=>{throw new Error('timeout')})).status).toBe(502)
    expect(quota()).toMatchObject({balance:99,spent:1})
  })
  it('flags incomplete or safety-blocked Gemini answers for review',async()=>{
    await enable()
    expect((await relayModel(request(),env,user,async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]}))).status).toBe(502)
    expect(quota()).toMatchObject({balance:99,spent:1})
  })
  it('recovers crashes and grants batches with renamed SQL triggers',async()=>{
    await enable()
    sqlite.prepare('INSERT INTO model_relay_usage(id,user_id,model,purpose,cost,created_at) VALUES(?,1,?,?,2,?)').run(crypto.randomUUID(),'gemini-2.5-flash','search','2000-01-01')
    await recoverProxyReservations(env);await recoverProxyReservations(env)
    expect(quota()).toMatchObject({balance:98,spent:2})
    expect((await adminProxy(request({userIds:[1,2],amount:10},'/api/admin/relay/grants'),env,user)).status).toBe(200)
    expect(quota().balance).toBe(108)
    expect((await adminProxy(request({userIds:[1,99],amount:10},'/api/admin/relay/grants'),env,user)).status).toBe(400)
    expect(quota().balance).toBe(108)
  })
  it('configures server routes, encrypts Google key, preserves blank key and requires valid capabilities',async()=>{
    const path='/api/admin/relay/config',config={routes:defaultRelayRoutes,models:defaultProxyModels,maxConcurrency:2,enabled:true}
    expect((await adminProxy(request({...config,apiKey:'fixture-google-key'},path,'PATCH'),env,user)).status).toBe(200)
    const saved=sqlite.prepare('SELECT encrypted_key FROM model_relay_config').get().encrypted_key
    expect(saved).not.toContain('fixture-google-key')
    expect((await adminProxy(request(config,path,'PATCH'),env,user)).status).toBe(200)
    expect(sqlite.prepare('SELECT encrypted_key FROM model_relay_config').get().encrypted_key).toBe(saved)
    expect((await adminProxy(request({...config,routes:{...defaultRelayRoutes,vision:'qwen3.8-flash'}},path,'PATCH'),env,user)).status).toBe(400)
    expect((await adminProxy(request({...config,clearKey:true},path,'PATCH'),env,user)).status).toBe(400)
    expect((await adminProxy(request({...config,clearKey:true,enabled:false},path,'PATCH'),env,user)).status).toBe(200)
    expect(()=>validateModels(defaultProxyModels.map(m=>({...m,translationCost:0})))).toThrow()
  })
  it('requires credentials/admin and removes old Qwen endpoints',async()=>{
    expect((await worker.fetch(request({},'/api/admin/relay/config','GET'),env)).status).toBe(401)
    expect((await worker.fetch(request(),env)).status).toBe(401)
    expect((await worker.fetch(request({},'/api/v1/qwen'),env)).status).toBe(404)
  })
  it('normalizes grounding and filters unsafe URLs/thoughts',()=>{
    const output=upstreamOutput({responseId:'safe',candidates:[{finishReason:'STOP',content:{parts:[{text:'private',thought:true},{text:'译名'}]},groundingMetadata:{groundingChunks:[{web:{uri:'javascript:alert(1)'}},{web:{uri:'https://example.com',title:'Source'}}],searchEntryPoint:{renderedContent:'<div>Search</div>'}}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:2,thoughtsTokenCount:3}})
    expect(output).toMatchObject({text:'译名',input:1,output:5,grounding:{sources:[{title:'Source',url:'https://example.com/'}],renderedContent:'<div>Search</div>'}})
  })
})
