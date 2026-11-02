export function summarize(msList) {
  const sorted=msList.slice().sort((a,b)=>a-b),n=sorted.length;
  const at=p=>n?sorted[Math.min(n-1,Math.ceil(n*p/100)-1)]:0;
  const round=x=>Math.round(x*1000)/1000;
  return {moves:n,avg:round(n?sorted.reduce((a,b)=>a+b,0)/n:0),
    p50:round(at(50)),p95:round(at(95)),p99:round(at(99)),max:round(n?sorted[n-1]:0)};
}
export function engineTiming(first,second) {
  // 第二半场交换的是引擎身份，不能把 A/B 当新版/旧版。
  return {new:summarize(first.aMsList.concat(second.bMsList)),
    old:summarize(first.bMsList.concat(second.aMsList))};
}
