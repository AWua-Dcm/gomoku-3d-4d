import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {sha} from './p2-e1.mjs';import {buildLinebook} from './paper-linebook.mjs';
import {buildNodeRules} from './paper-node-rules.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),closed=path.resolve(root,'../3-二维玩法联机闭源版');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const nodeRules=process.argv.includes('--node-rules');
const book=read('_verify/results/paper-ai/book-meta.json'),e1=read('_verify/results/paper-ai/'+(nodeRules?'node-rules-meta.json':'book-e1-meta.json'));
const formal=read('_verify/results/paper-ai/'+(nodeRules?'node-rules-formal':'4d-formal')+'/4d-2000.json');
if(!formal.valid||formal.mode!=='4d'||formal.total!==2000||formal.invalid||formal.none||
  formal.newSha!==e1.candidateSha||formal.oldSha!==e1.baselineSha)throw new Error('正式样本不完整、作废或版本不符');
const proof=read('_verify/results/paper-ai/linebook-test.json');
if(proof.checks<62049||proof.rootCases!==30||!proof.rootActionsAndBudgetsEqual||proof.candidateSha!==book.candidateSha)throw new Error('精确等价证据不完整');
const enable4D=formal.pct>=55&&formal.maxPliesGames===0&&!process.argv.includes('--cache-only');
const selected=enable4D?e1:book,prefix='paper-final-'+selected.candidateSha.slice(0,12),perfs={};
if(enable4D&&nodeRules){const t=read('_verify/results/paper-ai/node-rules-tests.json');if(!t.pass||t.checks!==4||t.file!==selected.candidate)throw new Error('节点规则测试未过');}
for(const mode of ['3d','4d']){
  const p=read('_verify/results/ai-ab/'+prefix+'-'+mode+'-40.json'),r=p.results;
  if(!r.valid||r.total!==40||r.invalid||r.none||r.maxPliesGames||p.meta.mode!==mode||
    p.meta.seedBase!==80001||p.meta.new.sha256!==selected.candidateSha||p.meta.old.sha256!==selected.baselineSha||
    p.meta.levels.new!=='ultra'||p.meta.levels.old!=='ultra')throw new Error('最终复测不符：'+mode);
  if(mode==='4d'&&(!p.meta.fourDDefault||p.meta.cooldown!==5))throw new Error('4D默认协议不符');
  if((mode==='3d'||!enable4D)&&r.pct!==50)throw new Error('等价模式未恰好50%：'+mode);
  const n=r.timingByEngine.new,o=r.timingByEngine.old;
  if(n.p95>(mode==='3d'?720:870)||n.p95>o.p95||n.p99>o.p99*2)throw new Error('最终性能未过线：'+mode);
  perfs[mode]=p;
}
const decision={accepted:true,enable4D,nodeRules:enable4D&&nodeRules,selected: selected.candidate,selectedSha:selected.candidateSha,formal,perfs,
  applied:false,scope:enable4D?(nodeRules?'精确码本；ultra 8/9贯通晨昏12 4D修正节点受限身份；二维和3D策略不变':'精确码本全3D/4D；8/9贯通+晨昏12 ultra开启E1；二维不变'):'仅精确码本；策略保持上轮版本',
  e1HeldReason:enable4D?null:formal.pct<55?'正式得分未达55%':formal.maxPliesGames?'存在上限局':'最终性能门槛未过或明确选择只部署等价优化'};
const resultFile=path.join(root,'_verify/results/paper-ai/final-decision.json');
const openFile=path.join(root,'Web_Gomoku3D/index.html'),closedFile=path.join(closed,'Web_Gomoku3D/index.html');
const current=fs.readFileSync(openFile,'utf8'),other=fs.readFileSync(closedFile,'utf8');
if(fs.existsSync(resultFile)){
  const prior=JSON.parse(fs.readFileSync(resultFile));
  if(prior.applied){
    if(prior.selectedSha!==selected.candidateSha||sha(current)!==prior.openSha||sha(other)!==prior.closedSha)throw new Error('已安装记录与源码不符，拒绝覆盖');
    Object.assign(decision,{applied:true,openSha:prior.openSha,closedSha:prior.closedSha});
  }
}
if(process.argv.includes('--apply')&&!decision.applied){
  if(sha(current)!==book.baselineSha||sha(other)!=='afc95c7f9cf74053f5462ebf1662a72b284a2733a34c9067fe672bc1a47029b7')throw new Error('基线源码已变化，拒绝覆盖');
  const build=enable4D&&nodeRules?buildNodeRules:(source=>buildLinebook(source,enable4D));
  const next=build(current),nextClosed=build(other);
  const core=h=>h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0].replace(/\r\n/g,'\n');
  if(sha(next)!==selected.candidateSha||core(next)!==core(nextClosed))throw new Error('安装内容与实测候选/两版内核不符');
  const backup=path.join(closed,'_verify/fixtures/paper-baseline-afc95c7f9cf7.html');fs.mkdirSync(path.dirname(backup),{recursive:true});
  if(fs.existsSync(backup)&&sha(fs.readFileSync(backup))!==sha(other))throw new Error('冻结备份冲突');fs.writeFileSync(backup,other);
  fs.writeFileSync(openFile+'.paper.tmp',next);fs.writeFileSync(closedFile+'.paper.tmp',nextClosed);
  try{fs.renameSync(openFile+'.paper.tmp',openFile);fs.renameSync(closedFile+'.paper.tmp',closedFile);}
  catch(error){fs.writeFileSync(openFile,current);fs.writeFileSync(closedFile,other);throw error;}
  Object.assign(decision,{applied:true,openSha:sha(next),closedSha:sha(nextClosed)});
}
fs.writeFileSync(resultFile,JSON.stringify(decision,null,2)+'\n');
console.log(JSON.stringify({accepted:true,enable4D,applied:decision.applied,pct:formal.pct,openSha:decision.openSha,closedSha:decision.closedSha}));
