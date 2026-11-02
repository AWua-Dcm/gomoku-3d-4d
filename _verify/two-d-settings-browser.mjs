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
  const linked=await ev(`(()=>{document.getElementById('mode2d').click();const change=(id,n)=>{const e=document.getElementById(id);e.value=n;e.dispatchEvent(new Event('change'));};const dims=()=>[Game.setupVariant2.w,Game.setupVariant2.h];const initial=Game.setupLink2;change('dim2W',16);const width=dims();change('dim2H',20);const height=dims();document.getElementById('dim2Link').click();change('dim2W',16);change('dim2H',15);const rectangle=dims();document.getElementById('dim2Link').click();return {initial,width,height,rectangle,relinked:dims(),range:document.getElementById('twoDRange').textContent};})()`);
  check(linked.initial&&linked.width.join()=='16,16'&&linked.height.join()=='20,20','two-axis linkage updates either dimension');
  check(linked.rectangle.join()=='16,15'&&linked.relinked.join()=='16,16','link can be disabled for rectangle and enabled again');
  check(linked.range==='可填 10–30','2D range includes allowed prefix');
  const three=await ev(`(()=>{document.getElementById('mode3d').click();const buttons=()=>['optSpinBtn','optWrapBtn'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [r.x,r.y,r.width,r.height];});const before=buttons();document.getElementById('optSpinBtn').click();document.getElementById('optWrapBtn').click();Game.setSetupCool(7);const info={before,after:buttons(),count:document.querySelectorAll('#extraRow button').length,spin:document.getElementById('threeDSpinFull').textContent,wrap:document.getElementById('threeDWrapFull').textContent,shown:!document.getElementById('threeDSpinNote').hidden&&!document.getElementById('threeDWrapNote').hidden};Game.setLang('en');Game.setSetupAi('cpu');Game.setupLevel=3;Game.syncAiLevel();info.level=Game.el.aiLevelName.textContent;Game.setSetupAi('human');Game.setupLevel=1;Game.setSetupCool(5);return info;})()`);
  check(three.shown&&three.spin.includes('7')&&three.wrap.includes('边界相连'),'3D option descriptions follow current parameters');
  check(three.count===2&&JSON.stringify(three.before)===JSON.stringify(three.after),'3D adds text without adding or moving controls');
  check(three.level==='Extra high','English AI tier renamed Extra high');
  const viewports=[[1280,800],[1600,900],[393,852],[900,700],[360,800],[320,740],[768,1024]];
  const languages=['zh','en','ja','ko','ru','fr'];
  const baseline={};
  await send('Page.navigate',{url:pathToFileURL(path.join(root,'_verify/fixtures/2d-layout-reference.html')).href});await sleep(1600);
  for(const [width,height] of viewports)for(const lang of languages){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    baseline[width+'-'+lang]=await ev(`(()=>{Game.openSetup();Game.setLang('${lang}');document.getElementById('mode2d').click();for(const key of ['holes','float','age'])Game.setupVariant2[key].on=true;Game.syncTwoDSetup();Game.el.setup.scrollTop=0;const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};return Object.fromEntries(['twoDToggleholes','twoDTogglefloat','twoDToggleage','firstBlack','aiHuman','startBtn','setupTitle','inscription','twoDSettingsBtn'].map(id=>[id,rect(id)]));})()`);
  }
  await send('Page.navigate',{url:pathToFileURL(path.join(root,process.env.GOMOKU_HTML||'Web_Gomoku3D/index.html')).href});await sleep(1600);
  for(const [width,height] of viewports)for(const lang of languages){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
    const data=await ev(`(()=>{Game.openSetup();Game.setLang('${lang}');const result=[];for(const mode of ['mode3d','mode2d','mode4d','mode2d','mode3d']){document.getElementById(mode).click();Game.el.setup.scrollTop=0;Game.syncInscription();const b=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};result.push({mode,title:b('setupTitle'),inscription:b('inscription'),start:b('startBtn')});}return result;})()`);
    for(const r of data.slice(1))for(const key of ['title','inscription'])for(const dim of ['x','y','w','h'])check(Math.abs(r[key][dim]-data[0][key][dim])<1,`${width} ${lang} ${key}.${dim} shifted: ${JSON.stringify(data)}`);
    const rows=await ev(`(()=>{document.getElementById('mode2d').click();for(const k of ['holes','float','age'])Game.setupVariant2[k].on=true;Game.syncTwoDSetup();const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height};};return {button:rect('twoDSettingsBtn'),first:rect('firstBlack'),note:rect('twoDComboNote'),access:rect('twoDSettingsAccess'),weight:parseInt(getComputedStyle(document.getElementById('twoDComboNote')).fontWeight),rows:['holes','float','age'].map(k=>({button:rect('twoDToggle'+k),text:rect('twoDParam'+k)}))};})()`);
    const preserved=await ev(`(()=>{const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};return Object.fromEntries(['twoDToggleholes','twoDTogglefloat','twoDToggleage','firstBlack','aiHuman','startBtn','setupTitle','inscription','twoDSettingsBtn'].map(id=>[id,rect(id)]));})()`);
    for(const id of ['twoDToggleholes','twoDTogglefloat','twoDToggleage','firstBlack','aiHuman','startBtn','setupTitle','inscription'])for(const dim of ['x','y','w','h'])check(Math.abs(preserved[id][dim]-baseline[width+'-'+lang][id][dim])<1,'original position '+width+' '+lang+' '+id+'.'+dim+' '+JSON.stringify({original:baseline[width+'-'+lang][id],current:preserved[id]}));
    const oldSettings=baseline[width+'-'+lang].twoDSettingsBtn;check(Math.abs(rows.button.x+rows.button.w/2-oldSettings.x-oldSettings.w/2)<1,'settings centered at original position');
    if(lang==='zh')check(Math.abs(rows.button.w-rows.first.w)<1&&Math.abs(rows.button.h-rows.first.h)<1,'settings button matches ordinary controls '+JSON.stringify(rows));
    check(rows.rows.every(r=>r.text.h<=r.button.h&&r.text.right<=width&&(width>1100?r.text.x>=r.button.right:r.text.x>=r.button.x&&r.text.right<=r.button.right&&r.text.bottom<=r.button.bottom)),'parameters fit without moving controls '+width+' '+lang+JSON.stringify(rows));
    check(await ev(`Array.from(document.querySelectorAll('.twoDParamCompact')).every(e=>getComputedStyle(e).display==='none'||e.getBoundingClientRect().width<=e.parentElement.getBoundingClientRect().width+.5)`),'compact summaries fit available width');
    check(rows.weight>=700&&rows.note.y>=rows.rows[2].button.bottom&&rows.note.bottom<=rows.access.y,'bold combo note fits below aging row '+width+' '+lang+JSON.stringify(rows));
    const descriptions=await ev(`(()=>{document.getElementById('mode3d').click();Game.setSetupSpin(true);Game.setSetupWrap(true);const visible=['threeDSpinNote','threeDWrapNote'].every(id=>!document.getElementById(id).hidden);const fits=['threeDSpinCompact','threeDWrapCompact'].every(id=>{const e=document.getElementById(id);return getComputedStyle(e).display==='none'||e.getBoundingClientRect().width<=e.parentElement.getBoundingClientRect().width+.5;});return {visible,fits};})()`);
    check(descriptions.visible&&descriptions.fits,'3D option text fits '+width+' '+lang);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await ev(`(()=>{Game.setLang('zh');document.getElementById('mode2d').click();for(const k of ['holes','float','age'])Game.setupVariant2[k].on=false;Game.syncTwoDSetup();})()`);
  check(await ev(`getComputedStyle(document.getElementById('twoDSettingsBtn')).display==='none' && !document.getElementById('twoDFree')`),'classic has no optional settings or free-rule checkbox');
  const boxes=await ev(`(()=>{const ids=['twoDToggleholes','twoDTogglefloat','twoDToggleage'];return ids.map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,box:!!el.querySelector('.extraBox')};});})()`);
  check(boxes.every(b=>b.box&&b.w===boxes[0].w&&b.x===boxes[0].x)&&boxes[1].y===boxes[0].y+boxes[0].h&&boxes[2].y===boxes[1].y+boxes[1].h,'three vertically stacked checkbox rows');
  for(let mask=1;mask<8;mask++){
    const settings=await ev(`(()=>{for(const k of ['holes','float','age'])Game.setupVariant2[k].on=false;Game.syncTwoDSetup();const keys=['holes','float','age'];for(let i=0;i<3;i++)if(${mask}&(1<<i))document.getElementById('twoDToggle'+keys[i]).click();const automatic=!document.getElementById('twoDSettings').classList.contains('off');const combo=!document.getElementById('twoDComboNote').hidden;document.getElementById('twoDSettingsBtn').click();const visible=id=>document.getElementById(id).getBoundingClientRect().height>0;return {automatic,combo,open:!document.getElementById('twoDSettings').classList.contains('off'),holes:visible('twoDRandom'),float:visible('twoDFloatNote'),age:visible('twoDAgeMode'),aura:visible('twoDAuraNote'),short:visible('twoDShortNote'),random:document.getElementById('twoDRandomLabel').textContent,fixed:document.getElementById('twoDFixedRule').textContent};})()`);
    check(!settings.automatic&&settings.combo===((mask&5)===5),'toggle updates parameters and combo note without opening modal');
    check(settings.open&&settings.holes===!!(mask&1)&&settings.float===!!(mask&2)&&settings.age===!!(mask&4)&&settings.aura===((mask&5)===5)&&!settings.short,'conditional settings '+mask+JSON.stringify(settings));
    check(settings.random.includes('3–15')&&settings.fixed.includes('六连及以上判负'),'visible range and fixed rule');
    await ev(`document.getElementById('twoDSettingsClose').click()`);
  }
  check(await ev(`document.getElementById('twoDSettingsClose').textContent==='关闭 Esc'`),'close label includes Esc');
  await ev('Game.openTwoDSettings(false)');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:8,y:8,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:8,y:8,button:'left',clickCount:1});
  check(await ev(`document.getElementById('twoDSettings').classList.contains('off')`),'outside click closes settings');
  await ev(`(()=>{Game.openTwoDSettings(false);document.querySelector('#twoDSettings .twoDCard').click();})()`);
  check(await ev(`!document.getElementById('twoDSettings').classList.contains('off')`),'inside click preserves modal');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  check(await ev(`document.getElementById('twoDSettings').classList.contains('off')`),'Esc closes settings');
  const parameters=await ev(`(()=>{Game.openTwoDSettings(false);document.getElementById('twoDRandom').value=9;document.getElementById('twoDPerPlayer').value=2;document.getElementById('twoDCool').value=7;document.getElementById('twoDAgeMode').value='30';document.getElementById('twoDTurns').value=36;document.getElementById('twoDSettingsSave').click();return {holes:document.getElementById('twoDParamholes').textContent,age:document.getElementById('twoDParamage').textContent};})()`);
  check(parameters.holes.includes('9')&&parameters.holes.includes('2')&&parameters.holes.includes('7')&&parameters.age.includes('36')&&parameters.age.includes('3'),'saving updates corresponding parameter summaries');
  for(const size of [10,30]){
    const range=await ev(`(()=>{document.getElementById('dim2W').value=${size};document.getElementById('dim2H').value=${size};document.getElementById('dim2H').dispatchEvent(new Event('change'));Game.openTwoDSettings(false);return document.getElementById('twoDRandomLabel').textContent;})()`);
    check(range.includes('3–'+Math.floor(size*size/15)),'random range follows area');
    await ev(`document.getElementById('twoDSettingsClose').click()`);
  }
  await ev(`(()=>{Game.openTwoDSettings(false);document.getElementById('twoDAgeMode').value='5';document.getElementById('twoDAgeMode').dispatchEvent(new Event('change'));})()`);
  check(await ev(`document.getElementById('twoDTurns').getBoundingClientRect().height===0 && document.getElementById('twoDShortNote').getBoundingClientRect().height>0`),'fixed five-turn mode hides adjustable lifetime');
  await ev(`(()=>{document.getElementById('twoDSettingsClose').click();document.getElementById('dim2W').value=15;document.getElementById('dim2H').value=15;document.getElementById('dim2H').dispatchEvent(new Event('change'));Game.setupVariant2.float.on=false;Game.setupVariant2.age.on=false;Game.syncTwoDSetup();Game.el.setup.scrollTop=0;})()`);
  fs.mkdirSync(path.join(root,'_verify/shots'),{recursive:true});
  let shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-settings-start.png'),Buffer.from(shot.result.data,'base64'));
  await ev('Game.openTwoDSettings(false)');shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-settings-holes.png'),Buffer.from(shot.result.data,'base64'));
  await ev(`(()=>{document.getElementById('twoDSettingsClose').click();Game.setupVariant2.float.on=true;Game.setupVariant2.age.on=true;Game.syncTwoDSetup();})()`);
  shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-settings-combo.png'),Buffer.from(shot.result.data,'base64'));
  for(const [width,height,lang] of [[393,852,'zh'],[320,740,'fr']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await ev(`(()=>{Game.setLang('${lang}');Game.syncTwoDSetup();const setup=Game.el.setup;setup.scrollTop=Math.max(0,setup.scrollTop+document.getElementById('twoDOptions').getBoundingClientRect().top-setup.getBoundingClientRect().top-60);})()`);
    shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'_verify/shots/2d-settings-portrait-'+lang+'.png'),Buffer.from(shot.result.data,'base64'));
  }
  check(errors.length===0,errors.join('\n'));console.log(`${passed} 项通过 / 0 项失败 (二维设置、竖排、跨模式标题与古语位置)`);
}finally{try{ws?.close();}catch{}chrome.kill();await sleep(300);if(path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
