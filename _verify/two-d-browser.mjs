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
  check(await ev('typeof Game === "object" && !!Game.session'),'boot');
  for(const lang of ['zh','en','ja','ko','ru','fr']){
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    const layout=await ev(`(()=>{Game.openSetup();Game.setLang('${lang}');document.getElementById('mode2d').click();let r=document.getElementById('startBtn').getBoundingClientRect();return {bottom:r.bottom,left:r.left,width:r.width,height:r.height,scroll:document.documentElement.scrollWidth};})()`);
    check(layout.bottom<=800&&layout.left>=0&&layout.scroll<=1280,'2D setup fits '+lang+JSON.stringify(layout));
    for(const floating of [false,true])for(const size of [15,30]){
      await ev(`(()=>{Game.setupVariant2.w=${size};Game.setupVariant2.h=${size};Game.setupVariant2.float.on=${floating};Game.setupVariant2.holes.on=true;Game.setupVariant2.age.on=true;document.getElementById('startBtn').click();})()`);
      await sleep(80);
      const geometry=await ev(`(()=>{const r=document.getElementById('twoDBoardHost').getBoundingClientRect();return {surfaces:TwoDUI.surfaces.map(x=>({w:x.w,h:x.h,step:x.step})),w:r.width,h:r.height,visible:getComputedStyle(document.getElementById('twoDBoardHost')).display,mode:!!Game.session.variant2,twoD:Game.twoD};})()`);
      check(geometry.mode&&geometry.visible!=='none'&&geometry.h>100&&geometry.surfaces.length===1+(floating?1:0),'visible boards '+lang+JSON.stringify(geometry)+errors.join('\n'));
      check(geometry.surfaces.every(r=>r.w>80&&r.h>80&&r.step>0),'board geometry');
      await ev('Game.openSetup()');
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});
  await ev(`(()=>{Game.setLang('zh');document.getElementById('mode2d').click();Game.setupVariant2.float.on=true;Game.setupVariant2.w=30;Game.setupVariant2.h=30;document.getElementById('startBtn').click();})()`);await sleep(150);
  check(await ev('TwoDUI.surfaces.length===2 && TwoDUI.surfaces[1].y > TwoDUI.surfaces[0].y'),'portrait boards stacked');
  fs.mkdirSync(path.join(root,'_verify/shots'),{recursive:true});
  let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-mobile.png'),Buffer.from(shot.result.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await ev(`(()=>{Game.openSetup();Game.setupVariant2={on:true,w:15,h:15,freeRule:false,holes:{on:false,randomCount:7,perPlayer:0,cooldown:5,seed:0},float:{on:false},age:{on:false,turns:30,gray:3}};document.getElementById('startBtn').click();})()`);await sleep(100);
  const point=await ev(`(()=>{const c=document.querySelector('#twoDBoardHost canvas').getBoundingClientRect(),r=TwoDUI.surfaces[0];return {x:c.left+r.left+7*r.step,y:c.top+r.bottom-7*r.step};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});await sleep(350);
  check(await ev('Game.session.top[112]===1 && Game.session.moveCount===1'),'real pointer places at intersection');
  const grid=await ev(`(()=>{document.getElementById('setupBtn').click();const open=!document.getElementById('gridPanel').classList.contains('off');const visible=document.getElementById('gridColorInput').getBoundingClientRect().height>0;Game.setGridColor('#2f5d7c',false);Game.setGridAlphaPercent(25,false);const a=TwoDUI.appearance;Game.closeGridSettings();return {open,visible,color:Game.gridColor,alpha:Game.gridAlpha,uiColor:a.gridColor,uiAlpha:a.gridAlpha};})()`);
  check(grid.open&&grid.visible&&grid.color==='#2f5d7c'&&Math.abs(grid.alpha-.25)<1e-9&&grid.uiColor==='#2f5d7c'&&Math.abs(grid.uiAlpha-.25)<1e-9,'2D grid appearance follows settings '+JSON.stringify(grid));
  await ev('Game.undo()');check(await ev('Game.session.moveCount===0'),'undo pointer action');
  const record=await ev(`(()=>{for(let x=0;x<5;x++){Game.twoDAction({kind:'place',x,y:7,layer:'top'});if(x<4)Game.twoDAction({kind:'place',x,y:x%2,layer:'top'});}const r=Game.buildRecord();return {status:Game.session.status,v:r.v,m:r.m,n:r.n,replay:!!Game.replayRecord(r),saved:GameRecords.load().some(x=>x.m===2)};})()`);
  check(record.status==='Decided'&&record.v===3&&record.m===2&&record.n===9&&record.replay&&record.saved,'v3 record replay '+JSON.stringify(record));
  const banner=await ev(`(()=>{const b=document.getElementById('banner'),c=document.getElementById('bannerClose');const r=c.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {on:b.classList.contains('on'),z:getComputedStyle(b).zIndex,hit:hit&&hit.closest&&!!hit.closest('#banner')};})()`);
  check(banner.on&&banner.hit,'2D banner is above board and clickable '+JSON.stringify(banner));
  // 2D 导出：长图任何已结束局都有；海报只在“我胜电脑”时有。
  await ev(`(()=>{Game.aiMode=true;Game.aiMyColor=Game.session.winner;Game.syncBannerExports();})()`);
  const exp=await ev(`(()=>{const rec=Object.assign({},Game.buildRecord(),{ai:0,me:Game.session.winner});const board=Game.captureBoardCanvas(Game.session);const long=Game.composeLongImageCanvas(rec,board,'测试');const poster=Game.composePosterCanvas(rec,board,'测试');return {board:board&&[board.width,board.height],long:long&&[long.width,long.height],poster:poster&&[poster.width,poster.height],longUrl:long?long.toDataURL('image/png').slice(0,14):'',posterUrl:poster?poster.toDataURL('image/jpeg').slice(0,15):''};})()`);
  const btns=await ev(`({poster:!document.getElementById('posterBtn').classList.contains('off'),long:!document.getElementById('longImageBtn').classList.contains('off'),bar:!document.getElementById('bannerExports').classList.contains('off')})`);
  check(exp.board&&exp.board[0]>=1000&&exp.long&&exp.long[0]===1080&&exp.long[1]>=900&&exp.poster&&exp.poster[0]===1080&&exp.poster[1]===1440&&exp.longUrl==='data:image/png'&&exp.posterUrl==='data:image/jpeg'&&btns.poster&&btns.long&&btns.bar,'2D export long/poster '+JSON.stringify({exp,btns}));
  const imgs=await ev(`(()=>{const rec=Object.assign({},Game.buildRecord(),{ai:0,me:Game.session.winner});const b=Game.captureBoardCanvas(Game.session);return {long:Game.composeLongImageCanvas(rec,b,'阿甲').toDataURL('image/png'),poster:Game.composePosterCanvas(rec,b,'阿甲').toDataURL('image/jpeg')};})()`);
  fs.writeFileSync(path.join(root,'_verify/shots/2d-export-long.png'),Buffer.from(imgs.long.split(',')[1],'base64'));
  fs.writeFileSync(path.join(root,'_verify/shots/2d-export-poster.jpg'),Buffer.from(imgs.poster.split(',')[1],'base64'));
  const hist=await ev(`(()=>{document.getElementById('historyBtn').click();const d=document.querySelector('#historyBody details[data-id]');if(!d)return {none:true};const b=d.querySelector('[data-export="long"]');document.getElementById('historyClose').click();return {long:!!b};})()`);
  check(hist.long,'2D history long export button '+JSON.stringify(hist));
  await ev('Game.aiMode=false');
  await ev(`document.getElementById('bannerClose').click()`);
  check(await ev(`!document.getElementById('banner').classList.contains('on')`),'2D banner close works');
  await ev('Game.undo()');check(await ev('Game.session.status==="Playing" && !Game.recId'),'undo removes terminal record');
  await ev(`(()=>{Game.openSetup();Game.setupVariant2.holes.on=true;Game.setupVariant2.float.on=true;Game.setupVariant2.age.on=true;document.getElementById('startBtn').click();})()`);await sleep(100);
  shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-desktop.png'),Buffer.from(shot.result.data,'base64'));
  // 2D → 3D：层视图画布必须从 1×1 恢复到实际尺寸，二维宿主必须隐藏。
  await ev(`(()=>{document.getElementById('quitBtn').click();document.getElementById('quitYes').click();document.getElementById('mode3d').click();document.getElementById('startBtn').click();})()`);await sleep(450);
  const trans=await ev(`(()=>{const h=document.getElementById('twoDBoardHost'),lb=document.getElementById('layerBase'),ov=document.getElementById('layerOverlay');return {twoD:Game.twoD,ctor:Game.session&&Game.session.constructor.name,stage:document.getElementById('stage').className,host:getComputedStyle(h).display,lw:lb.width,lh:lb.height,ow:ov.width,oh:ov.height};})()`);
  check(trans.ctor!=='Session2D'&&trans.host==='none'&&!String(trans.stage).includes('twod')&&trans.lw>100&&trans.ow>100,'2D→3D layer redraw '+JSON.stringify(trans));
  check(errors.length===0,'browser exceptions: '+errors.join('\n'));
  console.log(`${passed} 项通过 / 0 项失败 (二维真实浏览器)`);
}finally{try{ws?.close();}catch{}chrome.kill();await sleep(300);if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
