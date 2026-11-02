import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'Web_Gomoku3D/index.html'),'utf8');
const split=html.indexOf('<script>');
let release;
const gate=new Promise(resolve=>{release=resolve;});
const server=http.createServer(async(req,res)=>{
  if(req.url!=='/') {res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.write(html.slice(0,split));
  await gate;
  res.end(html.slice(split));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if(!browser) {server.close();throw Error('Chrome/Edge required');}
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'gomoku-startup-'));
const child=spawn(browser,['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--disable-extensions','about:blank'],{stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,id=0,passed=0;const pending=new Map(),errors=[];
const out=path.join(root,'_verify/results/startup-layout');fs.mkdirSync(out,{recursive:true});
function check(value,message) {assert.ok(value,message);passed++;}
function send(method,params={}) {
  const n=++id;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},20000);
    pending.set(n,m=>{clearTimeout(timeout);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);});
    ws.send(JSON.stringify({id:n,method,params}));
  });
}
async function ev(expression) {
  const r=await send('Runtime.evaluate',{expression,returnByValue:true});
  if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result?.value;
}
async function until(expression) {
  for(let i=0;i<100;i++) {if(await ev(expression))return;await sleep(100);}
  throw Error('Timed out: '+expression);
}
async function shot(name) {
  const r=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));
}
try {
  const active=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100&&!fs.existsSync(active);i++)await sleep(100);
  const port=fs.readFileSync(active,'utf8').split('\n')[0];
  const page=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setCPUThrottlingRate',{rate:4});
  await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source: `(()=>{
    const clear=CanvasRenderingContext2D.prototype.clearRect,fill=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.id==='bootAscii')window.__bootCalls=[];return clear.apply(this,a);};
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...a){if(this.canvas.id==='bootAscii')(window.__bootCalls||=[]).push([x,y,text]);return fill.call(this,text,x,y,...a);};
  })()`});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
  await until('!!document.getElementById("setup")');
  check(await ev('document.documentElement.classList.contains("app-loading") && getComputedStyle(document.getElementById("setup")).visibility === "hidden" && getComputedStyle(document.getElementById("bootStatus")).visibility === "visible"'),'incomplete download only shows startup screen');
  await until('document.getElementById("bootAscii").dataset.language === "zh"');
  check(await ev('document.getElementById("bootAscii").getBoundingClientRect().width >= innerWidth * .94'),'ASCII title spans the viewport');
  check(await ev('document.getElementById("bootLabel").textContent === "加载中…" && getComputedStyle(document.getElementById("bootLabel")).pointerEvents === "none"'),'plain noninteractive loading label');
  const resting=await ev('document.getElementById("bootAscii").toDataURL()');await sleep(500);
  check(await ev('document.getElementById("bootAscii").toDataURL()')!==resting,'title flows gently without pointer input');
  check(await ev('getComputedStyle(document.getElementById("bootStatus"),"::before").animationName === "bootPaperFlow" && getComputedStyle(document.getElementById("bootStatus"),"::after").animationName === "bootPaperFlow"'),'two broad background washes drift slowly');
  await shot('loading-mobile');
  const initial=await ev('window.__bootCalls');
  const point=await ev(`(()=>{const c=document.getElementById('bootAscii'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,r=c.getBoundingClientRect();for(let k=0;k<d.length;k+=4)if(d[k+3]>100)return {x:r.x+(k/4%c.width)*r.width/c.width,y:r.y+Math.floor(k/4/c.width)*r.height/c.height};})()`);
  check(!!point,'ASCII characters rendered before main script arrives');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await sleep(350);
  const hovered=await ev('window.__bootCalls');
  check(JSON.stringify(initial.map(p=>p.slice(0,2)))===JSON.stringify(hovered.map(p=>p.slice(0,2))),'pointer leaves all ASCII positions unchanged');
  check(initial.some((p,i)=>p[2]!==hovered[i][2]),'pointer changes characters along its path');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  await sleep(11500);
  check(await ev('document.getElementById("bootAscii").dataset.language === "en"'),'title switches to English after ten seconds');
  await shot('loading-english-mobile');
  await sleep(10000);
  check(await ev('document.getElementById("bootAscii").dataset.language === "zh"'),'title returns to Chinese after twenty seconds');
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});await sleep(200);await shot('loading-desktop');
  release();
  await until('!document.documentElement.classList.contains("app-loading")');
  check(await ev('getComputedStyle(document.getElementById("bootStatus")).display === "none" && !!document.getElementById("mode2d") && !!Game.session'),'completed startup reveals initialized controls');
  await send('Emulation.setCPUThrottlingRate',{rate:1});
  for(const width of [1600,1280,900,393,320]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:width<700?852:900,deviceScaleFactor:1,mobile:width<700});
    for(const lang of ['zh','en','ja','ko','ru','fr']) {
      await ev(`Game.openSetup();Game.setSetupMode(true);Game.setLang('${lang}');`);
      await sleep(40);
      const layout=await ev(`(()=>{
        const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom};};
        return {inputs:['dimN','coolInput','phaseInput'].map(rect),labels:['rowLabelSize4d','rowLabelCool','rowLabelPhase'].map(rect),hints:['dimRange4d','coolNote','phaseNote'].map(rect),scroll:document.documentElement.scrollWidth};
      })()`);
      for(const group of ['inputs','labels','hints'])check(layout[group].every(r=>Math.abs(r.x-layout[group][0].x)<1),`${width}/${lang}: ${group} align: ${JSON.stringify(layout)}`);
      check(layout.scroll<=width,`${width}/${lang}: no horizontal overflow`);
      check(layout.hints.every((r,i)=>i===0||r.y>=layout.hints[i-1].bottom-1),`${width}/${lang}: hints do not overlap`);
      if(lang==='zh'&&(width===1600||width===393))await shot('four-d-'+width);
    }
  }
  check(await ev('!!window.GomokuLoading && getComputedStyle(document.getElementById("bootStatus")).display === "none"'),'loader retired after initialization');
  check(errors.length===0,'no runtime exceptions: '+errors.join(','));
  console.log(`${passed} startup and layout checks passed`);
} finally {
  release();ws?.close();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
  await sleep(300);
  if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))try{fs.rmSync(profile,{recursive:true,force:true});}catch{}
}
