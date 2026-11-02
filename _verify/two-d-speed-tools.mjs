import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const read=p=>fs.readFileSync(path.resolve(root,p),'utf8');
export function load2D(file){const h=read(file),src=h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];return new Function(src+';return {Session2D,RuleSet,ai2ChooseMove,fingerprint2,MoveStatus,AI_PARAMS2,TWO_D_ARRAYS,Board3D,aiChooseMove,FourDSession,scratch:typeof ai2UseScratch===\'undefined\'?null:ai2UseScratch};')();}
export const apply2D=(s,a)=>a.kind==='swap'?s.swapLines(a.axis,a.i,a.j):a.kind==='placeHole'?s.placeHole(a.x,a.y):s.place(a.x,a.y,a.layer);
export const fromPosition=(C,p)=>C.Session2D.fromSnapshot(JSON.parse(JSON.stringify(p.snapshot)));
export function generateCorpus(file){
 const C=load2D(file),positions=[];
 for(const name of ['classic','h','f','a','ha','fa','hf','hfa']){
  const lines=read('_verify/results/selfplay/fair-2d-'+name+'-2000/shard-0.jsonl').split('\n').filter(Boolean);
  const records=lines.map(JSON.parse).filter(r=>!r.invalid&&r.aIsBlack).slice(0,2);
  for(const r of records){
   const [w,h]=r.size,holes=name.includes('h'),floating=name.includes('f'),age=name.includes('a');
   const cfg=r.cfg2||{holes:{on:holes,randomCount:Math.max(3,Math.min(7,Math.floor(w*h/15))),perPlayer:0,cooldown:5,seed:r.seed>>>0},float:{on:floating,life:20,opening:8},age:{on:age,turns:30,gray:3,aura:holes&&age}};
   const s=C.Session2D.create(w,h,1,new C.RuleSet(),cfg);
   for(const a of r.opening){if(s.place(a.x,a.y).status===C.MoveStatus.Rejected)throw new Error('开局重放失败');}
   for(let i=0;i<r.moves.length;i++){
    if([3,9,17,29,49].includes(i)&&s.status==='Playing')positions.push({variant:name,gameId:r.gameId,ply:r.moves[i].ply,snapshot:s.serialize()});
    const o=apply2D(s,{kind:r.moves[i].kind,...r.moves[i].action});if(!o||o.status===C.MoveStatus.Rejected)throw new Error('棋谱重放失败：'+name+'/'+i);
   }
   if(s.status!==r.status||s.winner!==r.winner)throw new Error('终局重放不符：'+name);
  }
 }
 fs.mkdirSync(path.join(root,'_verify/results/two-d-speed'),{recursive:true});
 fs.writeFileSync(path.join(root,'_verify/fixtures/two-d-speed-corpus.json'),JSON.stringify({note:'2 records per variant; positions in a game are correlated, not strength samples.',positions},null,2)+'\n');return positions;
}
