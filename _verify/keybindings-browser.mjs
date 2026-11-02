import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chromePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if(!chromePath)throw Error('Browser required for 2D validation');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gomoku2d-check-'));
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=9467','--user-data-dir='+profile,'--no-first-run','--disable-extensions','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,id=0,passed=0;const pending=new Map(),errors=[];
function send(method,params={}){const n=++id;return new Promise(resolve=>{pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;}
const check=(v,msg)=>{if(!v)throw Error(msg);passed++;};
try{
  let target;for(let i=0;i<80;i++){try{target=(await(await fetch('http://127.0.0.1:9467/json/list')).json()).find(x=>x.type==='page');if(target)break;}catch{}await sleep(250);}
  if(!target)throw Error('Browser did not start');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:pathToFileURL(path.join(root,'Web_Gomoku3D/index.html')).href});await sleep(1800);
  check(await ev('typeof Game === "object" && !!Game.session'),'boot');



  check(await ev("typeof Keymap==='object'"),'keymap boots');
  await ev('Game.openRules()');
  check(await ev("!document.getElementById('keymapOpen')&&!!document.querySelector('#keymapRules button')"),'only customize entry remains in full rules');
  await ev('Keymap.open()');
  check(await ev("document.getElementById('keymapBack').textContent.includes('返回')"),'top left return button');
  await ev("Keymap.save('undo','u')");
  check(await ev("Keymap.key('undo')==='z'&&document.querySelector('[data-action=undo]').textContent==='U'"),'draft changes do not apply');
  check(await ev("!JSON.parse(storeGet('gomoku.keybindings.v1')||'{}').undo"),'draft not persisted');
  await ev("document.getElementById('keymapConfirm').click()");
  check(await ev("!Keymap.isOpen&&Game.rulesOpen&&Keymap.key('undo')==='u'"),'confirm saves and returns to rules');
  check(await ev("document.getElementById('keymapRules').textContent.includes('U')&&Game.el.hint.textContent.includes('U')"),'rules and hint update on confirmation');
  await ev("Keymap.open();document.getElementById('keymapBack').click()");
  check(await ev("!Keymap.isOpen&&Game.rulesOpen"),'unchanged return does not prompt');
  await ev("Keymap.open();Keymap.save('undo','i');document.getElementById('keymapBack').click()");
  check(await ev("Keymap.isOpen&&!document.getElementById('keymapDiscard').classList.contains('off')"),'changed return prompts');
  await ev("document.getElementById('keymapInstructions').click()");
  check(await ev("document.getElementById('keymapDiscard').classList.contains('off')&&Keymap.isOpen&&document.querySelector('[data-action=undo]').textContent==='I'"),'outside click cancels return and retains draft');
  await ev("document.getElementById('keymapBack').click();document.getElementById('keymapKeepEditing').click()");
  check(await ev("document.getElementById('keymapDiscard').classList.contains('off')&&Keymap.isOpen"),'keep editing dismisses prompt');
  await ev("document.getElementById('keymapBack').click();document.getElementById('keymapDiscardConfirm').click()");
  check(await ev("!Keymap.isOpen&&Game.rulesOpen&&Keymap.key('undo')==='u'"),'discard returns without saving draft');
  await ev("Keymap.open();Keymap.save('undo','i');Keymap.save('undo','u');document.getElementById('keymapBack').click()");
  check(await ev('!Keymap.isOpen&&Game.rulesOpen'),'reverted draft no longer prompts');
  await ev("Keymap.open();document.getElementById('keymapReset').click()");
  check(await ev("Keymap.key('undo')==='u'&&document.querySelector('[data-action=undo]').textContent==='Z'"),'reset defaults is also staged');
  await ev("document.getElementById('keymapBack').click();document.getElementById('keymapDiscardConfirm').click();Keymap.open();document.querySelector('[data-action=undo]').click();document.getElementById('keymapManual').value='p';document.getElementById('keymapConfirm').click()");
  check(await ev("!Keymap.isOpen&&Game.rulesOpen&&Keymap.key('undo')==='p'"),'confirm applies manual input and returns');
  await send('Page.reload');await sleep(1200);
  check(await ev("Keymap.key('undo')==='p'"),'confirmed key survives refresh');
  await ev("Game.openRules();Keymap.open();document.querySelector('[data-action=undo]').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'i',bubbles:true}))");
  check(await ev("Keymap.key('undo')==='p'&&document.querySelector('[data-action=undo]').textContent==='I'"),'physical key changes draft only');
  check(await ev("!!Keymap.save('undo','r')"),'conflict rejected');
  await ev("document.getElementById('keymapBack').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  check(await ev("Keymap.isOpen&&document.getElementById('keymapDiscard').classList.contains('off')"),'Escape dismisses discard popover');
  await send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});await sleep(100);
  check(await ev("(()=>{const r=document.getElementById('keymapCard').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),'editing panel fits small phone');
  check(errors.length===0,'browser errors '+errors.join('\n'));
  console.log(`${passed} keybinding checks passed`);
}finally{try{if(ws?.readyState===1)await Promise.race([send('Browser.close'),sleep(500)]);}catch{}try{ws?.close();}catch{}chrome.kill();}

