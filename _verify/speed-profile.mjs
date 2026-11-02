import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const file=process.argv[2]||'Web_Gomoku3D/index.html',h=fs.readFileSync(file,'utf8');
const C=new Function(h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+
 ';return {FourDSession,RuleSet,RotationMove,aiChooseMove,fingerprint,MoveStatus};')();
const records=JSON.parse(fs.readFileSync('_verify/fixtures/speed-replay-corpus.json','utf8'));
let positions=0;
for(const r of records){
 const s=C.FourDSession.create(r.size,1,Object.assign(new C.RuleSet(),r.rules));
 for(const a of r.opening){const o=s.place(a.x,a.y,a.z);if(o.status===C.MoveStatus.Rejected)throw new Error('开局重放失败');}
 for(let i=0;i<r.moves.length;i++){
  if([4,10,16,22].includes(i)&&s.status==='Playing'){
   const before=C.fingerprint(s),stats={};C.aiChooseMove(s,{level:'ultra',seed:7193+i,stats});
   if(C.fingerprint(s)!==before)throw new Error('AI改变棋盘');positions++;
  }
  const m=r.moves[i],a=m.action,o=m.kind==='place'?s.place(a.x,a.y,a.z):s.rotate(C.RotationMove.fromClockwiseTurns(a.axis,a.layer,a.turns));
  if(!o||o.status===C.MoveStatus.Rejected||(m.kind==='rotate'&&!o.accepted))throw new Error('棋谱重放失败');
 }
}
console.log(JSON.stringify({positions,file}));
