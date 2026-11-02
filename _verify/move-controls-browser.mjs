import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chromePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if(!chromePath)throw Error('Browser required for 2D validation');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gomoku2d-check-'));
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=9427','--user-data-dir='+profile,'--no-first-run','--disable-extensions','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,id=0,passed=0;const pending=new Map(),errors=[];
function send(method,params={}){const n=++id;return new Promise(resolve=>{pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params}));});}
async function ev(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;}
const check=(v,msg)=>{if(!v)throw Error(msg);passed++;};
try{
  let target;for(let i=0;i<80;i++){try{target=(await(await fetch('http://127.0.0.1:9427/json/list')).json()).find(x=>x.type==='page');if(target)break;}catch{}await sleep(250);}
  if(!target)throw Error('Browser did not start');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:pathToFileURL(path.join(root,'Web_Gomoku3D/index.html')).href});await sleep(1800);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  for(const lang of ['zh','en','ja','ko','ru','fr']) {
    const fit=await ev(`(()=>{Game.openSetup();Game.setLang('${lang}');const a=document.getElementById('timingBtn').getBoundingClientRect(),b=document.getElementById('confirmMoveBtn').getBoundingClientRect(),r=document.getElementById('ruleNote').getBoundingClientRect();return a.right<b.left&&b.bottom<=r.top+14;})()`);
    check(fit,'buttons sit side by side without adding setup height: '+lang);
  }
  await ev(`Game.setLang('zh');Game.confirmMove=false;Game.syncMoveControls();document.getElementById('confirmMoveBtn').click();`);
  check(await ev(`Game.confirmMove&&document.getElementById('confirmMoveBtn').getAttribute('aria-pressed')==='true'`),'toggle enabled');
  await send('Page.reload');await sleep(1000);
  check(await ev(`Game.confirmMove`),'confirmation preference survives reload');
  await ev(`(()=>{Game.openSetup();Game.setSetupAi('human');document.getElementById('mode2d').click();Game.setupVariant2={on:true,w:15,h:15,freeRule:false,holes:{on:false,randomCount:7,perPlayer:0,cooldown:5,seed:0},float:{on:false},age:{on:false,turns:30,gray:3}};document.getElementById('startBtn').click();})()`);await sleep(150);
  const point=await ev(`(()=>{const c=document.querySelector('#twoDBoardHost canvas').getBoundingClientRect(),r=TwoDUI.surfaces[0];return {x:c.left+r.left+7*r.step,y:c.top+r.bottom-7*r.step};})()`);
  async function click(p,count=1){await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:count});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:count});}
  await click(point);await sleep(400);
  check(await ev('Game.session.moveCount===0'),'single click never auto-places');
  await click(point);await click(point,2);
  check(await ev('Game.session.moveCount===1'),'real 2D double-click places exactly once');
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-350});
  const zoom=await ev('TwoDUI.surfaces[0].step');
  await click(point);await click(point,2);
  check(await ev(`TwoDUI.surfaces[0].step===${zoom}`),'double-click does not restore zoom');
  const restore=await ev(`(()=>{const b=document.getElementById('restoreSizeGl'),r=b.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},s=getComputedStyle(b);return {...p,visible:document.elementFromPoint(p.x,p.y)===b,blur:s.backdropFilter};})()`);
  check(restore.visible&&restore.blur.includes('blur'),'2D restore button is reachable with frosted glass');
  await click({x:restore.x,y:restore.y});
  check(await ev(`TwoDUI.surfaces[0].step<${zoom}`),'restore button resets 2D scale');
  await ev(`Game.openSetup();document.getElementById('confirmMoveBtn').click();`);
  check(await ev(`!Game.confirmMove&&document.getElementById('confirmMoveBtn').getAttribute('aria-pressed')==='false'`),'second click disables confirmation');
  await ev(`Game.setSetupMode(false);Game.newGame([8,8,8],1);Game.closeSetup();Game.camera.distance=Game.camera.homeDistance*.5;Game.zoom2d=2;Game.pan2d=[20,20];Game.camera.yaw=.7;`);
  await ev(`document.getElementById('restoreSizeGl').click();document.getElementById('restoreSizeLayer').click();`);
  check(await ev(`Math.abs(Game.camera.distance-Game.camera.homeDistance)<1e-6&&Game.zoom2d===1&&Game.pan2d[0]===0&&Game.camera.yaw===.7`),'3D and layer buttons restore size and preserve angle');
  for(const size of [[1280,800],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:1,mobile:false});
    await ev('Game.openSetup()');await sleep(150);
    check(await ev(`(()=>{const a=document.getElementById('timingBtn').getBoundingClientRect(),b=document.getElementById('confirmMoveBtn').getBoundingClientRect();return a.right<b.left&&b.right<=innerWidth;})()`),'setup buttons fit '+size);
    await ev("document.getElementById('confirmMoveBtn').scrollIntoView({block:'center'})");await sleep(100);
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/results/controls-'+size[0]+'.png'),Buffer.from(shot.result.data,'base64'));
  }
  await ev("Game.closeSetup()");await sleep(150);
  const gameShot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/results/controls-game.png'),Buffer.from(gameShot.result.data,'base64'));
  check(errors.length===0,'browser exceptions: '+errors.join('\n'));
  console.log(`${passed} checks passed (move controls, real browser)`);
}finally{try{ws?.close();}catch{}chrome.kill();await sleep(300);if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
