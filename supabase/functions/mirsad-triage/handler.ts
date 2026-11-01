import { modelRequest, parseModelResponse } from './triage.ts';
import { boundedText,BodyLimitError } from './body.ts';

export type Config = { url:string; anon:string; service:string; key:string; model:string };
class ServiceError extends Error {
 constructor(public code:string,public status=502,public diagnostic?:Record<string,unknown>){super(code)}
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const allowedErrors=['AUTH_REQUIRED','NOT_ALLOWED','RATE_LIMIT','AI_BUSY','NOT_FOUND'];
export function upstreamFailure(status:number,error:any){
 const code=typeof error?.code==='string'?error.code:'';
 const type=typeof error?.type==='string'?error.type:'';
 const message=typeof error?.message==='string'?error.message:'';
 const quota=code==='insufficient_quota'||type==='insufficient_quota'||/current quota|billing quota|out of credits|no balance|spend limit|billing hard limit/i.test(message);
 return status===401?'PROVIDER_AUTH':status===429?(quota?'PROVIDER_QUOTA':'PROVIDER_RATE_LIMIT'):status===404?'PROVIDER_MODEL':status===400?'AI_REQUEST_INVALID':'AI_UNAVAILABLE';
}
export function createHandler(c:Config,send:typeof fetch=fetch,wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))){
 // Health never submits a generation or returns keys/account metadata.
 let healthPromise:Promise<{ready:boolean;code:string|null}>|undefined;let healthUntil=0;
 async function health(){
  if(Date.now()>healthUntil||!healthPromise){healthUntil=Date.now()+300000;healthPromise=(async()=>{
   if(!c.key||!c.service||!c.url||!c.anon)return {ready:false,code:'AI_NOT_CONFIGURED'};
   try{const r=await send('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+c.key},signal:AbortSignal.timeout(8000)});
    // Only report availability of the configured model, never account data.
    const data=await r.json().catch(()=>null);
    const available=r.ok&&Array.isArray(data?.data)&&data.data.some((m:any)=>m?.id===c.model);
    return {ready:available,code:available?null:r.status===401?'PROVIDER_AUTH':r.ok?'PROVIDER_MODEL':'PROVIDER_UNAVAILABLE'};
   }catch{return {ready:false,code:'PROVIDER_UNAVAILABLE'}}
  })()}
  return healthPromise;
 }
 async function supa(path:string,token:string,body?:unknown,admin=false):Promise<any>{
  const key=admin?c.service:c.anon;
  const r=await send(c.url+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:'Bearer '+(admin?key:token),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const d=await r.json().catch(()=>null);
  if(!r.ok){const code=allowedErrors.find(x=>typeof d?.message==='string'&&d.message.includes(x));throw new ServiceError(code||(r.status===401?'AUTH_REQUIRED':'DATA_UNAVAILABLE'),code==='RATE_LIMIT'?429:code==='AI_BUSY'?409:r.status===401?401:403)}
  return d;
 }
 return async function handle(req:Request){
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&path.endsWith('/health'))return json(await health());
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  try{
   const auth=req.headers.get('Authorization')||'';
   if(!/^Bearer [A-Za-z0-9._~-]+$/.test(auth)||auth.length>8192)throw new ServiceError('AUTH_REQUIRED',401);
   const token=auth.slice(7);
   // Validate the live Auth user, even when callers bypass the site's UI.
   const user=await supa('/auth/v1/user',token);
   if(!user?.id)throw new ServiceError('AUTH_REQUIRED',401);
   if(!req.headers.get('Content-Type')?.includes('application/json')||Number(req.headers.get('Content-Length')||0)>256)throw new ServiceError('INVALID_INPUT',400);
   let text:string;try{text=await boundedText(req,256)}catch(e){if(e instanceof BodyLimitError)throw new ServiceError('INVALID_INPUT',e.status);throw e}
   let input;try{input=JSON.parse(text)}catch{throw new ServiceError('INVALID_INPUT',400)}
   if(!input||Array.isArray(input)||Object.keys(input).length!==1||!Number.isSafeInteger(input.ticketId)||input.ticketId<1)throw new ServiceError('INVALID_INPUT',400);
   if(!c.key||!c.service){await supa('/rest/v1/rpc/mark_triage_review',token,{p_ticket:input.ticketId,p_reason:'not_configured'});return json({state:'needs_review',warning:'البلاغ محفوظ. الأولوية بانتظار مراجعة فني معتمد.'});}
   // The RPC verifies ticket visibility, reserves a job and enforces rate limits.
   // User-provided problem text or priority is never accepted by this endpoint.
   const job=await supa('/rest/v1/rpc/ticket_action',token,{p_action:'classify',p_ticket:input.ticketId,p_data:{}});
   if(job.ready)return json({state:'ready'});
   try{
    const notes=await supa('/rest/v1/ticket_events?ticket_id=eq.'+input.ticketId+'&kind=eq.note&select=message&order=created_at.desc&limit=3',token);
    const context={...job,followUpNotes:Array.isArray(notes)?notes.map((n:any)=>String(n.message||'').slice(0,500)):[]};
    let r:Response;
    for(let attempt=0;;attempt++){
     r=await send('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},body:JSON.stringify(modelRequest(context,c.model)),signal:AbortSignal.timeout(15000)});
     if(r.ok)break;
     const d=await r.json().catch(()=>null);const code=upstreamFailure(r.status,d?.error);
     const rawDelay=r.headers.get('retry-after');
     const delay=rawDelay?(/^\d+(\.\d+)?$/.test(rawDelay)?Number(rawDelay):Math.max(0,(Date.parse(rawDelay)-Date.now())/1000)):1;
     if(code==='PROVIDER_RATE_LIMIT'&&attempt===0&&Number.isFinite(delay)&&delay<=2){await wait(Math.max(1000,delay*1000));continue}
     const safe=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)?value:null;
     throw new ServiceError(code,502,{status:r.status,upstreamCode:safe(d?.error?.code),upstreamType:safe(d?.error?.type),requestId:safe(r.headers.get('x-request-id')),retryAfterSeconds:Number.isFinite(delay)?delay:null});
    }
    const result=parseModelResponse(await r.json());
    const committed=await supa('/rest/v1/rpc/complete_triage','',{p_ticket:input.ticketId,p_job:job.job,p_result:result},true);
    if(committed!==true)throw new ServiceError('AI_STALE_JOB',409);
    return json({state:result.decision==='classified'?'ready':'needs_review',warning:result.decision==='needs_review'?'حُفظ البلاغ. المعلومات تحتاج مراجعة فني قبل تحديد الأولوية.':undefined});
   }catch(e){
    const code=e instanceof ServiceError?e.code:'AI_UNAVAILABLE';
    // Only safe error categories are logged; no prompt, output or key values.
    console.warn('mirsad_triage_failed',{code,...(e instanceof ServiceError?e.diagnostic:{})});
    const reasons:Record<string,string>={PROVIDER_QUOTA:'quota',PROVIDER_RATE_LIMIT:'rate_limited',PROVIDER_AUTH:'auth',AI_REQUEST_INVALID:'invalid_response'};
    const reviewReason=reasons[code]||'service_unavailable';
    try{await supa('/rest/v1/rpc/complete_triage','',{p_ticket:input.ticketId,p_job:job.job,p_result:{decision:'needs_review',priority:null,reason:'تعذّر التحليل التلقائي. الأولوية بانتظار مراجعة فني معتمد.',summary:'لم يكتمل التحليل التلقائي؛ راجع وصف المشكلة والملاحظات.',review_reason:reviewReason,questions:[],impact:null}},true)}catch{ /* The site's fallback marks expired jobs for review. */ }
    return json({state:'needs_review',code,warning:'حُفظ البلاغ وأُحيلت الأولوية لمراجعة فني معتمد.'});
   }
  }catch(e){return e instanceof ServiceError?json({error:e.code},e.status):json({error:'SERVICE_UNAVAILABLE'},503)}
 };
}
