import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {buildCandidate,sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildP3(base){
  const eol=base.includes('\r\n')?'\r\n':'\n';let html=buildCandidate(base,'./p2-e1-optimized.part.js').replace(/\r\n/g,'\n');
  const patch=(from,to)=>{if(html.split(from).length!==2)throw new Error('P3 锚点不唯一：'+from);html=html.replace(from,to);};
  const part=fs.readFileSync(new URL('./p3-features.part.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  patch('function aiEvalLeaf(board, cands, mover, foe, winLength, moverRes, foeRes, aggregate) {',
    part+'\nfunction aiEvalLeaf(board, cands, mover, foe, winLength, moverRes, foeRes, aggregate, context) {');
  patch('if(aggregate)return aiEvalLeafE1(board,cands,mover,foe,winLength,moverRes,foeRes);',
    'if(aggregate)return aiEvalLeafE1(board,cands,mover,foe,winLength,moverRes,foeRes)+aiP3Value(board,mover,foe,context);');
  patch('e1: params === AI_PARAMS.ultra };','e1: params === AI_PARAMS.ultra, p3: params === AI_PARAMS.ultra ? aiP3Context(session) : null };');
  patch('tune.winLength, tune.moverRes, tune.foeRes, tune.e1);','tune.winLength, tune.moverRes, tune.foeRes, tune.e1, tune.p3);');
  patch('winLength, moverRes, foeRes, tune.e1);','winLength, moverRes, foeRes, tune.e1, tune.p3);');
  return html.replace(/\n/g,eol);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const baseline='_verify/fixtures/p2-pre-e1-85945d897aa9.html',base=fs.readFileSync(path.join(root,baseline),'utf8'),candidate=buildP3(base);
  const output='_verify/results/ai-eval/p3-'+sha(candidate).slice(0,12)+'.html';
  if(fs.existsSync(path.join(root,output))&&fs.readFileSync(path.join(root,output),'utf8')!==candidate)throw new Error('P3 冻结候选冲突');
  fs.writeFileSync(path.join(root,output),candidate);
  const meta={baseline,baselineSha:sha(base),candidate:output,candidateSha:sha(candidate),scope:'E1 + P3 topology/phase/cooldown leaf features only; experiment, not released'};
  fs.writeFileSync(path.join(root,'_verify/results/ai-eval/p3-meta.json'),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
}
