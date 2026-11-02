// 防守覆盖残余谱（CRS）：静态特征，不是必胜证书，不扩展递归搜索。
// 最强四点建立“防点 -> 方向分类变化”的稀疏图；第五点作为未展开尾部的上界底板。
const AI_COVER_POW = [19683,6561,2187,729,243,0,81,27,9,3,1];
const AI_COVER_FIELDS = ['wins','fours','openFours','threes','twos','over'];
function aiCoverPacked(key) {
  let packed=AI_LINE_BOOK[key];
  if(!packed){
    let value=key;const strip=new Uint8Array(11);strip[5]=S_MINE;
    for(let k=10;k>=0;k--){if(k===5)continue;strip[k]=value%3;value=Math.floor(value/3);}
    packed=aiLineBookClassify(strip)+1;AI_LINE_BOOK[key]=packed;
  }
  return packed-1;
}
function aiCoverSpend(ctx,n) {
  if(aiPointsUsed+n>AI_POINT_BUDGET_MAX){if(ctx.stats)ctx.stats.coverUnknown++;return false;}
  aiPointsUsed+=n;if(ctx.stats)ctx.stats.coverPoints+=n;return true;
}
function aiCoverLegal(ctx,index,defender) {
  const s=ctx.session,b=s.board,x=index%b.nx,y=Math.floor(index/b.nx)%b.ny,z=Math.floor(index/(b.nx*b.ny));
  if(b.cells[index]!==EMPTY)return false;
  if(!s.rules.isRestricted(defender,s.firstPlayer))return true;
  const before=b.cells[index],tag=cellOf(defender,aiPhase);
  b.set(x,y,z,tag);
  try{
    if(ctx.stats)ctx.stats.judgeCalls++;
    return RuleEngine.judge(b,{x,y,z},defender,s.firstPlayer,s.rules,tag).status!==MoveStatus.LoseByOverline;
  }finally{b.set(x,y,z,before);}
}
function aiCoverProfile(board,cands,player,winLength,restricted,ctx) {
  const top=[],tag=aiTag(player);
  for(let i=0;i<cands.length;i+=3){
    const x=cands[i],y=cands[i+1],z=cands[i+2],t=aiThreatAt(board,x,y,z,tag,winLength,restricted);
    const v=aiThreatValue(t,restricted);if(v<=0)continue;
    let at=top.length;while(at>0&&v>top[at-1].v)at--;
    if(at<5){top.splice(at,0,{x,y,z,t,v,index:board.index(x,y,z)});if(top.length>5)top.pop();}
  }
  const best=top[0]?.v||0,second=top[1]?.v||0,baseline=best+AI_EVAL_TOP2*second;
  const result={value:baseline,baseline,best,second,residual:second,tail:top[4]?.v||0,blocks:0,critical:-1,top:top.slice(0,4)};
  if(!second||best>=AI_W.WIN||winLength!==5)return result;
  const k=Math.min(4,top.length),graph=new Map();
  const node=index=>{let n=graph.get(index);if(!n){n={index,kill:0,delta:new Int8Array(k*6)};graph.set(index,n);}return n;};
  for(let i=0;i<k;i++){
    const a=top[i];node(a.index).kill|=1<<i;
    for(const direction of DIRS13){
      if(!aiCoverSpend(ctx,3))return result;
      let key=0;const ids=[],deltas=[];
      for(let j=0;j<11;j++){
        if(j===5)continue;
        let x=a.x+(j-5)*direction[0],y=a.y+(j-5)*direction[1],z=a.z+(j-5)*direction[2];
        if(board.wrap){x=(x%board.nx+board.nx)%board.nx;y=(y%board.ny+board.ny)%board.ny;z=(z%board.nz+board.nz)%board.nz;}
        let v=S_OTHER,index=-1;
        if(board.inBounds(x,y,z)){index=board.index(x,y,z);const cell=board.cells[index];v=cell===EMPTY?S_EMPTY:cell===tag?S_MINE:S_OTHER;}
        key=key*3+v;
        if(v===S_EMPTY){let at=ids.indexOf(index);if(at<0){at=ids.length;ids.push(index);deltas.push(0);}deltas[at]+=2*AI_COVER_POW[j];}
      }
      const old=aiCoverPacked(key);if(!old)continue;
      for(let j=0;j<ids.length;j++){
        const after=aiCoverPacked(key+deltas[j]);if(after===old)continue;
        const delta=node(ids[j]).delta,offset=i*6;
        for(let f=0;f<6;f++)delta[offset+f]+=((after>>>f)&1)-((old>>>f)&1);
      }
    }
  }
  const q={wins:0,fours:0,openFours:0,threes:0,twos:0,over:0};
  let residual=best,critical=-1;
  for(const n of graph.values()){
    if(!aiCoverSpend(ctx,3))return result;
    let remaining=result.tail;
    for(let i=0;i<k;i++){
      if(n.kill&(1<<i))continue;
      for(let f=0;f<6;f++)q[AI_COVER_FIELDS[f]]=top[i].t[AI_COVER_FIELDS[f]]+n.delta[i*6+f];
      remaining=Math.max(remaining,aiThreatValue(q,restricted));
    }
    if(remaining<residual&&aiCoverLegal(ctx,n.index,opponentOf(player))){residual=remaining;critical=n.index;}
  }
  result.residual=residual;result.critical=critical;result.blocks=graph.size;
  result.value=best+AI_EVAL_TOP2*residual;
  if(ctx.stats&&result.value!==baseline)ctx.stats.coverCorrections++;
  return result;
}
function aiEvalLeafCover(board,cands,mover,foe,winLength,moverRes,foeRes,ctx) {
  if(ctx.stats)ctx.stats.coverLeaves++;
  return aiCoverProfile(board,cands,mover,winLength,moverRes,ctx).value-
    AI_EVAL_W*aiCoverProfile(board,cands,foe,winLength,foeRes,ctx).value;
}

