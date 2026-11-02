// 只安装已冻结且实际通过的 3D 分流候选；4D 失败实验永不进入发行源码。
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {buildCandidate,sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),closed=path.resolve(root,'../3-二维玩法联机闭源版');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const meta=read('_verify/results/ai-eval/e1-3d-meta.json');
const formal=read('_verify/results/ai-ab/p2-e1-3d-formal/3d-2000.json');
const reasons=[];
if(!formal.valid||formal.total!==2000||formal.invalid||formal.none||formal.newSha!==meta.candidateSha||formal.oldSha!==meta.baselineSha)throw new Error('正式读数不完整或哈希不符');
if(formal.pct<55)reasons.push('3D正式得分未达55%');
let perf=null;
if(!reasons.length){
  perf=read('_verify/results/ai-ab/p2-e1-3d-final-perf-40.json');
  if(!perf.results.valid||perf.meta.new.sha256!==meta.candidateSha||perf.meta.old.sha256!==meta.baselineSha)throw new Error('最终独占性能读数不符');
  if(perf.results.timingByEngine.new.p95>720)reasons.push('3D p95超过方案720ms');
  if(perf.results.timingByEngine.new.p99>2*perf.results.timingByEngine.old.p99)reasons.push('3D p99超过同步旧版2倍');
}
for(const [file,n] of [['_verify/results/ai-tactics/e1-3d-12.log',6],['_verify/results/ai-tactics/e1-3d-30.log',10]]){
  const match=fs.readFileSync(path.join(root,file),'utf8').match(/ultra：防住 (\d+)\//);if(!match||Number(match[1])<n)reasons.push('战术题退步：'+file);
}
const decision={accepted:reasons.length===0,reasons,formal,performance:perf?.results||null,
  target:{threeD:'E1 ultra only',fourD:'legacy',twoD:'P1 + FA rollback'},applied:false};
const decisionFile=path.join(root,'_verify/results/ai-eval/final-decision.json');
if(fs.existsSync(decisionFile)){
  const prior=JSON.parse(fs.readFileSync(decisionFile));
  if(prior.applied){
    if(prior.formal.newSha!==meta.candidateSha||sha(fs.readFileSync(path.join(root,'Web_Gomoku3D/index.html')))!==prior.openSha||
      sha(fs.readFileSync(path.join(closed,'Web_Gomoku3D/index.html')))!==prior.closedSha)throw new Error('已安装记录与当前源码不同，拒绝覆盖收口记录');
    Object.assign(decision,{applied:true,openSha:prior.openSha,closedSha:prior.closedSha});
  }
}
if(decision.accepted&&process.argv.includes('--apply')&&!decision.applied){
  const openFile=path.join(root,'Web_Gomoku3D/index.html'),closedFile=path.join(closed,'Web_Gomoku3D/index.html');
  const current=fs.readFileSync(openFile,'utf8'),other=fs.readFileSync(closedFile,'utf8');
  if(sha(current)!==meta.baselineSha)throw new Error('开源源码发生其他改动，拒绝覆盖');
  if(sha(other)!=='738a2da2ac91c06031c3aed26d7a0765aeda43a037c1987567dbe107c938ede4')throw new Error('闭源源码发生其他改动，拒绝覆盖');
  const next=buildCandidate(current,'./p2-e1-optimized.part.js',true),nextClosed=buildCandidate(other,'./p2-e1-optimized.part.js',true);
  if(sha(next)!==meta.candidateSha)throw new Error('待安装实现与实测候选不同');
  const core=h=>h.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[0].replace(/\r\n/g,'\n');
  if(core(next)!==core(nextClosed))throw new Error('两版3D/4D内核不同，拒绝同步');
  const backup=path.join(closed,'_verify/fixtures/pre-e1-closed-738a2da2ac91.html');
  fs.mkdirSync(path.dirname(backup),{recursive:true});
  if(fs.existsSync(backup)&&sha(fs.readFileSync(backup))!==sha(other))throw new Error('闭源冻结文件冲突');
  fs.writeFileSync(backup,other);fs.writeFileSync(openFile,next);fs.writeFileSync(closedFile,nextClosed);
  decision.applied=true;decision.openSha=sha(next);decision.closedSha=sha(nextClosed);
}
fs.writeFileSync(decisionFile,JSON.stringify(decision,null,2)+'\n');
console.log(JSON.stringify({accepted:decision.accepted,reasons,applied:decision.applied,pct:formal.pct}));
if(!decision.accepted)process.exitCode=1;
