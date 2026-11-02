/* GOMOKU-2D-UI-BEGIN */
const TwoDUI = (() => {
  const langs = ["zh", "en", "ja", "ko", "ru", "fr"];
  const words = {
    classic:["经典二维","Classic 2D","二次元・基本","2차원 기본","Классика 2D","Classique 2D"],
    holes:["黑洞奇点","Black holes","ブラックホール","블랙홀","Чёрные дыры","Trous noirs"],
    float:["浮空连珠","Floating stones","浮遊連珠","공중 오목","Два слоя","Deux couches"],
    age:["刹那昙花","Fading stones","消えゆく石","사라지는 돌","Увядающие камни","Pierres éphémères"],
    base:["底层 · 归属地基","Foundation layer · owned","下層・所有土台","아래층 · 소유 기초","Нижний слой · свои основания","Étage des fondations · possédées"],
    top:["顶层 · 连五取胜","Top layer · connect five","上層・五連で勝利","위층 · 오목 완성","Верхний слой · пять в ряд","Étage supérieur · cinq pierres"],
    board:["二维棋盘","2D board","二次元盤","2차원 바둑판","Доска 2D","Plateau 2D"],
    black:["黑方","Black","黒","흑","Чёрные","Noirs"],
    white:["白方","White","白","백","Белые","Blancs"],
    turn:["{player}行动","{player} to play","{player}の手番","{player} 차례","Ход: {player}","À {player} de jouer"],
    setup:["{player}放置黑洞","{player}: place a black hole","{player}：ブラックホールを配置","{player}: 블랙홀 배치","{player}: поставьте дыру","{player} : placer un trou noir"],
    counts:["落子 {moves} · 交换 {swaps}","Placements {moves} · Swaps {swaps}","着手 {moves} · 交換 {swaps}","착수 {moves} · 교환 {swaps}","Камни {moves} · Обмены {swaps}","Poses {moves} · Échanges {swaps}"],
    holeCount:["黑洞 {n}","Holes {n}","穴 {n}","블랙홀 {n}","Дыры {n}","Trous {n}"],
    life:["寿命 {n} 手","Life: {n} turns","寿命 {n} 手","수명 {n} 수","Жизнь: {n} ходов","Durée : {n} coups"],
    aura:["时间光环","Time dilation","時間の遅れ","시간 지연","Замедление времени","Dilatation du temps"],
    auraBody:["黑洞八邻域每手老化 0.25 手；再外一圈 0.5 手；远处 1 手。重叠取最慢速度。交换也推进老化；新子当手不老化。","Adjacent to a hole, stones age 0.25 turns per action; the next ring ages 0.5, elsewhere 1. Overlap uses the slowest rate. Swaps also age stones; a new stone does not age immediately.","穴の隣接8点は1手に0.25手、その外側は0.5手、それ以外は1手老化します。重複時は最も遅い速度。交換でも老化し、新しい石は置いた手には老化しません。","블랙홀의 주변 8점에서는 수마다 0.25수, 다음 둘레는 0.5수, 나머지는 1수만큼 늙습니다. 겹치면 가장 느린 속도입니다. 교환도 시간을 진행시키며 새 돌은 놓은 수에 늙지 않습니다.","У дыры камни стареют на 0.25 хода за действие, в следующем кольце — на 0.5, дальше — на 1. При перекрытии действует самый медленный темп. Обмен тоже старит камни; новый камень в свой ход не стареет.","Près d’un trou, les pierres vieillissent de 0.25 coup par action ; dans l’anneau suivant, de 0.5 ; ailleurs, de 1. Le rythme le plus lent prévaut. Un échange fait aussi vieillir les pierres, sauf celle qui vient d’être posée."],
    swap:["交换黑洞","Swap holes","穴を交換","블랙홀 교환","Обменять дыры","Échanger les trous"],
    row:["行","Row","行","행","Ряд","Ligne"],
    col:["列","Column","列","열","Столбец","Colonne"],
    first:["第一条","First line","1本目","첫째 선","Первая линия","Première ligne"],
    second:["第二条","Second line","2本目","둘째 선","Вторая линия","Deuxième ligne"],
    confirm:["确定操作","Confirm","確定","확인","Подтвердить","Confirmer"],
    cancel:["取消操作","Cancel","取消","취소","Отмена","Annuler"],
    ready:["可交换","Swap ready","交換可能","교환 가능","Обмен готов","Échange prêt"],
    cooldown:["再落 {n} 子可交换","Place {n} more before swapping","あと {n} 手で交換可能","{n}수 더 놓으면 교환 가능","До обмена: ещё {n} камней","Encore {n} poses avant échange"],
    select:["点边缘刻度选择同向两条线，预览后确认","Select two rows or columns at the edges, then confirm","端の目盛で同じ方向の2本を選び、確認してください","가장자리에서 같은 방향의 두 선을 골라 확인하세요","Выберите две линии одного направления и подтвердите","Choisissez deux lignes de même sens puis confirmez"],
    preview:["虚线圈：新黑洞 · 红叉：被吞顶子","Dashed ring: new hole · Cross: swallowed stone","破線：移動先の穴・×：消える上の石","점선: 새 블랙홀 · ×: 삼켜질 위층 돌","Пунктир: новая дыра · Крест: поглощаемый камень","Pointillés : nouveau trou · Croix : pierre absorbée"],
    invalid:["这里不能落子","You cannot play here","ここには置けません","여기에는 둘 수 없습니다","Сюда поставить нельзя","Impossible de jouer ici"],
    needBase:["此处还没有地基；前 8 手只能铺地基","No foundation here; the first 8 placements are foundations","ここに土台がありません。最初の8手は土台のみ","여기에 기초가 없습니다. 처음 8수는 기초만","Здесь нет основания; первые 8 ходов — только основания","Pas de fondation ici ; les 8 premières poses sont des fondations"],
    useTop:["此格已有地基；第 9 手起可在顶层落子","This point has a foundation; top stones start on the 9th placement","この点には土台があります。9手目から上層に置けます","이 점에는 기초가 있습니다. 9수째부터 윗층에 놓을 수 있습니다","Здесь есть основание; верхние камни с 9-го хода","Cette case a une fondation ; le dessus commence à la 9e pose"],
    floatOpening:["前 8 个落子只能铺地基，第 9 个起才能在顶层落子","The first 8 placements are foundations; top stones start on the 9th","最初の8手は土台のみ。9手目から上層に置けます","처음 8수는 기초만, 9수째부터 윗층에 놓을 수 있습니다","Первые 8 ходов — только основания; верхние камни с 9-го","Les 8 premières poses sont des fondations ; le dessus commence à la 9e"],
    floatLife:["地基寿命 {n} 手","Foundation life: {n}","土台寿命 {n} 手","기초 수명 {n}수","Жизнь основания: {n}","Vie de la fondation : {n}"],
    zoom:["滚轮／双指缩放 · 拖动平移 · 点击「恢复大小」复位", "Wheel / pinch to zoom · Drag to pan · Restore size to reset", "ホイール／ピンチで拡大・ドラッグで移動・ボタンでサイズを戻す", "휠/핀치로 확대 · 드래그 이동 · 크기 복원 버튼", "Колесо / щипок: масштаб · Перетаскивание · Кнопка сброса масштаба", "Molette / pincement : zoom · Glisser : déplacer · Bouton de taille pour rétablir"],
    at:["({x}, {y}) · {layer}","({x}, {y}) · {layer}","({x}, {y}) · {layer}","({x}, {y}) · {layer}","({x}, {y}) · {layer}","({x}, {y}) · {layer}"],
    remaining:["剩余 {n} 手","{n} turns left","残り {n} 手","남은 수명 {n}수","Осталось {n} ходов","Encore {n} coups"],
    gray:["灰子：占位、阻断连线","Gray stone: occupied; breaks a line","灰色の石：場所を占め、連を遮る","회색 돌: 자리를 차지하고 연속을 끊음","Серый камень: занимает точку, прерывает ряд","Pierre grise : occupe le point et coupe l’alignement"],
    done:["本局已结束","Game finished","対局終了","대국 종료","Партия окончена","Partie terminée"],
    "tutorial.actionHint":["本关先练习交换黑洞，请选择两条线并确认","This lesson practices a hole swap: select two lines and confirm","この課題では穴を交換します。2本選んで確定してください","이번 과제는 블랙홀 교환입니다. 두 선을 골라 확인하세요","В этом уроке обменяйте дыры: выберите две линии и подтвердите","Ce défi porte sur l’échange : choisissez deux lignes et confirmez"]
  };
  function text(key, lang="zh", vars={}) {const row=words[key];return String(row?row[Math.max(0,langs.indexOf(lang))]:key).replace(/\{(\w+)\}/g,(_,k)=>vars[k]==null?"":String(vars[k]));}
  function modeName(v={},lang="zh"){const list=[v.holes&&v.holes.on&&text("holes",lang),v.float&&v.float.on&&text("float",lang),v.age&&v.age.on&&text("age",lang)].filter(Boolean);return list.length?list.join(" + "):text("classic",lang);}
  const state={root:null,canvas:null,ctx:null,session:null,options:{},lang:"zh",surfaces:[],views:[],hover:null,swap:null,pointers:new Map(),frame:0,stamp:0,needs:true,oldTop:null,fx:[],keyCell:{x:0,y:0,layer:"top"}};
  function create(tag,cls,parent){const e=document.createElement(tag);if(cls)e.className=cls;if(parent)parent.appendChild(e);return e;}
  function button(parent,key,fn,cls){const b=create("button",cls,parent);b.type="button";b.dataset.twoText=key;b.addEventListener("click",fn);return b;}
  function tell(key,vars){if(state.options.onNotice)state.options.onNotice(text(key,state.lang,vars));}
  function variant(){return state.session&&(state.session.variant2||state.session.variant)||{};}
  function dims(){const s=state.session;return s?[s.w||s.dims[0],s.h||s.dims[1]]:[15,15];}
  function mount(container,options={}){
    destroy();state.options=options;state.lang=options.lang||"zh";
    const root=state.root=create("div","two-d-ui",container);state.hud=create("div","two-d-hud",root);state.hud.setAttribute("aria-live","polite");state.summary=create("strong","",state.hud);state.counts=create("span","",state.hud);state.holeCount=create("span","",state.hud);state.life=create("span","",state.hud);state.aura=button(state.hud,"aura",()=>{state.auraNote.hidden=!state.auraNote.hidden;},"two-d-help");
    const area=state.area=create("div","two-d-surface",root),canvas=state.canvas=create("canvas","",area);canvas.id="board2d";canvas.tabIndex=0;canvas.setAttribute("role","img");state.ctx=canvas.getContext("2d");state.caption=create("div","two-d-caption",area);
    const bar=state.toolbar=create("div","two-d-toolbar",root);state.swapBtn=button(bar,"swap",beginSwap);state.swapStatus=create("span","two-d-status",bar);state.axis=create("select","",bar);for(const key of["row","col"]){const o=create("option","",state.axis);o.value=key;o.dataset.twoText=key;}state.axis.addEventListener("change",()=>{state.swap={axis:state.axis.value,lines:[]};refresh();});
    state.lineA=create("select","",bar);state.lineB=create("select","",bar);state.lineA.addEventListener("change",selectFromMenus);state.lineB.addEventListener("change",selectFromMenus);state.confirm=button(bar,"confirm",confirmSwap,"two-d-primary");state.cancel=button(bar,"cancel",cancelSwap);
    state.auraNote=create("div","two-d-aura-note",root);state.auraNote.hidden=true;state.auraNote.addEventListener("click",()=>{state.auraNote.hidden=true;});
    canvas.addEventListener("pointerdown",pointerDown);canvas.addEventListener("pointermove",pointerMove);canvas.addEventListener("pointerup",pointerUp);canvas.addEventListener("pointercancel",pointerCancel);canvas.addEventListener("pointerleave",()=>{if(!state.pointers.size){state.hover=null;state.needs=true;}});canvas.addEventListener("wheel",wheel,{passive:false});canvas.addEventListener("contextmenu",e=>e.preventDefault());canvas.addEventListener("keydown",keyDown);
    state.observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(resize):null;if(state.observer)state.observer.observe(area);state.resizeHandler=resize;window.addEventListener("resize",resize);state.reduced=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);setLanguage(state.lang);resize();tick(0);return api;
  }
  function destroy(){if(state.frame&&typeof cancelAnimationFrame!=="undefined")cancelAnimationFrame(state.frame);if(state.observer)state.observer.disconnect();if(state.resizeHandler&&typeof window!=="undefined")window.removeEventListener("resize",state.resizeHandler);if(state.root)state.root.remove();state.root=state.canvas=state.ctx=null;state.frame=0;state.observer=null;state.resizeHandler=null;state.pointers.clear();state.surfaces=[];state.views=[];state.swap=null;state.hover=null;state.oldTop=null;state.fx=[];}
  function setSession(session){const different=state.session!==session;state.session=session;if(different){state.swap=null;state.views=[];state.hover=null;state.oldTop=null;state.fx=[];}if(session&&state.oldTop&&state.oldTop.length===session.top.length&&!state.reduced)for(let k=0;k<session.top.length;k++)if(state.oldTop[k]&&!session.top[k]&&!session.hole[k])state.fx.push({k,color:state.oldTop[k],at:Date.now()});state.oldTop=session?Uint8Array.from(session.top):null;refresh();resize();return api;}
  function setLanguage(lang){state.lang=langs.includes(lang)?lang:"zh";if(state.root){for(const el of state.root.querySelectorAll("[data-two-text]"))el.textContent=text(el.dataset.twoText,state.lang);state.canvas.setAttribute("aria-label",text("board",state.lang)+". "+text("zoom",state.lang));state.auraNote.textContent=text("auraBody",state.lang);state.axis.setAttribute("aria-label",text("swap",state.lang));state.lineA.setAttribute("aria-label",text("first",state.lang));state.lineB.setAttribute("aria-label",text("second",state.lang));refresh();}return api;}
  function setAppearance(options={}){Object.assign(state.options,options);state.needs=true;render();return api;}
  function refresh(){state.needs=true;if(!state.root)return;const s=state.session,v=variant(),h=!!(v.holes&&v.holes.on),a=!!(v.age&&v.age.on),setup=s&&s.status==="Setup",player=text(s&&s.currentPlayer===2?"white":"black",state.lang);state.summary.textContent=!s?text("board",state.lang):s.status==="Decided"?text("done",state.lang):text(setup?"setup":"turn",state.lang,{player});state.counts.hidden=!!(s&&s.tutorialPosition);state.counts.textContent=s?text("counts",state.lang,{moves:s.moveCount||0,swaps:(s.swaps||[]).length}):"";state.holeCount.hidden=!h;state.holeCount.textContent=s?text("holeCount",state.lang,{n:Array.from(s.hole||[]).reduce((n,v)=>n+v,0)}):"";state.life.hidden=!a;state.life.textContent=text("life",state.lang,{n:a?v.age.turns:0});state.aura.hidden=!(a&&h);if(state.aura.hidden)state.auraNote.hidden=true;
    state.toolbar.hidden=!h;state.swapBtn.hidden=!!state.swap;state.swapBtn.disabled=!s||s.status!=="Playing"||s.handsUntilSwap>0;for(const el of[state.axis,state.lineA,state.lineB,state.confirm,state.cancel])el.hidden=!state.swap;
    if(state.swap){state.axis.value=state.swap.axis;const d=dims(),count=state.swap.axis==="row"?d[1]:d[0];for(let n=0;n<2;n++){const el=n?state.lineB:state.lineA;el.replaceChildren();const blank=create("option","",el);blank.value="";blank.textContent=text(n?"second":"first",state.lang);for(let j=0;j<count;j++){const op=create("option","",el);op.value=String(j);op.textContent=String(j);}el.value=state.swap.lines[n]===undefined?"":String(state.swap.lines[n]);}state.confirm.disabled=state.swap.lines.length!==2||!s.canSwapLines(state.swap.axis,...state.swap.lines);state.swapStatus.textContent=text(state.swap.lines.length===2?"preview":"select",state.lang);}else state.swapStatus.textContent=s&&s.handsUntilSwap>0?text("cooldown",state.lang,{n:s.handsUntilSwap}):text("ready",state.lang);state.caption.textContent=text("zoom",state.lang);render();}
  function resize(){if(!state.canvas||!state.area)return;const r=state.area.getBoundingClientRect(),dpr=Math.min(3,window.devicePixelRatio||1);state.width=Math.max(1,r.width);state.height=Math.max(1,r.height);const w=Math.round(state.width*dpr),h=Math.round(state.height*dpr);if(state.canvas.width!==w||state.canvas.height!==h){state.canvas.width=w;state.canvas.height=h;}state.dpr=dpr;layout();state.needs=true;render();}
  function layout(){const v=variant(),dual=!!(v.float&&v.float.on),w=state.width||1,h=state.height||1,gap=dual?12:0,horizontal=w>=h*1.25,boxes=dual?(horizontal?[{x:0,y:0,w:(w-gap)/2,h},{x:(w+gap)/2,y:0,w:(w-gap)/2,h}]:[{x:0,y:0,w,h:(h-gap)/2},{x:0,y:(h+gap)/2,w,h:(h-gap)/2}]):[{x:0,y:0,w,h}];const[nx,ny]=dims();state.surfaces=boxes.map((r,i)=>{const view=state.views[i]||(state.views[i]={scale:1,dx:0,dy:0}),pad=Math.min(30,Math.max(20,Math.min(r.w,r.h)*.09)),step=Math.max(1,Math.min((r.w-2*pad)/(nx-1),(r.h-2*pad-20)/(ny-1)))*view.scale,cx=r.x+r.w/2+view.dx,cy=r.y+r.h/2+10+view.dy;return {...r,i,layer:dual?(i===0?"base":"top"):"top",step,left:cx-(nx-1)*step/2,bottom:cy+(ny-1)*step/2};});if(typeof Game!=="undefined"&&Game.updateRestoreButtons)Game.updateRestoreButtons();}
  function xy(r,x,y){return[r.left+x*r.step,r.bottom-y*r.step];}
  function circle(ctx,x,y,r,fill,stroke,width=1){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
  function previewMoves(){const s=state.session,swap=state.swap;if(!s||!swap||swap.lines.length!==2)return[];const[a,b]=swap.lines,out=[],[w,h]=dims();for(let n=0;n<(swap.axis==="row"?w:h);n++){const p=swap.axis==="row"?[n,a]:[a,n],q=swap.axis==="row"?[n,b]:[b,n],pi=p[0]+p[1]*w,qi=q[0]+q[1]*w;if(!!s.hole[pi]!==!!s.hole[qi])out.push(s.hole[pi]?{from:p,to:q,k:qi}:{from:q,to:p,k:pi});}return out;}
  function drawBoard(ctx,r,now){const s=state.session;if(!s)return;const v=variant(),[w,h]=dims(),step=r.step,radius=Math.max(2,Math.min(step*.34,18)),float=!!(v.float&&v.float.on),age=!!(v.age&&v.age.on),holes=!!(v.holes&&v.holes.on);ctx.save();ctx.beginPath();ctx.rect(r.x+1,r.y+1,r.w-2,r.h-2);ctx.clip();ctx.fillStyle="rgba(247,242,230,.52)";ctx.fillRect(r.x,r.y,r.w,r.h);ctx.strokeStyle="rgba(91,91,69,.16)";ctx.lineWidth=1;ctx.strokeRect(r.x+.5,r.y+.5,r.w-1,r.h-1);const first=xy(r,0,0),last=xy(r,w-1,h-1);
    if(state.options.gridVisible!==false){ctx.save();ctx.globalAlpha=state.options.gridAlpha==null?.40:Math.max(0,Math.min(1,Number(state.options.gridAlpha)));ctx.strokeStyle=state.options.gridColor||"#566a62";ctx.lineWidth=.8;ctx.beginPath();for(let x=0;x<w;x++){const px=xy(r,x,0)[0];ctx.moveTo(px,first[1]);ctx.lineTo(px,last[1]);}for(let y=0;y<h;y++){const py=xy(r,0,y)[1];ctx.moveTo(first[0],py);ctx.lineTo(last[0],py);}ctx.stroke();ctx.restore();}
    if(state.swap){ctx.save();ctx.fillStyle="rgba(56,117,113,.13)";for(const line of state.swap.lines){if(state.swap.axis==="row"){const p=xy(r,0,line);ctx.fillRect(first[0]-step*.45,p[1]-step*.45,(w-1)*step+step*.9,step*.9);}else{const p=xy(r,line,0);ctx.fillRect(p[0]-step*.45,last[1]-step*.45,step*.9,(h-1)*step+step*.9);}}ctx.restore();}
    if(age&&holes){ctx.save();ctx.setLineDash([2,4]);ctx.strokeStyle="rgba(45,111,112,.17)";ctx.lineWidth=1;for(let k=0;k<s.hole.length;k++)if(s.hole[k]){const[cx,cy]=xy(r,k%w,Math.floor(k/w));for(const d of[1,2])ctx.strokeRect(cx-(d+.35)*step,cy-(d+.35)*step,(2*d+.7)*step,(2*d+.7)*step);}ctx.restore();}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=x+y*w,[cx,cy]=xy(r,x,y);if(cx<r.x-radius*3||cx>r.x+r.w+radius*3||cy<r.y-radius*3||cy>r.y+r.h+radius*3)continue;if(s.status==="Setup")circle(ctx,cx,cy,Math.max(1.3,radius*.16),s.canPlaceHole(x,y)?"#4e8a64":"#ad5a48");
      if(r.layer==="base"&&float){
        if(s.base[k]){
          circle(ctx,cx,cy,radius*.82,"#a9afa0","#747e70",1);
          const owner=s.baseOwner[k];
          if(owner){
            // 地基归属：黑/白环；白环外面再描一圈深色，浅底上也看得见。
            circle(ctx,cx,cy,radius*1.02,null,owner===1?"#182526":"#fbf8eb",Math.max(1.4,radius*.14));
            circle(ctx,cx,cy,radius*1.13,null,owner===1?"rgba(247,242,230,.55)":"rgba(24,37,38,.35)",1);
          }
          // 底层只显示寿命，不再画短横/颜色小点。
          const fl=s.floatLifeOf(x,y);
          ctx.save();ctx.fillStyle=owner===1?"#f5efe0":"#22302e";
          ctx.font=Math.max(8,radius*.78)+"px system-ui,sans-serif";
          ctx.textAlign="center";ctx.textBaseline="middle";
          ctx.fillText(String(fl),cx,cy);ctx.restore();
          if(age&&holes)drawLife(ctx,cx,cy,radius,Math.max(0,v.age.turns*4-s.bdrain[k]),v.age.turns*4,now);
        }
        if(s.hole[k]){ctx.strokeStyle="#a35948";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(cx-radius*.5,cy-radius*.5);ctx.lineTo(cx+radius*.5,cy+radius*.5);ctx.moveTo(cx+radius*.5,cy-radius*.5);ctx.lineTo(cx-radius*.5,cy+radius*.5);ctx.stroke();}
        continue;
      }
      if(s.hole[k]){drawHole2D(ctx,cx,cy,radius,state.reduced?0:now,(x+y)*.31);continue;}
      const color=s.top[k];if(!color){if(float&&s.base[k]&&s.moveCount>=(v.float.opening===undefined?8:v.float.opening))circle(ctx,cx,cy,Math.max(2,radius*.45),"rgba(63,84,77,.17)","rgba(67,90,80,.3)");continue;}const gray=color===3,fill=gray?"#b2b2a8":color===1?"#293636":"#fbf8eb",edge=gray?"#a28661":color===1?"#182526":"#66736d";circle(ctx,cx,cy,radius,fill,edge,Math.max(.8,radius*.07));if(color===2)circle(ctx,cx-radius*.15,cy-radius*.2,radius*.32,"rgba(255,255,255,.45)");if(float&&s.base[k]&&s.baseOwner[k]){const owner=s.baseOwner[k];circle(ctx,cx,cy,radius*1.16,null,owner===1?"#182526":"#fbf8eb",Math.max(1.1,radius*.11));circle(ctx,cx,cy,radius*1.27,null,owner===1?"rgba(247,242,230,.5)":"rgba(24,37,38,.28)",1);}if(age)drawLife(ctx,cx,cy,radius,Math.max(0,v.age.turns*4-s.drain[k]),v.age.turns*4,now);
    }
    if(!float||r.layer==="top")for(const f of state.fx){const t=(Date.now()-f.at)/250;if(t>=1)continue;const[cx,cy]=xy(r,f.k%w,Math.floor(f.k/w));ctx.save();ctx.globalAlpha=(1-t)*.5;circle(ctx,cx,cy,radius*(1-t),"#a6a99c");ctx.restore();}
    const recent=s.history&&s.history[s.history.length-1];if(recent&&(!float||recent.layer===r.layer)){const[cx,cy]=xy(r,recent.x,recent.y);circle(ctx,cx,cy,radius*1.3,null,"#aa5742",1.5);}if(s.tutorialHints)for(const h0 of s.tutorialHints){if(h0.layer&&h0.layer!==r.layer)continue;const[cx,cy]=xy(r,h0.x,h0.y);ctx.save();ctx.setLineDash([3,3]);circle(ctx,cx,cy,radius*1.5,null,"#a85c43",1.3);ctx.restore();}
    if(state.hover&&state.hover.type==="cell"){const[cx,cy]=xy(r,state.hover.x,state.hover.y);ctx.strokeStyle="rgba(152,75,52,.6)";ctx.lineWidth=1;ctx.strokeRect(cx-radius*1.3,cy-radius*1.3,radius*2.6,radius*2.6);}for(const m of previewMoves()){const[cx,cy]=xy(r,...m.to);ctx.save();ctx.setLineDash([3,3]);circle(ctx,cx,cy,radius*1.5,null,"#287f7a",2);ctx.restore();if(s.top[m.k]&&r.layer!=="base"){ctx.strokeStyle="#ac453d";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx-radius,cy-radius);ctx.lineTo(cx+radius,cy+radius);ctx.moveTo(cx+radius,cy-radius);ctx.lineTo(cx-radius,cy+radius);ctx.stroke();}}
    ctx.font="11px system-ui,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";const stride=step<17&&!state.swap?Math.ceil(17/step):1;for(let x=0;x<w;x+=stride){const[cx]=xy(r,x,0);ctx.fillStyle=state.swap&&lineHasHole("col",x)?"#257c70":"#6d786d";ctx.fillText(String(x),cx,Math.min(r.y+r.h-10,first[1]+Math.min(19,step*.8)));}for(let y=0;y<h;y+=stride){const[,cy]=xy(r,0,y);ctx.fillStyle=state.swap&&lineHasHole("row",y)?"#257c70":"#6d786d";ctx.fillText(String(y),Math.max(r.x+12,first[0]-Math.min(19,step*.8)),cy);}ctx.fillStyle="rgba(247,242,230,.94)";ctx.fillRect(r.x+3,r.y+3,r.w-6,21);ctx.fillStyle="#536b63";ctx.font="12px system-ui,sans-serif";ctx.fillText(text(float?r.layer:"board",state.lang),r.x+r.w/2,r.y+14);ctx.restore();
  }
  function drawLife(ctx,x,y,r,remaining,total,now){ctx.save();ctx.strokeStyle=remaining<=12?"#ad7654":"#4a8076";ctx.globalAlpha=remaining<=12&&!state.reduced?.6+.25*Math.sin(now/450):.8;ctx.lineWidth=Math.max(1,r*.09);ctx.beginPath();ctx.arc(x,y,r*1.16,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.max(0,remaining/total));ctx.stroke();ctx.restore();}
  /**
   * 二维平面黑洞：黑核乍看像一颗黑子，外面是金色吸积环 + 青色透镜弧 + 少量轨道微粒。
   * 所有效果都在棋子半径之外/边缘，不会把黑核染成别的颜色；旋转由 now 驱动。
   */
  function drawHole2D(ctx,cx,cy,r,now,phase){
    if(r<5){ctx.save();ctx.fillStyle="#050a0c";ctx.beginPath();ctx.arc(cx,cy,r*.94,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#e8c87a";ctx.lineWidth=1;ctx.stroke();ctx.restore();return;}
    const t=now/900+phase;
    ctx.save();
    // 引力透镜外晕
    const halo=ctx.createRadialGradient(cx,cy,r*.7,cx,cy,r*1.9);
    halo.addColorStop(0,"rgba(240,210,130,.30)");
    halo.addColorStop(.45,"rgba(70,190,180,.14)");
    halo.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(cx,cy,r*1.9,0,Math.PI*2);ctx.fill();
    // 黑核：像黑子，但比黑子更深
    const core=ctx.createRadialGradient(cx-r*.25,cy-r*.3,r*.08,cx,cy,r*.96);
    core.addColorStop(0,"#0b1416");core.addColorStop(.55,"#050a0c");
    core.addColorStop(.9,"#020506");core.addColorStop(1,"#1a2a2c");
    ctx.fillStyle=core;ctx.beginPath();ctx.arc(cx,cy,r*.94,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="rgba(232,200,122,.95)";ctx.lineWidth=Math.max(1,r*.07);
    ctx.beginPath();ctx.arc(cx,cy,r*.94,0,Math.PI*2);ctx.stroke();
    ctx.globalCompositeOperation="lighter";
    // 平面吸积盘：倾斜的亮环，金→青；会从黑核前方越过
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.35+Math.sin(t*.16)*.07);
    const disk=ctx.createLinearGradient(-r*1.55,0,r*1.55,0);
    disk.addColorStop(0,"rgba(60,200,190,0)");
    disk.addColorStop(.26,"rgba(70,225,210,.60)");
    disk.addColorStop(.5,"rgba(255,232,160,.98)");
    disk.addColorStop(.74,"rgba(245,170,80,.60)");
    disk.addColorStop(1,"rgba(60,200,190,0)");
    ctx.strokeStyle=disk;ctx.lineWidth=Math.max(1.3,r*.22);
    ctx.beginPath();ctx.ellipse(0,0,r*1.48,r*.40,0,0,Math.PI*2);ctx.stroke();
    ctx.restore();
    // 光子环
    ctx.strokeStyle="rgba(255,224,150,.85)";ctx.lineWidth=Math.max(.8,r*.055);
    ctx.beginPath();ctx.arc(cx,cy,r*1.03,0,Math.PI*2);ctx.stroke();
    // 旋转吸积弧 + 反向青色弧
    for(let i=0;i<2;i++){
      const rr=r*(1.18+i*.17),a0=t*(i?-.55:.8)+i*1.7;
      ctx.lineWidth=Math.max(1,r*(.14-i*.04));
      ctx.strokeStyle=i?"rgba(72,196,184,.72)":"rgba(244,194,92,.92)";
      ctx.beginPath();ctx.arc(cx,cy,rr,a0,a0+Math.PI*(i?1.1:1.35));ctx.stroke();
    }
    // 轨道微粒
    for(let i=0;i<3;i++){
      const a=t*(i%2?-1:1)+i*2.1,rr=r*(1.27+i*.07);
      ctx.fillStyle=i===1?"rgba(140,238,226,.9)":"rgba(255,222,148,.92)";
      ctx.beginPath();ctx.arc(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,Math.max(.8,r*.075),0,Math.PI*2);ctx.fill();
    }
    ctx.globalCompositeOperation="source-over";
    // 极小的高光，让它仍像一颗子
    ctx.fillStyle="rgba(255,255,255,.10)";ctx.beginPath();ctx.ellipse(cx-r*.27,cy-r*.3,r*.2,r*.12,-.6,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  function render(now=typeof performance!=="undefined"?performance.now():0){if(!state.ctx||!state.canvas)return;state.ctx.setTransform(state.dpr||1,0,0,state.dpr||1,0,0);state.ctx.clearRect(0,0,state.width||1,state.height||1);for(const r of state.surfaces)drawBoard(state.ctx,r,now);state.needs=false;}
  function tick(now){if(!state.root)return;const v=variant(),s=state.session,animated=!state.reduced&&s&&((v.holes&&v.holes.on)||(v.age&&v.age.on)||state.fx.length);if((state.needs||animated)&&now-state.stamp>=32){state.stamp=now;state.fx=state.fx.filter(f=>Date.now()-f.at<250);render(now);}state.frame=requestAnimationFrame(tick);}
  function point(e){const r=state.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function surfaceAt(p){return state.surfaces.find(r=>p.x>=r.x&&p.y>=r.y&&p.x<r.x+r.w&&p.y<r.y+r.h);}
  function hit(p,edges=true){const r=surfaceAt(p);if(!r)return null;const[w,h]=dims(),x=Math.round((p.x-r.left)/r.step),y=Math.round((r.bottom-p.y)/r.step);if(state.swap&&edges){const left=Math.max(r.x+12,r.left-Math.min(19,r.step*.8)),bottom=Math.min(r.y+r.h-10,r.bottom+Math.min(19,r.step*.8));if(Math.abs(p.x-left)<13&&y>=0&&y<h)return{type:"line",axis:"row",n:y,surface:r.i};if(Math.abs(p.y-bottom)<13&&x>=0&&x<w)return{type:"line",axis:"col",n:x,surface:r.i};}if(x<0||y<0||x>=w||y>=h)return null;return{type:"cell",x,y,layer:r.layer,surface:r.i};}
  function cancelTap(){if(state.options.onCancelTap)state.options.onCancelTap();}
  function pointerDown(e){if(!state.session||e.button!==0)return;e.preventDefault();const p=point(e),r=surfaceAt(p);if(!r)return;state.canvas.setPointerCapture(e.pointerId);state.pointers.set(e.pointerId,{...p,startX:p.x,startY:p.y,lastX:p.x,lastY:p.y,surface:r.i,moved:false});if(state.pointers.size===2){cancelTap();const ps=Array.from(state.pointers.values());if(ps[0].surface===ps[1].surface)state.pinch={surface:r.i,distance:Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y),scale:state.views[r.i].scale};for(const a of ps)a.moved=true;}}
  function pointerMove(e){const p=point(e),stored=state.pointers.get(e.pointerId);if(stored){stored.x=p.x;stored.y=p.y;if(state.pointers.size>=2&&state.pinch){const ps=Array.from(state.pointers.values()),v=state.views[state.pinch.surface];v.scale=Math.min(5,Math.max(1,state.pinch.scale*Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)/Math.max(1,state.pinch.distance)));stored.moved=true;layout();}else if(stored.moved||Math.hypot(p.x-stored.startX,p.y-stored.startY)>6){stored.moved=true;cancelTap();const v=state.views[stored.surface];v.dx+=p.x-stored.lastX;v.dy+=p.y-stored.lastY;clampView(stored.surface);layout();}stored.lastX=p.x;stored.lastY=p.y;state.needs=true;return;}state.hover=hit(p);updateCaption();state.needs=true;}
  function pointerUp(e){const p=state.pointers.get(e.pointerId);state.pointers.delete(e.pointerId);state.pinch=null;if(state.canvas.hasPointerCapture(e.pointerId))state.canvas.releasePointerCapture(e.pointerId);if(p&&!p.moved)requestActivate(hit(point(e)),e.clientX,e.clientY);state.needs=true;}
  function pointerCancel(e){cancelTap();state.pointers.delete(e.pointerId);state.pinch=null;}
  function clampView(i){const v=state.views[i],r=state.surfaces[i];if(!v||!r)return;v.dx=Math.max(-r.w*v.scale*.55,Math.min(r.w*v.scale*.55,v.dx));v.dy=Math.max(-r.h*v.scale*.55,Math.min(r.h*v.scale*.55,v.dy));}
  function wheel(e){e.preventDefault();cancelTap();const p=point(e),r=surfaceAt(p);if(!r)return;const v=state.views[r.i],old=v.scale;v.scale=Math.max(1,Math.min(5,old*Math.exp(-e.deltaY*.0015)));const factor=v.scale/old;v.dx=(v.dx-(p.x-r.x-r.w/2))*factor+(p.x-r.x-r.w/2);v.dy=(v.dy-(p.y-r.y-r.h/2))*factor+(p.y-r.y-r.h/2);clampView(r.i);layout();state.needs=true;}
  function viewMoved(){return state.views.some(v=>v&&(v.scale>1.001||Math.abs(v.dx)>1||Math.abs(v.dy)>1));}
  function resetZoom(e){cancelTap();if(e){const r=surfaceAt(point(e));if(r)state.views[r.i]={scale:1,dx:0,dy:0};}else state.views=[];layout();state.needs=true;render();}
  function requestActivate(h,x=0,y=0){
    if(!h)return;
    if(h.type!=="cell"||state.swap||!state.options.onTap){activate(h);return;}
    state.options.onTap("twoD-"+h.layer,x,y,()=>activate(h),h);
  }
  function activate(h){const s=state.session;if(!s||!h)return;if(h.type==="line"){selectLine(h.axis,h.n);return;}if(state.swap){tell("select");return;}if(s.status==="Decided"){tell("done");return;}const{x,y,layer}=h,k=x+y*dims()[0],v=variant();let action;if(s.status==="Setup"){if(!s.canPlaceHole(x,y)){tell("invalid");return;}action={kind:"placeHole",x,y};}else{if(v.float&&v.float.on){const opening=s.moveCount<(v.float.opening===undefined?8:v.float.opening);if(layer==="base"&&s.base[k]){tell(opening?"floatOpening":"useTop");return;}if(layer==="top"&&!s.base[k]){tell("needBase");return;}if(layer==="top"&&opening){tell("floatOpening");return;}}if(!s.canPlace(x,y,layer)){tell("invalid");return;}action={kind:"place",x,y,layer};}if(state.options.onAction)state.options.onAction(action);}
  function keyDown(e){if(typeof Keymap!=="undefined"){if(Keymap.isOpen)return;const action=Keymap.action(e),map={left:"ArrowLeft",right:"ArrowRight",up:"ArrowUp",down:"ArrowDown",place:"Enter",zoomIn:"+",zoomOut:"-",reset:"0"};if(e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;if(map[action]){const original=e;e={key:map[action],shiftKey:e.shiftKey,preventDefault:()=>original.preventDefault(),stopPropagation:()=>original.stopPropagation()};}else if(e.key!=="Escape")return;}const c=state.keyCell,[w,h]=dims();if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"," ","+","-","0","Escape"].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==="ArrowLeft")c.x=Math.max(0,c.x-1);if(e.key==="ArrowRight")c.x=Math.min(w-1,c.x+1);if(e.key==="ArrowUp")c.y=Math.min(h-1,c.y+1);if(e.key==="ArrowDown")c.y=Math.max(0,c.y-1);if(e.key==="Enter"||e.key===" "){if(e.shiftKey&&variant().float&&variant().float.on)c.layer=c.layer==="base"?"top":"base";else requestActivate({type:"cell",...c});}if(e.key==="Escape")cancelSwap();if(e.key==="0")resetZoom();if(e.key==="+"||e.key==="-"){for(const v of state.views)v.scale=Math.max(1,Math.min(5,v.scale*(e.key==="+"?1.2:1/1.2)));layout();}state.hover={type:"cell",...c};updateCaption();state.needs=true;}}
  function updateCaption(){if(!state.caption)return;const h=state.hover,s=state.session;if(!h||h.type!=="cell"||!s){state.caption.textContent=text("zoom",state.lang);return;}const k=h.x+h.y*dims()[0],v=variant(),parts=[text("at",state.lang,{x:h.x,y:h.y,layer:text(h.layer,state.lang)})];if(s.top[k]===3)parts.push(text("gray",state.lang));if(v.float&&v.float.on&&s.base[k])parts.push(text("floatLife",state.lang,{n:s.floatLifeOf(h.x,h.y)}));if(v.age&&v.age.on&&((h.layer==="top"&&s.top[k])||(h.layer==="base"&&s.base[k]&&v.holes&&v.holes.on))){const drain=h.layer==="base"?s.bdrain[k]:s.drain[k];parts.push(text("remaining",state.lang,{n:Math.max(0,v.age.turns*4-drain)/4}));}state.caption.textContent=parts.join(" · ");}
  function lineHasHole(axis,line){const s=state.session;if(!s)return false;const[w,h]=dims();for(let j=0;j<(axis==="row"?w:h);j++)if(s.hole[axis==="row"?j+line*w:line+j*w])return true;return false;}
  function beginSwap(){const s=state.session;if(!s||s.status!=="Playing")return;if(s.handsUntilSwap>0){tell("cooldown",{n:s.handsUntilSwap});return;}state.swap={axis:"row",lines:[]};refresh();}
  function cancelSwap(){state.swap=null;refresh();}
  function selectLine(axis,n){if(!state.swap)return;if(state.swap.axis!==axis)state.swap={axis,lines:[]};const lines=state.swap.lines;if(lines.length===2||lines[0]===n)state.swap.lines=[n];else lines.push(n);refresh();}
  function selectFromMenus(){if(!state.swap)return;state.swap.lines=[state.lineA.value,state.lineB.value].filter(x=>x!=="").map(Number);refresh();}
  function confirmSwap(){const swap=state.swap,s=state.session;if(!swap||swap.lines.length!==2||!s.canSwapLines(swap.axis,...swap.lines))return;const action={kind:"swap",axis:swap.axis,i:swap.lines[0],j:swap.lines[1]};state.swap=null;if(state.options.onAction)state.options.onAction(action);refresh();}
  const lessonTitles=[
    ["一换，攻守兼得","One swap, attack and defend","一度の交換で攻守両立","한 번의 교환으로 공수 동시","Один обмен: атака и защита","Un échange, attaque et défense"],
    ["归属的地基","The owned foundation","所有する土台","소유 기초","Основание с хозяином","La fondation possédée"],
    ["落子先于风化","Win before time moves","老化より先に勝つ","풍화보다 먼저 승리","Победа раньше старения","Gagner avant le vieillissement"],
    ["双层里的黑洞","Holes above foundations","土台の上の穴","받침 위의 블랙홀","Дыры над основаниями","Des trous au-dessus des fondations"],
    ["移动时间的边界","Move the edge of time","時間の境目を動かす","시간의 경계 이동","Сдвинуть границу времени","Déplacer la frontière du temps"],
    ["旧子散去，地基仍在","The stone fades; the base remains","石は消えても土台は残る","돌은 사라져도 받침은 남음","Камень исчезает, основание остаётся","La pierre disparaît, la base demeure"],
    ["空间与时间，一手兼顾","Space and time in one move","一手で空間と時間を変える","한 수로 공간과 시간 조절","Пространство и время одним ходом","Espace et temps en un coup"]
  ];
  const lessonBodies=[
    ["白方两条四即将成五，黑方两条斜四的两端都被黑洞封住。交换标记的两列：封住白方缺口，同时打开黑方两条斜线。只封缺口，不吞棋子。","White has two winning threats; holes seal both ends of Black’s two diagonal fours. Swap the marked columns to block White and open both Black diagonals. Block the gaps without swallowing stones.","白には二つの勝ち筋があり、黒の二本の斜め四連は両端を穴で封じられています。印の列を交換し、白の隙間を塞ぎながら黒の両方の斜線を開きましょう。石は飲み込ませません。","백은 두 곳에서 승리를 위협하고 흑의 대각선 네 줄은 양끝이 블랙홀로 막혔습니다. 표시된 열을 교환해 백의 빈칸을 막고 흑의 두 대각선을 여세요. 돌을 삼키지 말고 빈칸만 막습니다.","У белых две победные угрозы, а оба конца двух чёрных диагоналей закрыты дырами. Обменяйте отмеченные столбцы: закройте белые пробелы и откройте обе диагонали, не поглощая камней.","Les Blancs ont deux menaces gagnantes ; les deux extrémités des diagonales noires sont bloquées par des trous. Échangez les colonnes pour fermer les menaces blanches et ouvrir les diagonales, sans absorber de pierre."],
    ["前 8 个落子只能铺地基，第 9 个起才能在顶层落子。地基归落子方：黑环/白环表示归属，只有主人能在上面放同色顶子。对方放上后，地基寿命每手减 1；减到 0 时地基摧毁，顶子坠落成为新地基。底层数字是剩余寿命，只有顶层棋子参与五连。","The first 8 placements are foundations; top stones start on the 9th. A foundation belongs to its placer: the black/white ring shows the owner, and only the owner can add a matching top stone. If the opponent plays on it, its life drops by 1 per move; at 0 the foundation is destroyed and the top stone falls and becomes a new foundation. The number below is the remaining life; only top stones form a line.","最初の8手は土台のみ。9手目から上層に置けます。土台は置いた側の所有で、黒/白の輪が所有者を示し、所有者だけが同色の上石を置けます。相手が置くと1手ごとに寿命が1減り、0で土台が壊れ、上石が落ちて新しい土台になります。下の数字は残り寿命で、五連は上層の石だけです。","처음 8수는 기초만, 9수째부터 윗층에 놓을 수 있습니다. 기초는 놓은 쪽의 소유이며 검/흰 고리가 주인을 나타내고, 주인만 같은 색 윗돌을 놓을 수 있습니다. 상대가 놓으면 수마다 수명이 1씩 줄고, 0이 되면 기초가 파괴되며 윗돌이 떨어져 새 기초가 됩니다. 아래 숫자는 남은 수명이고, 오목은 윗층 돌만 셉니다.","Первые 8 ходов — только основания; верхние камни с 9-го. Основание принадлежит поставившему: чёрное/белое кольцо показывает хозяина, и только он может положить свой верхний камень. Если играет соперник, жизнь уменьшается на 1 за ход; при 0 основание разрушается, а верхний камень падает и становится новым основанием. Число внизу — остаток жизни; в линию входят только верхние камни.","Les 8 premières poses sont des fondations ; le dessus commence à la 9e. Une fondation appartient à celui qui l’a posée : l’anneau noir/blanc indique le propriétaire, et lui seul peut y poser une pierre de sa couleur. Si l’adversaire y joue, sa vie baisse de 1 par coup ; à 0, la fondation est détruite et la pierre tombe et devient une nouvelle fondation. Le nombre en bas est la vie restante ; seules les pierres du dessus comptent."],
    ["黑方四连里有棋子即将进入灰期，白方也在另一侧进攻。先落子判胜，再推进时间；趁关键黑子仍有颜色，补成五。","One stone in Black’s four is nearly gray, while White is attacking elsewhere. Place first and judge the win before time advances; finish five while the key stones still count.","黒の四連の要石がもうすぐ灰色になります。白も別の場所で攻めています。時間が進む前に、要石がまだ有効な今の手で五連を完成させましょう。","흑의 네 돌 중 핵심 돌이 곧 회색이 되며 백도 다른 곳에서 공격합니다. 시간 진행보다 착수의 승패 판정이 먼저입니다. 돌이 아직 유효할 때 오목을 완성하세요.","Один камень в чёрной четвёрке почти серый, а белые атакуют в другом месте. Победа проверяется до старения: завершите пять, пока ключевые камни ещё считаются.","Une pierre de la ligne noire va griser, tandis que les Blancs attaquent ailleurs. La victoire est jugée avant le vieillissement : complétez cinq tant que les pierres comptent."],
    ["顶层白方有两处绝杀，黑方两条斜四被黑洞封住两端。交换两列，同时封住白方缺口并打开黑方斜线。地基共享且保持原位，黑洞不吞地基。","On top, White has two winning gaps and holes seal both ends of Black’s diagonal fours. Swap columns to close White’s gaps and open Black’s diagonals. Shared foundations stay in place and are never swallowed.","上層の白には二つの勝ち筋があり、黒の斜め四連は両端を穴で封じられています。列を交換して白の隙間を塞ぎ、黒の斜線を開きましょう。共有の土台は動かず、穴にも飲まれません。","위층의 백은 두 곳에서 승리를 위협하고 흑의 대각선은 양끝이 막혔습니다. 열을 교환해 백의 빈칸을 막고 흑의 대각선을 여세요. 공유 기초는 움직이지 않고 블랙홀에 삼켜지지 않습니다.","Наверху у белых два выигрышных пробела, а чёрные диагонали закрыты с обоих концов. Обменяйте столбцы, закрыв белые пробелы и открыв чёрные диагонали. Общие основания остаются на месте.","À l’étage supérieur, les Blancs ont deux menaces et les diagonales noires sont fermées aux deux bouts. Échangez les colonnes pour bloquer les Blancs et ouvrir les Noirs. Les fondations partagées restent en place."],
    ["黑方关键子接近灰期，白方竖向四连逼近。交换两列，把黑洞移近黑子并吞掉白方关键顶子：附近时间变慢，远处照常流逝。","A critical black stone is almost gray; White threatens a vertical four. Move a hole close to Black and onto White’s key stone. Time slows near the hole; distant stones age normally.","黒の要石はもうすぐ灰色、白には縦の四連があります。穴を黒石の近くへ移し、白の要石を飲み込みます。穴の近くでは時間が遅れます。","흑의 핵심 돌이 곧 회색이 되고 백은 세로 네 줄을 위협합니다. 블랙홀을 흑 가까이 옮겨 백의 핵심 돌을 삼키세요. 가까울수록 시간이 느려집니다.","Важный чёрный камень почти серый, белые угрожают вертикальной четвёркой. Переместите дыру ближе к чёрным и на ключевой белый камень. Рядом с дырой время замедляется.","Une pierre noire va griser ; les Blancs menacent en colonne. Déplacez un trou près des Noirs et sur la pierre blanche essentielle. Le temps ralentit près du trou, ailleurs il avance normalement."],
    ["灰顶子仍占地基、阻断连线。先让黑、白各在标记空点铺一手地基，等灰子消失；再由黑方在留下的共享地基上补成五。空点不会自动连接断开的棋子。","The gray top stone still occupies its base and breaks the line. Let Black and White each lay a foundation at the marked empty points. After it fades, Black can reuse its base to complete five. Empty gaps never join stones.","灰色の上石は土台を占め、連を遮ります。黒と白で印の空点に土台を一つずつ置き、石が消えたら黒が残った土台に置いて五連にします。空点で連はつながりません。","회색 위층 돌은 아직 받침을 차지하고 연속을 끊습니다. 흑과 백이 표시된 빈칸에 받침을 하나씩 놓고 기다리세요. 사라진 뒤 흑이 남은 받침을 써서 오목을 만듭니다. 빈칸은 줄을 잇지 않습니다.","Серый верхний камень занимает основание и прерывает ряд. Пусть чёрные и белые поставят по основанию в отмеченных точках. После исчезновения чёрные используют свободную базу и завершат пять. Пустота не соединяет камни.","La pierre grise occupe encore sa base et coupe la ligne. Faites poser une fondation aux Noirs puis aux Blancs aux points indiqués. Après sa disparition, les Noirs réutilisent la base pour faire cinq. Une case vide ne relie pas les pierres."],
    ["两层都有寿命。交换两列黑洞：吞掉白方关键顶子、保留下方地基，并把时间光环移近黑方。地基不被吞，但自然到期时仍会连同顶子一起消失。","Both layers age here. Swap holes to swallow White’s key top stone, preserve its base, and bring the slow-time aura near Black. Holes never swallow bases, but an expiring base collapses with its top stone.","ここでは両層が老化します。穴を交換して白の上石を飲み込み、土台を残し、黒の近くの時間を遅らせます。穴は土台を飲みませんが、土台が寿命を迎えると上石も崩れます。","여기서는 두 층 모두 늙습니다. 교환으로 백의 핵심 위층 돌을 삼키고 받침을 보존하며 흑 가까이 시간 지연을 옮기세요. 블랙홀은 받침을 삼키지 않지만 받침의 수명이 끝나면 위층도 무너집니다.","Здесь стареют оба слоя. Обмен поглотит белый верхний камень, сохранит его основание и замедлит время у чёрных. Дыра не съедает основание, но при истечении его жизни верхний камень тоже падает.","Ici, les deux étages vieillissent. Échangez les trous pour absorber une pierre blanche, conserver sa base et ralentir le temps près des Noirs. Un trou ne mange pas la base, mais son expiration fait tomber la pierre supérieure."]
  ];
  const flags=[1,2,4,3,5,6,7],swapLessons=new Set([0,3,4,6]),lessonCache=new Map();
  function immediateWins(s,player){let n=0;for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){const k=x+y*s.w;if(s.top[k]||s.hole[k]||(s.variant2.float.on&&!s.base[k]))continue;const before=s.board.cells[k];s.board.cells[k]=player;const result=RuleEngine.judge(s.board,{x,y,z:0},player,s.firstPlayer,s.rules);s.board.cells[k]=before;if(result.status===MoveStatus.Win)n++;}return n;}
  function openFours(s,player){let n=0;for(const[dx,dy]of[[1,0],[0,1],[1,1],[1,-1]])for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){let ok=true;for(let t=0;t<4;t++){const xx=x+t*dx,yy=y+t*dy;if(xx<0||yy<0||xx>=s.w||yy>=s.h||s.top[xx+yy*s.w]!==player){ok=false;break;}}if(!ok)continue;for(const t of[-1,4]){const xx=x+t*dx,yy=y+t*dy,k=xx+yy*s.w;if(xx<0||yy<0||xx>=s.w||yy>=s.h||s.top[k]||s.hole[k]||(s.variant2.float.on&&!s.base[k]))ok=false;}if(ok)n++;}return n;}
  function lessonRandom(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
  function protectPosition(s,hints){const protectedCells=new Set();const reserve=(x,y)=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(s.inBounds(x+dx,y+dy))protectedCells.add(s.index(x+dx,y+dy));};for(let k=0;k<s.top.length;k++)if(s.top[k]||s.base[k]||s.hole[k])reserve(k%s.w,Math.floor(k/s.w));for(const p of hints)reserve(p.x,p.y);return protectedCells;}
  // Local clusters replace the former two strips of randomly scattered edge stones.
  // New stones may build threes, but cannot create unrelated fours or winning moves.
  function fillBackground(s,seed=9051,reserved=protectPosition(s,[]),target=s.variant2.age.on?30:42){
    const random=lessonRandom(seed),background=[];
    const counts=()=>{let b=0,w=0;for(const t of s.top){if(t===1||t===3)b++;else if(t===2)w++;}return[b,w];};
    function danger(x,y,player){for(const[dx,dy]of[[1,0],[0,1],[1,1],[1,-1]])for(let offset=0;offset<5;offset++){let own=0,blocked=false;for(let j=0;j<5;j++){const xx=x+(j-offset)*dx,yy=y+(j-offset)*dy;if(!s.inBounds(xx,yy)){blocked=true;break;}const k=s.index(xx,yy),t=s.top[k];if(s.hole[k]||t===3||(t&&t!==player)){blocked=true;break;}if(t===player)own++;}if(!blocked&&own>=4)return true;}return false;}
    const rejected=new Set();
    for(let attempts=0;attempts<350&&s.top.filter(Boolean).length<target;attempts++){
      const [black,white]=counts(),player=black===white?(random()<.5?1:2):(black<white?1:2),candidates=[];let left=0,right=0;for(let k=0;k<s.top.length;k++)if(s.top[k]){if(k%s.w<7)left++;else if(k%s.w>7)right++;}const perSide=Math.floor(target*.4);
      for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++){const k=s.index(x,y);if(reserved.has(k)||s.top[k]||s.hole[k]||rejected.has(player+':'+k))continue;let nearby=0,close=0;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){if(!dx&&!dy||!s.inBounds(x+dx,y+dy))continue;const t=s.top[s.index(x+dx,y+dy)];if(!t)continue;const d=Math.max(Math.abs(dx),Math.abs(dy));nearby+=d===1?6:d===2?2:1;if(d===1)close++;}const center=Math.max(0,7-Math.hypot(x-7,y-7));candidates.push({x,y,k,score:Math.min(nearby,24)+center*1.4+random()*6+(close?3:0)+((x<7&&left<perSide||x>7&&right<perSide)?30:0)});}
      if(!candidates.length)break;candidates.sort((a,b)=>b.score-a.score);const c=candidates[Math.floor(random()*Math.min(6,candidates.length))],oldBase=s.base[c.k];s.top[c.k]=player;if(s.variant2.float.on)s.base[c.k]=1;s.syncJudge();
      if(RuleEngine.judge(s.board,{x:c.x,y:c.y,z:0},player,s.firstPlayer,s.rules).longestRun>=4||danger(c.x,c.y,player)){s.top[c.k]=0;s.base[c.k]=oldBase;s.syncJudge();rejected.add(player+':'+c.k);continue;}
      s.birth[c.k]=-1;s.bbirth[c.k]=-2;background.push({x:c.x,y:c.y,player});
    }
    s.tutorialBackgroundCells=background;return background.length;
  }
  function addSharedBases(s,reserved,seed){if(!s.variant2.float.on)return;const random=lessonRandom(seed),candidates=[];for(let y=1;y<s.h-1;y++)for(let x=1;x<s.w-1;x++){const k=s.index(x,y);if(reserved.has(k)||s.hole[k]||s.top[k]||s.base[k])continue;let near=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(s.inBounds(x+dx,y+dy)&&s.top[s.index(x+dx,y+dy)])near++;if(near)candidates.push({k,score:near+random()*4});}candidates.sort((a,b)=>b.score-a.score);for(const c of candidates.slice(0,8)){s.base[c.k]=1;s.baseOwner[c.k]=1;s.bbirth[c.k]=-4;}}
  function assignLifetime(s,scenario){
    if(!s.variant2.age.on)return;
    if(!s.variant2.holes.on){
      // A normal 30-turn midgame has 30 surviving top stones, including its last 3 gray stones.
      const fixed=new Map();const put=(x,y,age)=>fixed.set(s.index(x,y),age);
      if(scenario===3){put(3,7,25);put(4,7,23);put(5,7,15);put(6,7,9);}
      else{put(7,7,29);put(3,7,7);put(4,7,5);put(5,7,3);put(6,7,1);}
      put(3,10,24);put(4,10,16);put(5,10,8);
      for(const color of[1,2]){const available=[];for(let age=color===1?1:0;age<30;age+=2)if(!Array.from(fixed.values()).includes(age))available.push(age);for(let k=0;k<s.top.length;k++){const owner=s.top[k]===3?1:s.top[k];if(owner!==color)continue;const age=fixed.has(k)?fixed.get(k):available.pop();if(age===undefined)throw new Error('Unbalanced aging lesson');s.drain[k]=age*4;s.birth[k]=-age;s.top[k]=age>=27?3:owner;}}
    }else{
      const random=lessonRandom(9043+scenario);for(let k=0;k<s.top.length;k++){if(s.top[k]){s.drain[k]=8+4*Math.floor(random()*17);s.birth[k]=-Math.ceil(s.drain[k]/4);}if(s.base[k]){s.bdrain[k]=s.drain[k]+4;s.bbirth[k]=s.birth[k]-1;}}
      const key=s.index(11,7);s.drain[key]=106;s.birth[key]=-28;if(s.variant2.float.on){s.bdrain[key]=110;s.bbirth[key]=-29;}
    }
  }
  function buildLesson(index){
    if(!Number.isInteger(index)||index<0||index>=flags.length)throw new Error('Unknown 2D lesson');
    if(lessonCache.has(index)){const cached=lessonCache.get(index),s=Session2D.fromSnapshot(JSON.parse(JSON.stringify(cached.snapshot)));Object.assign(s,JSON.parse(JSON.stringify(cached.meta)));s.captureInitial();return s;}
    const scenario=index+1,mask=flags[index],v={on:true,w:15,h:15,freeRule:false,holes:{on:!!(mask&1),randomCount:3,perPlayer:0,cooldown:3,seed:1873},float:{on:!!(mask&2),life:20,opening:0},age:{on:!!(mask&4),turns:30,gray:3}};
    const s=Session2D.create(15,15,1,new RuleSet(),v);for(const name of['top','base','hole','drain','bdrain'])s[name].fill(0);s.birth.fill(-1);s.bbirth.fill(-1);s.status='Playing';s.currentPlayer=1;s.placementsSinceLastSwap=3;
    const stone=(x,y,c)=>{const k=s.index(x,y);s.top[k]=c;s.birth[k]=-1;if(v.float.on){s.base[k]=1;s.baseOwner[k]=c;s.bbirth[k]=-2;}},base=(x,y)=>{const k=s.index(x,y);s.base[k]=1;s.baseOwner[k]=s.top[k]||1;s.bbirth[k]=-2;},hole=(x,y)=>{s.hole[s.index(x,y)]=1;};
    if(scenario===1||scenario===4){for(let x=6;x<=9;x++){stone(x,x-2,1);stone(x,18-x,1);}for(const y of[3,13])for(let x=11;x<=14;x++)stone(x,y,2);for(const [x,y] of [[5,3],[10,8],[5,13]])hole(x,y);if(v.float.on)for(const [x,y] of [[5,3],[10,8],[5,13],[10,3],[5,8],[10,13]])base(x,y);s.tutorialHints=[{x:5,y:3},{x:10,y:3},{x:10,y:8},{x:5,y:8},{x:5,y:13},{x:10,y:13}];}
    else if(scenario===5||scenario===7){for(let x=9;x<=11;x++)stone(x,7,1);stone(12,2,1);for(let y=3;y<=6;y++)stone(12,y,2);hole(4,6);hole(4,11);hole(14,14);if(v.float.on){base(7,7);base(12,7);base(4,6);}s.tutorialHints=[{x:4,y:6},{x:12,y:6},{x:11,y:7,layer:'top'}];}
    else{for(let x=3;x<=6;x++)stone(x,7,1);if(v.float.on)base(7,7);if(scenario===6){stone(7,7,3);s.tutorialHints=[{x:8,y:8,layer:'base'},{x:6,y:9,layer:'base'},{x:7,y:7,layer:'top'}];}else s.tutorialHints=[{x:7,y:7,layer:'top'}];stone(3,10,2);stone(4,10,2);stone(5,10,2);}
    const reserved=protectPosition(s,s.tutorialHints);fillBackground(s,1873+index*31,reserved);addSharedBases(s,reserved,7103+index);assignLifetime(s,scenario);
    s.initialHoles=[];for(let k=0;k<s.hole.length;k++)if(s.hole[k])s.initialHoles.push({x:k%s.w,y:Math.floor(k/s.w)});s.variant2.holes.layout=s.variant2.holes.on?s.initialHoles.map(p=>({...p})):null;s.tutorialPosition=true;s.syncJudge();s.captureInitial();
    lessonCache.set(index,{snapshot:s.serialize(),meta:{tutorialPosition:true,tutorialHints:s.tutorialHints,tutorialBackgroundCells:s.tutorialBackgroundCells}});return s;
  }
  function goalLesson(index,s){if(!s)return false;const scenario=index+1;if(scenario===1||scenario===4)return s.swaps.length>0&&s.swaps[s.swaps.length-1].swallowed.length===0&&immediateWins(s,2)===0&&openFours(s,1)>=2;if(scenario===5)return s.swaps.length>0&&s.top[11+7*15]===1&&s.hole[12+6*15]===1&&immediateWins(s,2)===0;if(scenario===7)return s.swaps.length>0&&s.top[11+7*15]===1&&s.hole[12+6*15]===1&&s.base[12+6*15]===1&&s.top[12+6*15]===0;return s.status==='Decided'&&s.winner===1;}
  const tutorial={
    levels(){return flags.map((mask,index)=>({id:index,mask,title:lang=>lessonTitles[index][Math.max(0,langs.indexOf(lang))],body:lang=>lessonBodies[index][Math.max(0,langs.indexOf(lang))],build:()=>buildLesson(index),goal:s=>goalLesson(index,s),solution:index===0||index===3?[{kind:'swap',axis:'col',i:5,j:10}]:index===4||index===6?[{kind:'swap',axis:'col',i:4,j:12}]:index===5?[{kind:'place',x:8,y:8,layer:'base'},{kind:'place',x:6,y:9,layer:'base'},{kind:'place',x:7,y:7,layer:'top'}]:[{kind:'place',x:7,y:7,layer:'top'}]}));},
    plan(v={}){const mask=(v.holes&&v.holes.on?1:0)|(v.float&&v.float.on?2:0)|(v.age&&v.age.on?4:0);return flags.flatMap((f,i)=>(f&mask)===f?[i]:[]);},
    build:buildLesson,goal:goalLesson,allowed(index,action){return !swapLessons.has(index)||action.kind==='swap';},apply(index,s,action){if(!this.allowed(index,action))return false;if(action.kind==='swap')return s.swapLines(action.axis,action.i,action.j);if(action.kind==='placeHole')return s.placeHole(action.x,action.y);return s.place(action.x,action.y,action.layer);},immediateWins,openFours,fill:fillBackground
  };

  const api={mount,destroy,setSession,setLanguage,setAppearance,resize,render,text,modeName,tutorial,beginSwap,cancelSwap,resetZoom,viewMoved,get session(){return state.session;},get surfaces(){return state.surfaces;},get swapPreview(){return state.swap;},get appearance(){return {gridColor:state.options.gridColor,gridAlpha:state.options.gridAlpha,gridVisible:state.options.gridVisible};}};return api;
})();
if(typeof window!=="undefined")window.TwoDUI=TwoDUI;
/* GOMOKU-2D-UI-END */
