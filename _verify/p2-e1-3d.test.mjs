import fs from 'node:fs';import assert from 'node:assert/strict';import {buildCandidate} from './p2-e1.mjs';
const base=fs.readFileSync(new URL('./fixtures/p2-pre-e1-85945d897aa9.html',import.meta.url),'utf8');
const candidate=buildCandidate(base,'./p2-e1-optimized.part.js',true);
const load=h=>new Function(h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+
  ';return {FourDSession,RuleSet,RotationMove,aiChooseMove,fingerprint}')();
const old=load(base),now=load(candidate);
const line=fs.readFileSync(new URL('./results/selfplay/fair-4d-default-10000/shard-0.jsonl',import.meta.url),'utf8').split('\n')[0],rec=JSON.parse(line);
const position=(C,count)=>{
  const s=C.FourDSession.create(rec.size[0],1,Object.assign(new C.RuleSet(),rec.rules));
  for(const o of rec.opening)s.place(o.x,o.y,o.z);
  for(const m of rec.moves.slice(0,count))m.kind==='place'?s.place(m.action.x,m.action.y,m.action.z):s.rotate(C.RotationMove.fromClockwiseTurns(m.action.axis,m.action.layer,m.action.turns));
  return s;
};
for(const count of [4,10,16]){
  const a=position(old,count),b=position(now,count),fp=now.fingerprint(b);
  assert.deepEqual(now.aiChooseMove(b,{level:'ultra',seed:919}),old.aiChooseMove(a,{level:'ultra',seed:919}),'4D 保持旧评估，位置 '+count);
  assert.equal(now.fingerprint(b),fp);
}
assert.equal(candidate.split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1],base.split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1]);
console.log('3D 分流：3 个真实 4D 中盘着法保持、原盘不变、二维不变');
