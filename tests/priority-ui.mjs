import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=fs.readFileSync('public/mirsad.js','utf8');
const ast=ts.createSourceFile('mirsad.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
// Load real rendering functions without starting network/session/UI side effects.
const declarations=ast.statements.filter(s=>ts.isFunctionDeclaration(s)||ts.isVariableStatement(s)).map(s=>s.getText(ast)).join('\n');
const ctx=vm.createContext({console,Date,Intl,setTimeout,clearTimeout});vm.runInContext(declarations,ctx);
vm.runInContext(`serviceConfig={};currentSession={user:{id:'person',email:'test@example.invalid'}};liveProfile={id:'person',full_name:'Test',role:'user',technician_status:'not_requested'};`,ctx);
const ticket={id:1,priority:'بانتظار مراجعة فني',priorityState:'needs_review',priorityReason:'وصف يحتاج مراجعة',questions:['<img src=x onerror=alert(1)>']};
ctx.sample=ticket;
let html=vm.runInContext('priorityPanel(sample)',ctx);
assert.ok(html.includes('بانتظار مراجعة فني'));assert.ok(!html.includes('onclick="openPriorityReview'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));
vm.runInContext("liveProfile.role='technician';liveProfile.technician_status='pending'",ctx);html=vm.runInContext('priorityPanel(sample)',ctx);assert.ok(!html.includes('onclick="openPriorityReview'));
vm.runInContext("liveProfile.technician_status='approved'",ctx);html=vm.runInContext('priorityPanel(sample)',ctx);assert.ok(html.includes('onclick="openPriorityReview(1)'));
ctx.sample={...ticket,priorityState:'ready',priority:'متوسطة',prioritySource:'technician'};html=vm.runInContext('priorityPanel(sample)',ctx);assert.ok(html.includes('حددها فني معتمد'));assert.ok(!html.includes('onclick="openPriorityReview'));
console.log('PASS UI permission and escaping checks: users/applicants cannot see priority controls; approved technicians can review; source and questions render safely.');
