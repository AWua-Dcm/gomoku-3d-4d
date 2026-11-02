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
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:pathToFileURL(path.join(root,process.env.GOMOKU_HTML||'Web_Gomoku3D/index.html')).href});await sleep(1800);
  check(await ev('typeof Game === "object" && !!Game.session'),'boot');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  check(await ev(`(()=>{document.getElementById('mode2d').click();for(const k of ['holes','float','age'])Game.setupVariant2[k].on=false;Game.syncTwoDSetup();Game.startTutorial();return getComputedStyle(Game.el.tutorialBtn).display==='none'&&!Game.tutActive&&Game.tutorialPlan().length===0;})()`),'classic 2D has no tutorial entry or callable empty course');
  check(await ev(`(()=>{Game.setSetupMode(false);Game.startTutorial();return getComputedStyle(Game.el.tutorialBtn).display==='none'&&!Game.tutActive;})()`),'classic 3D still has no tutorial');
  await ev(`(()=>{document.getElementById('mode2d').click();for(const k of ['holes','float','age'])document.getElementById('twoDToggle'+k).click();Game.startTutorial();})()`);
  check(await ev('Game.tutActive&&Game.tutorialPlan().join()==="0,1,2,3,4,5,6"'),'selected extras start the seven mechanism lessons');
  for(const lang of ['zh','en','ja','ko','ru','fr'])for(let index=0;index<7;index++){
    const result=await ev(`(()=>{Game.cancelTutTimer();Game.setLang('${lang}');Game.tutorialBuild(${index});const s=Game.session,lesson=TwoDUI.tutorial.levels()[${index}],fp=fingerprint2(s),initial={title:Game.el.tutTitle.textContent,expected:lesson.title('${lang}'),stones:s.top.filter(Boolean).length,background:s.tutorialBackgroundCells.length,info:Game.el.info.textContent,position:d2Text('tutorialPosition'),surfaces:TwoDUI.surfaces.length,expectedSurfaces:s.variant2.float.on?2:1};for(const action of lesson.solution){const r=Game.twoDAction(action);if(!r.ok)throw new Error(JSON.stringify(action));}Game.cancelTutTimer();initial.solved=Game.tutPassed&&TwoDUI.tutorial.goal(${index},s);for(const action of lesson.solution)Game.undo();Game.cancelTutTimer();initial.undo=fingerprint2(Game.session)===fp&&!Game.tutPassed;return initial;})()`);
    check(result.title===result.expected&&!/一线成五|Five in a line/.test(result.title),'correct translated mechanism title '+lang+index);
    check(result.stones>=30&&result.background>=20&&result.info.includes(result.position),'populated training position without fake turn count '+lang+index);
    check(result.surfaces===result.expectedSurfaces,'correct training board layers '+lang+index);
    check(result.solved&&result.undo,'actual game controls solve and undo '+lang+index+JSON.stringify(result));
  }
  fs.mkdirSync(path.join(root,'_verify/shots'),{recursive:true});
  await ev(`(()=>{Game.setLang('zh');Game.tutorialBuild(0);Game.el.toast.classList.remove('on');Game.toastTimer=0;})()`);let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-tutorial-midgame.png'),Buffer.from(shot.result.data,'base64'));
  for(const [width,height,lang,index]of [[393,852,'zh',3],[320,740,'fr',5]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await ev(`(()=>{Game.setLang('${lang}');Game.tutorialBuild(${index});})()`);
    const fit=await ev(`(()=>{const a=Game.el.tutBar.getBoundingClientRect(),b=document.getElementById('twoDBoardHost').getBoundingClientRect();return {bar:a.bottom,board:b.top,width:document.documentElement.scrollWidth,boards:TwoDUI.surfaces.length};})()`);
    check(fit.bar<=fit.board&&fit.width<=width&&fit.boards===2,'portrait tutorial layout '+JSON.stringify(fit));
    shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-tutorial-portrait-'+lang+'.png'),Buffer.from(shot.result.data,'base64'));
  }
  await ev('Game.tutorialExit()');check(await ev('!Game.tutActive&&Game.setupOpen'),'tutorial exits normally');
  check(errors.length===0,'console exceptions: '+errors.join('\n'));
  console.log(passed+' 项通过 / 0 项失败 (七关教学实操、六语言、无额外玩法无教程、悔棋及竖屏)');

}finally{try{ws?.close();}catch{}chrome.kill();await sleep(300);if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
