// P2 E1 实验候选。由 p2-e1.mjs 注入冻结 HTML，不直接进入发行源码。
// threes 是现有窗口分类，不冒充已经验证的“活三”。长连受限点整点剔除。
function aiAggregateThreat(board, cands, player, winLength, restricted) {
  const f = { wins:0, fours:0, openFours:0, threes:0, twos:0, over:0,
    doubleThree:0, fourThree:0, doubleFour:0, legal:0, candidates:cands.length/3,
    top:[0,0,0,0] };
  for(let i=0;i<cands.length;i+=3){
    const t=aiThreatAt(board,cands[i],cands[i+1],cands[i+2],aiTag(player),winLength,restricted);
    f.over+=t.over;
    if(restricted&&t.over)continue;
    f.legal++;
    f.wins+=t.wins+(!restricted&&t.over?1:0);
    f.fours+=t.fours;f.openFours+=t.openFours;f.threes+=t.threes;f.twos+=t.twos;
    if(t.threes>=2)f.doubleThree++;
    if(t.fours&&t.threes)f.fourThree++;
    if(t.fours>=2)f.doubleFour++;
    const v=aiThreatValue(t,restricted);
    for(let j=0;j<4;j++)if(v>f.top[j]){for(let k=3;k>j;k--)f.top[k]=f.top[k-1];f.top[j]=v;break;}
  }
  return f;
}
function aiAggregateValue(f) {
  // 保留已有 top1/top2 梯度，新增分布项按候选数归一到最多 64 点。
  // 中心/奇偶/相位/冷却本轮不赋权，避免混入 P3 或重试已否决的奇偶评估。
  const density=Math.min(1,64/Math.max(1,f.candidates));
  return f.top[0]+AI_EVAL_TOP2*f.top[1]+0.05*(f.top[2]+f.top[3])+density*(
    0.02*AI_W.WIN*f.wins+0.02*AI_W.OPEN_FOUR*f.openFours+
    0.04*AI_W.DOUBLE_FOUR*f.doubleFour+0.04*AI_W.FOUR_THREE*f.fourThree+
    0.05*AI_W.FOUR*f.fours+0.1*AI_W.DOUBLE_THREE*f.doubleThree+
    0.2*AI_W.THREE*f.threes+0.2*AI_W.TWO*f.twos);
}
function aiEvalLeafE1(board,cands,mover,foe,winLength,moverRes,foeRes){
  return aiAggregateValue(aiAggregateThreat(board,cands,mover,winLength,moverRes))-
    AI_EVAL_W*aiAggregateValue(aiAggregateThreat(board,cands,foe,winLength,foeRes));
}
