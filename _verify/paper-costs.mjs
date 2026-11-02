import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {buildLinebook} from './paper-linebook.mjs';import {sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildCosts(base){
  const eol=base.includes('\r\n')?'\r\n':'\n';let html=buildLinebook(base,false).replace(/\r\n/g,'\n');
  const patch=(a,b)=>{if(html.split(a).length!==2)throw new Error('防点锚点不唯一：'+a);html=html.replace(a,b);};
  patch('const AI_LINE_BOOK = new Uint8Array(59049);','const AI_LINE_BOOK = new Uint16Array(59049);\nconst AI_LAST_COST_MASKS = new Uint16Array(13);');
  patch('let need=5;','let need=5,mask=0;');
  patch('let ok=true,mine=0;const base=5+s;','let ok=true,mine=0,empty=-1;const base=5+s;');
  patch('if(v===S_EMPTY)continue;if(v===S_MINE)','if(v===S_EMPTY){empty=j;continue;}if(v===S_MINE)');
  patch('if(ok){const gap=5-(mine+1);if(gap<need)need=gap;}','if(ok){const gap=5-(mine+1);if(gap===1)mask|=1<<(empty-1);if(gap<need)need=gap;}');
  patch('if(need===1)return 2+(run===4&&openA&&openB?4:0);','if(need===1)return (2+(run===4&&openA&&openB?4:0))|(mask<<6);');
  patch('    packed--;','    packed--;\n    AI_LAST_COST_MASKS[i]=packed>>>6;');
  const start=html.indexOf('function aiThreatAt(board,'),end=html.indexOf('\n/**',start);
  const raw='return { wins: wins, fours: fours, openFours: openFours, threes: threes, twos: twos, over: over };';
  let fn=html.slice(start,end);if(fn.split(raw).length!==2)throw new Error('原始威胁返回锚点缺失');
  fn=fn.replace(raw,'const result={ wins: wins, fours: fours, openFours: openFours, threes: threes, twos: twos, over: over };\n'+
    '  if(AI_COST_CONTEXT)aiAttachCostMeta(board,x,y,z,player,winLength,restricted,result);\n  return result;');
  const part=fs.readFileSync(new URL('./paper-costs.part.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  html=html.slice(0,start)+part+'\n'+fn+html.slice(end);
  patch('function aiThreatValue(t, restricted) {','function aiThreatValue(t, restricted) {\n  t=aiCostAdjusted(t,restricted);');
  patch('function aiSearchMove(session, safe, params, stats, moverOverride) {','function aiSearchMoveCore(session, safe, params, stats, moverOverride) {');
  patch('  const stats = o.stats || null;\n  aiVcfBudgetReset();','  const stats = o.stats || null;\n  if(stats){stats.costChecks=0;stats.costCorrections=0;stats.costUnknown=0;}\n  aiVcfBudgetReset();');
  return html.replace(/\n/g,eol);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const baseline='_verify/fixtures/paper-baseline-ca334d130dfd.html',base=fs.readFileSync(path.join(root,baseline),'utf8'),candidate=buildCosts(base);
  const file='_verify/results/paper-ai/costs-'+sha(candidate).slice(0,12)+'.html';
  if(fs.existsSync(path.join(root,file))&&fs.readFileSync(path.join(root,file),'utf8')!==candidate)throw new Error('冻结冲突');
  fs.writeFileSync(path.join(root,file),candidate);
  const meta={baseline,baselineSha:sha(base),candidate:file,candidateSha:sha(candidate),method:'independent-defense-cost',
    note:'不启用4D E1；精确16位码本+合法防点去重；仅ultra默认4D常规搜索相位安全窗口内生效；规则/深度/分支上限不变'};
  fs.writeFileSync(path.join(root,'_verify/results/paper-ai/costs-meta.json'),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
}
