import fs from 'node:fs';import path from 'node:path';import {performance} from 'node:perf_hooks';
import {root,read,load2D,generateCorpus,fromPosition} from './two-d-speed-tools.mjs';
const file=process.argv[2]||'Web_Gomoku3D/index.html';
if(process.argv.includes('--generate')){const p=generateCorpus(file);console.log(JSON.stringify({generated:p.length}));}
else{
 const C=load2D(file),positions=JSON.parse(read('_verify/fixtures/two-d-speed-corpus.json')).positions,rows=[];
 for(let i=0;i<positions.length;i++){
  const p=positions[i],s=fromPosition(C,p),before=C.fingerprint2(s),stats={},t=performance.now(),action=C.ai2ChooseMove(s,{level:'ultra',seed:1650001+i,stats});
  const ms=performance.now()-t;if(C.fingerprint2(s)!==before)throw new Error('AI修改原盘');rows.push({variant:p.variant,ply:p.ply,ms,stats,action});
 }
 fs.mkdirSync(path.join(root,'_verify/results/two-d-speed'),{recursive:true});
 fs.writeFileSync(path.join(root,'_verify/results/two-d-speed/profile-summary.json'),JSON.stringify({file,positions:positions.length,timingForAcceptance:false,rows},null,2)+'\n');console.log(JSON.stringify({file,positions:positions.length}));
}
