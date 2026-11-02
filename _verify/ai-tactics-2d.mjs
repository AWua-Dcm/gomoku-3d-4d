import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=process.argv[2]||'Web_Gomoku3D/index.html',text=fs.readFileSync(path.resolve(root,html),'utf8');
const core=text.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const C=new Function(core+';return {Session2D,RuleSet,ai2ChooseMove,ai2Vcf,ai2VcfDefend,fingerprint2,RuleEngine,MoveStatus}')();
const data=JSON.parse(fs.readFileSync(path.join(root,'_verify/tactics-2d.json'))),results=[];
for(const p of data.puzzles){
  const s=C.Session2D.create(15,15,1,new C.RuleSet(),{holes:{on:false},float:{on:false},age:{on:false}});
  for(const [y,color,xs] of p.rows)for(const x of xs){s.top[x+y*15]=color;s.board.cells[x+y*15]=color;}
  s.currentPlayer=p.side;s.captureInitial();const before=C.fingerprint2(s),foe=3-p.side;
  const cfg={vcfDepth:8,vcfBudget:30000};
  const premise=p.type==='defend'?!!C.ai2Vcf(s,foe,cfg,{}):p.type==='vcf'?!!C.ai2Vcf(s,p.side,cfg,{}):true;
  const a=C.ai2ChooseMove(s,{level:'ultra',seed:12345}),pure=C.fingerprint2(s)===before;
  const c=s.clone();let ok=false;
  if(a.kind==='place'){
    const r=c.place(a.x,a.y,a.layer),judged=C.RuleEngine.judge(c.board,{x:a.x,y:a.y,z:0},p.side,c.firstPlayer,c.rules,p.side);
    const won=r.status===C.MoveStatus.Win&&judged.status===C.MoveStatus.Win&&c.winner===p.side;
    if(p.type==='win')ok=won;
    else if(p.type==='vcf')ok=won||C.ai2VcfDefend(c,p.side,8,{nodes:0,limit:30000},{});
    else if(p.type==='defend')ok=won||!C.ai2Vcf(c,foe,cfg,{});
    else ok=r.status!==C.MoveStatus.Rejected&&judged.status!==C.MoveStatus.LoseByOverline&&!(a.x===p.forbidden[0]&&a.y===p.forbidden[1]);
  }
  results.push({id:p.id,pass:!!(premise&&pure&&ok),premise,pure,move:a});
}
const report={html,total:results.length,passed:results.filter(r=>r.pass).length,results};
const out=path.join(root,'_verify/results/ai-tactics');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'2d-'+path.basename(html).replace(/\W/g,'_')+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(report.passed!==report.total)process.exitCode=1;
