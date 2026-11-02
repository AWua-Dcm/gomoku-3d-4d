/* GOMOKU-2D-CORE-BEGIN: independent rule state, shared RuleEngine, no DOM. */
const TWO_D_LANGS = ['zh','en','ja','ko','ru','fr'];
const TWO_D_MESSAGES = {
  invalid: ['二维配置不合法','Invalid 2D configuration','二次元設定が無効です','잘못된 2D 설정','Неверная конфигурация 2D','Configuration 2D incorrecte'],
  place: ['此处不能落子，请检查层和占位','Cannot place here: check the layer and occupancy','層と占有状態を確認してください','층과 점유 상태를 확인하세요','Здесь нельзя поставить камень: проверьте слой','Pose impossible : vérifiez la couche et l’occupation'],
  hole: ['黑洞不能重叠、正交相邻或越界','Holes cannot overlap, be orthogonally adjacent or out of bounds','穴は重複・上下左右隣接・盤外不可','블랙홀은 중복·상하좌우 인접·범위 밖에 놓을 수 없습니다','Дыры не могут совпадать, соседствовать по стороне или выходить за доску','Les trous ne peuvent se superposer, se toucher par un côté ou sortir du plateau'],
  swap: ['交换需冷却完成、两条不同的同向线且至少一条有黑洞','Swap needs cooldown, two different parallel lines and at least one hole','交換には待ち完了・異なる平行線・穴が必要','교환에는 대기 완료, 서로 다른 평행선과 블랙홀이 필요합니다','Для обмена нужны завершённая пауза, разные параллельные линии и дыра','Échange : délai terminé, deux lignes parallèles distinctes et au moins un trou'],
  setup: ['放置黑洞','Place a black hole','穴を置く','블랙홀 놓기','Разместите дыру','Placez un trou noir'],
  base: ['地基','Foundation','土台','기초','Основание','Fondation'],
  top: ['顶层','Top','上層','윗층','Верх','Dessus'],
  swapped: ['交换','Swap','交換','교환','Обмен','Échange'],
};
function twoDMessage(key, lang='zh') { return TWO_D_MESSAGES[key][Math.max(0,TWO_D_LANGS.indexOf(lang))]; }
function validateVariant2(raw={}, width, height) {
  try {
    if(!raw || typeof raw!=='object'||Array.isArray(raw))throw 0;
    const w=width===undefined?(raw.w===undefined?15:raw.w):width;
    const h=height===undefined?(raw.h===undefined?15:raw.h):height;
    const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
    if(!int(w,10,30)||!int(h,10,30))throw 0;
    const H=raw.holes||{},F=raw.float||{},A=raw.age||{};
    for(const v of [raw.on,raw.freeRule,H.on,F.on,A.on])if(v!==undefined&&typeof v!=='boolean')throw 0;
    const v={on:true,w,h,freeRule:false,holes:{on:!!H.on,randomCount:H.randomCount===undefined?Math.max(3,Math.floor(w*h/30)):H.randomCount,perPlayer:H.perPlayer===undefined?0:H.perPlayer,cooldown:H.cooldown===undefined?5:H.cooldown,seed:H.seed===undefined?0:H.seed,layout:null},float:{on:!!F.on,life:F.life===undefined?20:F.life,opening:F.opening===undefined?8:F.opening},age:{on:!!A.on,turns:A.turns===undefined?30:A.turns,gray:A.gray===undefined?(A.turns===5?0:3):A.gray,aura:!!H.on&&!!A.on}};
    if(v.holes.on){
      if(!int(v.holes.randomCount,3,Math.floor(w*h/15))||!int(v.holes.perPlayer,0,5)||!int(v.holes.cooldown,3,10)||!int(v.holes.seed,0,0xffffffff))throw 0;
      if(H.layout!==null&&H.layout!==undefined){
        if(!Array.isArray(H.layout)||H.layout.length!==v.holes.randomCount)throw 0;
        const occupied=new Set();v.holes.layout=H.layout.map(p=>{const x=Array.isArray(p)?p[0]:p.x,y=Array.isArray(p)?p[1]:p.y;
          if(!int(x,0,w-1)||!int(y,0,h-1)||occupied.has(x+w*y)||[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&occupied.has(x+dx+w*(y+dy))))throw 0;
          occupied.add(x+w*y);return {x,y};});
      }
    }else v.holes={on:false,randomCount:Math.max(3,Math.floor(w*h/30)),perPlayer:0,cooldown:5,seed:0,layout:null};
    if(!int(v.float.life,10,30)||!int(v.float.opening,0,20))throw 0;
    if(v.age.on&&(!(v.age.turns===5||int(v.age.turns,24,42))||![0,3].includes(v.age.gray)||(v.age.turns===5&&v.age.gray!==0)))throw 0;
    if(!v.age.on)v.age={on:false,turns:30,gray:3,aura:false};
    return {ok:true,variant:v};
  }catch(e){return {ok:false,reason:twoDMessage('invalid'),code:'invalid'};}
}
function normalizeVariant2(raw,w,h) {const r=validateVariant2(raw,w,h);if(!r.ok)throw new Error(r.reason);return r.variant;}
function twoDRng(seed) {let x=(seed>>>0)||0x9e3779b9;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
function generateHoles2(w,h,count,seed) {
  const random=twoDRng(seed),ids=Array.from({length:w*h},(_,i)=>i);
  for(let attempt=0;attempt<64;attempt++){
    for(let i=ids.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
    const marked=new Set(),holes=[];
    for(const k of ids){const x=k%w,y=Math.floor(k/w);if((x&&marked.has(k-1))||(x+1<w&&marked.has(k+1))||marked.has(k-w)||marked.has(k+w))continue;marked.add(k);holes.push({x,y});if(holes.length===count)return holes;}
  }
  const fallback=[];for(let y=0;y<h;y++)for(let x=y%2;x<w;x+=2){fallback.push({x,y});if(fallback.length===count)return fallback;}return fallback;
}
const TWO_D_ARRAYS=['top','base','baseOwner','hole','birth','drain','bbirth','bdrain'];
function twoDRecord(record) {
  record.toString=function(lang='zh'){return sideName(this.player,lang)+' · '+(this.kind==='swap'?twoDMessage('swapped',lang)+' '+this.axis+' '+this.i+'/'+this.j:'('+this.x+','+this.y+') · '+twoDMessage(this.kind==='placeHole'?'setup':this.layer,lang));};
  return record;
}
class Session2D {
  constructor(w,h,firstPlayer,rules,variant) {
    if(firstPlayer!==BLACK&&firstPlayer!==WHITE)throw new Error('Invalid first player');
    this.variant2=normalizeVariant2(variant,w,h);this.variant=this.variant2;
    this.w=w;this.h=h;this.dims=[w,h];this.board=new Board3D(w,h,1);this.board.wrap=false;
    this.rules=(rules||new RuleSet()).clone();this.rules.wrapEdges=false;this.rules.allowRotation=false;this.rules.phasePeriod=0;
    this.rules.winLength=5;this.rules.overlineLoses=true;this.rules.restricted=RestrictionTarget.FirstPlayer;this.rules.overlineTakesPrecedence=true;
    this.firstPlayer=firstPlayer;this.currentPlayer=firstPlayer;this.phase=0;this.rotationEnabled=false;this.rotationCount=0;
    this.history=[];this.swaps=[];this.actions=[];this.setupHoles=[];this._undoStack=[];this._silent=false;
    this.top=new Uint8Array(w*h);this.base=new Uint8Array(w*h);this.baseOwner=new Uint8Array(w*h);this.hole=new Uint8Array(w*h);
    for(const key of ['birth','drain','bbirth','bdrain'])this[key]=new Int32Array(w*h);
    this.birth.fill(-1);this.bbirth.fill(-1);
    this.initialHoles=this.variant2.holes.on?(this.variant2.holes.layout||generateHoles2(w,h,this.variant2.holes.randomCount,this.variant2.holes.seed)).map(p=>({x:p.x,y:p.y})):[];
    if(this.variant2.holes.on)this.variant2.holes.layout=this.initialHoles.map(p=>({...p}));
    for(const p of this.initialHoles)this.hole[p.x+w*p.y]=1;
    this.status=this.variant2.holes.on&&this.variant2.holes.perPlayer>0?'Setup':'Playing';this.winner=0;this.isDraw=false;this.lastOutcome=this._placed();
    this.placementsSinceLastSwap=0;
    for(const name of ['onMoveApplied','onMoveUndone','onSwapApplied','onSwapUndone','onSetupChanged','onReset','onAged','onFloatCollapsed'])this[name]=[];
    this.captureInitial();
  }
  static create(w,h,first,rules,v){return new Session2D(w,h,first,rules,v);}
  get moveCount(){return this.history.length;}
  get actionCount(){return this.actions.length;}
  get handsUntilSwap(){return Math.max(0,this.variant2.holes.cooldown-this.placementsSinceLastSwap);}
  get canSwap(){return this.status==='Playing'&&this.variant2.holes.on&&this.handsUntilSwap===0;}
  _placed(){return {status:MoveStatus.Placed,winner:0,longestRun:0,line:null,isOverlineFoul:false};}
  _reject(code,lang){return {status:MoveStatus.Rejected,winner:0,longestRun:0,line:null,isOverlineFoul:false,code,reason:twoDMessage(code,lang)};}
  _emit(name,...args){if(!this._silent)for(const fn of this[name])fn(this,...args);}
  inBounds(x,y){return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<this.w&&y<this.h;}
  index(x,y){return x+this.w*y;}
  syncJudge(){for(let k=0;k<this.top.length;k++)this.board.cells[k]=this.top[k]===BLACK||this.top[k]===WHITE?this.top[k]:0;this.board.wrap=false;}
  canPlace(x,y,layer){
    if(this.status!=='Playing'||!this.inBounds(x,y))return false;const k=this.index(x,y);
    if(this.hole[k]||this.top[k])return false;
    const F=this.variant2.float,actual=F.on&&!this.base[k]?'base':'top';
    // 前 opening 个落子只能铺地基；第 opening+1 个起才允许顶层。
    if(F.on&&actual==='top'&&this.moveCount<F.opening)return false;
    if(layer===undefined||layer===null)return true;
    if(typeof layer==='number')layer=F.on?(layer===0?'base':layer===1?'top':'invalid'):(layer===0?'top':'invalid');
    return actual===layer;
  }
  canPlaceHole(x,y){
    if(this.status!=='Setup'||!this.inBounds(x,y))return false;const k=this.index(x,y);
    return !this.hole[k]&&!this.top[k]&&!this.base[k]&&!(x>0&&this.hole[k-1])&&!(x+1<this.w&&this.hole[k+1])&&!(y>0&&this.hole[k-this.w])&&!(y+1<this.h&&this.hole[k+this.w]);
  }
  placeHole(x,y,lang='zh'){
    if(!this.canPlaceHole(x,y))return this._reject('hole',lang);
    const record=twoDRecord({kind:'placeHole',x,y,player:this.currentPlayer});this.hole[this.index(x,y)]=1;this.setupHoles.push(record);
    this.currentPlayer=opponentOf(this.currentPlayer);
    if(this.setupHoles.length===this.variant2.holes.perPlayer*2){this.status='Playing';this.currentPlayer=this.firstPlayer;this.captureInitial();}
    this._emit('onSetupChanged',record);return this._placed();
  }
  _snapshot(){
    const state={};for(const name of TWO_D_ARRAYS)state[name]=this[name].slice();
    Object.assign(state,{currentPlayer:this.currentPlayer,status:this.status,winner:this.winner,isDraw:this.isDraw,lastOutcome:JSON.parse(JSON.stringify(this.lastOutcome)),placementsSinceLastSwap:this.placementsSinceLastSwap,history:this.history.slice(),swaps:this.swaps.slice(),actions:this.actions.slice(),setupHoles:this.setupHoles.slice()});return state;
  }
  _restore(state){for(const key of TWO_D_ARRAYS)this[key].set(state[key]);for(const key of ['currentPlayer','status','winner','isDraw','placementsSinceLastSwap'])this[key]=state[key];this.lastOutcome=JSON.parse(JSON.stringify(state.lastOutcome));for(const key of ['history','swaps','actions','setupHoles'])this[key]=state[key].slice();this.syncJudge();}
  captureInitial(){this.syncJudge();this._initial=this._snapshot();this._undoStack=[];return this;}
  _settle(outcome){this.lastOutcome=outcome;if(outcome.status===MoveStatus.Win||outcome.status===MoveStatus.LoseByOverline||outcome.status===MoveStatus.Draw){this.status='Decided';this.winner=outcome.winner;this.isDraw=outcome.status===MoveStatus.Draw;return true;}return false;}
  _finish(player){
    if(this.status==='Playing'){
      this.tick();if(this.status==='Playing')this.floatRepel();this.syncJudge();
      if(this.status==='Playing'&&!this.top.some((v,k)=>!v&&!this.hole[k]))this._settle({status:MoveStatus.Draw,winner:0,longestRun:0,line:null,isOverlineFoul:false});
      if(this.status==='Playing')this.currentPlayer=opponentOf(player);
    }
    return this.lastOutcome;
  }
  place(x,y,layer,lang='zh'){
    if(!this.canPlace(x,y,layer))return this._reject('place',lang);
    const k=this.index(x,y),player=this.currentPlayer,action=this.actionCount+1,actual=this.variant2.float.on&&!this.base[k]?'base':'top';
    this._undoStack.push(this._snapshot());
    const record=twoDRecord({kind:'place',x,y,z:this.variant2.float.on&&actual==='top'?1:0,player,layer:actual,action});
    this.history.push(record);this.actions.push(record);this.placementsSinceLastSwap++;
    this.lastOutcome=this._placed();
    if(actual==='base'){this.base[k]=1;this.baseOwner[k]=player;this.bbirth[k]=action;this.bdrain[k]=0;}
    else {if(!this.baseOwner[k])this.baseOwner[k]=player;this.top[k]=player;this.birth[k]=action;this.drain[k]=0;this.syncJudge();this._settle(RuleEngine.judge(this.board,{x,y,z:0},player,this.firstPlayer,this.rules,player));}
    const result=this._finish(player);this._emit('onMoveApplied',record,result);return result;
  }
  canSwapLines(axis,i,j){
    const col=axis==='col'||axis===1,row=axis==='row'||axis===0;
    if(!col&&!row||!this.canSwap||!Number.isInteger(i)||!Number.isInteger(j)||i===j||i<0||j<0||i>=(col?this.w:this.h)||j>=(col?this.w:this.h))return false;
    for(let n=0;n<(col?this.h:this.w);n++)if(this.hole[col?i+this.w*n:n+this.w*i]||this.hole[col?j+this.w*n:n+this.w*j])return true;return false;
  }
  swapLines(axis,i,j,lang='zh'){
    if(!this.canSwapLines(axis,i,j))return this._reject('swap',lang);
    const col=axis==='col'||axis===1,player=this.currentPlayer;
    this._undoStack.push(this._snapshot());
    const record=twoDRecord({kind:'swap',axis:col?'col':'row',orient:col?1:0,i,j,lineA:i,lineB:j,player,action:this.actionCount+1,placementsBefore:this.moveCount,swallowed:[]});
    for(let n=0;n<(col?this.h:this.w);n++){
      const a=col?i+this.w*n:n+this.w*i,b=col?j+this.w*n:n+this.w*j;
      if(this.hole[a]===this.hole[b])continue;
      const target=this.hole[a]?b:a;[this.hole[a],this.hole[b]]=[this.hole[b],this.hole[a]];
      if(this.top[target])record.swallowed.push([target%this.w,Math.floor(target/this.w)]);
      this.top[target]=0;this.birth[target]=-1;this.drain[target]=0; // Foundations deliberately survive holes.
    }
    this.swaps.push(record);this.actions.push(record);this.placementsSinceLastSwap=0;this.lastOutcome=this._placed();this.syncJudge();this.scanAfterChange(player);
    const result=this._finish(player);this._emit('onSwapApplied',record,result);return result;
  }
  drainAt(x,y){
    if(!this.variant2.age.aura)return 4;let cost=4;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){if(!dx&&!dy)continue;if(this.inBounds(x+dx,y+dy)&&this.hole[this.index(x+dx,y+dy)])cost=Math.min(cost,Math.max(Math.abs(dx),Math.abs(dy))===1?1:2);}
    return cost;
  }
  remainingOf(x,y,layer='top'){const k=this.index(x,y);if(!this.inBounds(x,y))return 0;if(layer==='base'){if(!this.base[k])return 0;if(!(this.variant2.holes.on&&this.variant2.float.on&&this.variant2.age.on))return Infinity;return Math.max(0,this.variant2.age.turns-this.bdrain[k]/4);}if(!this.top[k])return 0;return this.variant2.age.on?Math.max(0,this.variant2.age.turns-this.drain[k]/4):Infinity;}
  /**
   * 浮空地基的排斥寿命：上面没有顶子、或顶子与地基同主、或是灰子时，
   * 寿命保持初始值；对方顶子放上后，每过一手减 1。
   */
  floatLifeOf(x,y){
    const F=this.variant2.float;if(!F.on)return 0;
    const k=this.index(x,y);if(!this.inBounds(x,y)||!this.base[k])return F.life;
    const owner=this.baseOwner[k];if(!owner)return F.life;
    const t=this.top[k];
    if(t!==BLACK&&t!==WHITE)return F.life; // 空 / 灰子：暂停计时
    if(t===owner)return F.life;
    const born=this.birth[k];
    if(born<0)return F.life;
    return Math.max(0,F.life-(this.actionCount-born));
  }
  /**
   * 排斥结算：对方顶子把地基耗到 0 手时，地基摧毁，顶子坠下成为新的地基。
   * 新地基归坠落棋子的颜色；旧地基的主人失去它。灰子不参与（见 floatLifeOf）。
   */
  floatRepel(){
    const F=this.variant2.float;
    if(!F.on||this.status!=='Playing')return;
    let changed=false;
    for(let k=0;k<this.base.length;k++){
      if(!this.base[k]||!this.baseOwner[k])continue;
      const t=this.top[k];
      if(t!==BLACK&&t!==WHITE)continue;
      if(t===this.baseOwner[k])continue;
      if(this.floatLifeOf(k%this.w,Math.floor(k/this.w))>0)continue;
      this.base[k]=1;this.baseOwner[k]=t;this.bbirth[k]=this.actionCount;this.bdrain[k]=0;
      this.top[k]=0;this.birth[k]=-1;this.drain[k]=0;
      changed=true;
    }
    if(changed){this.syncJudge();this._emit('onFloatCollapsed');}
  }
  tick(){
    if(!this.variant2.age.on||this.status!=='Playing')return;
    const T=this.variant2.age.turns*4,gray=this.variant2.age.gray*4,ageBase=this.variant2.holes.on&&this.variant2.float.on,removed=[];
    for(let k=0;k<this.top.length;k++){
      const cost=this.drainAt(k%this.w,Math.floor(k/this.w));
      if(ageBase&&this.base[k]&&this.bbirth[k]<this.actionCount){this.bdrain[k]=Math.min(T,this.bdrain[k]+cost);if(this.bdrain[k]>=T){this.base[k]=0;this.baseOwner[k]=0;this.bbirth[k]=-1;this.bdrain[k]=0;this.top[k]=0;this.birth[k]=-1;this.drain[k]=0;removed.push(k);continue;}}
      if(this.top[k]&&this.birth[k]<this.actionCount){
        this.drain[k]=Math.min(T,this.drain[k]+cost);const remain=T-this.drain[k];
        if(remain<=0){this.top[k]=0;this.birth[k]=-1;this.drain[k]=0;removed.push(k);}
        else if(remain<=gray)this.top[k]=3;
      }
    }
    this.syncJudge();if(removed.length)this.scanAfterChange(this.currentPlayer);this._emit('onAged',removed);
  }
  scanAfterChange(actor){
    const lines=RuleEngine.fullScan(this.board,this.rules.winLength);if(!lines.length)return;
    const preferred=lines.find(l=>l.player===actor)||lines[0];const [x,y]=preferred.start;
    this._settle(RuleEngine.judge(this.board,{x,y,z:0},preferred.player,this.firstPlayer,this.rules,preferred.player));
  }
  undo(){
    if(this._undoStack.length){const record=this.actions[this.actions.length-1],snapshot=this._undoStack.pop();this._restore(snapshot);this._emit(record.kind==='swap'?'onSwapUndone':'onMoveUndone',record);return true;}
    if(this.setupHoles.length&&this.actions.length===0){const record=this.setupHoles.pop();this.hole[this.index(record.x,record.y)]=0;this.status='Setup';this.currentPlayer=record.player;this.captureInitial();this._emit('onSetupChanged',record);return true;}
    return false;
  }
  undoLastSwap(){return this.actions.length&&this.actions[this.actions.length-1].kind==='swap'?this.undo():false;}
  reset(w,h,first,rules,variant){
    if(Array.isArray(w)){variant=rules;rules=first;first=h;h=w[1];w=w[0];}
    const next=new Session2D(w||this.w,h||this.h,first||this.firstPlayer,rules||this.rules,variant||this.variant2);
    for(const key of Object.keys(next))if(!key.startsWith('on'))this[key]=next[key];this._emit('onReset');
  }
  restart(){this.reset(this.w,this.h,this.firstPlayer,this.rules,this.variant2);}
  concede(player){if(this.status!=='Playing'||![BLACK,WHITE].includes(player))return false;this.status='Decided';this.winner=opponentOf(player);this.isDraw=false;this.lastOutcome={status:MoveStatus.Win,winner:this.winner,longestRun:0,line:null,isOverlineFoul:false,isResign:true,resignedBy:player};return true;}
  describeStatus(lang='zh'){if(this.status==='Setup')return sideName(this.currentPlayer,lang)+' · '+twoDMessage('setup',lang)+' '+this.setupHoles.length+'/'+(2*this.variant2.holes.perPlayer);return GameSession.prototype.describeStatus.call(this,lang);}
  clone(){const copy=new Session2D(this.w,this.h,this.firstPlayer,this.rules,this.variant2);copy._restore(this._snapshot());copy._initial=this._initial;copy._silent=true;return copy;}
  serialize(){const state=this._snapshot();for(const key of TWO_D_ARRAYS)state[key]=Array.from(state[key]);return {w:this.w,h:this.h,firstPlayer:this.firstPlayer,rules:{...this.rules},variant:JSON.parse(JSON.stringify(this.variant2)),state};}
  static fromSnapshot(data){const s=new Session2D(data.w,data.h,data.firstPlayer,Object.assign(new RuleSet(),data.rules),data.variant);const state=data.state;for(const key of ['history','swaps','actions','setupHoles'])state[key]=state[key].map(r=>twoDRecord({...r}));s._restore(state);s.captureInitial();return s;}
  replay(initial,actions,options={}){
    const quiet=this._silent;this._silent=true;this._restore(initial||this._initial);this._undoStack=[];
    for(const a of actions){const result=a.kind==='swap'?this.swapLines(a.axis,a.i,a.j):a.kind==='placeHole'?this.placeHole(a.x,a.y):this.place(a.x,a.y,a.layer);if(result.status===MoveStatus.Rejected)throw new Error('Illegal replay action');}
    this._silent=quiet;if(!options.silent)this._emit('onReset');return this;
  }
  fingerprint2(){return fingerprint2(this);}
}
function fingerprint2(s){
  let h=0x811c9dc5;const mix=v=>{h=Math.imul(h^(v&255),16777619)>>>0;};const integer=v=>{mix(v);mix(v>>>8);mix(v>>>16);mix(v>>>24);};
  const text=JSON.stringify([s.variant2,s.rules,s.firstPlayer,s.currentPlayer,s.status,s.winner,s.isDraw,s.moveCount,s.actionCount,s.placementsSinceLastSwap,s.initialHoles,s.setupHoles.map(p=>[p.x,p.y,p.player])]);
  for(let i=0;i<text.length;i++){integer(text.charCodeAt(i));}for(const key of TWO_D_ARRAYS)for(const v of s[key])integer(v);
  return h.toString(16).padStart(8,'0');
}
const AI_PARAMS2={low:{depth:1,branch:5,budget:20000,swaps:4},medium:{depth:2,branch:6,budget:80000,swaps:8},high:{depth:3,branch:6,budget:300000,swaps:12},xhigh:{depth:4,branch:6,budget:500000,swaps:16},ultra:{depth:5,branch:6,budget:800000,swaps:16,vcf:true,vcfDepth:8,vcfBudget:30000,vcfDefDepth:6,vcfDefBudget:10000,feat:true}};
const TWO_D_DIRS=[[1,0],[0,1],[1,1],[1,-1]];

/* ------------------------------------------------------------------
   2D VCF：只做“冲四/活四”的连续强制手。

   【为什么只给 classic 开】浮空会改可下性、寿命会让子到期、黑洞会阻断线路；
   这三件事都不在 VCF 的盘面模型里。把 VCF 开到带机制的变体上，它会把
   “现在能成五”误当成“将来还能成五”。第一版只在三机制全关时启用。

   【判定必须走 RuleEngine.judge】2D 是“恰好五连、先手长连负”。自己数连子
   会把先手的长连自尽当成胜。所有终局判定都走 judge。
   ------------------------------------------------------------------ */
function ai2VcfSafe(s){return !s.variant2.holes.on&&!s.variant2.float.on&&!s.variant2.age.on;}

/**
 * 遍历所有长度 5 的窗口。回调参数是 5 个格子索引 + 窗口两端再外一格的索引
 * （越界为 -1）。方向固定为横、竖、右下、左下；顺序固定，保证同种子同结果。
 */
function ai2Windows(s,fn){
  const w=s.w,h=s.h;
  for(let y=0;y<h;y++)for(let x=0;x+5<=w;x++){const k=x+y*w;fn(k,k+1,k+2,k+3,k+4,x>0?k-1:-1,x+5<w?k+5:-1);}
  for(let x=0;x<w;x++)for(let y=0;y+5<=h;y++){const k=x+y*w;fn(k,k+w,k+2*w,k+3*w,k+4*w,y>0?k-w:-1,y+5<h?k+5*w:-1);}
  for(let y=0;y+5<=h;y++)for(let x=0;x+5<=w;x++){const k=x+y*w;fn(k,k+w+1,k+2*w+2,k+3*w+3,k+4*w+4,x>0&&y>0?k-w-1:-1,x+5<w&&y+5<h?k+5*w+5:-1);}
  for(let y=0;y+5<=h;y++)for(let x=4;x<w;x++){const k=x+y*w;fn(k,k+w-1,k+2*w-2,k+3*w-3,k+4*w-4,x+1<w&&y>0?k-w+1:-1,x-5>=0&&y+5<h?k+5*w-5:-1);}
}

function ai2JudgeAt(s,k,player){
  const x=k%s.w,y=Math.floor(k/s.w);
  return RuleEngine.judge(s.board,{x,y,z:0},player,s.firstPlayer,s.rules,player);
}

/* 热循环里的复用缓冲。扫描函数不递归、调用方立刻读走，所以可以共用一份。 */
const AI2_SCAN={b:0,w:0,g:0,hole:0,e1:-1,e2:-1,empties:0};
function ai2ScanWindow(s,a,b,c,d,e){
  const o=AI2_SCAN;o.b=0;o.w=0;o.g=0;o.hole=0;o.e1=-1;o.e2=-1;o.empties=0;
  let v=s.top[a];if(s.hole[a])o.hole++;else if(v===1)o.b++;else if(v===2)o.w++;else if(v===3)o.g++;else{o.empties++;o.e1=a;}
  v=s.top[b];if(s.hole[b])o.hole++;else if(v===1)o.b++;else if(v===2)o.w++;else if(v===3)o.g++;else{o.empties++;if(o.e1<0)o.e1=b;else o.e2=b;}
  v=s.top[c];if(s.hole[c])o.hole++;else if(v===1)o.b++;else if(v===2)o.w++;else if(v===3)o.g++;else{o.empties++;if(o.e1<0)o.e1=c;else if(o.e2<0)o.e2=c;}
  v=s.top[d];if(s.hole[d])o.hole++;else if(v===1)o.b++;else if(v===2)o.w++;else if(v===3)o.g++;else{o.empties++;if(o.e1<0)o.e1=d;else if(o.e2<0)o.e2=d;}
  v=s.top[e];if(s.hole[e])o.hole++;else if(v===1)o.b++;else if(v===2)o.w++;else if(v===3)o.g++;else{o.empties++;if(o.e1<0)o.e1=e;else if(o.e2<0)o.e2=e;}
  return o;
}

/** 当前盘面上，player 落子就能成五的点（已用 judge 过滤长连负）。 */
function ai2WinPoints(s,player){
  const pts=[];
  ai2Windows(s,(a,b,c,d,e)=>{
    const o=ai2ScanWindow(s,a,b,c,d,e);
    if(o.hole||o.g)return;
    const own=player===1?o.b:o.w,other=player===1?o.w:o.b;
    if(other||own!==4||o.empties!==1)return;
    if(pts.indexOf(o.e1)<0)pts.push(o.e1);
  });
  return ai2ValidatePoints(s,player,pts);
}

/** 去重 + 用 judge 过滤长连负；只保留真正能成五的点。 */
function ai2ValidatePoints(s,player,pts){
  const out=[],seen=[];
  for(const k of pts){
    if(seen.indexOf(k)>=0)continue;seen.push(k);
    if(s.top[k]!==0||s.hole[k])continue;
    // 浮空：没有地基的格子只能落底层，底层不参与连线；把它临时置顶再 judge
    // 会造出“根本不存在的成五点”（审查实测 4 局里 1288 次假 +9e7）。
    if(s.variant2.float.on&&!s.base[k])continue;
    const beforeTop=s.top[k],beforeCell=s.board.cells[k];
    s.top[k]=player;s.board.cells[k]=player;
    const o=ai2JudgeAt(s,k,player);
    s.top[k]=beforeTop;s.board.cells[k]=beforeCell;
    if(o.status===MoveStatus.Win&&o.winner===player)out.push({x:k%s.w,y:Math.floor(k/s.w),k});
  }
  return out;
}

/** 所有“落子后能做出一个四”的点（窗口里已有 3 个自己 + 2 个空）。 */
function ai2FourMoves(s,player){
  const pts=[];
  ai2Windows(s,(a,b,c,d,e)=>{
    const o=ai2ScanWindow(s,a,b,c,d,e);
    if(o.hole||o.g)return;
    const own=player===1?o.b:o.w,other=player===1?o.w:o.b;
    if(other||own!==3||o.empties!==2)return;
    if(pts.indexOf(o.e1)<0)pts.push(o.e1);
    if(pts.indexOf(o.e2)<0)pts.push(o.e2);
  });
  return pts;
}

/** 对方是否至少有一个“做四”的点；没有就不必跑防守 VCF。 */
function ai2HasFourPotential(s,player){return ai2FourMoves(s,player).length>0;}

/* 叶子评估的方向窗口权重。量级和旧 value() 的 [0,2,15,180,4500] 同阶，
   但这里统计的是**全盘所有窗口**，不是只看某一手经过的那几条线。 */
const AI2_EVAL_WINDOW=[0,2,12,150,4000];
const AI2_EVAL_OPEN=0.25;   // 窗口两端都空时，三/二的价值上浮
const AI2_EVAL_FOE=0.9;     // 对方形状的折扣：下一步是我走

/** 变体寿命/浮空对某一方整体形状的折扣（classic 直接返回 1）。 */
function ai2LifeFactor(s,side){
  if(!s.variant2.age.on&&!s.variant2.float.on)return 1;
  let sum=0,n=0;
  for(let k=0;k<s.top.length;k++){
    if(s.top[k]!==side)continue;n++;
    const x=k%s.w,y=Math.floor(k/s.w);let life=1;
    if(s.variant2.age.on)life=Math.min(life,Math.max(.25,s.remainingOf(x,y)/8));
    if(s.variant2.float.on&&s.base[k]&&s.baseOwner[k]&&s.baseOwner[k]!==side)
      life=Math.min(life,Math.max(.25,s.floatLifeOf(x,y)/Math.max(1,s.variant2.float.life)));
    sum+=life;
  }
  return n?Math.max(.25,sum/n):1;
}

/**
 * 攻方刚走完、轮到守方应手。返回 true 表示攻方的强制链仍然成立。
 * 这里**不猜**：守方能立即成五就判失败；攻方有两个成五点就判成功；
 * 只有一个时守方只能堵那一点，然后回到攻方。
 */
function ai2VcfDefend(s,attacker,depth,budget,stats){
  if(budget.nodes++>budget.limit)return false;
  if(stats)stats.vcfNodes=(stats.vcfNodes||0)+1;
  const foe=opponentOf(attacker);
  if(ai2WinPoints(s,foe).length>0)return false;      // 守方自己先成五
  const wins=ai2WinPoints(s,attacker);
  if(wins.length>=2)return true;                     // 一手堵不住两处
  if(wins.length===0)return false;                   // 这一手没做出四，不强制
  const k=wins[0].k;
  if(s.top[k]!==0||s.hole[k])return false;
  s.top[k]=foe;s.board.cells[k]=foe;
  const o=ai2JudgeAt(s,k,foe);
  let ok=false;
  if(o.status===MoveStatus.LoseByOverline)ok=true;   // 守方堵点自尽
  else if(o.status===MoveStatus.Win)ok=false;        // 守方堵点成五
  else ok=!!ai2VcfAttack(s,attacker,depth,budget,stats);
  s.top[k]=0;s.board.cells[k]=0;
  return ok;
}

/**
 * 攻方走。返回 {x,y,win:true} 或 null。
 * 顺序：先看自己能不能立即成五；再看对方有没有立即成五（有就必须先堵）；
 * 否则枚举所有能做四的点，逐一交给 ai2VcfDefend 验证。
 */
function ai2VcfAttack(s,attacker,depth,budget,stats){
  if(budget.nodes++>budget.limit)return null;
  if(stats)stats.vcfNodes=(stats.vcfNodes||0)+1;
  const foe=opponentOf(attacker);
  const mine=ai2WinPoints(s,attacker);
  if(mine.length)return {x:mine[0].x,y:mine[0].y,win:true};
  if(depth<=0)return null;
  const foeWins=ai2WinPoints(s,foe);
  if(foeWins.length>=2)return null;                  // 堵不住
  if(foeWins.length===1){
    // 必须堵；堵完若还能做出四，才继续强制链。
    const k=foeWins[0].k;
    if(s.top[k]!==0||s.hole[k])return null;
    s.top[k]=attacker;s.board.cells[k]=attacker;
    const o=ai2JudgeAt(s,k,attacker);
    let ok=false;
    if(o.status===MoveStatus.Win)ok=true;
    else if(o.status!==MoveStatus.LoseByOverline&&ai2WinPoints(s,attacker).length>0)
      ok=ai2VcfDefend(s,attacker,depth-1,budget,stats);
    s.top[k]=0;s.board.cells[k]=0;
    return ok?{x:foeWins[0].x,y:foeWins[0].y,win:true}:null;
  }
  const cand=ai2FourMoves(s,attacker).sort((a,b)=>a-b);
  for(const k of cand){
    if(budget.nodes>budget.limit)break;
    if(s.top[k]!==0||s.hole[k])continue;
    s.top[k]=attacker;s.board.cells[k]=attacker;
    const o=ai2JudgeAt(s,k,attacker);
    if(o.status===MoveStatus.LoseByOverline){s.top[k]=0;s.board.cells[k]=0;continue;}
    let ok=false;
    if(o.status===MoveStatus.Win)ok=true;
    else ok=ai2VcfDefend(s,attacker,depth-1,budget,stats);
    s.top[k]=0;s.board.cells[k]=0;
    if(ok)return {x:k%s.w,y:Math.floor(k/s.w),win:true};
  }
  return null;
}

/** 对外入口：在克隆盘上跑，保证不修改原盘；预算按节点数封顶。 */
function ai2Vcf(session,attacker,cfg,stats){
  const s=session.clone();
  const budget={nodes:0,limit:cfg.vcfBudget||30000};
  if(stats)stats.vcfCalls=(stats.vcfCalls||0)+1;
  return ai2VcfAttack(s,attacker,cfg.vcfDepth||8,budget,stats);
}
// 仅用于AI树：每个分支单独复制，不调用undo；VCF自行还原临时棋子。
// 首个入口仍用公开clone规范化配置。公开Session2D.clone/place/swap/undo不改。
function ai2SkipUndoSnapshot(){return null;}
function ai2UseScratch(s){s.clone=ai2ScratchClone;s._snapshot=ai2SkipUndoSnapshot;return s;}
function ai2ScratchClone(){return new AI2ScratchSession(this);}
function AI2ScratchSession(s){
  const v=s.variant2,H=v.holes,F=v.float,A=v.age;
  this.variant2={on:v.on,w:v.w,h:v.h,freeRule:v.freeRule,
    holes:{on:H.on,randomCount:H.randomCount,perPlayer:H.perPlayer,cooldown:H.cooldown,seed:H.seed,layout:H.layout?H.layout.map(p=>({x:p.x,y:p.y})):null},
    float:{on:F.on,life:F.life,opening:F.opening},age:{on:A.on,turns:A.turns,gray:A.gray,aura:A.aura}};
  this.variant=this.variant2;this.w=s.w;this.h=s.h;this.dims=[s.w,s.h];
  this.board=new Board3D(s.w,s.h,1);this.board.wrap=false;this.rules=s.rules.clone();
  this.firstPlayer=s.firstPlayer;this.currentPlayer=s.currentPlayer;this.phase=0;this.rotationEnabled=false;this.rotationCount=0;
  this.history=s.history.slice();this.swaps=s.swaps.slice();this.actions=s.actions.slice();this.setupHoles=s.setupHoles.slice();
  this._undoStack=[];this._silent=true;
  this.top=s.top.slice();this.base=s.base.slice();this.baseOwner=s.baseOwner.slice();this.hole=s.hole.slice();
  this.birth=s.birth.slice();this.drain=s.drain.slice();this.bbirth=s.bbirth.slice();this.bdrain=s.bdrain.slice();
  this.initialHoles=s.initialHoles.map(p=>({x:p.x,y:p.y}));
  this.status=s.status;this.winner=s.winner;this.isDraw=s.isDraw;this.lastOutcome=JSON.parse(JSON.stringify(s.lastOutcome));
  this.placementsSinceLastSwap=s.placementsSinceLastSwap;
  this.onMoveApplied=[];this.onMoveUndone=[];this.onSwapApplied=[];this.onSwapUndone=[];
  this.onSetupChanged=[];this.onReset=[];this.onAged=[];this.onFloatCollapsed=[];
  this._initial=s._initial;this.clone=ai2ScratchClone;this._snapshot=ai2SkipUndoSnapshot;
  this.syncJudge();
}
AI2ScratchSession.prototype=Session2D.prototype;

function ai2ChooseMove(session,opts={}){
  const config=AI_PARAMS2[opts.level]||AI_PARAMS2.medium,random=twoDRng(opts.seed||1),stats=opts.stats||{};
  stats.points=0;stats.nodes=0;const budget=config.budget*Math.max(1,session.w*session.h/225),me=session.currentPlayer;
  if(session.status==='Setup'){
    const legal=[];for(let y=0;y<session.h;y++)for(let x=0;x<session.w;x++)if(session.canPlaceHole(x,y))legal.push({kind:'placeHole',x,y,score:-Math.abs(x-(session.w-1)/2)-Math.abs(y-(session.h-1)/2)+random()*3});
    legal.sort((a,b)=>b.score-a.score);return legal[0]||{kind:'none'};
  }
  if(session.status!=='Playing')return {kind:'none'};
  const legal=(s)=>{const list=[];for(let y=0;y<s.h;y++)for(let x=0;x<s.w;x++)if(s.canPlace(x,y)){stats.points++;list.push({kind:'place',x,y,layer:s.variant2.float.on&&!s.base[s.index(x,y)]?'base':'top'});}return list;};
  const outcome=(s,a,p)=>{
    if(a.layer==='base')return null;const k=s.index(a.x,a.y),before=s.board.cells[k];s.board.cells[k]=p;
    const out=RuleEngine.judge(s.board,{x:a.x,y:a.y,z:0},p,s.firstPlayer,s.rules,p);s.board.cells[k]=before;stats.points+=4;return out;
  };
  const value=(s,a,p)=>{
    if(stats.points+100>budget*.2)return 0;
    let total=0;const limit=s.rules.winLength;
    for(const [dx,dy] of TWO_D_DIRS)for(let offset=0;offset<limit;offset++){
      let count=0,empty=0,life=1,blocked=false;
      for(let j=0;j<limit;j++){const x=a.x+(j-offset)*dx,y=a.y+(j-offset)*dy;stats.points++;
        if(!s.inBounds(x,y)){blocked=true;break;}const k=s.index(x,y),t=s.top[k];
        if(s.hole[k]||t===3||(t&&t!==p)){blocked=true;break;}
        if(x===a.x&&y===a.y||t===p){count++;if(t===p){if(s.variant2.age.on)life=Math.min(life,Math.min(1,s.remainingOf(x,y)/8));if(s.variant2.float.on&&s.base[k]&&s.baseOwner[k]&&s.baseOwner[k]!==p){life=Math.min(life,Math.max(.25,s.floatLifeOf(x,y)/Math.max(1,s.variant2.float.life)));}}}else empty++;
      }
      if(!blocked)total+=[0,2,15,180,4500,1000000][count]*life/(1+empty*.1);
    }
    if(s.variant2.float.on&&a.layer==='top'){const kk=s.index(a.x,a.y);if(s.base[kk]&&s.baseOwner[kk]&&s.baseOwner[kk]!==p)total*=.8;}
    return total;
  };
  const evalBoardOld=(s,p)=>{
    if(s.status==='Decided')return s.winner===p?1e8:s.winner?-1e8:0;
    let score=0;for(let k=0;k<s.top.length;k++)if(s.top[k]===1||s.top[k]===2){const x=k%s.w,y=Math.floor(k/s.w),side=s.top[k];let life=s.variant2.age.on?Math.min(1,s.remainingOf(x,y)/8):1;if(s.variant2.float.on&&s.base[k]&&s.baseOwner[k]&&s.baseOwner[k]!==side)life*=Math.max(.25,s.floatLifeOf(x,y)/Math.max(1,s.variant2.float.life));score+=(side===p?1:-1)*life*(8+4/(1+Math.abs(x-s.w/2)+Math.abs(y-s.h/2)));}
    const ranked=legal(s).map(a=>({a,v:value(s,a,p),f:value(s,a,opponentOf(p))}));
    ranked.sort((a,b)=>b.v-a.v);score+=ranked.slice(0,2).reduce((n,a)=>n+a.v,0);ranked.sort((a,b)=>b.f-a.f);score-=ranked.slice(0,2).reduce((n,a)=>n+a.f,0)*1.05;return score;
  };
  /**
   * 方向窗口评估（P1）。旧评估只看“棋子数 + 前两名候选威胁”，
   * 全盘的活三/冲四/双三这些形状没有进分。这里把 4 方向的 5 格窗口扫一遍：
   *   - 窗口里只有自己（或只有对方）的子 + 空位时，按子数加权；
   *   - 4 子 1 空 = 成五点，用 judge 过滤长连负后单独计数；
   *   - 两端都空的窗口给三/二小幅上浮；
   *   - 保留旧评估的前两名候选项（它算的是“下一手具体值多少”，和全盘形状互补）。
   * 变体上再乘寿命/浮空折扣；F 额外算地基归属。
   */
  const evalBoardNew=(s,p)=>{
    if(s.status==='Decided')return s.winner===p?1e8:s.winner?-1e8:0;
    const foe=opponentOf(p);
    let ownScore=0,foeScore=0;const ownWin=[],foeWin=[];
    // 浮空：没有地基的空格只能落底层（不参与连线）。窗口分和成五点都必须跳过它，
    // 否则会给“根本挡不了/做不成的四”记 4000 分并造出假成五点。
    const playable=k=>!s.variant2.float.on||s.base[k];
    ai2Windows(s,(a,b,c,d,e,before,after)=>{
      const o=ai2ScanWindow(s,a,b,c,d,e);
      if(o.hole||o.g)return;
      const mine=p===1?o.b:o.w,other=p===1?o.w:o.b;
      if(mine&&other)return;
      if(!mine&&!other)return;
      if(mine===4&&!playable(o.e1))return;
      if(mine===3&&!playable(o.e1)&&!playable(o.e2))return;
      if(other===4&&!playable(o.e1))return;
      if(other===3&&!playable(o.e1)&&!playable(o.e2))return;
      const open=(before>=0&&!s.hole[before]&&s.top[before]===0?1:0)+(after>=0&&!s.hole[after]&&s.top[after]===0?1:0);
      if(mine){
        ownScore+=AI2_EVAL_WINDOW[mine]*(1+(mine<4?AI2_EVAL_OPEN*open:0));
        if(mine===4&&o.empties===1)ownWin.push(o.e1);
      }else{
        foeScore+=AI2_EVAL_WINDOW[other]*(1+(other<4?AI2_EVAL_OPEN*open:0));
        if(other===4&&o.empties===1)foeWin.push(o.e1);
      }
    });
    const ownValid=ai2ValidatePoints(s,p,ownWin);
    if(ownValid.length)return 9e7;                 // 轮到我走且已能成五
    const foeValid=ai2ValidatePoints(s,foe,foeWin);
    // 【带机制变体不能把“对方两处成五”当定局】我这一手会先经过 tick（到期子变灰/移除）、
    // floatRepel（地基塌陷把顶子变底层）或交换移洞，可能把其中一个威胁直接改掉。
    // 所以只有三机制全关才返回终局分；否则给很大的有限惩罚，保留搜索推翻的余地。
    const volatile=s.variant2.age.on||s.variant2.float.on||s.variant2.holes.on;
    if(foeValid.length>=2&&!volatile)return -9e7;
    let score=ownScore*ai2LifeFactor(s,p)-AI2_EVAL_FOE*foeScore*ai2LifeFactor(s,foe);
    if(foeValid.length>=2)score-=9e6*foeValid.length;
    const ranked=legal(s).map(a=>({a,v:value(s,a,p),f:value(s,a,foe)}));
    ranked.sort((a,b)=>b.v-a.v);score+=ranked.slice(0,2).reduce((n,a)=>n+a.v,0);
    ranked.sort((a,b)=>b.f-a.f);score-=ranked.slice(0,2).reduce((n,a)=>n+a.f,0)*1.05;
    for(let k=0;k<s.top.length;k++){
      const v=s.top[k];if(v!==1&&v!==2)continue;
      const x=k%s.w,y=Math.floor(k/s.w);let life=1;
      if(s.variant2.age.on)life=Math.min(1,s.remainingOf(x,y)/8);
      if(s.variant2.float.on&&s.base[k]&&s.baseOwner[k]&&s.baseOwner[k]!==v)life*=Math.max(.25,s.floatLifeOf(x,y)/Math.max(1,s.variant2.float.life));
      score+=(v===p?1:-1)*life*(2+1/(1+Math.abs(x-s.w/2)+Math.abs(y-s.h/2)));
    }
    if(s.variant2.float.on){
      for(let k=0;k<s.base.length;k++){
        if(!s.base[k]||!s.baseOwner[k])continue;
        score+=(s.baseOwner[k]===p?1:-1)*3;
        const t=s.top[k];
        if(t===p||t===foe){
          const life=s.floatLifeOf(k%s.w,Math.floor(k/s.w));
          const urgency=1-Math.min(1,life/Math.max(1,s.variant2.float.life));
          score+=(t===p?1:-1)*urgency*12;
        }
      }
    }
    if(foeValid.length===1)score-=5e6;             // 对方有一个成五点：这一手必须堵
    return score;
  };
  // classic 的方向评估 400 局 54.6%（CI 含 50%），保留 VCF + 旧评估。
  // FA 修正版 400 局仅 47.0%，触发停止线，单独退回旧评估；不能外推 F/A 的收益。
  const faOnly=session.variant2.float.on&&session.variant2.age.on&&!session.variant2.holes.on;
  const evalBoard=config.feat&&!ai2VcfSafe(session)&&!faOnly?evalBoardNew:evalBoardOld;
  const candidates=(s,root)=>{
    const all=legal(s),p=s.currentPlayer,foe=opponentOf(p),scored=[],wins=[];
    for(const a of all){const o=outcome(s,a,p);if(o&&o.status===MoveStatus.Win){wins.push(a);continue;}if(o&&o.status===MoveStatus.LoseByOverline)continue;
      const danger=outcome(s,a,foe);a.score=(danger&&danger.status===MoveStatus.Win?5e7:0)+(a.layer==='base'?.08:1)*(value(s,a,p)+value(s,a,foe)*1.1)+2/(1+Math.abs(a.x-s.w/2)+Math.abs(a.y-s.h/2));scored.push(a);}
    if(wins.length)return wins.map(a=>({...a,score:1e9}));scored.sort((a,b)=>b.score-a.score);
    const list=scored.slice(0,config.branch);
    if(s.canSwap&&(root||config.depth>2)){
      const swaps=[];for(const axis of ['row','col']){const n=axis==='row'?s.h:s.w;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(s.canSwapLines(axis,i,j)){
        let score=0;const col=axis==='col';for(let t=0;t<(col?s.h:s.w);t++){const a=col?i+s.w*t:t+s.w*i,b=col?j+s.w*t:t+s.w*j;if(s.hole[a]===s.hole[b])continue;const dest=s.hole[a]?b:a,from=s.hole[a]?a:b;
          if(s.top[dest]===foe)score+=value(s,{x:dest%s.w,y:Math.floor(dest/s.w)},foe);if(s.top[dest]===p)score-=value(s,{x:dest%s.w,y:Math.floor(dest/s.w)},p);
          const old=s.hole[from];s.hole[from]=0;score+=value(s,{x:from%s.w,y:Math.floor(from/s.w)},p)*.5;s.hole[from]=old;
        }swaps.push({kind:'swap',axis,orient:col?1:0,i,j,lineA:i,lineB:j,score});
      }}swaps.sort((a,b)=>b.score-a.score);list.push(...swaps.slice(0,config.swaps));
    }
    return list;
  };
  const apply=(s,a)=>a.kind==='swap'?s.swapLines(a.axis,a.i,a.j):s.place(a.x,a.y,a.layer);
  const search=(s,depth,alpha,beta)=>{
    stats.nodes++;if(s.status==='Decided')return s.winner===s.currentPlayer?1e8:s.winner?-1e8:0;
    if(depth<=0||stats.points>=budget*.6)return evalBoard(s,s.currentPlayer);
    let best=-Infinity;for(const a of candidates(s,false).slice(0,config.branch)){if(stats.points>=budget&&best>-Infinity)break;const copy=s.clone(),mover=s.currentPlayer;apply(copy,a);const v=copy.status==='Decided'?(copy.winner===mover?1e8:copy.winner?-1e8:0):-search(copy,depth-1,-beta,-alpha);best=Math.max(best,v);alpha=Math.max(alpha,v);if(alpha>=beta)break;}return best===-Infinity?0:best;
  };
  const initial=ai2UseScratch(session.clone()),moves=candidates(initial,true);if(!moves.length)return legal(initial)[0]||{kind:'none'};
  if(moves[0].score===1e9)return moves[0];
  // 先算自己的 VCF：有必胜强制链就直接走，不再进启发式搜索。
  // 对方有强制链时，把“走完之后对方仍有 VCF”的候选剔掉；剔完一个不剩就保留原表
  //（那说明已经防不住，交给搜索去选最能拖的一手）。
  let ordered=moves;
  if(config.vcf&&ai2VcfSafe(initial)){
    const v=ai2Vcf(initial,me,config,stats);
    if(v)return {kind:'place',x:v.x,y:v.y,layer:'top'};
    const foe=opponentOf(me);
    if(ai2HasFourPotential(initial,foe)){
      const safe=[];let checked=0;
      for(const a of moves){
        if(a.kind!=='place'){safe.push(a);continue;}
        if(checked>=8)continue;
        checked++;
        const copy=initial.clone();apply(copy,a);
        if(copy.status!=='Playing'){safe.push(a);continue;}
        const fv=ai2VcfAttack(copy,foe,config.vcfDefDepth||6,{nodes:0,limit:config.vcfDefBudget||10000},stats);
        if(!fv)safe.push(a);
      }
      const safePlaces=safe.filter(a=>a.kind==='place');
      if(safePlaces.length)ordered=moves.filter(a=>a.kind!=='place'||safe.includes(a));
    }
  }
  // 根节点兜底：apply 之后已经轮到对手，evalBoard 的 p 必须是“轮到谁”。
  // 直接用 evalBoard(copy,me) 会把“我刚做成的四”当成“我马上能走成五”——语义反了。
  const evalRoot=(s)=>s.currentPlayer===me?evalBoard(s,me):-evalBoard(s,s.currentPlayer);
  let best=null,bestValue=-Infinity;
  for(const a of ordered){const copy=initial.clone();apply(copy,a);let score;
    if(copy.status==='Decided')score=copy.winner===me?1e8:copy.winner?-1e8:0;
    else {
      const enemyWins=legal(copy).some(b=>{const o=outcome(copy,b,copy.currentPlayer);return o&&o.status===MoveStatus.Win;});
      score=enemyWins?-9e7:(stats.points<budget?-search(copy,config.depth-1,-Infinity,Infinity):evalRoot(copy));
    }
    score+=opts.level==='low'?random()*5:0;if(score>bestValue){bestValue=score;best=a;}
  }
  stats.aiPointsUsed=stats.points;return best||moves[0];
}
/* GOMOKU-2D-CORE-END */
