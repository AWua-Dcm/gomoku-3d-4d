import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export function analyze(sessions,privateSessions,records){
  const index=new Map(sessions.map(s=>[s.id,s])),mapping=new Map(privateSessions.map(s=>[s.id,s]));
  const seen=new Set(),groups=new Map();
  for(const r of records){
    if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['participant','sessionId','result','difficulty','lossType','notes','recordFile'].includes(k))||
      ['notes','recordFile'].some(k=>r[k]!==undefined&&typeof r[k]!=='string'))throw new Error('结果字段不符合填写schema');
    const s=index.get(r.sessionId),m=mapping.get(r.sessionId),key=r.participant+':'+r.sessionId;
    if(!s||!m||m.eligible!=='accepted')throw new Error('未知/未验收条件：'+r.sessionId);
    if(typeof r.participant!=='string'||!r.participant.trim()||seen.has(key))throw new Error('参与者缺失或重复记录');seen.add(key);
    if(!['human-win','ai-win','draw','aborted'].includes(r.result)||!Number.isInteger(r.difficulty)||r.difficulty<1||r.difficulty>5||
      !['calculated-kill','double-threat','comeback','other','not-applicable'].includes(r.lossType))throw new Error('非法结果/难度/输棋类型');
    const group=r.participant+':'+s.block;if(!groups.has(group))groups.set(group,[]);groups.get(group).push({r,s,m});
  }
  const summary={status:records.length?'collected':'awaiting-real-player-data',records:records.length,
    participants:new Set(records.map(r=>r.participant)).size,completePairs:0,incompletePairs:0,byModeAndColor:{}};
  for(const list of groups.values()){
    if(list.length!==2||list.some(v=>v.r.result==='aborted')||new Set(list.map(v=>v.m.condition)).size!==2){summary.incompletePairs++;continue;}
    const n=list.find(v=>v.m.condition==='new'),o=list.find(v=>v.m.condition==='old');
    if(!n||!o||n.s.mode!==o.s.mode||n.s.playerColor!==o.s.playerColor||
      ['opening','size','rules'].some(k=>JSON.stringify(n.s[k])!==JSON.stringify(o.s[k])))throw new Error('配对条件不同');
    summary.completePairs++;const key=n.s.mode+'/human-'+n.s.playerColor;
    const a=summary.byModeAndColor[key]??={pairs:0,newDifficultySum:0,oldDifficultySum:0,newAiWins:0,oldAiWins:0,lossTypes:{}};
    a.pairs++;a.newDifficultySum+=n.r.difficulty;a.oldDifficultySum+=o.r.difficulty;
    a.newAiWins+=n.r.result==='ai-win'?1:0;a.oldAiWins+=o.r.result==='ai-win'?1:0;
    for(const v of [n,o])if(v.r.result==='ai-win')a.lossTypes[v.r.lossType]=(a.lossTypes[v.r.lossType]||0)+1;
  }
  for(const a of Object.values(summary.byModeAndColor))a.meanDifficultyDifference=(a.newDifficultySum-a.oldDifficultySum)/a.pairs;
  return summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'results/human/blind-study-20261101');
  const sessions=JSON.parse(fs.readFileSync(path.join(dir,'participant-sessions.json'))).sessions;
  const mapping=JSON.parse(fs.readFileSync(path.join(dir,'administrator-private.json'))).sessions;
  const file=path.join(dir,'responses.jsonl'),records=fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').filter(s=>s.trim()).map(JSON.parse):[];
  const report=analyze(sessions,mapping,records);
  fs.writeFileSync(path.join(dir,'administrator-analysis.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
