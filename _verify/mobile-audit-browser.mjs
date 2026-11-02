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

  await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:2,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await send('Page.reload');await sleep(1200);
  await ev("Game.openSetup();Game.setSetupMode(false);document.getElementById('startBtn').click()");await sleep(250);
  fs.writeFileSync(path.join(root,'_verify/results/project-audit/mobile-before.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  for(const mode of ['mode3d','mode4d']){
    await ev(`Game.openSetup();document.getElementById('${mode}').click();document.getElementById('startBtn').click()`);await sleep(200);
    const g=await ev(`(()=>{const r=Game.el.layerBase.getBoundingClientRect(),d=Game.session.board.dims;const v=Game.gridLayout(r.width,r.height,d[0],d[1]);return {height:r.height,width:r.width,extent:v.cs*(d[0]-1)};})()`);
    check(g.height>=300&&g.extent>=g.width*.65,'mobile plane fills available width '+mode+JSON.stringify(g));
  }
  fs.writeFileSync(path.join(root,'_verify/results/project-audit/mobile-after.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
  const phantom=await ev(`(()=>{Game.pointers.clear();Game.trackPointer({pointerId:99,clientX:10,clientY:10},'move');return Game.pointers.size;})()`);
  check(phantom===0,'hover must not register a pressed pointer: '+phantom);
  const cancelled=await ev(`(()=>{const c=Game.el.gl; c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:71,button:0,clientX:100,clientY:150,bubbles:true}));window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:71,bubbles:true}));return {drag:Game.dragging,pan:Game.panning,press:Game.pressInView,count:Game.pointers.size};})()`);
  check(!cancelled.drag&&!cancelled.pan&&!cancelled.press&&cancelled.count===0,'cancel clears gesture '+JSON.stringify(cancelled));
  const blurred=await ev(`(()=>{Game.el.gl.dispatchEvent(new PointerEvent('pointerdown',{pointerId:72,button:0,clientX:100,clientY:150,bubbles:true}));window.dispatchEvent(new Event('blur'));return {drag:Game.dragging,count:Game.pointers.size};})()`);
  check(!blurred.drag&&blurred.count===0,'background clears gesture '+JSON.stringify(blurred));
  for(const [width,height] of [[320,568],[360,640],[393,852],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
    for(const lang of ['zh','en','ru'])for(const mode of ['mode2d','mode3d','mode4d']){
      await ev(`Game.openSetup();Game.setLang('${lang}');document.getElementById('${mode}').click()`);await sleep(60);
      const g=await ev(`(()=>{const b=document.getElementById('startBtn');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {overflow:document.documentElement.scrollWidth>innerWidth+1,clickable:!!hit&&(hit===b||b.contains(hit)),rect:[r.x,r.y,r.width,r.height]};})()`);
      check(!g.overflow&&g.clickable,'setup '+width+'x'+height+' '+lang+' '+mode+' '+JSON.stringify(g));
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:2,mobile:true});
  await ev(`Game.openSetup();Game.setLang('zh');document.getElementById('mode2d').click();Game.setupVariant2={on:true,w:15,h:15,freeRule:false,holes:{on:false,randomCount:7,perPlayer:0,cooldown:5,seed:0},float:{on:false},age:{on:false,turns:30,gray:3}};document.getElementById('startBtn').click()`);await sleep(200);
  const pt=await ev(`(()=>{const c=document.getElementById('board2d').getBoundingClientRect(),r=TwoDUI.surfaces[0];return {x:c.left+r.left+7*r.step,y:c.top+r.bottom-7*r.step};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...pt,button:'right',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...pt,button:'right',clickCount:1});await sleep(350);
  check(await ev('Game.session.moveCount===0'),'right-click must not place stone');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pt,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await sleep(350);
  check(await ev('Game.session.moveCount===0'),'cancelled touch must not place stone');
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...pt,id:2}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(350);
  check(await ev('Game.session.moveCount===1'),'real touch places exactly one stone after cancellation');
  check(errors.length===0,'browser exceptions: '+errors.join('\n'));
  console.log(`${passed} checks passed: mobile layouts and interrupted gestures`);
}finally{try{ws?.close();}catch{}chrome.kill();}

