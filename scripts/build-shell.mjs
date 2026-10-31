// يولّد app/shell.ts من app/shell.html مع escaping صحيح.
// الاستخدام: node scripts/build-shell.mjs
import fs from 'node:fs';
const src = new URL('../app/shell.html', import.meta.url);
const out = new URL('../app/shell.ts', import.meta.url);
const html = fs.readFileSync(src, 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '\n');
fs.writeFileSync(out, '// مُولَّد تلقائيًا من app/shell.html — لا تعدّليه يدويًا. شغّلي: node scripts/build-shell.mjs\nexport const shell = ' + JSON.stringify(html) + ';\n');
console.log('app/shell.ts updated (' + html.length + ' chars)');
