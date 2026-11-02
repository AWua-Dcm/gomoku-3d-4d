import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {sha} from './p2-e1.mjs';import {buildSpeed} from './speed-rays.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),peer=path.resolve(root,'../3-二维玩法联机闭源版');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const meta=read('_verify/results/speed-ai/rays-meta.json'),proof=read('_verify/results/speed-ai/tests.json');
assert.equal(meta.rays,true);assert.equal(proof.pass,true);assert.ok(proof.checks>=179800&&proof.geometryEntries>=2414880&&proof.roots>=92&&proof.real4D>=16);
assert.ok(proof.metas.some(m=>m.candidateSha===meta.candidateSha&&m.rays));
const perfs={};let reason=null;
for(const mode of ['3d','4d']){
 const p=read('_verify/results/ai-ab/speed-rays-'+mode+'-40.json'),r=p.results;
 assert.equal(p.meta.mode,mode);assert.equal(p.meta.seedBase,meta.gates.seed);assert.equal(p.meta.new.sha256,meta.candidateSha);assert.equal(p.meta.old.sha256,meta.baselineSha);
 assert.equal(p.meta.levels.new,'ultra');assert.equal(p.meta.levels.old,'ultra');assert.equal(r.total,40);assert.equal(r.valid,true);
 assert.equal(r.pct,50);assert.equal(r.sameColorPairs,20);assert.equal(r.invalid,0);assert.equal(r.none,0);assert.equal(r.maxPliesGames,0);
 if(mode==='4d'){assert.equal(p.meta.fourDDefault,true);assert.equal(p.meta.cooldown,5);}
 const n=r.timingByEngine.new,o=r.timingByEngine.old;
 if(n.p95>=o.p95||n.p95>meta.gates.p95Limits[mode]||n.p99>o.p99*meta.gates.p99Factor)reason='performance-'+mode;
 perfs[mode]=p;
}
const decision={accepted:!reason,applied:false,reason,meta,proof:{checks:proof.checks,geometryEntries:proof.geometryEntries,roots:proof.roots,real4D:proof.real4D},perfs};
const resultFile=path.join(root,'_verify/results/speed-ai/final-decision.json'),open=path.join(root,'Web_Gomoku3D/index.html'),closed=path.join(peer,'Web_Gomoku3D/index.html');
const a=fs.readFileSync(open,'utf8'),b=fs.readFileSync(closed,'utf8');
if(fs.existsSync(resultFile)){
 const prior=JSON.parse(fs.readFileSync(resultFile));
 if(prior.applied){assert.equal(reason,null);assert.equal(prior.meta.candidateSha,meta.candidateSha);assert.equal(sha(a),prior.openSha);assert.equal(sha(b),prior.closedSha);Object.assign(decision,{applied:true,openSha:prior.openSha,closedSha:prior.closedSha});}
}
if(process.argv.includes('--apply')&&!decision.applied){
 if(reason)throw new Error('性能验收未通过：'+reason);
 assert.equal(sha(a),meta.baselineSha);assert.equal(sha(b),'2b9e4d240796342f8cf567a55f985c296054c1c015301d131fd41e5e525962eb');
 const next=buildSpeed(a,true),other=buildSpeed(b,true);assert.equal(sha(next),meta.candidateSha);
 const core=s=>s.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0].replace(/\r\n/g,'\n');assert.equal(core(next),core(other));
 const backup=path.join(peer,'_verify/fixtures/speed-baseline-2b9e4d240796.html');if(fs.existsSync(backup))assert.equal(sha(fs.readFileSync(backup)),sha(b));fs.writeFileSync(backup,b);
 fs.writeFileSync(open+'.speed.tmp',next);fs.writeFileSync(closed+'.speed.tmp',other);
 try{fs.renameSync(open+'.speed.tmp',open);fs.renameSync(closed+'.speed.tmp',closed);}catch(error){fs.writeFileSync(open,a);fs.writeFileSync(closed,b);throw error;}
 Object.assign(decision,{applied:true,openSha:sha(next),closedSha:sha(other)});
}
fs.writeFileSync(resultFile,JSON.stringify(decision,null,2)+'\n');console.log(JSON.stringify({accepted:decision.accepted,applied:decision.applied,reason,openSha:decision.openSha,closedSha:decision.closedSha}));
