import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildCover(source){
  const eol=source.includes('\r\n')?'\r\n':'\n';let html=source.replace(/\r\n/g,'\n');
  const patch=(a,b)=>{if(html.split(a).length!==2)throw new Error('CRS锚点不唯一：'+a);html=html.replace(a,b);};
  const mark='function aiEvalLeaf(board, cands, mover, foe, winLength, moverRes, foeRes, aggregate) {';
  patch(mark,fs.readFileSync(new URL('./cover-residual.part.js',import.meta.url),'utf8').replace(/\r\n/g,'\n')+'\n'+
    mark.replace('aggregate)','aggregate, cover)')+'\n  if(cover)return aiEvalLeafCover(board,cands,mover,foe,winLength,moverRes,foeRes,cover);');
  patch('return aiEvalLeaf(board, cands, mover, foe, tune.winLength, tune.moverRes, tune.foeRes, tune.e1);',
    'return aiEvalLeaf(board, cands, mover, foe, tune.winLength, tune.moverRes, tune.foeRes, tune.e1, tune.cover);');
  patch('winLength, moverRes, foeRes, tune.e1);\n    board.set(best.x, best.y, best.z, EMPTY);',
    'winLength, moverRes, foeRes, tune.e1, tune.cover);\n    board.set(best.x, best.y, best.z, EMPTY);');
  patch('tt: !!params.tt, e1: params === AI_PARAMS.ultra && !session.rotationEnabled };',
    'tt: !!params.tt, e1: params === AI_PARAMS.ultra && !session.rotationEnabled,\n'+
    '                 cover: params === AI_PARAMS.ultra && !moverOverride && session.rotationEnabled && board.wrap && board.isCube &&\n'+
    '                   board.nx >= 8 && board.nx <= 9 && rules.phasePeriod === 12 && winLength === 5 ? {session,stats} : null };');
  patch('const stats = o.stats || null;\n  aiVcfBudgetReset();',
    'const stats = o.stats || null;\n  if(stats){stats.coverLeaves=0;stats.coverCorrections=0;stats.coverPoints=0;stats.coverUnknown=0;}\n  aiVcfBudgetReset();');
  return html.replace(/\n/g,eol);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const at=process.argv.indexOf('--baseline');
  const source=fs.readFileSync(path.resolve(root,at<0?'Web_Gomoku3D/index.html':process.argv[at+1]),'utf8');
  if(sha(source)!=='44872e86ddbc15b09d46e6565d3613909e7e6747ee51b7950ac065c62c3fbcb0')throw new Error('发行基线已变化');
  const baseline='_verify/fixtures/cover-baseline-44872e86ddbc.html',candidate=buildCover(source);
  const output='_verify/results/cover-ai/cover-'+sha(candidate).slice(0,12)+'.html';
  for(const [file,data] of [[baseline,source],[output,candidate]]){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    if(fs.existsSync(path.join(root,file))&&fs.readFileSync(path.join(root,file),'utf8')!==data)throw new Error('冻结内容冲突');
    fs.writeFileSync(path.join(root,file),data);
  }
  const meta={baseline,baselineSha:sha(source),candidate:output,candidateSha:sha(candidate),method:'coverage-residual-spectrum',
    scope:'ultra 4D cube8/9 wrap phase12; static leaf only',gates:{pilotGames:40,formalGames:2000,targetPct:55,p95MaxMs:870,seedPilot:920101,seedFormal:1230001,seedFinal:920401},pilotTag:'crs-fixed-4d-pilot-40'};
  fs.writeFileSync(path.join(root,'_verify/results/cover-ai/meta.json'),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
}
