// 仅从开源工程运行：验证冻结实验，再按需安装到两个工程。默认只记录决策。
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {sha} from './p2-e1.mjs';import {buildCover} from './cover-residual.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),peer=path.resolve(root,'../3-二维玩法联机闭源版');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const meta=read('_verify/results/cover-ai/meta.json'),test=read('_verify/results/cover-ai/tests.json');
assert.equal(test.pass,true);assert.ok(test.checks>=67&&test.bruteForceDefenses>=12588);assert.equal(test.candidateSha,meta.candidateSha);
const validate=(p,games,seed)=>{
 assert.equal(p.results.valid,true);assert.equal(p.results.total,games);assert.equal(p.meta.mode,'4d');assert.equal(p.meta.fourDDefault,true);
 assert.equal(p.meta.cooldown,5);assert.equal(p.meta.seedBase,seed);assert.equal(p.meta.new.sha256,meta.candidateSha);assert.equal(p.meta.old.sha256,meta.baselineSha);
 assert.equal(p.meta.levels.new,'ultra');assert.equal(p.meta.levels.old,'ultra');
 return !p.results.invalid&&!p.results.none&&!p.results.maxPliesGames;
};
const fast=p=>p.results.timingByEngine.new.p95<=meta.gates.p95MaxMs&&p.results.timingByEngine.new.p99<=2*p.results.timingByEngine.old.p99;
const pilot=read('_verify/results/ai-ab/'+meta.pilotTag+'.json');
let reason=null,formal=null,finalPerf=null;
if(!validate(pilot,40,meta.gates.seedPilot))reason='pilot-invalid-none-or-cap';
else if(pilot.results.pct<meta.gates.targetPct)reason='pilot-score-below-55';
else if(!fast(pilot))reason='pilot-performance';
if(!reason){
 const file='_verify/results/cover-ai/formal/4d-2000.json';
 if(!fs.existsSync(path.join(root,file)))reason='awaiting-formal';
 else{
  const plan=read('_verify/results/cover-ai/formal/plan.json');
  assert.equal(plan.seedBase,meta.gates.seedFormal);assert.equal(plan.gamesPerMode,2000);assert.equal(plan.jobs.length,20);
  assert.equal(plan.newSha,meta.candidateSha);assert.equal(plan.oldSha,meta.baselineSha);
  formal=read(file);
  assert.equal(formal.total,2000);assert.equal(formal.mode,'4d');assert.equal(formal.newSha,meta.candidateSha);assert.equal(formal.oldSha,meta.baselineSha);
  if(!formal.valid||formal.invalid||formal.none||formal.maxPliesGames)reason='formal-invalid-none-or-cap';
  else if(formal.pct<meta.gates.targetPct||formal.ci95[0]<=50)reason='formal-score';
 }
}
if(!reason){
 const file='_verify/results/ai-ab/crs-4d-final-40.json';
 if(!fs.existsSync(path.join(root,file)))reason='awaiting-final-performance';
 else{finalPerf=read(file);if(!validate(finalPerf,40,meta.gates.seedFinal)||!fast(finalPerf))reason='final-performance';}
}
const decision={accepted:!reason,applied:false,reason,method:meta.method,meta,tests:{checks:test.checks,bruteForceDefenses:test.bruteForceDefenses},pilot,formal,finalPerf};
const resultFile=path.join(root,'_verify/results/cover-ai/final-decision.json');
if(fs.existsSync(resultFile)){
 const prior=JSON.parse(fs.readFileSync(resultFile));
 if(prior.applied){
  assert.equal(reason,null);assert.equal(prior.meta.candidateSha,meta.candidateSha);
  assert.equal(sha(fs.readFileSync(path.join(root,'Web_Gomoku3D/index.html'))),prior.openSha);
  assert.equal(sha(fs.readFileSync(path.join(peer,'Web_Gomoku3D/index.html'))),prior.closedSha);
  Object.assign(decision,{applied:true,openSha:prior.openSha,closedSha:prior.closedSha});
 }
}
if(process.argv.includes('--apply')&&!decision.applied){
 if(reason)throw new Error('CRS未通过全部验收：'+reason);
 const open=path.join(root,'Web_Gomoku3D/index.html'),closed=path.join(peer,'Web_Gomoku3D/index.html');
 const a=fs.readFileSync(open,'utf8'),b=fs.readFileSync(closed,'utf8');
 assert.equal(sha(a),meta.baselineSha);assert.equal(sha(b),'2b9e4d240796342f8cf567a55f985c296054c1c015301d131fd41e5e525962eb');
 const next=buildCover(a),other=buildCover(b);assert.equal(sha(next),meta.candidateSha);
 const core=s=>s.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0].replace(/\r\n/g,'\n');assert.equal(core(next),core(other));
 const backup=path.join(peer,'_verify/fixtures/cover-baseline-2b9e4d240796.html');
 if(fs.existsSync(backup))assert.equal(sha(fs.readFileSync(backup)),sha(b));fs.writeFileSync(backup,b);
 fs.writeFileSync(open+'.cover.tmp',next);fs.writeFileSync(closed+'.cover.tmp',other);
 try{fs.renameSync(open+'.cover.tmp',open);fs.renameSync(closed+'.cover.tmp',closed);}
 catch(error){fs.writeFileSync(open,a);fs.writeFileSync(closed,b);throw error;}
 Object.assign(decision,{applied:true,openSha:sha(next),closedSha:sha(other)});
}
fs.writeFileSync(resultFile,JSON.stringify(decision,null,2)+'\n');
console.log(JSON.stringify({accepted:decision.accepted,applied:decision.applied,reason,pilot:pivot(pilot),formal:formal?.pct??null}));
function pivot(p){return {pct:p.results.pct,p95:p.results.timingByEngine.new.p95,oldP95:p.results.timingByEngine.old.p95};}
