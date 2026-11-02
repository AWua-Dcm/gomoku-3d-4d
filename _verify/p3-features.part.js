// P3 实验：根节点预计算真实跨面窗口和下一相位窗口；叶子只看模拟落子的增量。
// 不生成转动搜索节点，不改变任何候选、排序、预算或终局判定。
function aiP3Context(session){
  const b=session.board,n=b.nx;
  if(!session.rotationEnabled||!b.wrap||!(session.rules.phasePeriod>0)||!b.isCube||n<5||b.cells.length>4096)return null;
  const size=b.cells.length,wrap=[null,new Float64Array(size),new Float64Array(size)],
    reserve=[null,new Float64Array(size),new Float64Array(size)],phase=session.phase|0;
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++)for(const dir of DIRS13){
    const indices=[],empty=[];let px=x,py=y,pz=z,cross=false;
    for(let j=0;j<5;j++){
      const k=b.index(px,py,pz);indices.push(k);if(b.cells[k]===EMPTY)empty.push(k);
      const nx=px+dir[0],ny=py+dir[1],nz=pz+dir[2];
      if(j<4&&(nx<0||ny<0||nz<0||nx>=n||ny>=n||nz>=n))cross=true;
      px=(nx+n)%n;py=(ny+n)%n;pz=(nz+n)%n;
    }
    if(!empty.length)continue;
    for(const player of [1,2])for(const next of [false,true]){
      if(!next&&!cross)continue;
      const tag=cellOf(player,next?phase^1:phase);let mine=0,blocked=false;
      for(const k of indices){const v=b.cells[k];if(v===tag)mine++;else if(v!==EMPTY){blocked=true;break;}}
      if(blocked||mine<2)continue;
      const value=mine>=3?AI_W.THREE:AI_W.TWO,target=next?reserve[player]:wrap[player];
      for(const k of empty)if(value>target[k])target[k]=value;
    }
  }
  return {base:b.cells.slice(),wrap,reserve,until:session.handsUntilFlip,cooldown:session.placementsUntilRotation};
}
function aiP3Value(board,mover,foe,context){
  if(!context)return 0;
  let topology=0,future=0,added=0;const own=aiTag(mover),other=aiTag(foe);
  for(let k=0;k<board.cells.length;k++){
    const v=board.cells[k];if(context.base[k]!==EMPTY||v===EMPTY)continue;added++;
    if(v===own)topology+=context.wrap[mover][k];else if(v===other)topology-=AI_EVAL_W*context.wrap[foe][k];
    // 当前相位新落的任意颜色都是下相位窗口的障碍：封掉对手储备加分，封掉自己储备扣分。
    future+=context.reserve[foe][k]-context.reserve[mover][k];
  }
  const soon=Math.max(0,Math.min(1,(6-context.until+added)/6));
  const stable=.5+.5*Math.max(0,Math.min(1,(context.cooldown-added)/5));
  return .1*stable*topology+.1*soon*future;
}
