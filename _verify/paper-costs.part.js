// 威胁的防点依赖：仅常规搜索、ultra默认4D、相位安全窗口内修正共享/非法成五点的高估。
// 这是局部估值信息，不作为终局或严格必胜证明；规则结论始终走RuleEngine.judge。
const AI_COST_META=Symbol('independent-four-cost');
let AI_COST_CONTEXT=null;
function aiCostAdjusted(t,restricted){
  const m=t[AI_COST_META];
  if(!m||m.restricted!==restricted)return t;
  return {wins:t.wins,fours:m.fours,openFours:0,threes:t.threes,twos:t.twos,over:t.over};
}
function aiCostContext(session,params,stats,moverOverride){
  const b=session.board,maxDepth=Math.max(params.searchDepth||0,params.depth4d||0,params.idMax||0);
  return params===AI_PARAMS.ultra&&!moverOverride&&session.rotationEnabled&&b.wrap&&b.isCube&&
    b.nx>=8&&b.nx<=9&&session.rules.winLength===5&&session.rules.phasePeriod===12&&
    aiPhase===session.phase&&session.handsUntilFlip>=maxDepth+3?{session,stats}:null;
}
function aiCostJudge(board,p,side,ctx){
  if(aiPointsUsed+3>AI_POINT_BUDGET_MAX){if(ctx.stats)ctx.stats.costUnknown=(ctx.stats.costUnknown||0)+1;return null;}
  aiPointsUsed+=3;
  if(ctx.stats){ctx.stats.costChecks=(ctx.stats.costChecks||0)+1;ctx.stats.judgeCalls=(ctx.stats.judgeCalls||0)+1;}
  const before=board.get(p[0],p[1],p[2]),tag=cellOf(side,aiPhase);
  board.set(p[0],p[1],p[2],tag);
  try{return RuleEngine.judge(board,{x:p[0],y:p[1],z:p[2]},side,ctx.session.firstPlayer,ctx.session.rules,tag);}
  finally{board.set(p[0],p[1],p[2],before);}
}
function aiAttachCostMeta(board,x,y,z,tag,winLength,restricted,t){
  const ctx=AI_COST_CONTEXT;
  if(!ctx||board!==ctx.session.board||winLength!==5||!board.inBounds(x,y,z)||board.get(x,y,z)!==EMPTY||
    t.wins||t.over||(!t.openFours&&t.fours<2))return;
  const side=colourOf(tag),fp=ctx.session.firstPlayer,rules=ctx.session.rules;
  if(tag!==cellOf(side,aiPhase)||restricted!==rules.isRestricted(side,fp))return;
  // 在任何嵌套规则探针之前取完快照；后续调用不得依赖共享方向缓冲。
  const seen=new Set(),points=[];
  for(let i=0;i<DIRS13.length;i++){
    const mask=AI_LAST_COST_MASKS[i];if(!mask)continue;const d=DIRS13[i];
    for(let bit=0;bit<9;bit++)if(mask&(1<<bit)){
      const off=bit-4,px=(x+off*d[0]+board.nx)%board.nx,py=(y+off*d[1]+board.ny)%board.ny,pz=(z+off*d[2]+board.nz)%board.nz;
      const k=board.index(px,py,pz);if(!seen.has(k)&&board.get(px,py,pz)===EMPTY&&!(px===x&&py===y&&pz===z)){seen.add(k);points.push([px,py,pz]);}
    }
  }
  board.set(x,y,z,tag);
  try{
    let legal=0,sole=null;
    for(const p of points){const r=aiCostJudge(board,p,side,ctx);if(!r)return;
      if(r.status===MoveStatus.Win){legal++;sole=p;if(legal>=2)return;}}
    if(legal===1&&rules.isRestricted(opponentOf(side),fp)){
      const block=aiCostJudge(board,sole,opponentOf(side),ctx);if(!block||block.status===MoveStatus.LoseByOverline)return;
    }
    Object.defineProperty(t,AI_COST_META,{value:{fours:legal,restricted}});
    if(ctx.stats)ctx.stats.costCorrections=(ctx.stats.costCorrections||0)+1;
  }finally{board.set(x,y,z,EMPTY);}
}
function aiSearchMove(session,safe,params,stats,moverOverride){
  const previous=AI_COST_CONTEXT;AI_COST_CONTEXT=aiCostContext(session,params,stats,moverOverride);
  try{return aiSearchMoveCore(session,safe,params,stats,moverOverride);}
  finally{AI_COST_CONTEXT=previous;}
}
