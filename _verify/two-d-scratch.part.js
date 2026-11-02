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

