import fs from 'node:fs';import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),src=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const {Session2D,RuleSet,ai2ChooseMove,fingerprint2,AI_PARAMS2,ai2Vcf,ai2WinPoints,ai2VcfSafe,ai2ValidatePoints}=new Function(src+';return {Session2D,RuleSet,ai2ChooseMove,fingerprint2,AI_PARAMS2,ai2Vcf,ai2WinPoints,ai2VcfSafe,ai2ValidatePoints}')();
let passed=0;const check=(v,m)=>{assert.ok(v,m);passed++;};
const make=bits=>Session2D.create(15,15,1,new RuleSet(),{holes:{on:!!(bits&1),randomCount:3,cooldown:3,seed:222},float:{on:!!(bits&2),life:20,opening:0},age:{on:!!(bits&4),turns:30,gray:3}});
const stone=(s,x,y,p)=>{const k=x+s.w*y;s.hole[k]=0;s.top[k]=p;s.birth[k]=0;if(s.variant.float.on){s.base[k]=1;s.baseOwner[k]=p;s.bbirth[k]=0;}};
const apply=(s,a)=>a.kind==='swap'?s.swapLines(a.axis,a.i,a.j):a.kind==='placeHole'?s.placeHole(a.x,a.y):s.place(a.x,a.y,a.layer);
for(let bits=0;bits<8;bits++)for(const level of Object.keys(AI_PARAMS2)){
  const s=make(bits);for(let x=3;x<=6;x++)stone(s,x,7,1);for(const x of [2,7]){s.hole[x+105]=0;if(bits&2)s.base[x+105]=1;}s.captureInitial();const fp=fingerprint2(s),a=ai2ChooseMove(s,{level,seed:7});check(fingerprint2(s)===fp,'search does not mutate');check(apply(s,a).status==='Win','takes immediate win '+bits+'/'+level);
  const d=make(bits);for(let x=3;x<=6;x++)stone(d,x,7,2);stone(d,2,7,1);d.hole[112]=0;if(bits&2)d.base[112]=1;d.captureInitial();const b=ai2ChooseMove(d,{level,seed:8});check(b.kind==='place'&&b.x===7&&b.y===7,'blocks forced win '+bits+'/'+level);
}
for(let bits=0;bits<8;bits++){
  const s=make(bits);let moves=0;
  while(s.status==='Playing'&&moves<100){const stats={},fp=fingerprint2(s),a=ai2ChooseMove(s,{level:'low',seed:123+moves,stats});check(a.kind!=='none','AI always finds move');check(fingerprint2(s)===fp,'selfplay search pure');check(apply(s,a).status!=='Rejected','AI legal in combination '+bits);check(stats.points<=AI_PARAMS2.low.budget,'low budget '+stats.points);moves++;}
  console.log('selfplay',bits,moves,s.status);
}
for(const level of Object.keys(AI_PARAMS2)){const s=make(7);for(let i=0;i<8;i++){const a=ai2ChooseMove(s,{level:'low',seed:i});apply(s,a);}const stats={};ai2ChooseMove(s,{level,seed:1,stats});check(stats.points<=AI_PARAMS2[level].budget,'budget '+level+': '+stats.points);}
// ---- P1：2D VCF ----
const vcfSession=()=>Session2D.create(15,15,1,new RuleSet(),{holes:{on:false},float:{on:false},age:{on:false}});
const vcfCfg={vcfDepth:8,vcfBudget:30000,vcfDefDepth:6,vcfDefBudget:10000};
{
  // 1 手：已有冲四，直接成五
  const s=vcfSession();for(const x of [5,6,7,8])s.top[x+7*15]=1;for(const x of [5,6,7,8])s.board.cells[x+7*15]=1;s.top[4+7*15]=2;s.board.cells[4+7*15]=2;s.captureInitial();
  const fp=fingerprint2(s),st={};const v=ai2Vcf(s,1,vcfCfg,st);
  check(v&&v.x===9&&v.y===7,'VCF 1手成五');
  check(fingerprint2(s)===fp,'VCF 不修改原盘');
  check((st.vcfNodes||0)<=vcfCfg.vcfBudget+16,'VCF 节点预算 '+st.vcfNodes);
}
{
  // 2 手：活三 -> 活四（两端成五点）
  const s=vcfSession();for(const x of [5,6,7]){s.top[x+7*15]=1;s.board.cells[x+7*15]=1;}s.captureInitial();
  const v=ai2Vcf(s,1,vcfCfg,{});
  check(v&&(v.x===4||v.x===8)&&v.y===7,'VCF 2手活三');
}
{
  // 3 手链：两条单端四，最后一条活三变活四
  const s=vcfSession();
  for(const x of [5,6,7]){s.top[x+5*15]=1;s.board.cells[x+5*15]=1;}s.top[4+5*15]=2;s.board.cells[4+5*15]=2;
  for(const x of [5,6,7]){s.top[x+7*15]=1;s.board.cells[x+7*15]=1;}s.top[4+7*15]=2;s.board.cells[4+7*15]=2;
  for(const x of [5,6,7]){s.top[x+9*15]=1;s.board.cells[x+9*15]=1;}
  s.captureInitial();
  const v=ai2Vcf(s,1,vcfCfg,{});
  check(v&&((v.x===8&&v.y===5)||(v.x===8&&v.y===7)||(v.x===4&&v.y===9)),'VCF 3手链');
}
{
  // 防守：白活三，黑必须堵到白 VCF 失效
  const s=vcfSession();for(const x of [5,6,7]){s.top[x+7*15]=2;s.board.cells[x+7*15]=2;}s.captureInitial();
  const a=ai2ChooseMove(s,{level:'ultra',seed:2});
  check(a.kind==='place','VCF 防守选落子');
  const c=s.clone();apply(c,a);
  check(!ai2Vcf(c,2,vcfCfg,{}),'VCF 防守后对方无强制胜');
}
{
  // 对方已有成五点：攻方不能报假胜；唯一应手是堵，堵完做不出四就放弃
  const s=vcfSession();
  for(const x of [1,2,3,4]){s.top[x]=2;s.board.cells[x]=2;}
  s.top[0]=1;s.board.cells[0]=1;                 // 白四只剩 5,0 一个成五点
  for(const x of [5,6,7]){s.top[x+7*15]=1;s.board.cells[x+7*15]=1;}
  s.captureInitial();
  check(!ai2Vcf(s,1,vcfCfg,{}),'对方能立即成五时不报 VCF 胜');
}
{
  // 先手长连自尽：7,7 不是成五点，也不能被选
  const s=vcfSession();for(const x of [3,4,5,6,8]){s.top[x+7*15]=1;s.board.cells[x+7*15]=1;}s.captureInitial();
  const wp=ai2WinPoints(s,1);
  check(!wp.some(p=>p.x===7&&p.y===7),'长连点不算成五点');
  const a=ai2ChooseMove(s,{level:'ultra',seed:1});
  check(a.kind==='place'&&!(a.x===7&&a.y===7),'不选长连自尽');
}
for(const bits of [1,2,4,7])check(!ai2VcfSafe(make(bits)),'带机制变体关 VCF '+bits);
check(ai2VcfSafe(make(0)),'classic 开 VCF');
{
  // 浮空：没有地基的空格只能落底层，不能当顶子成五点。
  // 这是审查抓到的假 +9e7 的回归测试。
  const s=Session2D.create(15,15,1,new RuleSet(),{holes:{on:false},float:{on:true,life:20,opening:0},age:{on:false}});
  for(const x of [0,1,2,3]){const k=x+7*15;s.base[k]=1;s.baseOwner[k]=1;s.top[k]=1;s.board.cells[k]=1;}
  s.captureInitial();
  const k=4+7*15;
  check(!s.canPlace(4,7,'top'),'浮空无地基不能落顶子');
  check(ai2ValidatePoints(s,1,[k]).length===0,'无地基地不算成五点');
  s.base[k]=1;s.baseOwner[k]=1;
  check(ai2ValidatePoints(s,1,[k]).length===1,'有地基地才算成五点');
}
// FA 的方向评估 400 局触发停止线：默认 ultra 必须与关闭 feat 的旧评估着法一致。
for(const seed of [17,29,43]){
  const s=make(6);
  for(let i=0;i<10&&s.status==='Playing';i++)apply(s,ai2ChooseMove(s,{level:'low',seed:seed+i}));
  const fp=fingerprint2(s),actual=ai2ChooseMove(s,{level:'ultra',seed});
  const saved=AI_PARAMS2.ultra.feat;let expected;
  try{AI_PARAMS2.ultra.feat=false;expected=ai2ChooseMove(s,{level:'ultra',seed});}
  finally{AI_PARAMS2.ultra.feat=saved;}
  check(JSON.stringify(actual)===JSON.stringify(expected),'FA 默认走旧评估 '+seed);
  check(fingerprint2(s)===fp,'FA 分流探针不改原盘 '+seed);
}
console.log(`${passed} 项通过 / 0 项失败 (二维AI必胜、必堵、8组合自对局、计算预算、VCF、FA分流)`);
