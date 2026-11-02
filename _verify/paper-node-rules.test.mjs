import fs from 'node:fs';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=process.argv[2]||'Web_Gomoku3D/index.html',html=fs.readFileSync(path.resolve(root,file),'utf8');
let core=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const anchor='function aiEvalLeaf(board, cands, mover, foe, winLength, moverRes, foeRes, aggregate) {';
assert.equal(core.split(anchor).length,2);core=core.replace(anchor,anchor+' __seen.push({mover,foe,moverRes,foeRes});');
const C=new Function('let __seen=[];'+core+';return {FourDSession,RuleSet,aiNegamax,AI_W,seen:__seen,reset:s=>{aiPhase=s.phase;aiPointsUsed=0;aiNodesLeft=1200;aiTtReset();return aiZobristBoard(s.board);}}')();
let checks=0;
for(const first of [1,2])for(const mover of [1,2]){
  const s=C.FourDSession.create(8,first,Object.assign(new C.RuleSet(),{allowRotation:true,wrapEdges:true,phasePeriod:12,rotationCooldownPlacements:5}));
  for(const x of [2,3,4,6,7])s.board.set(x,3,3,mover);s.board.set(0,0,0,3-mover);
  // 从根出子方传下来的tune；递归节点已经换成对方。
  const ancestor=3-mover;s.inner.currentPlayer=ancestor;
  const tune={winLength:5,branch:1,tt:false,guard:false,e1:false,nodeRules:true,
    moverRes:s.rules.isRestricted(ancestor,first),foeRes:s.rules.isRestricted(mover,first)};
  const hash=C.reset(s);C.seen.length=0;
  const score=C.aiNegamax(s,0,-Infinity,Infinity,mover,null,tune,{searchNodes:0},hash);
  assert.ok(C.seen.length>0);
  for(const node of C.seen){
    assert.equal(node.moverRes,s.rules.isRestricted(node.mover,first),'节点出子方身份必须与规则一致：'+JSON.stringify({first,mover,node}));
    assert.equal(node.foeRes,s.rules.isRestricted(node.foe,first));
  }
  assert.ok(s.rules.isRestricted(mover,first)?score<C.AI_W.WIN:score>=C.AI_W.WIN,'长连负/长连胜的叶子值遵守实际身份');checks++;
}
fs.mkdirSync(path.join(root,'_verify/results/paper-ai'),{recursive:true});
fs.writeFileSync(path.join(root,'_verify/results/paper-ai/node-rules-tests.json'),JSON.stringify({file,checks,pass:true},null,2)+'\n');
console.log('4组节点身份/受限长连叶子测试通过，黑先/白先与双方出子均覆盖');
