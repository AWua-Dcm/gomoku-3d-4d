// 等价拆分两个半场：每块 100 局、25 个 pair/半场，保持五种开局长度的周期。
// 并发数据只用于棋力；性能必须由独占 CPU 的独立批次验收。
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';import {summarize} from './ai-ab-timing.mjs';
import {chunks} from './ai-ab-batch-plan.mjs';
import {sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1];};
const modes=arg('modes','3d,4d').split(',');if(!modes.length||new Set(modes).size!==modes.length||modes.some(m=>!['3d','4d'].includes(m)))throw new Error('非法 modes');
const meta=JSON.parse(fs.readFileSync(path.resolve(root,arg('meta','_verify/results/ai-eval/e1-meta.json'))));
if(sha(fs.readFileSync(path.resolve(root,meta.candidate)))!==meta.candidateSha||sha(fs.readFileSync(path.resolve(root,meta.baseline)))!==meta.baselineSha)throw new Error('正式批次引擎与冻结哈希不同');
const out=path.resolve(root,arg('out','_verify/results/ai-ab/p2-e1-formal'));fs.mkdirSync(out,{recursive:true});
const seedBase=Number(arg('seed',String(meta.gates?.seedFormal??200001)));
if(!Number.isSafeInteger(seedBase)||seedBase<1)throw new Error('非法 seed');
const jobs=modes.flatMap(mode=>chunks(mode,2000,100,seedBase));
const plan={version:1,modes,gamesPerMode:2000,workers:12,seedBase,new:meta.candidate,old:meta.baseline,
  newSha:meta.candidateSha,oldSha:meta.baselineSha,jobs,note:'并行吞吐跑；性能以独占 CPU 的 perf-40 为准'};
const planFile=path.join(out,'plan.json');
if(fs.existsSync(planFile)&&JSON.stringify(JSON.parse(fs.readFileSync(planFile)))!==JSON.stringify(plan))throw new Error('已有不同正式方案');
fs.writeFileSync(planFile,JSON.stringify(plan,null,2)+'\n');
const executionWorkers=Number(arg('workers',String(plan.workers)));
if(!Number.isInteger(executionWorkers)||executionWorkers<1||executionWorkers>24)throw new Error('执行并发须为1..24');
// 执行资源与冻结的棋局协议分开记录；改变并发不改变种子、颜色、规则、引擎或样本量。
fs.appendFileSync(path.join(out,'executions.jsonl'),JSON.stringify({startedAt:new Date().toISOString(),workers:executionWorkers,
  frozenPlanWorkers:plan.workers,toolSha:sha(fs.readFileSync(fileURLToPath(import.meta.url))),timingForAcceptance:false})+'\n');
const active=new Set();let aborted=false;
const matches=(r,job)=>r.results.valid&&r.results.total===100&&r.meta.mode===job.mode&&
  r.meta.new.sha256===plan.newSha&&r.meta.old.sha256===plan.oldSha&&r.meta.seedBase===job.seed&&
  r.meta.levels.new==='ultra'&&r.meta.levels.old==='ultra'&&r.meta.fourDDefault===(job.mode==='4d');
async function run(job){
  const json=path.join(out,job.tag+'.json'),cp=path.join(out,job.tag+'.checkpoint.jsonl');
  if(fs.existsSync(json)){const r=JSON.parse(fs.readFileSync(json));if(matches(r,job))return;throw new Error('已有结果不匹配');}
  const args=['_verify/ai-ab.mjs','--mode',job.mode,'--games','100','--seed',String(job.seed),
    '--new',plan.new,'--old',plan.old,'--tag',job.tag,'--json',json,'--checkpoint',cp];
  if(job.mode==='4d')args.push('--4d-default');if(fs.existsSync(cp))args.push('--resume');
  const log=fs.openSync(path.join(out,job.tag+'.log'),'a');
  const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,stdio:['ignore',log,log],windowsHide:true});active.add(p);p.on('error',e=>{active.delete(p);reject(e);});p.on('close',code=>{active.delete(p);resolve(code);});});
  fs.closeSync(log);
  if(![0,1].includes(code)||!fs.existsSync(json)||!matches(JSON.parse(fs.readFileSync(json)),job))throw new Error('作废/失败：'+job.tag);
  console.log('完成 '+job.tag+'：'+JSON.parse(fs.readFileSync(json)).results.pct+'%');
}
let next=0;
try{await Promise.all(Array.from({length:executionWorkers},async()=>{while(!aborted&&next<jobs.length){const job=jobs[next++];await run(job);}}));}
catch(error){aborted=true;for(const child of active)child.kill();throw error;}
for(const mode of modes){
  let newModeCoreSha256=null,oldModeCoreSha256=null;
  let score=0,wins=0,losses=0,draws=0,blackWins=0,blackDecided=0,sameColor=0,pairs=0,invalid=0,none=0,caps=0,plies=0,rotations=0,elapsed=0;
  const asBlack={score:0,games:0},asWhite={score:0,games:0},times=[],newTimes=[],oldTimes=[];
  for(const job of jobs.filter(j=>j.mode===mode)){
    const report=JSON.parse(fs.readFileSync(path.join(out,job.tag+'.json'))),r=report.results;
    if(newModeCoreSha256===null){newModeCoreSha256=report.meta.new.coreSha256;oldModeCoreSha256=report.meta.old.coreSha256;}
    if(newModeCoreSha256!==report.meta.new.coreSha256||oldModeCoreSha256!==report.meta.old.coreSha256)throw new Error('mode 内核哈希混用');
    score+=r.newScore;wins+=r.wins;losses+=r.losses;draws+=r.draws;blackWins+=r.rawBlackWins;blackDecided+=r.rawBlackDecided;
    sameColor+=r.sameColorPairs;pairs+=r.pairs;invalid+=r.invalid;none+=r.none;caps+=r.maxPliesGames;rotations+=r.rotations;
    for(const color of ['Black','White']){const a=color==='Black'?asBlack:asWhite;a.score+=r['as'+color].score;a.games+=r['as'+color].games;}
    const rows=fs.readFileSync(path.join(out,job.tag+'.checkpoint.jsonl'),'utf8').trim().split('\n').slice(1).map(JSON.parse);
    if(rows.length!==100||new Set(rows.map(r=>r.key)).size!==100)throw new Error('断点数量不符');
    for(const row of rows){const v=row.r,first=Number(row.key.split(':')[0])===job.seed;
      if(!first&&Number(row.key.split(':')[0])!==job.seed+10000)throw new Error('半场种子不符');
      plies+=v.plies;elapsed+=v.elapsedMs;times.push(...v.msList);
      newTimes.push(...(first?v.aMsList:v.bMsList));oldTimes.push(...(first?v.bMsList:v.aMsList));}
  }
  const n=2000,p=score/n,z=1.96,d=1+z*z/n,centre=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  const result={mode,total:n,newScore:score,pct:score/n*100,ci95:[(centre-half)*100,(centre+half)*100],wins,losses,draws,
    asBlack,asWhite,rawBlackWins:blackWins,rawBlackDecided:blackDecided,rawBlackPct:100*blackWins/blackDecided,
    sameColorPairs:sameColor,pairs,sameColorPct:100*sameColor/pairs,invalid,none,maxPliesGames:caps,avgPlies:plies/n,
    rotations,rotationsPerGame:rotations/n,elapsedGameMs:elapsed,timing:summarize(times),
    timingByEngine:{new:summarize(newTimes),old:summarize(oldTimes)},timingForAcceptance:false,
    valid:invalid===0&&none===0&&pairs*2===n&&asBlack.games===n/2&&asWhite.games===n/2,
    newSha:plan.newSha,oldSha:plan.oldSha,newModeCoreSha256,oldModeCoreSha256};
  fs.writeFileSync(path.join(out,mode+'-2000.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
