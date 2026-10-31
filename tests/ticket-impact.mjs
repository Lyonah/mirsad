import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('public/mirsad.js','utf8');
const block=source.slice(source.indexOf('const impactChoices='),source.indexOf('function baseOpenNew()'));
const ctx=vm.createContext({});vm.runInContext(block,ctx);
for(const scope of ['single','team','organization','unknown'])for(const disruption of ['blocked','degraded','nonblocking','unknown'])for(const workaround of ['available','unavailable','unknown'])for(const onset of ['now','today','older','unknown'])for(const risk of ['security','data_loss','none','unknown']){
 const description=vm.runInContext(`ticketDescription(${JSON.stringify('ع'.repeat(1800))},'${scope}','${disruption}','${workaround}','${onset}','${risk}')`,ctx);
 assert.ok(description.length<=2500);
 assert.ok(description.includes('من المتأثر؟'));
 assert.ok(description.includes('كيف أثرت على العمل؟'));
 assert.ok(description.includes('هل يوجد حل مؤقت؟'));
}
assert.throws(()=>vm.runInContext("ticketDescription('تعطل','','blocked','unknown')",ctx));
assert.throws(()=>vm.runInContext("ticketDescription('تعطل','single','high','unknown')",ctx));
const html=vm.runInContext("impactQuestion('newScope','مين متأثر؟',impactChoices.scope)",ctx);
assert.ok(html.includes('required'));assert.ok(html.includes('value="unknown"'));assert.ok(html.includes('disabled selected'));
console.log('768 combinations preserve impact answers within API limits; missing/forged answers rejected.');
let submitted;
const values={newTitle:'انقطاع الشبكة',newBuilding:'الرئيسي',newDepartment:'الدعم',newFloor:'2',newOffice:'204',newPhone:'٠٥٠١٢٣٤٥٦٧',newOnset:'now',newRisk:'none',newDescription:'الشبكة مفصولة',newScope:'team',newDisruption:'blocked',newWorkaround:'unavailable',newCategory:'الشبكات'};
Object.assign(ctx,{document:{getElementById:id=>({value:values[id]})},categoryNames:{networks:'الشبكات'},activeTicketRequestId:'20000000-0000-4000-8000-000000000001',mutation:async(path,body)=>{submitted={path,body}},modal:(_title,html)=>{ctx.formHtml=html},currentUser:()=>({id:'test'}),isTech:()=>false,icon:()=>'',tr:(s,v)=>v?String(s).replace(/\{(\w+)\}/g,(m,k)=>k in v?String(v[k]):m):String(s),esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),formatId:id=>String(id).padStart(2,'0')});
vm.runInContext(source.slice(source.indexOf('function baseOpenNew()'),source.indexOf('function openNote()')),ctx);
vm.runInContext('baseOpenNew()',ctx);
assert.equal((ctx.formHtml.match(/id="new(?:Scope|Disruption|Workaround|Onset|Risk)"/g)||[]).length,5);
const create=source.slice(source.indexOf('async function createTicket('),source.indexOf('\n',source.indexOf('async function createTicket(')));
vm.runInContext(create,ctx);await ctx.createTicket({preventDefault(){}});
assert.equal(submitted.path,'tickets');assert.ok(submitted.body.description.includes('عدة أشخاص أو قسم'));assert.ok(submitted.body.description.includes('العمل متوقف'));assert.ok(submitted.body.description.includes('لا يوجد بديل متاح'));assert.equal('priority' in submitted.body,false);assert.equal(submitted.body.category,'networks');
console.log('Rendered form has five questions; submission sends answers in persisted description without a chosen priority.');

assert.equal(submitted.body.contact.phone,'0501234567');assert.equal(submitted.body.contact.office,'204');assert.ok(!submitted.body.description.includes('0501234567'));assert.ok(!submitted.body.description.includes('204'));assert.ok(submitted.body.description.includes('متى بدأت المشكلة؟'));assert.ok(submitted.body.description.includes('مؤشرات أمنية'));console.log('Contact fields are separate from AI description; Arabic phone digits normalize correctly.');
