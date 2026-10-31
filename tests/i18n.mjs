// يتحقق أن كل نص عربي يمرّ عبر tr() أو data-i18n له ترجمة إنجليزية،
// وأن المتغيرات {..} متطابقة بين العربي والإنجليزي، وأن التبديل يعمل.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync('public/mirsad.js','utf8');const shell=fs.readFileSync('app/shell.html','utf8');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/mirsad-i18n.js','utf8'),ctx);const EN=ctx.window.MirsadEN;
const keys=new Set();
for(const m of src.matchAll(/tr\('((?:[^'\\]|\\.)*)'/g))keys.add(m[1]);
for(const m of src.matchAll(/tr\([^()]*\?'((?:[^'\\]|\\.)*)':'((?:[^'\\]|\\.)*)'/g)){keys.add(m[1]);keys.add(m[2])}
for(const m of shell.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g))keys.add(m[1]);
// قيم تُعرض عبر tr(متغير): الحالات والأولويات والتصنيفات والخيارات.
const block=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
for(const part of [block('const navs=','const seed'),block('const badgeTone=','function badge'),block('const impactChoices=','function impactQuestion'),block('const categoryNames=','function currentUser'),block('const handoverReasons=','function handover('),block('const specialties=','function showAuth')])
  for(const m of part.matchAll(/'([^']*[؀-ۿ][^']*)'/g))keys.add(m[1]);
const missing=[...keys].filter(k=>/[؀-ۿ]/.test(k)&&!Object.hasOwn(EN,k));
assert.deepEqual(missing,[],'Missing English translations:\n'+missing.join('\n'));
const vars=s=>[...String(s).matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');
for(const [k,v] of Object.entries(EN))assert.equal(vars(k),vars(v),'Placeholder mismatch for: '+k);
for(const v of Object.values(EN))assert.ok(!/[؀-ۿ]/.test(v)||v==='ع','English value contains Arabic: '+v);
// tr() behaviour
const decl=src.slice(src.indexOf('let lang='),src.indexOf('const paths='));
const c2={window:ctx.window};vm.createContext(c2);vm.runInContext(decl,c2);
assert.equal(vm.runInContext("tr('لوحة التحكم')",c2),'لوحة التحكم');
vm.runInContext("lang='en'",c2);
assert.equal(vm.runInContext("tr('لوحة التحكم')",c2),'Dashboard');
assert.equal(vm.runInContext("tr('أهلًا {name}',{name:'Layan'})",c2),'Welcome, Layan');
assert.equal(vm.runInContext("trEvent('أضيفت خطوة: فحص الكابل')",c2),'Step added: فحص الكابل');
assert.equal(vm.runInContext("trEvent('حدد الفني الأولوية: عالية. السبب: توقف القسم')",c2),'Technician set the priority: High. Reason: توقف القسم');
assert.equal(vm.runInContext("trEvent('تم إغلاق البلاغ بعد إكمال جميع الخطوات.')",c2),'Ticket closed after all steps were completed.');
assert.equal(vm.runInContext("tr('نص غير موجود')",c2),'نص غير موجود','unknown text falls back to Arabic');
console.log(`PASS i18n: ${keys.size} interface strings have English translations; placeholders match; tr/trEvent switch correctly.`);
