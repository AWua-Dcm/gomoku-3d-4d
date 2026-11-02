// 两个探针内核只允许各自的指定档位；第二半场错把A/B当新旧身份会产生none。
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(root,'_verify/results/level-role-probe-'));
const source=fs.readFileSync(path.join(root,'_verify/fixtures/p2-pre-e1-85945d897aa9.html'),'utf8');
for(const [name,level] of [['new','ultra'],['old','low']]){
  const anchor='function ai2ChooseMove(session,opts={}){';assert.equal(source.split(anchor).length,2);
  fs.writeFileSync(path.join(dir,name+'.html'),source.replace(anchor,anchor+'if(opts.level!=="'+level+'")return {kind:"none"};'));
}
const output=path.join(dir,'parameter-plumbing.json');
const result=spawnSync(process.execPath,['_verify/ai-ab.mjs','--mode','2d','--games','4',
  '--new',path.join(dir,'new.html'),'--old',path.join(dir,'old.html'),'--nlv','ultra','--olv','low','--json',output],
  {cwd:root,encoding:'utf8',windowsHide:true});
assert.ok([0,1].includes(result.status),result.stderr);
const file=fs.existsSync(output)?output:output.replace('.json','.invalid.json'),report=JSON.parse(fs.readFileSync(file));
assert.equal(report.results.none,0,'第二半场必须为新旧引擎分别保留各自档位');
assert.equal(report.results.valid,true);assert.deepEqual(report.meta.levels,{new:'ultra',old:'low'});
assert.equal(report.results.total,4);
console.log('跨档位测量台：两半场均为各自引擎保留档位，探针无none；不作为棋力数据');
