import fs from 'node:fs';import assert from 'node:assert/strict';
const meta=JSON.parse(fs.readFileSync(new URL('./results/paper-ai/book-e1-meta.json',import.meta.url)));
const html=fs.readFileSync(new URL('../'+meta.candidate,import.meta.url),'utf8');
let core=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const anchor='function aiEvalLeaf(board, cands, mover, foe, winLength, moverRes, foeRes, aggregate) {';
assert.equal(core.split(anchor).length,2);core=core.replace(anchor,anchor+' __scope.push(!!aggregate);');
const C=new Function('let __scope=[];'+core+';return {FourDSession,RuleSet,AI_PARAMS,aiCandidates,aiSearchMove,scope:__scope,reset:s=>{aiPhase=s.phase;aiPointsUsed=0;aiNodesLeft=1200;aiTtReset();}}')();
for(const [n,rotation,wrap,period,level,expected] of [
  [15,false,false,0,'ultra',true],[8,true,true,12,'ultra',true],[9,true,true,12,'ultra',true],
  [10,true,true,12,'ultra',false],[8,true,false,12,'ultra',false],[8,true,true,0,'ultra',false],
  [8,true,true,12,'high',false],[15,false,false,0,'high',false]]){
  const s=C.FourDSession.create(n,1,Object.assign(new C.RuleSet(),{allowRotation:rotation,wrapEdges:wrap,phasePeriod:period}));
  s.board.set(2,3,3,1);s.board.set(5,5,5,2);C.reset(s);C.scope.length=0;
  const p=C.AI_PARAMS[level],saved={...p};
  // 仅在测试实例缩短树，观测真实搜索到叶子时的分流；生产参数与冻结候选不变。
  try{Object.assign(p,{searchDepth:1,depth4d:1,idMax:0,branch:1});
    C.aiSearchMove(s,C.aiCandidates(s.board,20000),p,{searchNodes:0,judgeCalls:0},1);
    assert.ok(C.scope.length>0);assert.ok(C.scope.every(v=>v===expected),JSON.stringify([n,rotation,wrap,period,level]));
  }finally{Object.assign(p,saved);}
}
console.log('8组真实叶子分流通过：3D沿用E1、仅8/9默认4D ultra启用E1，其余维持原评估');
