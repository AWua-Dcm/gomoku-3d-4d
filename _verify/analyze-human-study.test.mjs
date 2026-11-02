// 仅在内存中使用显式合成记录，不写入真实玩家目录。
import assert from 'node:assert/strict';import {analyze} from './analyze-human-study.mjs';
const s=[{id:'T1',block:'B',mode:'2d',playerColor:1},{id:'T2',block:'B',mode:'2d',playerColor:1}];
const m=[{id:'T1',eligible:'accepted',condition:'old'},{id:'T2',eligible:'accepted',condition:'new'}];
const records=[{participant:'synthetic-test',sessionId:'T1',result:'human-win',difficulty:2,lossType:'not-applicable'},
  {participant:'synthetic-test',sessionId:'T2',result:'ai-win',difficulty:4,lossType:'calculated-kill'}];
assert.equal(analyze(s,m,[]).status,'awaiting-real-player-data');
const r=analyze(s,m,records);assert.equal(r.completePairs,1);assert.equal(r.byModeAndColor['2d/human-1'].meanDifficultyDifference,2);
assert.equal(analyze(s,m,records.slice(0,1)).completePairs,0);
assert.throws(()=>analyze(s,m,[...records,records[0]]));
assert.throws(()=>analyze(s,m.map(v=>({...v,eligible:'hold'})),records));
assert.equal(analyze(s,m,[records[0],{...records[1],result:'aborted'}]).completePairs,0);
console.log('盲测分析器：空数据不造结论、完整配对、重复/未验收条件拦截、中断排除通过（合成数据仅在内存）');
