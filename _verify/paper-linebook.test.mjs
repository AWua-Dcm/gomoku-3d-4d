import fs from 'node:fs';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';
import {sha} from './p2-e1.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const meta=JSON.parse(read('./results/paper-ai/book-meta.json'));
const option=process.argv.indexOf('--candidate'),candidateFile=option<0?meta.candidate:process.argv[option+1];
const load=h=>new Function(h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+
  ';return {Board3D,FourDSession,RuleSet,aiThreatAt,aiCandidates,aiChooseMove,fingerprint,DIRS13,cellOf,resetBook:()=>{if(typeof AI_LINE_BOOK!=="undefined")AI_LINE_BOOK.fill(0);}}')();
const old=load(read('./fixtures/paper-baseline-ca334d130dfd.html')),now=load(read('../'+candidateFile));let checked=0;
const directions=old.DIRS13.map(d=>d.slice());
old.DIRS13.splice(0,old.DIRS13.length,[1,0,0]);now.DIRS13.splice(0,now.DIRS13.length,[1,0,0]);
const line=new old.Board3D(11,1,1);
for(let key=0;key<59049;key++){
  let k=key;for(let j=10;j>=0;j--){if(j===5)continue;line.cells[j]=k%3;k=Math.floor(k/3);}
  line.cells[5]=2;
  assert.deepEqual(now.aiThreatAt(line,5,0,0,1,5,true),old.aiThreatAt(line,5,0,0,1,5,true),'完整三态条带 '+key);checked++;
}
old.DIRS13.splice(0,1,...directions);now.DIRS13.splice(0,1,...directions);
let rng=37178;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
const cases=[];
for(const dims of [[8,8,8],[9,9,9],[15,15,15],[12,8,6],[3,3,3]])for(const wrap of [false,true]){
  const b=new old.Board3D(...dims);b.wrap=wrap;
  for(let i=0;i<b.cells.length;i++)if(random()<.18)b.set(i%b.nx,Math.floor(i/b.nx)%b.ny,Math.floor(i/(b.nx*b.ny)),old.cellOf(1+(random()*2|0),random()*2|0));
  for(let i=0;i<100;i++){
    const x=random()*b.nx|0,y=random()*b.ny|0,z=random()*b.nz|0,p=old.cellOf(1+(random()*2|0),random()*2|0);
    for(const wl of [5,4,6]){assert.deepEqual(now.aiThreatAt(b,x,y,z,p,wl,true),old.aiThreatAt(b,x,y,z,p,wl,true));checked++;}
  }
  const c=old.aiCandidates(b,20000).slice(0,600);cases.push({b,c});
}
function bench(C){C.resetBook();const times=[];for(let r=0;r<6;r++){const t=performance.now();for(const {b,c} of cases)for(let j=0;j<c.length;j+=3)for(const p of [1,2,5,6])C.aiThreatAt(b,c[j],c[j+1],c[j+2],p,5,true);times.push(performance.now()-t);}return {cold:times[0],median:times.slice(1).sort((a,b)=>a-b)[2],samples:times};}
const report={checks:checked,legacy:bench(old),book:bench(now)};
assert.equal(read('../'+candidateFile).split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1],read('./fixtures/paper-baseline-ca334d130dfd.html').split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1]);
console.log(JSON.stringify(report));
const puzzles=JSON.parse(read('./tactics-30.json')).puzzles;
for(let i=0;i<puzzles.length;i++){
  const p=puzzles[i],position=C=>{const r=new C.RuleSet();r.allowRotation=false;const s=C.FourDSession.create(p.size,1,r);
    for(const [x,y,z,c] of p.stones)s.board.set(x,y,z,c);s.inner.currentPlayer=p.side;return s;};
  const a=position(old),b=position(now),fp=now.fingerprint(b),sa={},sb={};
  assert.deepEqual(now.aiChooseMove(b,{level:'ultra',seed:12345+i,stats:sb}),old.aiChooseMove(a,{level:'ultra',seed:12345+i,stats:sa}),'真实战术局面动作 '+i);
  for(const key of ['points','searchNodes','vcfNodes'])assert.equal(sb[key],sa[key],key+' '+i);
  assert.equal(now.fingerprint(b),fp);
}
console.log('30个真实战术局面：动作、搜索节点、预算计数、原盘状态逐项一致');
report.rootCases=puzzles.length;report.rootActionsAndBudgetsEqual=true;report.candidateSha=sha(read('../'+candidateFile));
fs.writeFileSync(new URL('./results/paper-ai/'+(option<0?'linebook-test.json':'costs-linebook-test.json'),import.meta.url),JSON.stringify(report,null,2)+'\n');
