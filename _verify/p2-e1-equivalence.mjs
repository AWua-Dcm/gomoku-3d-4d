import fs from 'node:fs';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {buildCandidate} from './p2-e1.mjs';
const base=fs.readFileSync(new URL('./fixtures/p2-pre-e1-85945d897aa9.html',import.meta.url),'utf8');
const load=h=>new Function(h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+
  ';return {Board3D,aiCandidates,aiAggregateThreat,aiEvalLeafE1,aiEvalLeaf,cellOf,setPhase:p=>{aiPhase=p;}}')();
const old=load(buildCandidate(base)),opt=load(buildCandidate(base,'./p2-e1-optimized.part.js')),cases=[];
let rng=917345;const random=()=>((rng=Math.imul(rng,1664525)+1013904223>>>0)/4294967296);
for(const n of [8,9,15])for(const wrap of [false,true])for(const phase of [0,1]){
  const board=new old.Board3D(n,n,n);board.wrap=wrap;
  for(let i=0;i<45;i++){const x=random()*n|0,y=random()*n|0,z=random()*n|0;board.set(x,y,z,old.cellOf(1+(i%2),i%3?phase:phase^1));}
  const cands=old.aiCandidates(board,20000);old.setPhase(phase);opt.setPhase(phase);
  for(const side of [1,2])for(const restricted of [true,false])assert.deepEqual(opt.aiAggregateThreat(board,cands,side,5,restricted),old.aiAggregateThreat(board,cands,side,5,restricted));
  assert.equal(opt.aiEvalLeafE1(board,cands,1,2,5,true,false),old.aiEvalLeafE1(board,cands,1,2,5,true,false));
  cases.push({board,cands,phase});
}
function bench(C,name){const evaluate=name==='legacy leaf'?C.aiEvalLeaf:C.aiEvalLeafE1;
  for(let i=0;i<100;i++){const p=cases[i%cases.length];C.setPhase(p.phase);evaluate(p.board,p.cands,1,2,5,true,false);}
  const samples=[];for(let j=0;j<5;j++){const start=performance.now();for(let i=0;i<200;i++){const p=cases[i%cases.length];C.setPhase(p.phase);evaluate(p.board,p.cands,1,2,5,true,false);}samples.push(performance.now()-start);}return {name,samples,median:samples.slice().sort((a,b)=>a-b)[2]};}
const report={cases:cases.length,checks:cases.length*5,legacy:bench(old,'legacy leaf'),original:bench(old,'original E1'),optimized:bench(opt,'equivalent E1')};
fs.writeFileSync(new URL('./results/ai-eval/e1-equivalence-profile.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
