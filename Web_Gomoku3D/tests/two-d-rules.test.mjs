import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(process.env.GOMOKU_2D_SOURCE || new URL('../index.html',import.meta.url),'utf8');
const source=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const {Session2D,RuleSet,RuleEngine,MoveStatus,fingerprint2,validateVariant2,generateHoles2,twoDRng}=new Function(source+';return {Session2D,RuleSet,RuleEngine,MoveStatus,fingerprint2,validateVariant2,generateHoles2,twoDRng};')();
let passed=0;const check=(v,msg)=>{assert.ok(v,msg);passed++;};
const make=(bits=0,extra={})=>Session2D.create(15,15,1,new RuleSet(),{on:true,holes:{on:!!(bits&1),randomCount:3,perPlayer:0,cooldown:3,seed:123},float:{on:!!(bits&2),life:20,opening:0},age:{on:!!(bits&4),turns:30,gray:3},...extra});
const set=(s,x,y,p)=>{const k=s.index(x,y);s.top[k]=p;s.birth[k]=0;if(s.variant2.float.on){s.base[k]=1;s.baseOwner[k]=p;s.bbirth[k]=0;}};
for(const d of [[1,0],[0,1],[1,1],[1,-1]]){
  const s=make();for(let i=0;i<4;i++)set(s,4+i*d[0],7+i*d[1],1);s.captureInitial();
  check(s.place(4+4*d[0],7+4*d[1]).status==='Win','four line directions');
  check(s.winner===1,'black wins exactly five');check(s.undo()&&s.status==='Playing','undo terminal');
}
for(const first of [1,2]){
  const s=Session2D.create(15,15,first,new RuleSet(),{});for(const x of [1,2,3,5,6])set(s,x,3,first);s.captureInitial();
  check(s.place(4,3).status==='LoseByOverline','restricted first overline');check(s.winner===3-first,'opponent wins overline');
}
for(const free of [false,true]){
  const s=make(0,{freeRule:free});for(const x of [1,2,3,5,6])set(s,x,3,2);s.currentPlayer=2;s.captureInitial();
  check(s.place(4,3).status==='Win','second player long line wins');
}
const free=make(0,{freeRule:true});for(const x of [1,2,3,5,6])set(free,x,3,1);free.captureInitial();check(free.place(4,3).status==='LoseByOverline','legacy freeRule cannot disable first-player overline loss');
for(let bits=0;bits<8;bits++)for(const first of [1,2]){
  const s=make(bits,{freeRule:true});s.firstPlayer=first;s.currentPlayer=first;s.rules.overlineTakesPrecedence=true;
  for(const x of [1,2,3,5,6]){const k=s.index(x,3);s.hole[k]=0;set(s,x,3,first);}s.hole[s.index(4,3)]=0;if(bits&2)s.base[s.index(4,3)]=1;
  s.captureInitial();check(s.place(4,3).status==='LoseByOverline','all combinations and both first-player colors keep six-in-a-row loss');
}
for(const [w,h] of [[10,10],[15,19],[30,30]])for(let seed=1;seed<=20;seed++){
  const n=Math.floor(w*h/15),a=generateHoles2(w,h,n,seed),b=generateHoles2(w,h,n,seed);check(JSON.stringify(a)===JSON.stringify(b),'seed determinism');check(a.length===n,'hole count');
  const occupied=new Set(a.map(p=>p.x+w*p.y));check(occupied.size===n,'unique holes');
  for(const {x,y} of a)check(!(x+1<w&&occupied.has(x+1+w*y))&&!occupied.has(x+w*(y+1)),'orthogonal separation');
}
check(!validateVariant2({w:9,h:15}).ok,'minimum dimension');check(!validateVariant2({age:{on:true,turns:5,gray:3}}).ok,'five-turn gray rejected');
const setup=make(1,{holes:{on:true,randomCount:3,perPlayer:2,cooldown:3,seed:9}});
check(setup.status==='Setup'&&setup.place(0,0).status==='Rejected','setup prevents stones');
for(let i=0;i<4;i++){const p=Array.from({length:225},(_,k)=>[k%15,Math.floor(k/15)]).find(([x,y])=>setup.canPlaceHole(x,y));check(setup.currentPlayer===1+i%2,'alternating hole setup');setup.placeHole(...p);}
check(setup.status==='Playing'&&setup.currentPlayer===1&&setup.hole.reduce((a,b)=>a+b)===7,'a+2b start');
check(setup.moveCount===0&&setup.actionCount===0,'setup is not a timed action');
for(const bits of [1,3,5,7]){
  const s=make(bits);s.hole.fill(0);s.hole[s.index(2,2)]=1;s.hole[s.index(10,10)]=1;s.hole[s.index(13,13)]=1;
  set(s,2,5,2);set(s,8,8,1);s.placementsSinceLastSwap=3;s.captureInitial();const before=fingerprint2(s),drain=s.drain[s.index(8,8)];
  check(s.swapLines('row',2,5).status!=='Rejected','legal swap');check(s.hole[s.index(2,5)]===1&&s.hole[s.index(2,2)]===0,'hole moved');
  check(s.top[s.index(2,5)]===0,'top swallowed');if(bits&2)check(s.base[s.index(2,5)]===1,'foundation survives');
  check(s.top[s.index(8,8)]===1,'unrelated stone stays');check(s.hole.reduce((a,b)=>a+b)===3,'hole count conserved');check(s.handsUntilSwap===3,'cooldown reset');
  check(s.swapLines('row',5,6).status==='Rejected','cooldown enforced');if(bits&4)check(s.drain[s.index(8,8)]>drain,'swap advances age');
  check(s.undo()&&fingerprint2(s)===before,'swap undo restores every field');
}
const floating=make(2);check(floating.place(7,7,'top').status==='Rejected','top needs base');floating.place(7,7,'base');check(floating.top[112]===0&&floating.base[112]===1,'owned base');check(floating.baseOwner[112]===1,'base owner recorded');check(floating.place(7,7,'base').status==='Rejected','cannot place another base');floating.place(7,7,'top');check(floating.top[112]===2,'opponent can claim foundation');check(floating.floatLifeOf(7,7)===20,'opponent top starts at full life');
// Opening gate: first 8 placements only foundations; 9th may use the top.
{
  const s=make(2,{float:{on:true,life:20,opening:8}});
  s.place(0,0,'base');
  check(!s.canPlace(0,0,'top'),'top locked before 8 placements');
  check(s.place(0,0,'top').status==='Rejected','top placement rejected before 8');
  for(let i=1;i<8;i++){const x=i,y=1;check(s.place(x,y,'base').status!=='Rejected','foundation '+i);}
  check(s.moveCount===8,'eight foundation placements');
  check(s.canPlace(0,0,'top'),'top allowed on the 9th placement');
  check(s.place(0,0,'top').status!=='Rejected','top accepted on the 9th');
}
// Repulsion: opponent top on an owned base counts down; at 0 the foundation is destroyed
// and the top falls as a new foundation of its color.
{
  const s=make(2,{float:{on:true,life:10,opening:0}});
  s.place(7,7,'base');s.place(7,7,'top');
  check(s.baseOwner[112]===1&&s.top[112]===2,'white top on black base');
  check(s.floatLifeOf(7,7)===10,'repulsion starts at 10');
  for(let i=0;i<9;i++)s.place(i,0,'base');
  check(s.floatLifeOf(7,7)===1,'one action left');
  s.place(9,0,'base');
  check(s.base[112]===1&&s.baseOwner[112]===2&&s.top[112]===0,'foundation destroyed; white top falls as white base');
  check(s.floatLifeOf(7,7)===10,'new foundation has full life');
}
// Same-color top / empty base do not decrement.
{
  const s=make(2,{float:{on:true,life:10,opening:0}});
  set(s,7,7,1); // black top on a black-owned base
  set(s,8,8,2); // white top on a white-owned base
  s.captureInitial();
  check(s.floatLifeOf(7,7)===10 && s.floatLifeOf(8,8)===10,'same-color tops keep full life');
  for(let i=0;i<10;i++)s.place(i,0,'base');
  check(s.floatLifeOf(7,7)===10 && s.floatLifeOf(8,8)===10,'same-color tops never count down');
  const empty=make(2,{float:{on:true,life:10,opening:0}});
  empty.place(7,7,'base');
  check(empty.floatLifeOf(7,7)===10,'empty base keeps full life');
  for(let i=0;i<10;i++)empty.place(i,0,'base');
  check(empty.floatLifeOf(7,7)===10,'empty base never counts down');
}
// Validation of the new float fields.
check(!validateVariant2({float:{on:true,life:9}}).ok,'float life below 10 rejected');
check(!validateVariant2({float:{on:true,life:31}}).ok,'float life above 30 rejected');
check(!validateVariant2({float:{on:true,opening:21}}).ok,'float opening above 20 rejected');
check(validateVariant2({float:{on:true,life:10,opening:0}}).ok,'float life 10/opening 0 accepted');
const age=make(4,{age:{on:true,turns:5,gray:0}});age.place(7,7);check(age.remainingOf(7,7)===5,'new stone does not age');for(let i=0;i<4;i++)age.place(i,0);check(age.remainingOf(7,7)===1,'four following actions');age.place(4,1);check(age.top[112]===0,'exact expiry');check(age.undo()&&age.remainingOf(7,7)===1,'age undo');
const gray=make(4);set(gray,5,5,1);gray.drain[80]=104;gray.captureInitial();gray.place(0,0);check(gray.top[80]===3&&gray.board.cells[80]===0,'gray blocks and never counts');check(!gray.canPlace(5,5),'gray occupies point');
for(let i=0;i<3;i++)gray.place(i+1,0);check(gray.top[80]===0,'gray expires');
const aura=make(7);aura.hole.fill(0);aura.hole[aura.index(5,5)]=1;check(aura.drainAt(6,6)===1,'inner ring quarter');check(aura.drainAt(7,7)===2,'outer ring half');check(aura.drainAt(8,8)===4,'outside normal');aura.hole[aura.index(7,5)]=1;check(aura.drainAt(6,6)===1,'auras do not stack');
const fa=make(6);set(fa,7,7,1);fa.drain[112]=116;fa.captureInitial();fa.place(0,0);check(fa.top[112]===0&&fa.base[112]===1,'F+A keeps foundation forever');
const hfa=make(7);hfa.hole.fill(0);set(hfa,7,7,1);hfa.bdrain[112]=116;hfa.captureInitial();hfa.place(0,0);check(hfa.base[112]===0&&hfa.top[112]===0,'H+F+A collapsing base removes top');
const gap=make(4);for(const x of [2,3,5,6,7])set(gap,x,7,1);set(gap,4,7,3);gap.drain[109]=116;gap.captureInitial();gap.place(0,0);check(gap.status==='Playing'&&gap.top[109]===0,'empty gap does not magically connect separated stones');
// Fixed-seed property games exercise every combination and full-state undo/replay.
for(let bits=0;bits<8;bits++)for(let game=0;game<50;game++){
  const s=make(bits),rng=twoDRng(777+bits*61+game),initial=s.clone(),sequence=[];
  for(let step=0;step<70&&s.status==='Playing';step++){
    const legal=[];for(let y=0;y<15;y++)for(let x=0;x<15;x++)if(s.canPlace(x,y))legal.push({kind:'place',x,y});
    if(s.canSwap&&rng()<.25)for(let i=0;i<15;i++)for(let j=i+1;j<15;j++)if(s.canSwapLines('row',i,j))legal.push({kind:'swap',axis:'row',i,j});
    if(!legal.length)break;const a=legal[Math.floor(rng()*legal.length)],before=fingerprint2(s);
    const out=a.kind==='swap'?s.swapLines(a.axis,a.i,a.j):s.place(a.x,a.y);check(out.status!==MoveStatus.Rejected,'random action accepted');
    const after=fingerprint2(s);check(s.undo()&&fingerprint2(s)===before,'random undo exact');a.kind==='swap'?s.swapLines(a.axis,a.i,a.j):s.place(a.x,a.y);check(fingerprint2(s)===after,'reapply deterministic');sequence.push(a);
    for(let k=0;k<225;k++){if(s.hole[k])check(!s.top[k],'holes never contain top');if((bits&2)&&s.top[k])check(s.base[k]===1,'top has foundation');if(s.top[k]===3)check(s.board.cells[k]===0,'gray absent from judge');}
    check(s.board.wrap===false,'2D never wraps');if(s.status==='Playing')check(RuleEngine.fullScan(s.board,5).length===0,'no missed winning line');
  }
  for(const a of sequence)a.kind==='swap'?initial.swapLines(a.axis,a.i,a.j):initial.place(a.x,a.y);
  check(fingerprint2(initial)===fingerprint2(s),'deterministic replay all variants');
  check(fingerprint2(Session2D.fromSnapshot(s.serialize()))===fingerprint2(s),'serialized state fingerprint');
}
console.log(`${passed} 项通过 / 0 项失败 (二维规则、8种组合、400局属性测试)`);
