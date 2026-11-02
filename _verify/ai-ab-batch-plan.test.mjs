import assert from 'node:assert/strict';import {chunks} from './ai-ab-batch-plan.mjs';
for(const mode of ['3d','4d']){
  const jobs=chunks(mode),actual=[];
  for(let half=0;half<2;half++)for(const job of jobs)for(let game=0;game<job.games/2;game++){
    const global=job.index*job.games/2+game;
    actual.push([half,job.seed+half*10000+(game>>1)*7919,game%2,(game>>1)%5]);
    assert.equal((game>>1)%5,(global>>1)%5);
  }
  const expected=[];for(let half=0;half<2;half++)for(let game=0;game<1000;game++)expected.push([half,200001+half*10000+(game>>1)*7919,game%2,(game>>1)%5]);
  assert.deepEqual(actual,expected);
}
assert.throws(()=>chunks('4d',2000,24));assert.throws(()=>chunks('4d',2002,100));
console.log('正式批次拆分与单进程 2000 局的种子、颜色、开局周期逐局一致；非法分块被拒');
