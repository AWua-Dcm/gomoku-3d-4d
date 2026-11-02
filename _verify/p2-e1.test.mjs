import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildCandidate} from './p2-e1.mjs';
const html=fs.readFileSync(new URL('./fixtures/p2-pre-e1-85945d897aa9.html',import.meta.url),'utf8');
const candidate=buildCandidate(html);
const load=h=>new Function(h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+
  ';return {Board3D,GameSession,RuleSet,aiChooseMove,aiEvalLeaf,AI_W'+
  (h===candidate?',aiAggregateThreat,aiEvalLeafE1,cellOf,setPhase:p=>{aiPhase=p;}':'')+'}')();
const old=load(html),C=load(candidate);let passed=0;
const check=(v,m)=>{assert.ok(v,m);passed++;};
const b=new C.Board3D(15,15,15);
for(const x of [3,4,5,6,8])b.set(x,7,7,1);
const before=Array.from(b.cells),point=[7,7,7];
const restricted=C.aiAggregateThreat(b,point,1,5,true);
const free=C.aiAggregateThreat(b,point,1,5,false);
check(restricted.over>0&&restricted.legal===0&&restricted.top[0]===0,'先手长连点整点剔除');
check(free.legal===1&&free.top[0]===C.AI_W.WIN,'后手长连仍为取胜点');
assert.deepEqual(Array.from(b.cells),before);passed++;
const cross=new C.Board3D(15,15,15);
for(const k of [5,6,8]){cross.set(k,7,7,1);cross.set(7,k,7,1);}
const f=C.aiAggregateThreat(cross,point,1,5,true);
check(f.doubleFour===1&&f.fours>=2,'跨方向双四按点累计');
check(C.aiEvalLeafE1(new C.Board3D(8,8,8),[],1,2,5,true,false)===0,'空候选有限零分');
const cands=[7,7,7,4,7,7,9,7,7,7,4,7];
const mirrored=new C.Board3D(15,15,15);
cross.forEachStone((x,y,z)=>mirrored.set(14-x,14-y,14-z,cross.get(x,y,z)));
const v=C.aiEvalLeafE1(cross,cands,1,2,5,true,false);
check(Number.isFinite(v)&&v===C.aiEvalLeafE1(mirrored,cands.map(k=>14-k),1,2,5,true,false),'空间镜像不改变评估');
check(C.aiEvalLeaf(cross,cands,1,2,5,true,false)===old.aiEvalLeaf(cross,cands,1,2,5,true,false),'默认调用保留旧评估');
for(const n of [8,9]){
  const wrapped=new C.Board3D(n,n,n);wrapped.wrap=true;
  for(const x of [n-2,n-1,0,1])wrapped.set(x,3,3,C.cellOf(1,0));
  check(C.aiAggregateThreat(wrapped,[2,3,3],1,5,true).top[0]===C.AI_W.WIN,'贯通边界成五 '+n);
  C.setPhase(1);
  check(C.aiAggregateThreat(wrapped,[2,3,3],1,5,true).wins===0,'异相位旧线不当成成五 '+n);
  for(const x of [n-2,n-1,0,1])wrapped.set(x,3,3,C.cellOf(1,1));
  check(C.aiAggregateThreat(wrapped,[2,3,3],1,5,true).top[0]===C.AI_W.WIN,'当前相位成五 '+n);
  C.setPhase(0);
}
const swapped=new C.Board3D(15,15,15);
cross.forEachStone((x,y,z)=>swapped.set(x,y,z,3-cross.get(x,y,z)));
check(v===C.aiEvalLeafE1(swapped,cands,2,1,5,true,false),'交换颜色并保持受限身份后分值一致');
for(const level of ['low','medium','high','xhigh']){
  const a=old.GameSession.create(15,1,new old.RuleSet());
  const b=C.GameSession.create(15,1,new C.RuleSet());
  for(const [x,y,z] of [[7,7,7],[8,7,7],[7,8,7],[8,8,7]]){a.place(x,y,z);b.place(x,y,z);}
  assert.deepEqual(C.aiChooseMove(b,{level,seed:123}),old.aiChooseMove(a,{level,seed:123}),level+' 保留原着法');passed++;
}
assert.equal(candidate.split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1],html.split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1]);passed++;
check(buildCandidate(html.replace(/\r\n/g,'\n')).replace(/\r\n/g,'\n')===candidate.replace(/\r\n/g,'\n'),'LF/CRLF 构建一致');
console.log('P2 E1 '+passed+' 项通过');
