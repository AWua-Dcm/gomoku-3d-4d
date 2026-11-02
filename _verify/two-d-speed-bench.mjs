import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {root,read,load2D,fromPosition} from './two-d-speed-tools.mjs';
const meta=JSON.parse(read('_verify/results/two-d-speed/meta.json')),old=load2D(meta.baseline),C=load2D(meta.candidate),positions=JSON.parse(read('_verify/fixtures/two-d-speed-corpus.json')).positions,rows=[];
const summary=a=>{const s=a.slice().sort((x,y)=>x-y);return {n:s.length,mean:a.reduce((x,y)=>x+y,0)/a.length,p50:s[Math.min(s.length-1,Math.floor(s.length*.5))],p95:s[Math.min(s.length-1,Math.floor(s.length*.95))],p99:s[Math.min(s.length-1,Math.floor(s.length*.99))],max:s.at(-1)};};
for(let round=-1;round<6;round++)for(let i=0;i<positions.length;i++){
 const p=positions[i],values={};
 for(const which of (round+i)%2===0?['old','new']:['new','old']){
  const E=which==='old'?old:C,s=fromPosition(E,p),fp=E.fingerprint2(s),stats={},at=performance.now();
  const action=E.ai2ChooseMove(s,{level:'ultra',seed:1650001+i,stats});const ms=performance.now()-at;
  assert.equal(E.fingerprint2(s),fp);values[which]={ms,stats,action};
 }
 assert.deepEqual(values.new.action,values.old.action);assert.deepEqual(values.new.stats,values.old.stats);
 if(round>=0)rows.push({variant:p.variant,position:i,round,oldMs:values.old.ms,newMs:values.new.ms,action:values.new.action,stats:values.new.stats});
}
const variants={};for(const name of [...new Set(rows.map(r=>r.variant))]){const r=rows.filter(r=>r.variant===name),o=summary(r.map(r=>r.oldMs)),n=summary(r.map(r=>r.newMs));variants[name]={old:o,new:n,p95ReductionPct:100*(1-n.p95/o.p95),pass:n.p95<o.p95&&n.p99<=o.p99*meta.gates.p99Factor};}
const result={candidateSha:meta.candidateSha,baselineSha:meta.baselineSha,type:'fixed-position repeated latency, not full games or strength samples',warmupRounds:1,measuredRounds:6,positions:positions.length,variants,rows};
fs.writeFileSync(path.join(root,'_verify/results/two-d-speed/fixed-bench.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({variants}));
