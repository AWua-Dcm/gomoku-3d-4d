import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');let passed=0;
function check(v,message){assert.ok(v,message);passed++;}
for(const rel of ['Web_Gomoku3D/server.js','Web_Gomoku3D/tests/online.test.mjs','Web_Gomoku3D/tests/online-http.test.mjs','Web_Gomoku3D/tests/two-d-online.test.mjs','_verify/two-d-online.part.js','_verify/two-d-online-browser.mjs','_verify/online-browser.mjs','_verify/inject-online.mjs','dist-online/index.html','dist-online-review/index.html'])check(!fs.existsSync(path.join(root,rel)),'network-only implementation excluded: '+rel);
const html=fs.readFileSync(path.join(root,'Web_Gomoku3D/index.html'),'utf8');
for(const rel of ['Web_Gomoku3D/index.html','_verify/two-d-integration.part.js','_verify/fixtures/2d-layout-reference.html']){const text=fs.readFileSync(path.join(root,rel),'utf8');for(const re of [/\bconst\s+Net\s*=/,/\bNet\s*\./,/ONLINE_CORE_HASH/,/ONLINE_READY/,/new\s+EventSource/,/id="onlinePanel"/,/id="onlineBtn"/])check(!re.test(text),'no multiplayer implementation: '+rel+' '+re);}
new Function(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')))();passed++;
const source=html.split('/* GOMOKU-CORE-BEGIN */')[1].split('/* GOMOKU-CORE-END */')[0];
const {Session2D,RuleSet,fingerprint2,ai2ChooseMove}=new Function(source+';return {Session2D,RuleSet,fingerprint2,ai2ChooseMove}')();
for(let mask=0;mask<8;mask++){const s=Session2D.create(15,15,1,new RuleSet(),{holes:{on:!!(mask&1),randomCount:3,seed:77},float:{on:!!(mask&2)},age:{on:!!(mask&4),turns:30,gray:3}}),fp=fingerprint2(s),a=ai2ChooseMove(s,{level:'low',seed:23});check(a.kind==='place'&&s.place(a.x,a.y,a.layer).status!=='Rejected','offline combination '+mask);check(s.undo()&&fingerprint2(s)===fp,'undo combination '+mask);}
for(const [file,want] of [['vectors.json','3bcead846a4ad6804080b03205b2985e'],['rotation-vectors.json','33d638c973e4f4a5ccb2be67ad475ae4']])check(crypto.createHash('md5').update(fs.readFileSync(path.join(root,'Web_Gomoku3D/tests',file))).digest('hex')===want,'frozen evidence '+file);
for(const rel of ['知识库','docs','宣传片','.claude','.superpowers','.vscode','.github','assets','_site','dist-core','dist-public','dist-online','dist-online-review'])check(fs.existsSync(path.join(root,rel)),'original structure restored: '+rel);
check(fs.readFileSync(path.join(root,'LICENSE'),'utf8').startsWith('MIT License'),'original MIT license retained');
const rules=spawnSync(process.execPath,[path.join(root,'_verify/embed-rules.mjs'),'--check'],{cwd:root,encoding:'utf8',windowsHide:true});check(rules.status===0,'rule embedding synchronized');
console.log(passed+' 项公开工程结构与离线边界检查通过。');
