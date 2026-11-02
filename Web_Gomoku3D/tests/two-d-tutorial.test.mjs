import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),html=fs.readFileSync(path.join(root,'Web_Gomoku3D/index.html'),'utf8'),core=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0],ui=fs.readFileSync(path.join(root,'_verify/two-d-ui.part.js'),'utf8');
const {TwoDUI,RuleEngine,MoveStatus,fingerprint2}=new Function(core+'\n'+ui+';return {TwoDUI,RuleEngine,MoveStatus,fingerprint2}')();
const T=TwoDUI.tutorial,levels=T.levels();let assertions=0;
function check(v,m){assert.ok(v,m);assertions++;}
check(levels.length===7&&levels.every(l=>l.mask!==0),'only seven extra-mechanism lessons remain');
for(const lang of ['zh','en','ja','ko','ru','fr'])for(const l of levels){check(l.title(lang).length>0&&!/一线成五|Five in a line/.test(l.title(lang)),'removed classic lesson '+lang);check(l.body(lang).length>40,'complete translated instructions '+l.id+lang);}
check(T.plan({}).length===0,'no tutorial without extra mechanisms');
check(T.plan({holes:{on:true}}).join()==='0','holes teach only holes');
check(T.plan({float:{on:true}}).join()==='1','foundations teach only foundations');
check(T.plan({age:{on:true}}).join()==='2','aging teaches only aging');
for(let mask=1;mask<8;mask++){const plan=T.plan({holes:{on:!!(mask&1)},float:{on:!!(mask&2)},age:{on:!!(mask&4)}});check(plan.every(id=>(levels[id].mask&mask)===levels[id].mask),'plan contains only selected mechanisms '+mask);}
for(const l of levels){
  const s=T.build(l.id),fp=fingerprint2(s);check(s.tutorialPosition,'preset is explicitly a training position');check(fp===fingerprint2(T.build(l.id)),'deterministic independent scenario '+l.id);
  check(RuleEngine.fullScan(s.board,5).length===0,'position has no pre-existing winner '+l.id);check(!T.goal(l.id,s),'position is not already solved '+l.id);
  const stones=s.top.filter(Boolean).length,central=s.top.reduce((n,v,k)=>n+(v&&Math.floor(k/15)>=2&&Math.floor(k/15)<=12?1:0),0);
  check(stones>=30&&s.tutorialBackgroundCells.length>=20,'substantial midgame background '+l.id);check(central>=stones*.65,'stones are not confined to edge strips '+l.id);
  const left=s.top.reduce((n,v,k)=>n+(v&&k%s.w<7?1:0),0),right=s.top.reduce((n,v,k)=>n+(v&&k%s.w>7?1:0),0);check(left>=stones*.3&&right>=stones*.3,'both halves contain interacting play '+l.id);
  let connected=0;for(let k=0;k<s.top.length;k++)if(s.top[k]){const x=k%s.w,y=Math.floor(k/s.w);if([-1,0,1].some(dx=>[-1,0,1].some(dy=>(dx||dy)&&s.inBounds(x+dx,y+dy)&&s.top[s.index(x+dx,y+dy)])))connected++;}
  check(connected>=stones*.65,'stones form interacting groups '+l.id);
  const b=s.top.filter(v=>v===1).length,w=s.top.filter(v=>v===2).length;check(Math.abs(b-w)<=1,'balanced visible colors '+l.id);
  for(let k=0;k<s.top.length;k++){
    if(s.hole[k])check(s.top[k]===0,'hole never contains a top stone');
    if(s.variant2.float.on&&s.top[k])check(s.base[k]===1,'every top has a foundation');
    if(s.top[k]&&s.variant2.age.on){const remaining=s.variant2.age.turns*4-s.drain[k];check(remaining>0,'no expired stone remains');check((remaining<=s.variant2.age.gray*4)===(s.top[k]===3),'gray appearance matches remaining lifetime');}
  }
  if(s.variant2.float.on)check(s.base.filter(Boolean).length>s.top.filter(Boolean).length,'unclaimed shared foundations are visible');
  if([0,3,4,6].includes(l.id))check(T.immediateWins(s,1)===0,'swap lesson has no easier immediate black win');
  if([0,3].includes(l.id)){check(T.immediateWins(s,2)===2,'white has two immediate threats');check(T.openFours(s,1)===0,'both black diagonals are initially blocked');}
  if([2,5].includes(l.id))check(s.variant2.age.turns===30&&s.top.filter(v=>v===3).length===3,'aging setup represents a normal 30-turn lifetime');
  if(l.id===6)check(s.bdrain[s.index(11,7)]>s.drain[s.index(11,7)],'foundation is older than its top stone');
  for(const a of l.solution){check(T.allowed(l.id,a),'solution action permitted');const result=T.apply(l.id,s,a);check(result.status!==MoveStatus.Rejected,'solution action legal '+l.id);}
  check(T.goal(l.id,s),'actual actions solve lesson '+l.id);
  if([0,3].includes(l.id)){check(T.immediateWins(s,2)===0,'swap neutralizes both threats');check(T.openFours(s,1)>=2,'swap opens both black diagonals');}
  if(l.id===5){check(s.base[s.index(7,7)]===1,'weathering keeps shared foundation');check(s.history[0].layer==='base'&&s.history[2].layer==='top','waiting and reuse are actual placements');}
  if(l.id===6){check(s.base[s.index(12,6)]===1&&s.top[s.index(12,6)]===0&&s.hole[s.index(12,6)]===1,'hole swallows top and preserves base');check(s.drain[s.index(11,7)]===107&&s.bdrain[s.index(11,7)]===111,'aura slows both layers with distinct ages');}
  for(const a of l.solution)check(s.undo(),'undo each tutorial action');check(fingerprint2(s)===fp,'undo restores all state '+l.id);check(!T.goal(l.id,s),'undo revokes completion '+l.id);
  s.top.fill(0);check(fingerprint2(T.build(l.id))===fp,'scenario cache cannot be corrupted by a caller');
}
for(const id of [0,3]){const solutions=[];for(const axis of ['row','col'])for(let i=0;i<15;i++)for(let j=i+1;j<15;j++){const s=T.build(id);if(!s.canSwapLines(axis,i,j))continue;s.swapLines(axis,i,j);if(T.goal(id,s))solutions.push([axis,i,j]);}check(JSON.stringify(solutions)===JSON.stringify([['col',5,10]]),'double-threat exchange remains uniquely solvable '+id+': '+JSON.stringify(solutions));}
const timed=T.build(2);for(let turn=0;turn<2;turn++){let applied=false;for(let k=0;k<225&&!applied;k++){const x=k%15,y=Math.floor(k/15);if(y===7||!timed.canPlace(x,y))continue;applied=timed.place(x,y).status!==MoveStatus.Rejected;}check(applied,'two realistic intervening moves');}check(timed.top[timed.index(3,7)]===3,'delaying loses the critical colored stone');
console.log('2D tutorials: '+assertions+' assertions passed; seven extra-mechanism midgames solved; no classic tutorial; swap solutions uniquely enumerated.');

