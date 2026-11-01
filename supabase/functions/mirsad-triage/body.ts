export class BodyLimitError extends Error {
 constructor(public status:number){super(status===413?'BODY_TOO_LARGE':'BODY_TIMEOUT')}
}

// Count raw bytes before decoding; never buffer more than the configured limit.
export async function boundedText(request:Request,maxBytes:number,timeoutMs=10000):Promise<string>{
 if(Number(request.headers.get('content-length')||0)>maxBytes){
  void request.body?.cancel().catch(()=>{});
  throw new BodyLimitError(413);
 }
 if(!request.body)return '';
 const reader=request.body.getReader();
 const chunks:Uint8Array[]=[];let size=0;let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new BodyLimitError(408)),timeoutMs)});
 try{
  for(;;){
   const {done,value}=await Promise.race([reader.read(),deadline]);
   if(done)break;
   size+=value.byteLength;
   if(size>maxBytes)throw new BodyLimitError(413);
   chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return new TextDecoder().decode(bytes);
 }catch(error){void reader.cancel().catch(()=>{});throw error}
 finally{clearTimeout(timer);reader.releaseLock()}
}
