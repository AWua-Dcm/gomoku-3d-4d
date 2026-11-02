import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),html=fs.readFileSync(path.join(root,'Web_Gomoku3D/index.html'),'utf8');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gomoku2d-mutation-')),target=path.join(dir,'index.html');
const mutations=[
 ['交换漏吞顶子','this.top[target]=0;this.birth[target]=-1;','this.top[target]=this.top[target];this.birth[target]=-1;'],
 ['灰子错误参与连线','this.top[k]===BLACK||this.top[k]===WHITE?this.top[k]:0','this.top[k]===3?BLACK:(this.top[k]===BLACK||this.top[k]===WHITE?this.top[k]:0)'],
 ['地基错误参与判胜','this.top[k]===BLACK||this.top[k]===WHITE?this.top[k]:0','this.top[k]===BLACK||this.top[k]===WHITE?this.top[k]:(this.base[k]?BLACK:0)'],
 ['黑洞误吞地基','this.top[target]=0;this.birth[target]=-1;','this.base[target]=0;this.top[target]=0;this.birth[target]=-1;'],
 ['悔棋漏还原状态','this._restore(snapshot);this._emit(record.kind','this._emit(record.kind'],
];
let caught=0;
try{for(const [name,from,to] of mutations){if(!html.includes(from))throw Error('Mutation anchor missing: '+name);const changed=html.replace(from,to);new Function(changed.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0]);fs.writeFileSync(target,changed);const r=spawnSync(process.execPath,['Web_Gomoku3D/tests/two-d-rules.test.mjs'],{cwd:root,env:{...process.env,GOMOKU_2D_SOURCE:target},encoding:'utf8',timeout:30000,windowsHide:true});if(r.status!==0&&/AssertionError/.test(r.stderr)){caught++;console.log('抓住：'+name);}else throw Error('漏网：'+name+' '+r.stderr);}}finally{if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(dir,{recursive:true,force:true});}
console.log(caught+' / 5 条注入被规则测试捕获');
