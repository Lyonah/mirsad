import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
fs.mkdirSync('work/triage',{recursive:true});
for(const name of ['triage','handler']){
 const source=fs.readFileSync(`supabase/functions/mirsad-triage/${name}.ts`,'utf8').replace("'./triage.ts'","'./triage.mjs'");
 fs.writeFileSync(`work/triage/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
}
const {createHandler,upstreamFailure}=await import(pathToFileURL(path.resolve('work/triage/handler.mjs')));
const {modelRequest,parseModelResponse}=await import(pathToFileURL(path.resolve('work/triage/triage.mjs')));
const config={url:'https://database.example',anon:'public-test-value',service:'private-test-value',key:'synthetic-test-value',model:'openai/gpt-oss-120b'};
const valid={decision:'classified',priority:'high',reason:'انقطاع خدمة مشتركة',summary:'الشبكة متوقفة لجميع الموظفين',review_reason:null,questions:[],impact:{scope:'organization',disruption:'blocked',risk:'none',workaround:'unavailable'}};
const completed=result=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}]});
const job={job:'job-uuid',title:'عطل شبكة',description:'الشبكة متوقفة لجميع الموظفين',category:'networks'};
const post=(body={ticketId:1},auth='Bearer user-token')=>new Request('https://function.example/mirsad-triage',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture({authStatus=200,rpcError,aiStatus=200,aiBody=completed(valid),commit=true}={}){
 const calls=[];const send=async(url,init={})=>{
  const u=String(url);const body=init.body?JSON.parse(init.body):undefined;calls.push({u,headers:init.headers,body});
  if(u.endsWith('/auth/v1/user'))return Response.json(authStatus===200?{id:'real-user'}:{message:'invalid token'},{status:authStatus});
  if(u.endsWith('/rpc/ticket_action'))return Response.json(rpcError?{message:rpcError}:job,{status:rpcError?403:200});
  if(u.endsWith('/rpc/complete_triage'))return Response.json(commit);
  if(u.includes('/rest/v1/ticket_events?'))return Response.json([]);
  if(u.endsWith('/chat/completions'))return Response.json(aiBody,{status:aiStatus});
  if(u.endsWith('/models'))return Response.json({data:[{id:config.model}]});
  throw new Error('Unexpected external request');
 };return {calls,handle:createHandler(config,send)};
}
let checks=0;
{const f=fixture();const r=await f.handle(post({},''));assert.equal(r.status,401);assert.equal(f.calls.length,0);checks++}
{const f=fixture({authStatus:401});const r=await f.handle(post());assert.equal(r.status,401);assert.equal(f.calls.length,1);checks++}
for(const body of [{ticketId:1,priority:'high'},{ticketId:0},{ticketId:1.2},{ticketId:'1'},null]){
 const f=fixture();assert.equal((await f.handle(post(body))).status,400);assert.equal(f.calls.length,1);checks++;
}
{const f=fixture({rpcError:'NOT_ALLOWED'});assert.equal((await f.handle(post())).status,403);assert.ok(!f.calls.some(c=>c.u.endsWith('/chat/completions')));checks++}
{const f=fixture({rpcError:'RATE_LIMIT'});assert.equal((await f.handle(post())).status,429);checks++}
{const f=fixture();assert.equal((await (await f.handle(post())).json()).state,'ready');
 const ai=f.calls.find(c=>c.u.endsWith('/chat/completions'));assert.deepEqual(JSON.parse(ai.body.messages[1].content),{title:job.title,description:job.description,category:job.category});
 assert.equal(ai.body.stream,false);assert.equal(ai.body.response_format.json_schema.strict,true);assert.ok(ai.u.startsWith('https://api.groq.com/'));assert.ok(!f.calls.some(c=>c.u.includes('api.openai.com')));
 const commit=f.calls.find(c=>c.u.endsWith('/rpc/complete_triage'));assert.equal(commit.body.p_result.priority,'high');assert.equal(commit.body.p_job,job.job);assert.equal(commit.headers.apikey,config.service);checks++}
for(const aiBody of [completed({...valid,priority:'critical'}),completed({...valid,command:'approve'}),{choices:[{finish_reason:'length',message:{content:'{}'}}]},{choices:[{finish_reason:'stop',message:{refusal:'refused',content:null}}]}]){
 const f=fixture({aiBody});const d=await (await f.handle(post())).json();assert.equal(d.state,'needs_review');
 const commit=f.calls.find(c=>c.u.endsWith('/rpc/complete_triage'));assert.equal(commit.body.p_result.priority,null);assert.ok(commit.body.p_result.review_reason);checks++;
}
{const f=fixture({aiStatus:429,aiBody:{error:{code:'insufficient_quota'}}});const d=await (await f.handle(post())).json();assert.equal(d.code,'PROVIDER_QUOTA');assert.equal(d.state,'needs_review');checks++}
{const f=fixture({commit:false});assert.equal((await (await f.handle(post())).json()).state,'needs_review');checks++}
{const f=fixture();const request=()=>new Request('https://function.example/mirsad-triage/health');
 const h=await (await f.handle(request())).json();assert.equal(h.ready,true);assert.equal(Object.keys(h).join(','),'ready,code');
 await f.handle(request());assert.equal(f.calls.length,1);assert.ok(!f.calls.some(c=>c.u.endsWith('/chat/completions')));checks++}
{const f=fixture();const handle=createHandler({...config,key:''},async()=>{throw new Error('Must not call upstream')});assert.equal((await (await handle(new Request('https://function.example/mirsad-triage/health'))).json()).ready,false);checks++}
assert.deepEqual(parseModelResponse(completed(valid)),valid);
assert.ok(!modelRequest(job,config.model).messages[1].content.includes('user-token'));
assert.equal(upstreamFailure(429,{type:'insufficient_quota'}),'PROVIDER_QUOTA');
assert.equal(upstreamFailure(429,{message:'You exceeded your current quota.'}),'PROVIDER_QUOTA');
assert.equal(upstreamFailure(429,{code:'rate_limit_exceeded'}),'PROVIDER_RATE_LIMIT');
checks+=3;
{const f=fixture();let attempts=0;let waited=0;
 const handler=createHandler(config,async(url,init)=>{
  if(String(url).endsWith('/chat/completions')&&attempts++===0)return Response.json({error:{code:'rate_limit_exceeded'}},{status:429,headers:{'retry-after':'1'}});
  // Use the same happy-path protocol as the real fixture.
  const u=String(url);
  if(u.endsWith('/chat/completions'))return Response.json(completed(valid));
  if(u.endsWith('/auth/v1/user'))return Response.json({id:'user'});
  if(u.includes('/rest/v1/ticket_events?'))return Response.json([]);
  if(u.endsWith('/ticket_action'))return Response.json(job);
  if(u.endsWith('/complete_triage'))return Response.json(true);
  throw new Error('unexpected URL');
 },async(ms)=>{waited+=ms});
 assert.equal((await (await handler(post())).json()).state,'ready');assert.equal(attempts,2);assert.equal(waited,1000);checks++;
}

{const f=fixture({aiBody:completed({...valid,decision:'needs_review',priority:null,review_reason:'ambiguous',questions:['كم شخصًا تأثر؟']})});
 const d=await (await f.handle(post())).json();assert.equal(d.state,'needs_review');
 const save=f.calls.find(c=>c.u.endsWith('/complete_triage'));assert.equal(save.body.p_result.priority,null);checks++;
}
{const uncertain={...valid,impact:{scope:'unknown',disruption:'unknown',risk:'none',workaround:'unknown'}};
 const parsed=parseModelResponse(completed(uncertain));assert.equal(parsed.decision,'needs_review');assert.equal(parsed.priority,null);checks++;
}
assert.throws(()=>parseModelResponse(completed({...valid,decision:'needs_review',review_reason:'ambiguous',questions:['وضّح؟']})));checks++;
console.log(`PASS ${checks} Edge Function checks: identity, payloads, AI ambiguity, technician-review fallback, quota handling, retries and private commits.`);
