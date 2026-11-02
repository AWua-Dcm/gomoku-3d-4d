// 文献启发的独立防点探针：通过真实24手重放到默认4D局面，再用RuleEngine枚举真实成五点。
import fs from 'node:fs';import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('./fixtures/paper-baseline-ca334d130dfd.html',import.meta.url),'utf8');
const C=new Function(html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+
  ';return {FourDSession,RuleSet,RuleEngine,MoveStatus,aiThreatAt,aiThreatValue,cellOf}')();
const s=C.FourDSession.create(8,1,Object.assign(new C.RuleSet(),{allowRotation:true,wrapEdges:true,phasePeriod:12,rotationCooldownPlacements:5}));
const black0=[[1,1,0],[1,7,0],[2,2,0],[2,6,0],[3,3,0],[3,5,0]];
const white0=[[7,7,0],[7,1,0],[0,0,4],[2,5,3],[6,4,5],[5,2,6]];
const black1=[[0,2,2],[1,4,2],[2,6,2],[3,0,3],[4,2,4],[6,6,6]];
const white1=[[7,2,2],[6,4,3],[5,6,4],[4,0,5],[3,2,6],[2,4,7]],moves=[];
for(const [b,w] of [[black0,white0],[black1,white1]])for(let i=0;i<6;i++)for(const p of [b[i],w[i]]){
  const result=s.place(...p);assert.notEqual(result.status,C.MoveStatus.Rejected);assert.equal(s.status,'Playing');moves.push(p);
}
assert.equal(s.phase,0);assert.equal(s.currentPlayer,1);
const raw=C.aiThreatAt(s.board,0,0,0,1,5,true),value=C.aiThreatValue(raw,true);
assert.ok(raw.fours>=2);assert.equal(raw.openFours,0);s.place(0,0,0);assert.equal(s.status,'Playing');
function winningPoints(){const result=[];
  for(let z=0;z<8;z++)for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(s.board.isEmpty(x,y,z)){
    s.board.set(x,y,z,C.cellOf(1,s.phase));
    try{const r=C.RuleEngine.judge(s.board,{x,y,z},1,s.firstPlayer,s.rules,C.cellOf(1,s.phase));if(r.status===C.MoveStatus.Win)result.push([x,y,z]);}
    finally{s.board.set(x,y,z,0);}
  }return result;
}
const before=winningPoints();assert.deepEqual(before,[[4,4,0]]);
const defense=s.place(4,4,0);assert.notEqual(defense.status,C.MoveStatus.Rejected);assert.equal(s.status,'Playing');
const after=winningPoints();assert.deepEqual(after,[]);
const report={boardSize:8,rules:{wrap:true,phasePeriod:12,cooldown:5},reachableMoves:moves,
  attackerMove:[0,0,0],raw,value,winningPointsBefore:before,defense:[4,4,0],winningPointsAfter:after,
  note:'实际合法重放。两条冲四共享一个防点，原方向计数被估成双四；后续可试防点去重，本轮R1冻结候选不改变该特征。'};
fs.writeFileSync(new URL('./results/paper-ai/shared-cost-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
