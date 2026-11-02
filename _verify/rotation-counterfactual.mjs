// B 基线的反事实诊断。每次真实转动同时试“不允许转动”的 ultra 落子；只做一手后的比较。
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const dir=path.resolve(root,arg('dir','_verify/results/selfplay/fair-4d-default-10000'));
const limit=Number(arg('limit','20')),file=arg('html','_verify/fixtures/ultra-baseline-6203b1a0.html');
const html=fs.readFileSync(path.resolve(root,file),'utf8'),src=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const C=new Function(src+';return {FourDSession,RuleSet,RotationMove,MoveStatus,aiChooseMove,aiCandidates,aiThreatBest,aiTier,fingerprint,setPhase:p=>{aiPhase=p;}}')();
const records=[];
outer:for(const file of fs.readdirSync(dir).filter(f=>/^shard-\d+\.jsonl$/.test(f)).sort())for(const line of fs.readFileSync(path.join(dir,file),'utf8').split('\n')){
  if(!line.trim())continue;const r=JSON.parse(line);if(r.invalid||!r.aIsBlack)continue;records.push(r);if(records.length>=limit)break outer;
}
const rows=[];let mismatch=0;const sizes=new Set();
const apply=(s,m)=>m.kind==='place'?s.place(m.action.x,m.action.y,m.action.z):s.rotate(C.RotationMove.fromClockwiseTurns(m.action.axis,m.action.layer,m.action.turns));
function view(s,mover){
  C.setPhase(s.phase);const c=C.aiCandidates(s.board,20000),foe=3-mover;
  const mine=C.aiThreatBest(s.board,c,mover,5,s.rules.isRestricted(mover,s.firstPlayer));
  const other=C.aiThreatBest(s.board,c,foe,5,s.rules.isRestricted(foe,s.firstPlayer));
  return {mine,foe:other,mineTier:C.aiTier(mine),foeTier:C.aiTier(other),phase:s.phase};
}
for(const rec of records){
  const dims=rec.size;if(!Array.isArray(dims)||dims.length!==3||!dims.every(n=>n===dims[0]))throw new Error('非法4D尺寸');
  sizes.add(dims[0]);const rules=Object.assign(new C.RuleSet(),rec.rules),s=C.FourDSession.create(dims[0],1,rules);
  for(const a of rec.opening){const r=s.place(a.x,a.y,a.z);if(r.status===C.MoveStatus.Rejected)throw new Error('开局重放被拒');}
  for(const m of rec.moves){
    if(m.kind==='rotate'){
      const fp=C.fingerprint(s),mover=s.currentPlayer,before=view(s,mover),saved=s.rules.allowRotation;
      let place;try{s.rules.allowRotation=false;place=C.aiChooseMove(s,{level:'ultra',seed:(rec.seed^m.ply)>>>0,noRotation:true});}finally{s.rules.allowRotation=saved;}
      if(C.fingerprint(s)!==fp)throw new Error('不转候选修改原盘');
      let flat;const wrap=s.board.wrap;try{s.board.wrap=false;flat=view(s,mover);}finally{s.board.wrap=wrap;}
      const alt=s.phase^1;C.setPhase(alt);const c=C.aiCandidates(s.board,20000);
      const reserve=C.aiThreatBest(s.board,c,mover,5,s.rules.isRestricted(mover,s.firstPlayer));C.setPhase(s.phase);
      const r=apply(s,m);if(!r.accepted)throw new Error('转动重放被拒');const rotate={...view(s,mover),status:s.status,winner:s.winner};
      if(!s.undo()||C.fingerprint(s)!==fp)throw new Error('转动反事实没有还原');
      let placement=null;
      if(place.kind==='place'){
        const p=s.place(place.x,place.y,place.z);if(p.status===C.MoveStatus.Rejected)throw new Error('不转候选被拒');
        placement={...view(s,mover),status:s.status,winner:s.winner,move:place};
        if(!s.undo()||C.fingerprint(s)!==fp)throw new Error('落子反事实没有还原');
      }
      rows.push({gameId:rec.gameId,ply:m.ply,size:dims[0],phase:s.phase,handsUntilFlip:s.handsUntilFlip,
        cooldown:s.placementsUntilRotation,canRotate:s.canRotate,before,flat,wrappedMineDelta:before.mine-flat.mine,
        wrappedFoeDelta:before.foe-flat.foe,reserve,rotate,placement});
    }
    const r=apply(s,m);if(!r||r.status===C.MoveStatus.Rejected||(m.kind==='rotate'&&!r.accepted))throw new Error('重放被拒');
  }
  if(s.status!==rec.status||(s.winner|0)!==(rec.winner|0))mismatch++;
}
const nonterminal=rows.filter(r=>r.rotate.status==='Playing'&&r.placement?.status==='Playing');
const summary={games:records.length,sizes:[...sizes].sort(),rotations:rows.length,mismatch,
  terminalRotations:rows.length-nonterminal.length,comparedNonterminal:nonterminal.length,
  rotateReducesFoeTier:nonterminal.filter(r=>r.rotate.foeTier<r.before.foeTier).length,
  placeReducesFoeTier:nonterminal.filter(r=>r.placement.foeTier<r.before.foeTier).length,
  rotateStrictlyBetterFoeTier:nonterminal.filter(r=>r.rotate.foeTier<r.placement.foeTier).length,
  rotateWorseFoeTier:nonterminal.filter(r=>r.rotate.foeTier>r.placement.foeTier).length,
  note:'只诊断一手后的威胁档位，不是棋力或更优着法证明；无转动入搜索'};
const output={engine:file,sha256:crypto.createHash('sha256').update(html).digest('hex'),dir,summary,rows};
const out=path.join(root,'_verify/results/rotation-counterfactual');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'b-'+limit+'.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(summary));if(mismatch)process.exitCode=1;
