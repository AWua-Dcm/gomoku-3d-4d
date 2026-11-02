import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildLinebook(source,enable4D=false){
  const eol=source.includes('\r\n')?'\r\n':'\n';let html=source.replace(/\r\n/g,'\n');
  const start=html.indexOf('function aiThreatAt(board, x, y, z, player, winLength, restricted) {');
  const end=html.indexOf('\n/**',start);if(start<0||end<0)throw new Error('aiThreatAt 边界缺失');
  let fn=html.slice(start,end);
  const patch=(a,b)=>{if(fn.split(a).length!==2)throw new Error('码本锚点不唯一：'+a);fn=fn.replace(a,b);};
  patch('let px = x - half * dx, py = y - half * dy, pz = z - half * dz;',
    'let patternKey=0;\n    let px = x - half * dx, py = y - half * dy, pz = z - half * dz;');
  patch('strip[k] = v;','strip[k] = v;\n      if(k!==half)patternKey=patternKey*3+(v===S_OUT?S_OTHER:v);');
  const begin=fn.indexOf('    let neg = 0;'),finish=fn.indexOf('    // need >= winLength-1',begin);
  const finishLine=fn.indexOf('\n',finish);if(begin<0||finish<0||finishLine<0)throw new Error('分类区间缺失');
  fn=fn.slice(0,begin)+`    let packed=AI_LINE_BOOK[patternKey];
    if(packed===0){packed=aiLineBookClassify(strip)+1;AI_LINE_BOOK[patternKey]=packed;}
    packed--;
    wins+=packed&1;fours+=(packed>>>1)&1;openFours+=(packed>>>2)&1;
    threes+=(packed>>>3)&1;twos+=(packed>>>4)&1;over+=(packed>>>5)&1;
`+fn.slice(finishLine+1);
  const part=fs.readFileSync(new URL('./paper-linebook.part.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  html=html.slice(0,start)+part+'\n'+fn+html.slice(end);
  if(enable4D){
    const from='e1: params === AI_PARAMS.ultra && !session.rotationEnabled';
    if(html.split(from).length!==2)throw new Error('E1 分流锚点不唯一');
    html=html.replace(from,'e1: params === AI_PARAMS.ultra && (!session.rotationEnabled || (board.wrap && session.rules.phasePeriod === 12 && board.isCube && board.nx >= 8 && board.nx <= 9))');
  }
  return html.replace(/\n/g,eol);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const at=process.argv.indexOf('--baseline');
  const source=fs.readFileSync(path.resolve(root,at<0?'Web_Gomoku3D/index.html':process.argv[at+1]),'utf8');
  if(sha(source)!=='ca334d130dfd76b5b5cacb65284ea7b7b8572e897b877841e2b786654d8ae9b7')throw new Error('当前基线变化，需重新登记');
  const baseline='_verify/fixtures/paper-baseline-ca334d130dfd.html';
  if(fs.existsSync(path.join(root,baseline))&&fs.readFileSync(path.join(root,baseline),'utf8')!==source)throw new Error('冻结冲突');
  fs.writeFileSync(path.join(root,baseline),source);
  fs.mkdirSync(path.join(root,'_verify/results/paper-ai'),{recursive:true});
  for(const enable4D of [false,true]){
    const candidate=buildLinebook(source,enable4D),file='_verify/results/paper-ai/'+(enable4D?'book-e1-4d-':'book-')+sha(candidate).slice(0,12)+'.html';
    if(fs.existsSync(path.join(root,file))&&fs.readFileSync(path.join(root,file),'utf8')!==candidate)throw new Error('候选冲突');
    fs.writeFileSync(path.join(root,file),candidate);
    const meta={baseline,baselineSha:sha(source),candidate:file,candidateSha:sha(candidate),enable4D,
      note:enable4D?'精确码本+默认8/9立方4D E1，独立验收':'仅精确码本，策略/搜索/预算应完全相同'};
    fs.writeFileSync(path.join(root,'_verify/results/paper-ai/'+(enable4D?'book-e1-meta.json':'book-meta.json')),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
  }
}
