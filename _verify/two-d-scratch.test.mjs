import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {root,read,load2D,apply2D,fromPosition} from './two-d-speed-tools.mjs';
const meta=JSON.parse(read('_verify/results/two-d-speed/meta.json')),old=load2D(meta.baseline),C=load2D(meta.candidate),positions=JSON.parse(read('_verify/fixtures/two-d-speed-corpus.json')).positions;
const state=(E,s)=>{const o=E.Session2D.prototype._snapshot.call(s);for(const key of E.TWO_D_ARRAYS)o[key]=Array.from(o[key]);return JSON.stringify({w:s.w,h:s.h,firstPlayer:s.firstPlayer,rules:s.rules,variant:s.variant2,initialHoles:s.initialHoles,board:{cells:Array.from(s.board.cells),wrap:s.board.wrap,stoneCount:s.board.stoneCount},state:o});};
let clones=0,transitions=0,calls=0;const variants={};
for(let i=0;i<positions.length;i++){
 const p=positions[i],s=fromPosition(C,p),source=state(C,s),scratch=C.scratch(s.clone()),copy=scratch.clone(),plain=s.clone();
 assert.equal(state(C,copy),state(C,plain));for(const k of C.TWO_D_ARRAYS)assert.notEqual(copy[k].buffer,scratch[k].buffer);assert.notEqual(copy.rules,scratch.rules);assert.notEqual(copy.variant2.age,scratch.variant2.age);clones++;
 const moves=[];for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++)if(s.canPlace(x,y))moves.push({kind:'place',x,y,layer:s.variant2.float.on&&!s.base[s.index(x,y)]?'base':'top'});
 const chosen=moves.filter((_,i)=>i===0||i===moves.length-1||i%Math.max(1,Math.floor(moves.length/6))===0);
 for(const axis of ['row','col']){let n=0;for(let a=0;a<(axis==='row'?s.h:s.w)&&n<2;a++)for(let b=a+1;b<(axis==='row'?s.h:s.w)&&n<2;b++)if(s.canSwapLines(axis,a,b)){chosen.push({kind:'swap',axis,i:a,j:b});n++;}}
 chosen.push({kind:'place',x:-1,y:0,layer:'top'});
 for(const a of chosen){const x=plain.clone(),y=copy.clone();assert.deepEqual(apply2D(x,a),apply2D(y,a));assert.equal(state(C,x),state(C,y));assert.equal(state(C,copy),state(C,plain));transitions++;}
 assert.equal(state(C,s),source);assert.equal(Object.hasOwn(s,'clone'),false);assert.notEqual(s._snapshot,copy._snapshot);
 for(const level of ['low','medium','high','xhigh','ultra']){
  const x=fromPosition(old,p),y=fromPosition(C,p),sx={},sy={},before=state(C,y),undo=y._undoStack.length;
  assert.deepEqual(C.ai2ChooseMove(y,{level,seed:1650001+i,stats:sy}),old.ai2ChooseMove(x,{level,seed:1650001+i,stats:sx}),p.variant+'/'+p.ply+'/'+level);
  assert.deepEqual(sy,sx,'预算/节点/VCF计数一致');assert.equal(state(C,y),before);assert.equal(y._undoStack.length,undo);assert.equal(Object.hasOwn(y,'clone'),false);calls++;
 }
 variants[p.variant]=(variants[p.variant]||0)+1;
}
// 真实对局有悔棋栈、监听器和手动布洞；AI不得把内部跳过快照的配置泄漏给它们。
for(let bits=0;bits<8;bits++)for(const first of [1,2]){
 const make=E=>E.Session2D.create(15,15,first,new E.RuleSet(),{holes:{on:!!(bits&1),randomCount:3,perPlayer:bits&1?1:0,cooldown:3,seed:8},float:{on:!!(bits&2),life:20,opening:0},age:{on:!!(bits&4),turns:30,gray:3}});
 const x=make(old),y=make(C);
 while(x.status==='Setup'){const ax=old.ai2ChooseMove(x,{level:'ultra',seed:99}),ay=C.ai2ChooseMove(y,{level:'ultra',seed:99});assert.deepEqual(ay,ax);apply2D(x,ax);apply2D(y,ay);calls++;}
 let fired=0;y.onMoveApplied.push(()=>fired++);
 for(let t=0;t<3;t++){const sx={},sy={},ax=old.ai2ChooseMove(x,{level:'low',seed:77+t,stats:sx}),ay=C.ai2ChooseMove(y,{level:'low',seed:77+t,stats:sy});assert.deepEqual(ay,ax);assert.deepEqual(sy,sx);assert.equal(fired,t);apply2D(x,ax);apply2D(y,ay);assert.equal(state(C,y),state(old,x));calls++;}
 for(let t=0;t<3;t++){assert.equal(y.undo(),x.undo());assert.equal(state(C,y),state(old,x));}assert.equal(fired,3);
}
const without2D=h=>h.replace(/\/\* GOMOKU-2D-EMBED-CORE-BEGIN \*\/[\s\S]*?\/\* GOMOKU-2D-EMBED-CORE-END \*\//,'');assert.equal(without2D(read(meta.candidate)),without2D(read(meta.baseline)));
const part=read(meta.partBaseline),next=read(meta.partCandidate);assert.equal(part.split('const AI_PARAMS2=')[0],next.split('const AI_PARAMS2=')[0],'公开二维规则/clone/悔棋代码原文不变');
const result={pass:true,candidateSha:meta.candidateSha,clones,transitions,calls,positions:positions.length,variants,publicRulesUnchanged:true,threeFourDUnchanged:true};
fs.writeFileSync(path.join(root,'_verify/results/two-d-speed/tests.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
