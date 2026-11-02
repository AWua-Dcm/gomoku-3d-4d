// E1 的等价实现：热循环使用数值局部变量，避免每点读写聚合对象/数组。
function aiAggregateThreat(board,cands,player,winLength,restricted){
  let wins=0,fours=0,openFours=0,threes=0,twos=0,over=0,doubleThree=0,fourThree=0,doubleFour=0,legal=0;
  let a=0,b=0,c=0,d=0;const tag=aiTag(player);
  for(let i=0;i<cands.length;i+=3){
    const t=aiThreatAt(board,cands[i],cands[i+1],cands[i+2],tag,winLength,restricted);
    over+=t.over;if(restricted&&t.over)continue;legal++;
    wins+=t.wins+(!restricted&&t.over?1:0);fours+=t.fours;openFours+=t.openFours;threes+=t.threes;twos+=t.twos;
    if(t.threes>=2)doubleThree++;if(t.fours&&t.threes)fourThree++;if(t.fours>=2)doubleFour++;
    const v=aiThreatValue(t,restricted);
    if(v>a){d=c;c=b;b=a;a=v;}else if(v>b){d=c;c=b;b=v;}else if(v>c){d=c;c=v;}else if(v>d)d=v;
  }
  return {wins,fours,openFours,threes,twos,over,doubleThree,fourThree,doubleFour,legal,candidates:cands.length/3,top:[a,b,c,d]};
}
function aiAggregateValue(f){
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
