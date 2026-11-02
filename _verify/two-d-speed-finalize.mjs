import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {sha} from './p2-e1.mjs';import {buildScratchPart,embedPart} from './two-d-scratch.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),peer=path.resolve(root,'../3-二维玩法联机闭源版'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const meta=read('_verify/results/two-d-speed/meta.json'),proof=read('_verify/results/two-d-speed/tests.json'),fixed=read('_verify/results/two-d-speed/fixed-bench.json');
assert.equal(proof.pass,true);assert.equal(proof.candidateSha,meta.candidateSha);assert.ok(proof.clones>=61&&proof.transitions>=580&&proof.calls>=369);
assert.equal(proof.publicRulesUnchanged,true);assert.equal(proof.threeFourDUnchanged,true);assert.equal(fixed.candidateSha,meta.candidateSha);assert.equal(fixed.baselineSha,meta.baselineSha);
assert.equal(Object.keys(fixed.variants).length,8);let reason=null;
for(const [variant,v]of Object.entries(fixed.variants))if(!v.pass)reason='fixed-position-'+variant;
const perfs={};
for(const variant of ['classic','h','f','a']){
 const p=read('_verify/results/ai-ab/two-d-scratch-'+variant+'-40.json'),r=p.results;
 assert.equal(p.meta.mode,'2d');assert.equal(p.meta.twoDVariant,variant);assert.equal(p.meta.seedBase,meta.gates.seed);
 assert.equal(p.meta.new.sha256,meta.candidateSha);assert.equal(p.meta.old.sha256,meta.baselineSha);assert.equal(p.meta.levels.new,'ultra');assert.equal(p.meta.levels.old,'ultra');
 assert.equal(r.valid,true);assert.equal(r.total,40);assert.equal(r.pct,50);assert.equal(r.pairs,20);
 // sameColorPairs只计已决胜负；两局都和棋的配对也必须完整计入等价核对。
 assert.equal(r.sameColorPairs+r.draws/2,r.pairs);assert.equal(r.invalid,0);assert.equal(r.none,0);assert.equal(r.maxPliesGames%2,0);
 const n=r.timingByEngine.new,o=r.timingByEngine.old;
 if(n.p95>=o.p95*meta.gates.p95Factor||n.p99>o.p99*meta.gates.p99Factor)reason='full-game-'+variant;
 perfs[variant]=p;
}
const decision={accepted:!reason,applied:false,reason,meta,proof,fixedSummary:fixed.variants,perfs};
const out=path.join(root,'_verify/results/two-d-speed/final-decision.json'),open=path.join(root,'Web_Gomoku3D/index.html'),closed=path.join(peer,'Web_Gomoku3D/index.html'),openPart=path.join(root,'_verify/two-d-core.part.js'),closedPart=path.join(peer,'_verify/two-d-core.part.js');
const a=fs.readFileSync(open,'utf8'),b=fs.readFileSync(closed,'utf8'),part=fs.readFileSync(openPart,'utf8'),otherPart=fs.readFileSync(closedPart,'utf8');
if(fs.existsSync(out)){
 const prior=JSON.parse(fs.readFileSync(out));if(prior.applied){assert.equal(reason,null);assert.equal(prior.meta.candidateSha,meta.candidateSha);assert.equal(sha(a),prior.openSha);assert.equal(sha(b),prior.closedSha);assert.equal(sha(part),prior.partSha);assert.equal(sha(otherPart),prior.partSha);Object.assign(decision,{applied:true,openSha:prior.openSha,closedSha:prior.closedSha,partSha:prior.partSha});}
}
if(process.argv.includes('--apply')&&!decision.applied){
 if(reason)throw new Error('二维提速未通过：'+reason);
 assert.equal(sha(a),meta.baselineSha);assert.equal(sha(b),'64e7d9f36bdc571619dcb380c528d0742cf6fd8d2d3a5814ec5c0a0e860f39c6');assert.equal(sha(part),meta.partBaselineSha);assert.equal(sha(otherPart),meta.partBaselineSha);
 const nextPart=buildScratchPart(part),next=embedPart(a,nextPart),other=embedPart(b,nextPart);
 assert.equal(sha(nextPart),meta.partSha);assert.equal(sha(next),meta.candidateSha);
 const core=s=>s.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0].replace(/\r\n/g,'\n');assert.equal(core(next),core(other));
 const backup=path.join(peer,'_verify/fixtures/two-d-speed-baseline-64e7d9f36bdc.html');if(fs.existsSync(backup))assert.equal(sha(fs.readFileSync(backup)),sha(b));fs.writeFileSync(backup,b);
 const writes=[[open,next,a],[closed,other,b],[openPart,nextPart,part],[closedPart,nextPart,otherPart]];
 for(const [file,content]of writes)fs.writeFileSync(file+'.2dspeed.tmp',content);
 try{for(const [file]of writes)fs.renameSync(file+'.2dspeed.tmp',file);}catch(error){for(const [file,,original]of writes)fs.writeFileSync(file,original);throw error;}
 Object.assign(decision,{applied:true,openSha:sha(next),closedSha:sha(other),partSha:sha(nextPart)});
}
fs.writeFileSync(out,JSON.stringify(decision,null,2)+'\n');console.log(JSON.stringify({accepted:decision.accepted,applied:decision.applied,reason,openSha:decision.openSha,closedSha:decision.closedSha,partSha:decision.partSha}));
