import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {buildLinebook} from './paper-linebook.mjs';import {sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildNodeRules(base){
  const eol=base.includes('\r\n')?'\r\n':'\n';let html=buildLinebook(base,false).replace(/\r\n/g,'\n');
  const start=html.indexOf('function aiNegamax(session,'),end=html.indexOf('\n/**',start);
  if(start<0||end<0)throw new Error('负极大值函数边界缺失');
  let fn=html.slice(start,end).replaceAll('tune.moverRes','nodeMoverRes').replaceAll('tune.foeRes','nodeFoeRes');
  const mark='  const foe = opponentOf(mover);';if(fn.split(mark).length!==2)throw new Error('节点身份锚点不唯一');
  fn=fn.replace(mark,mark+'\n  const nodeMoverRes=tune.nodeRules?rules.isRestricted(mover,fp):tune.moverRes;\n'+
    '  const nodeFoeRes=tune.nodeRules?rules.isRestricted(foe,fp):tune.foeRes;');
  html=html.slice(0,start)+fn+html.slice(end);
  const anchor='tt: !!params.tt, e1: params === AI_PARAMS.ultra && !session.rotationEnabled };';
  if(html.split(anchor).length!==2)throw new Error('模式分流锚点不唯一');
  html=html.replace(anchor,'tt: !!params.tt, e1: params === AI_PARAMS.ultra && !session.rotationEnabled, '+
    'nodeRules: params === AI_PARAMS.ultra && session.rotationEnabled && board.wrap && session.rules.phasePeriod === 12 && board.isCube && board.nx >= 8 && board.nx <= 9 };');
  return html.replace(/\n/g,eol);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const baseline='_verify/fixtures/paper-baseline-ca334d130dfd.html',base=fs.readFileSync(path.join(root,baseline),'utf8'),candidate=buildNodeRules(base);
  const file='_verify/results/paper-ai/node-rules-'+sha(candidate).slice(0,12)+'.html';
  if(fs.existsSync(path.join(root,file))&&fs.readFileSync(path.join(root,file),'utf8')!==candidate)throw new Error('冻结冲突');fs.writeFileSync(path.join(root,file),candidate);
  const meta={baseline,baselineSha:sha(base),candidate:file,candidateSha:sha(candidate),method:'node-restriction-identity',
    note:'精确码本；只修ultra的8/9贯通+晨昏12 4D节点受限身份；3D和其他档位沿用旧策略；权重/深度/分支上限不变'};
  fs.writeFileSync(path.join(root,'_verify/results/paper-ai/node-rules-meta.json'),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
}
