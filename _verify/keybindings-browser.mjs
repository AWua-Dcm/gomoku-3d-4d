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
  await ev("Game.openSetup();Game.setSetupMode(true);document.getElementById('startBtn').click()");await sleep(150);
  check(await ev("Keymap.save('undo','u')===''"),'remap undo');
  check(await ev("Game.el.hint.textContent.includes('U')&&document.getElementById('keymapHint').textContent.includes('U')"),'hint updates');
  await ev("Game.openRules()");
  check(await ev("document.getElementById('keymapRules').textContent.includes('U')"),'rules updates');
  await ev("Game.closeRules();window.savedUndo=Game.undo;window.undoCalls=0;Game.undo=()=>undoCalls++");
  await ev("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'u',bubbles:true}))");
  check(await ev('undoCalls===1'),'old key disabled and new key works');
  await ev("(window.typingInput=document.body.appendChild(document.createElement('input'))).focus();typingInput.dispatchEvent(new KeyboardEvent('keydown',{key:'u',bubbles:true}))");check(await ev('undoCalls===1'),'typing cannot undo');
  await ev("document.activeElement.blur();Keymap.open();document.querySelector('[data-action=undo]').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'i',bubbles:true}))");
  check(await ev("Keymap.key('undo')==='i'"),'UI captures new key');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));Game.undo=savedUndo");
  check(await ev('!Keymap.isOpen'),'Escape closes settings');
  await send('Page.reload');await sleep(1300);
  check(await ev("Keymap.key('undo')==='i'"),'binding persists after refresh');
  await send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});
  await ev('Keymap.open()');await sleep(100);
  check(await ev("(()=>{const r=document.getElementById('keymapCard').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),'settings fit small phone');
  await ev("document.querySelector('[data-action=undo]').click();document.getElementById('keymapManual').value='p';document.getElementById('keymapManual').nextElementSibling.click()");
  check(await ev("Keymap.key('undo')==='p'"),'manual mobile entry updates binding');
  await ev("Keymap.close();Game.openSetup();document.getElementById('mode2d').click();document.getElementById('startBtn').click()");await sleep(150);
  check(await ev("Keymap.save('left','a')===''"),'2D cursor can be remapped');
  check(await ev("Keymap.action(new KeyboardEvent('keydown',{key:'a'}))==='left'&&!Keymap.action(new KeyboardEvent('keydown',{key:'ArrowLeft'}))"),'2D old direction disabled');
  check(errors.length===0,'browser errors '+errors.join('\n'));
  console.log(`${passed} keybinding checks passed`);
}finally{try{if(ws?.readyState===1)await Promise.race([send('Browser.close'),sleep(500)]);}catch{}try{ws?.close();}catch{}chrome.kill();}

