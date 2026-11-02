import assert from 'node:assert/strict';
import {summarize,engineTiming} from './ai-ab-timing.mjs';
const t=engineTiming({aMsList:[1,2],bMsList:[100]}, {aMsList:[200,300],bMsList:[3]});
assert.deepEqual(t.new,{moves:3,avg:2,p50:2,p95:3,p99:3,max:3});
assert.deepEqual(t.old,{moves:3,avg:200,p50:200,p95:300,p99:300,max:300});
assert.deepEqual(summarize([]),{moves:0,avg:0,p50:0,p95:0,p99:0,max:0});
assert.equal(summarize(Array.from({length:100},(_,i)=>i+1)).p95,95);
console.log('A/B 独立耗时：4 项通过（含第二半场身份互换）');
