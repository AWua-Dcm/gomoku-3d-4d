// 局部模式码本：中心固定为己方，周围10格按空/己/阻挡编码，最多3^10=59049项。
// 边界、异相位子、敌子在原分类器中均阻挡窗口，因此统一为阻挡；不改变六项计数。
const AI_LINE_BOOK = new Uint8Array(59049);
function aiLineBookClassify(strip){
  let neg=0,pos=0;
  while(4-neg>=0&&strip[4-neg]===S_MINE)neg++;
  while(6+pos<11&&strip[6+pos]===S_MINE)pos++;
  const run=1+neg+pos;if(run>5)return 32;
  const openA=4-neg>=0&&strip[4-neg]===S_EMPTY,openB=6+pos<11&&strip[6+pos]===S_EMPTY;
  let need=5;
  for(let s=-4;s<=0&&need>0;s++){
    let ok=true,mine=0;const base=5+s;
    for(let k=0;k<5;k++){const j=base+k;if(j===5)continue;const v=strip[j];
      if(v===S_EMPTY)continue;if(v===S_MINE){mine++;continue;}ok=false;break;}
    if(ok){const gap=5-(mine+1);if(gap<need)need=gap;}
  }
  if(need===0)return 1;
  if(need===1)return 2+(run===4&&openA&&openB?4:0);
  if(need===2)return 8;if(need===3)return 16;return 0;
}
