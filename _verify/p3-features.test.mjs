import fs from 'node:fs';import assert from 'node:assert/strict';import {buildP3} from './p3-features.mjs';
const base=fs.readFileSync(new URL('./fixtures/p2-pre-e1-85945d897aa9.html',import.meta.url),'utf8'),html=buildP3(base);
const C=new Function(html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]+
  ';return {FourDSession,RuleSet,aiP3Context,aiP3Value,cellOf,fingerprint,setPhase:p=>{aiPhase=p;}}')();
const rules=new C.RuleSet();Object.assign(rules,{allowRotation:true,wrapEdges:true,phasePeriod:12,rotationCooldownPlacements:5});
const s=C.FourDSession.create(8,1,rules);for(const x of [6,7,0])s.board.set(x,3,3,C.cellOf(1,0));
for(const x of [2,3,4])s.board.set(x,5,3,C.cellOf(2,1));
const fp=C.fingerprint(s),ctx=C.aiP3Context(s);assert.equal(C.fingerprint(s),fp);
assert.ok(ctx.wrap[1][s.board.index(1,3,3)]>0);assert.ok(ctx.reserve[2][s.board.index(5,5,3)]>0);
C.setPhase(0);assert.equal(C.aiP3Value(s.board,1,2,ctx),0);
s.board.set(1,3,3,C.cellOf(1,0));const ready=C.aiP3Value(s.board,1,2,ctx);assert.ok(ready>0);
ctx.cooldown=6;assert.ok(C.aiP3Value(s.board,1,2,ctx)>ready);s.board.set(1,3,3,0);
ctx.until=1;s.board.set(5,5,3,C.cellOf(1,0));assert.ok(C.aiP3Value(s.board,1,2,ctx)>0);
ctx.until=12;assert.equal(C.aiP3Value(s.board,1,2,ctx),0);s.board.set(5,5,3,0);
assert.equal(C.fingerprint(s),fp);rules.wrapEdges=false;const classic=C.FourDSession.create(8,1,rules);assert.equal(C.aiP3Context(classic),null);
assert.equal(html.split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1],base.split('/* GOMOKU-2D-EMBED-CORE-BEGIN */')[1]);
console.log('P3 定向检查通过：贯通窗口、下相位储备、冷却上下文、纯函数、模式守卫、二维不变');
