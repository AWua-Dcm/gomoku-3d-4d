import fs from 'node:fs';import assert from 'node:assert/strict';
const meta=JSON.parse(fs.readFileSync(new URL('./results/paper-ai/costs-meta.json',import.meta.url)));
const html=fs.readFileSync(new URL('../'+meta.candidate,import.meta.url),'utf8');
const core=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const C=new Function(core+`;return {FourDSession,RuleSet,RuleEngine,MoveStatus,aiThreatAt,aiThreatValue,fingerprint,AI_W,
  scoped:(s,fn,budget=0)=>{const previous=AI_COST_CONTEXT;aiPhase=s.phase;aiPointsUsed=budget;const stats={costChecks:0,costCorrections:0,costUnknown:0,judgeCalls:0};
    AI_COST_CONTEXT=aiCostContext(s,AI_PARAMS.ultra,stats);try{return {result:fn(),stats,points:aiPointsUsed,active:!!AI_COST_CONTEXT};}finally{AI_COST_CONTEXT=previous;}},
  max:AI_POINT_BUDGET_MAX};`)();
const settings=()=>Object.assign(new C.RuleSet(),{allowRotation:true,wrapEdges:true,phasePeriod:12,rotationCooldownPlacements:5});
const probe=JSON.parse(fs.readFileSync(new URL('./results/paper-ai/shared-cost-probe.json',import.meta.url)));
let checks=0;
for(const first of [1,2])for(const shift of [0,4]){
  const s=C.FourDSession.create(8,first,settings());
  for(const [x,y,z] of probe.reachableMoves)s.place((x+shift)%8,(y+shift)%8,z);
  const fp=C.fingerprint(s),before=[];s.board.forEachStone((...p)=>before.push(p));
  const r=C.scoped(s,()=>{const t=C.aiThreatAt(s.board,shift,shift,0,first,5,true);
    assert.equal(t.fours,2);assert.equal(Object.keys(t).length,6);
    assert.equal(C.aiThreatValue(t,false),C.AI_W.DOUBLE_FOUR,'不同受限身份不误用元数据');
    return C.aiThreatValue(t,true);});
  assert.equal(r.active,true);assert.equal(r.result,C.AI_W.FOUR);assert.equal(r.stats.costCorrections,1);
  assert.equal(C.fingerprint(s),fp);const after=[];s.board.forEachStone((...p)=>after.push(p));assert.deepEqual(after,before);checks++;
  const exhausted=C.scoped(s,()=>C.aiThreatValue(C.aiThreatAt(s.board,shift,shift,0,first,5,true),true),C.max);
  assert.equal(exhausted.result,C.AI_W.DOUBLE_FOUR);assert.equal(exhausted.stats.costUnknown,1);assert.equal(C.fingerprint(s),fp);checks++;
  const elapsed=s.inner.elapsedInPhase;s.inner.elapsedInPhase=s.phaseTarget-2;
  const unsafe=C.scoped(s,()=>C.aiThreatValue(C.aiThreatAt(s.board,shift,shift,0,first,5,true),true));
  assert.equal(unsafe.active,false);assert.equal(unsafe.result,C.AI_W.DOUBLE_FOUR);s.inner.elapsedInPhase=elapsed;checks++;
}
// 常规两独立防点保持高分；单一攻击方成五点若令受限防守方长连自尽，也保留原高分。
{
  const s=C.FourDSession.create(8,1,settings());
  for(const p of [[1,0,0],[2,0,0],[3,0,0],[0,1,0],[0,2,0],[0,3,0]])s.board.set(...p,1);
  s.board.set(7,0,0,2);s.board.set(0,7,0,2);const fp=C.fingerprint(s);
  assert.equal(C.scoped(s,()=>C.aiThreatValue(C.aiThreatAt(s.board,0,0,0,1,5,true),true)).result,C.AI_W.DOUBLE_FOUR);
  const partial=C.scoped(s,()=>C.aiThreatValue(C.aiThreatAt(s.board,0,0,0,1,5,true),true),C.max-3);
  assert.equal(partial.result,C.AI_W.DOUBLE_FOUR);assert.equal(partial.stats.costUnknown,1);assert.equal(C.fingerprint(s),fp);checks+=2;
}
for(const attacker of [1,2]){
  const s=C.FourDSession.create(8,1,settings()),foe=3-attacker;
  for(const p of [[1,1,0],[1,7,0],[2,2,0],[2,6,0],[3,3,0],[3,5,0]])s.board.set(...p,attacker);
  s.board.set(7,7,0,foe);s.board.set(7,1,0,foe);
  // 同一缺口4,4若落黑会形成六连；落白是正常成五。
  for(const x of [1,2,3,5,6])s.board.set(x,4,0,1);
  const fp=C.fingerprint(s),restricted=attacker===1;
  const r=C.scoped(s,()=>C.aiThreatValue(C.aiThreatAt(s.board,0,0,0,attacker,5,restricted),restricted));
  assert.equal(r.result,attacker===1?0:C.AI_W.DOUBLE_FOUR);assert.equal(C.fingerprint(s),fp);checks++;
}
fs.writeFileSync(new URL('./results/paper-ai/costs-tests.json',import.meta.url),JSON.stringify({checks,pass:true,source:meta.candidateSha},null,2)+'\n');
console.log('防点修正 '+checks+' 组通过：真实重放、索引0、换色、长连身份、预算未知、相位窗口、原盘和占位顺序还原');
