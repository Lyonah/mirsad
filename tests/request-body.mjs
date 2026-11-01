import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
fs.mkdirSync('work/body-tests',{recursive:true});
fs.writeFileSync('work/body-tests/body.mjs',ts.transpileModule(fs.readFileSync('supabase/functions/mirsad-triage/body.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {boundedText}=await import('../work/body-tests/body.mjs');
const request=body=>new Request('https://test.invalid',{method:'POST',body,duplex:'half'});
for(const limit of [256,16000]){
 let sent=0,cancelled=false;
 const stream=new ReadableStream({pull(c){sent+=128;c.enqueue(new Uint8Array(128))},cancel(){cancelled=true}},{highWaterMark:0});
 await assert.rejects(boundedText(request(stream),limit),e=>e.status===413);
 assert.ok(cancelled);assert.ok(sent<=limit+128,'stop reading immediately after limit');
 const exact='a'.repeat(limit);assert.equal(await boundedText(request(exact),limit),exact);
 await assert.rejects(boundedText(request('ع'.repeat(limit)),limit),e=>e.status===413);
}
let slowCancelled=false;
const slow=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){slowCancelled=true}},{highWaterMark:0});
await assert.rejects(boundedText(request(slow),256,20),e=>e.status===408);
assert.ok(slowCancelled);
let consumed=false,headerCancelled=false;
const tooLarge=request(new ReadableStream({pull(){consumed=true},cancel(){headerCancelled=true}},{highWaterMark:0}));
tooLarge.headers.set('content-length','1000000');
await assert.rejects(boundedText(tooLarge,256),e=>e.status===413);
assert.equal(consumed,false);assert.ok(headerCancelled);
assert.equal(await boundedText(request('عربي'),256),'عربي');
console.log('PASS bounded bodies: early cancellation, exact limits, UTF-8 bytes, declared sizes and stalled-stream timeout.');
