// 独立 E1 候选构建器：冻结来源、按哈希命名；不改发行源码、2D、排序或搜索参数。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export function buildCandidate(html,partName='./p2-e1.part.js',only3D=false){
  const eol=html.includes('\r\n')?'\r\n':'\n';
  html=html.replace(/\r\n/g,'\n');
  const replaceOnce=(from,to)=>{
    if(html.split(from).length!==2)throw new Error('替换锚点不是唯一：'+from);
    html=html.replace(from,to);
  };
  const part=fs.readFileSync(new URL(partName,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  replaceOnce('function aiEvalLeaf(board, cands, mover, foe, winLength, moverRes, foeRes) {',
    part+'\nfunction aiEvalLeaf(board, cands, mover, foe, winLength, moverRes, foeRes, aggregate) {\n'+
    '  if(aggregate)return aiEvalLeafE1(board,cands,mover,foe,winLength,moverRes,foeRes);');
  replaceOnce('return aiEvalLeaf(board, cands, mover, foe, tune.winLength, tune.moverRes, tune.foeRes);',
    'return aiEvalLeaf(board, cands, mover, foe, tune.winLength, tune.moverRes, tune.foeRes, tune.e1);');
  replaceOnce('tt: !!params.tt };','tt: !!params.tt, e1: params === AI_PARAMS.ultra'+(only3D?' && !session.rotationEnabled':'')+' };');
  replaceOnce('winLength, moverRes, foeRes);\n    board.set(best.x, best.y, best.z, EMPTY);',
    'winLength, moverRes, foeRes, tune.e1);\n    board.set(best.x, best.y, best.z, EMPTY);');
  return html.replace(/\n/g,eol);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const at=process.argv.indexOf('--baseline');
  const source=fs.readFileSync(path.resolve(root,at<0?'Web_Gomoku3D/index.html':process.argv[at+1]),'utf8');
  const only3D=process.argv.includes('--3d-only'),optimized=process.argv.includes('--optimized')||only3D;
  const candidate=buildCandidate(source,optimized?'./p2-e1-optimized.part.js':'./p2-e1.part.js',only3D);
  const baseline='_verify/fixtures/p2-pre-e1-'+sha(source).slice(0,12)+'.html';
  const output='_verify/results/ai-eval/e1-'+sha(candidate).slice(0,12)+'.html';
  for(const [file,data] of [[baseline,source],[output,candidate]]){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    if(fs.existsSync(path.join(root,file))&&fs.readFileSync(path.join(root,file),'utf8')!==data)throw new Error('冻结文件冲突');
    fs.writeFileSync(path.join(root,file),data);
  }
  const meta={baseline,baselineSha:sha(source),candidate:output,candidateSha:sha(candidate),
    scope:only3D?'ultra 3D leaf only; 4D legacy; no search/order/VCF changes':'ultra 3D/4D leaf only; AI_EVAL_W unchanged; no search/order/VCF changes',
    gates:{games:2000,targetPct:55,tactics:6,stopPct:52}};
  fs.writeFileSync(path.join(root,'_verify/results/ai-eval/'+(only3D?'e1-3d-meta.json':optimized?'e1-optimized-meta.json':'e1-meta.json')),JSON.stringify(meta,null,2)+'\n');
  console.log(JSON.stringify(meta,null,2));
}
