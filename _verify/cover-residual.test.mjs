import fs from 'node:fs';import assert from 'node:assert/strict';import {sha} from './p2-e1.mjs';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
const meta=JSON.parse(read('_verify/results/cover-ai/meta.json'));
const load=h=>new Function(h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+`;return {
 FourDSession,RuleSet,RuleEngine,MoveStatus,aiCoverProfile:typeof aiCoverProfile==='function'?aiCoverProfile:null,
 aiChooseMove,aiThreatAt,aiThreatValue,aiCandidates,aiTag,AI_W,cellOf,fingerprint,
 reset:(phase=0,points=0)=>{aiPhase=phase;aiPointsUsed=points;},points:()=>aiPointsUsed,
 limit:AI_POINT_BUDGET_MAX};`)();
const old=load(read(meta.baseline)),C=load(read(meta.candidate));let checks=0,defenses=0;
const mk=(n=9,first=1,phase=0)=>{const s=C.FourDSession.create(n,first,Object.assign(new C.RuleSet(),{allowRotation:true,wrapEdges:true,phasePeriod:12,rotationCooldownPlacements:5}));s.inner.phase=phase;return s;};
const ctx=s=>({session:s,stats:{coverLeaves:0,coverPoints:0,coverCorrections:0,coverUnknown:0,judgeCalls:0}});
function checkProfile(s,p){
 C.reset(s.phase);const b=s.board,fp=C.fingerprint(s),cells=Array.from(b.cells),occupied=[];b.forEachStone((x,y,z)=>occupied.push(b.index(x,y,z)));
 const cands=C.aiCandidates(b,20000),restricted=s.rules.isRestricted(p,s.firstPlayer),context=ctx(s),r=C.aiCoverProfile(b,cands,p,5,restricted,context);
 assert.equal(C.fingerprint(s),fp);assert.deepEqual(Array.from(b.cells),cells);const occupiedAfter=[];b.forEachStone((x,y,z)=>occupiedAfter.push(b.index(x,y,z)));assert.deepEqual(occupiedAfter,occupied);
 if(r.blocks){
  let expected=r.best;
  for(let index=0;index<b.cells.length;index++){
   if(b.cells[index])continue;const x=index%b.nx,y=Math.floor(index/b.nx)%b.ny,z=Math.floor(index/(b.nx*b.ny)),defender=3-p;
   b.set(x,y,z,C.cellOf(defender,s.phase));
   try{
    if(C.RuleEngine.judge(b,{x,y,z},defender,s.firstPlayer,s.rules,C.cellOf(defender,s.phase)).status===C.MoveStatus.LoseByOverline)continue;
    let residual=r.tail;
    for(const a of r.top)if(a.index!==index)residual=Math.max(residual,C.aiThreatValue(C.aiThreatAt(b,a.x,a.y,a.z,C.aiTag(p),5,restricted),restricted));
    expected=Math.min(expected,residual);defenses++;
   }finally{b.set(x,y,z,0);}
  }
  assert.equal(r.residual,expected,'稀疏图与真实落子重算必须相同');
 }
 assert.ok(Number.isFinite(r.value));checks++;return r;
}
const correlated=mk(9);for(const x of [3,4,5])correlated.board.set(x,4,4,2);
const a=checkProfile(correlated,2);assert.ok(a.value<a.baseline,'同一活三的两头不能当成独立威胁');
const independent=mk(9);for(const y of [2,6])for(const x of [3,4,5])independent.board.set(x,y,4,2);
const b=checkProfile(independent,2);assert.ok(b.residual>a.residual,'两个独立三保留更高的防守残余');checks+=2;
const illegal=mk(9);for(const x of [3,4,5])illegal.board.set(x,4,4,2);
for(const x of [2,6])for(const y of [0,1,2,3,5])illegal.board.set(x,y,4,1);
const unanswerable=checkProfile(illegal,2);assert.equal(unanswerable.residual,unanswerable.best,'两端防点均长连自尽时不当作有效防守');checks++;
const suicide=mk(9);for(const x of [0,1,2,3,5])suicide.board.set(x,4,4,1);
C.reset();const suicideProfile=C.aiCoverProfile(suicide.board,[4,4,4],1,5,true,ctx(suicide));
assert.equal(C.aiThreatValue(C.aiThreatAt(suicide.board,4,4,4,1,5,true),true),C.AI_W.SUICIDE);
assert.equal(suicideProfile.value,0);assert.equal(suicideProfile.baseline,0);checks++;
let seed=719311;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(const n of [8,9])for(const phase of [0,1])for(const first of [1,2]){
 const s=mk(n,first,phase);
 for(let i=0;i<48;i++){const x=random()*n|0,y=random()*n|0,z=random()*n|0;if(!s.board.get(x,y,z))s.board.set(x,y,z,C.cellOf(1+(random()*2|0),random()*2|0));}
 for(const side of [1,2])checkProfile(s,side);
}
// 跨面重合（8/9格环面同格会出现在条带两处），非受限长连、受限长连同时由上述真实重算核对。
for(const n of [8,9]){const s=mk(n,2);for(const x of [n-2,n-1,0])s.board.set(x,3,3,1);checkProfile(s,1);}
C.reset(0,C.limit);const context=ctx(correlated),fallback=C.aiCoverProfile(correlated.board,C.aiCandidates(correlated.board,20000),2,5,false,context);
assert.equal(fallback.value,fallback.baseline);assert.ok(context.stats.coverUnknown>0);assert.equal(C.points(),C.limit);checks++;
// 独立3D题集的30个真实动作与预算保持原样，保护已验收E1。
for(const [i,p] of JSON.parse(read('_verify/tactics-30.json')).puzzles.entries()){
 const position=E=>{const r=new E.RuleSet();r.allowRotation=false;const s=E.FourDSession.create(p.size,1,r);for(const [x,y,z,c] of p.stones)s.board.set(x,y,z,c);s.inner.currentPlayer=p.side;return s;};
 const x=position(old),y=position(C),sa={},sb={},fp=C.fingerprint(y);
 assert.deepEqual(C.aiChooseMove(y,{level:'ultra',seed:12345+i,stats:sb}),old.aiChooseMove(x,{level:'ultra',seed:12345+i,stats:sa}));
 for(const key of ['points','searchNodes','vcfNodes'])assert.equal(sb[key],sa[key]);assert.equal(sb.coverLeaves,0);assert.equal(C.fingerprint(y),fp);checks++;
}
assert.equal(read(meta.candidate).split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1],read(meta.baseline).split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1]);checks++;
for(const recipe of [
 {n:8,enabled:true},{n:9,enabled:true},{n:10,enabled:false},{n:8,wrap:false,enabled:false},
 {n:8,period:0,enabled:false},{n:8,rotation:false,enabled:false},{n:8,level:'xhigh',enabled:false},
 {n:8,level:'high',enabled:false},{n:[8,9,8],enabled:false},{n:8,winLength:4,enabled:false}
]){
 const make=E=>{const r=Object.assign(new E.RuleSet(),{allowRotation:recipe.rotation??true,wrapEdges:recipe.wrap??true,phasePeriod:recipe.period??12,winLength:recipe.winLength??5,rotationCooldownPlacements:5});const s=E.FourDSession.create(recipe.n,1,r);s.board.set(1,1,1,1);s.board.set(5,4,6,2);return s;};
 const s=make(C),fp=C.fingerprint(s),stats={},action=C.aiChooseMove(s,{level:recipe.level||'ultra',seed:7193,stats});
 assert.equal(stats.coverLeaves>0,recipe.enabled,JSON.stringify(recipe));assert.equal(C.fingerprint(s),fp);assert.ok(stats.points<=C.limit);
 if(!recipe.enabled){const baselineStats={};assert.deepEqual(action,old.aiChooseMove(make(old),{level:recipe.level||'ultra',seed:7193,stats:baselineStats}));for(const key of ['points','searchNodes','vcfNodes'])assert.equal(stats[key],baselineStats[key]);}
 checks++;
}
const result={checks,bruteForceDefenses:defenses,shared:a,independent:b,candidateSha:sha(read(meta.candidate)),pass:true};
fs.writeFileSync(new URL('_verify/results/cover-ai/tests.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({checks,bruteForceDefenses:defenses,sharedResidual:a.residual,independentResidual:b.residual,pass:true}));
