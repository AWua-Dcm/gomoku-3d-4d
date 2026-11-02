import fs from 'node:fs';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';import {sha} from './p2-e1.mjs';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const metas=['stream','rays'].map(n=>JSON.parse(read('_verify/results/speed-ai/'+n+'-meta.json')));
const load=h=>new Function(h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+`;return {
 Board3D,FourDSession,RuleSet,RotationMove,MoveStatus,aiThreatAt,aiCandidates,aiChooseMove,fingerprint,cellOf,DIRS13,
 reset:()=>{AI_LINE_BOOK.fill(0);if(typeof AI_RAY_CACHE!=='undefined')AI_RAY_CACHE=null;},
 geometry:b=>typeof aiRayTable==='undefined'?null:aiRayTable(b),
 withRay:(b,fn)=>{if(typeof AI_RAY_ACTIVE==='undefined')return fn();const previous=AI_RAY_ACTIVE;
  AI_RAY_ACTIVE={board:b,wrap:b.wrap,directions:DIRS13.length,table:aiRayTable(b)};try{return fn();}finally{AI_RAY_ACTIVE=previous;}},
 active:()=>typeof AI_RAY_ACTIVE==='undefined'?null:AI_RAY_ACTIVE
};`)();
const old=load(read(metas[0].baseline)),engines=metas.map(m=>load(read(m.candidate)));let checks=0,roots=0;
for(const C of engines){
 const dirs=old.DIRS13.map(d=>d.slice());old.DIRS13.splice(0,old.DIRS13.length,[1,0,0]);C.DIRS13.splice(0,C.DIRS13.length,[1,0,0]);
 const b=new old.Board3D(11,1,1);
 for(let key=0;key<59049;key++){
  let value=key;for(let j=10;j>=0;j--){if(j===5)continue;b.cells[j]=value%3;value=Math.floor(value/3);}b.cells[5]=2;
  assert.deepEqual(C.aiThreatAt(b,5,0,0,1,5,true),old.aiThreatAt(b,5,0,0,1,5,true));checks++;
 }
 old.DIRS13.splice(0,old.DIRS13.length,...dirs);C.DIRS13.splice(0,C.DIRS13.length,...dirs.map(d=>d.slice()));
}
let rng=410219;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/4294967296);
const cases=[];
for(const dims of [[8,8,8],[9,9,9],[15,15,15],[12,8,6],[3,3,3],[5,7,9],[16,16,16],[17,17,17]])for(const wrap of [false,true]){
 const b=new old.Board3D(...dims);b.wrap=wrap;
 for(let i=0;i<b.cells.length;i++)if(random()<.16)b.set(i%b.nx,Math.floor(i/b.nx)%b.ny,Math.floor(i/(b.nx*b.ny)),old.cellOf(1+(random()*2|0),random()*2|0));
 const points=Array.from({length:80},()=>[random()*b.nx|0,random()*b.ny|0,random()*b.nz|0]);cases.push({b,points});
 for(const C of engines)C.withRay(b,()=>{
  for(const [x,y,z] of points)for(const player of [1,2,5,6])for(const length of [4,5,6])for(const restricted of [false,true]){
   assert.deepEqual(C.aiThreatAt(b,x,y,z,player,length,restricted),old.aiThreatAt(b,x,y,z,player,length,restricted));checks++;
  }
  // 改棋子/相位不改几何表；在active期间改变wrap会安全退回条带。
  const prior=b.wrap;b.wrap=!prior;for(const [x,y,z] of points.slice(0,8)){assert.deepEqual(C.aiThreatAt(b,x,y,z,5,5,true),old.aiThreatAt(b,x,y,z,5,5,true));checks++;}b.wrap=prior;
 });
}
const C=engines[1];let geometryEntries=0;
for(const {b}of cases){
 const table=C.geometry(b);if(!table)continue;let at=0;
 // 用旧实现“起点-5、每格纠偏再前进”的顺序核对每个索引，而非重复新实现的直接偏移算法。
 for(let z=0;z<b.nz;z++)for(let y=0;y<b.ny;y++)for(let x=0;x<b.nx;x++)for(const d of old.DIRS13){
  let px=x-5*d[0],py=y-5*d[1],pz=z-5*d[2];
  for(let k=0;k<11;k++){
   if(b.wrap){if(px<0)px+=b.nx;else if(px>=b.nx)px-=b.nx;if(py<0)py+=b.ny;else if(py>=b.ny)py-=b.ny;if(pz<0)pz+=b.nz;else if(pz>=b.nz)pz-=b.nz;}
   if(k!==5){const expected=b.inBounds(px,py,pz)?b.index(px,py,pz):-1;assert.equal(table[at++],expected);geometryEntries++;}
   px+=d[0];py+=d[1];pz+=d[2];
  }
 }
 assert.equal(at,table.length);
}
assert.equal(C.geometry(new old.Board3D(50,50,50)),null);assert.equal(C.geometry(new old.Board3D(5,8,8)),null);
assert.equal(C.geometry(new old.Board3D(16,16,16)).byteLength,4096*13*10*2);checks+=3;
// 相同尺寸、不同方向内容必须使缓存失效。
const db=new old.Board3D(8,8,8);db.set(1,2,3,1);C.geometry(db);const prior=C.DIRS13[0];C.DIRS13[0]=[0,1,0];const basePrior=old.DIRS13[0];old.DIRS13[0]=[0,1,0];
C.withRay(db,()=>assert.deepEqual(C.aiThreatAt(db,2,2,3,1,5,true),old.aiThreatAt(db,2,2,3,1,5,true)));C.DIRS13[0]=prior;old.DIRS13[0]=basePrior;checks++;
for(const [i,p] of JSON.parse(read('_verify/tactics-30.json')).puzzles.entries()){
 const make=E=>{const r=new E.RuleSet();r.allowRotation=false;const s=E.FourDSession.create(p.size,1,r);for(const [x,y,z,c]of p.stones)s.board.set(x,y,z,c);s.inner.currentPlayer=p.side;return s;};
 const stats={},expected=old.aiChooseMove(make(old),{level:'ultra',seed:12345+i,stats});
 for(const E of engines){const s=make(E),before=E.fingerprint(s),got={};assert.deepEqual(E.aiChooseMove(s,{level:'ultra',seed:12345+i,stats:got}),expected);assert.deepEqual(got,stats);assert.equal(E.fingerprint(s),before);assert.equal(E.active(),null);roots++;}
}
const records=JSON.parse(read('_verify/fixtures/speed-replay-corpus.json'));
let real4D=0;
for(const rec of records){
 const sessions=[old,...engines].map(E=>E.FourDSession.create(rec.size,1,Object.assign(new E.RuleSet(),rec.rules)));
 for(const s of sessions)for(const a of rec.opening)s.place(a.x,a.y,a.z);
 for(let i=0;i<rec.moves.length;i++){
  if([4,10,16,22].includes(i)&&sessions[0].status==='Playing'){
   const stats={},expected=old.aiChooseMove(sessions[0],{level:'ultra',seed:7193+i,stats});
   for(let j=0;j<engines.length;j++){const E=engines[j],s=sessions[j+1],before=E.fingerprint(s),got={};assert.deepEqual(E.aiChooseMove(s,{level:'ultra',seed:7193+i,stats:got}),expected);assert.deepEqual(got,stats);assert.equal(E.fingerprint(s),before);assert.equal(E.active(),null);roots++;}
   real4D++;
  }
  const m=rec.moves[i],a=m.action;
  for(let j=0;j<sessions.length;j++){const E=[old,...engines][j],s=sessions[j],o=m.kind==='place'?s.place(a.x,a.y,a.z):s.rotate(E.RotationMove.fromClockwiseTurns(a.axis,a.layer,a.turns));assert.ok(o&&o.status!==E.MoveStatus.Rejected);if(m.kind==='rotate')assert.equal(o.accepted,true);}
 }
}
for(const m of metas)assert.equal(read(m.candidate).split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1],read(m.baseline).split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1]);checks+=2;
const benchCases=cases.filter(({b})=>(b.nx===8&&b.wrap)||(b.nx===15&&!b.wrap));
const benches=[];
for(const {b,points} of benchCases){
 const samples=[];
 for(const [name,E,geometry]of [['baseline',old,false],['stream',engines[0],false],['rays-fallback',engines[1],false],['rays',engines[1],true]]){
  E.reset();const times=[];let checksum=0;
  for(let round=0;round<8;round++){const at=performance.now(),run=()=>{for(let repeat=0;repeat<40;repeat++)for(const [x,y,z]of points)for(const player of [1,2,5,6]){const t=E.aiThreatAt(b,x,y,z,player,5,true);checksum+=t.wins+3*t.fours+5*t.openFours+7*t.threes+11*t.twos+13*t.over;}};if(geometry)E.withRay(b,run);else run();times.push(performance.now()-at);}
  samples.push({name,cold:times[0],warmMedian:times.slice(1).sort((a,b)=>a-b)[3],times,checksum});
 }
 assert.ok(samples.every(s=>s.checksum===samples[0].checksum));
 benches.push({dims:[b.nx,b.ny,b.nz],wrap:b.wrap,samples});
}
const result={checks,geometryEntries,roots,real4D,pass:true,metas,benches};fs.writeFileSync(new URL('_verify/results/speed-ai/tests.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({checks,geometryEntries,roots,real4D,benches}));
