// 只缓存几何，不缓存棋子/颜色/相位。单份Int16表上限4096*13*10*2字节。
// ACTIVE仅在一次ultra调用内有效，finally恢复；大盘、小轴、非5连继续走条带分支。
let AI_RAY_CACHE=null, AI_RAY_ACTIVE=null;
function aiRayTable(board){
  const nx=board.nx,ny=board.ny,nz=board.nz;
  if(Math.min(nx,ny,nz)<6||board.cellCount>4096)return null;
  const key=[nx,ny,nz,board.wrap?1:0,...DIRS13.map(d=>d.join(','))].join(':');
  if(AI_RAY_CACHE&&AI_RAY_CACHE.key===key)return AI_RAY_CACHE.table;
  const table=new Int16Array(board.cellCount*DIRS13.length*10);let at=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)for(const d of DIRS13){
    for(let k=-5;k<=5;k++){
      if(k===0)continue;
      let px=x+k*d[0],py=y+k*d[1],pz=z+k*d[2];
      if(board.wrap){
        if(px<0)px+=nx;else if(px>=nx)px-=nx;
        if(py<0)py+=ny;else if(py>=ny)py-=ny;
        if(pz<0)pz+=nz;else if(pz>=nz)pz-=nz;
      }
      table[at++]=px<0||px>=nx||py<0||py>=ny||pz<0||pz>=nz?-1:px+nx*(py+ny*pz);
    }
  }
  AI_RAY_CACHE={key,table};return table;
}
function aiRayBookMiss(key){
  let value=key;AI_STRIP[5]=S_MINE;
  for(let k=10;k>=0;k--){if(k===5)continue;AI_STRIP[k]=value%3;value=Math.floor(value/3);}
  const packed=aiLineBookClassify(AI_STRIP)+1;AI_LINE_BOOK[key]=packed;return packed;
}
function aiThreatAt(board,x,y,z,player,winLength,restricted){
  if(winLength!==5)return aiThreatAtSlow(board,x,y,z,player,winLength,restricted);
  let wins=0,fours=0,openFours=0,threes=0,twos=0,over=0;
  const nx=board.nx,ny=board.ny,nz=board.nz,sy=nx,sz=nx*ny,cells=board.cells,wrap=board.wrap;
  const active=AI_RAY_ACTIVE,table=active&&active.board===board&&active.wrap===wrap&&active.directions===DIRS13.length?active.table:null;
  const row=(x+sy*y+sz*z)*DIRS13.length*10;
  for(let i=0;i<DIRS13.length;i++){
    let key=0;
    if(table){
      const base=row+i*10;
      for(let k=0;k<10;k++){const at=table[base+k],c=at<0?-1:cells[at];key=key*3+(c===EMPTY?S_EMPTY:c===player?S_MINE:S_OTHER);}
    }else{
      const d=DIRS13[i],dx=d[0],dy=d[1],dz=d[2];let px=x-5*dx,py=y-5*dy,pz=z-5*dz;
      for(let k=0;k<11;k++){
        // 保留旧分支逐格纠偏顺序，尤其不能把小轴环绕擅自换成全取模。
        if(wrap){
          if(px<0)px+=nx;else if(px>=nx)px-=nx;
          if(py<0)py+=ny;else if(py>=ny)py-=ny;
          if(pz<0)pz+=nz;else if(pz>=nz)pz-=nz;
        }
        if(k!==5){
          let v=S_OTHER;
          if(wrap||(px>=0&&px<nx&&py>=0&&py<ny&&pz>=0&&pz<nz)){
            const c=cells[px+sy*py+sz*pz];v=c===EMPTY?S_EMPTY:c===player?S_MINE:S_OTHER;
          }
          key=key*3+v;
        }
        px+=dx;py+=dy;pz+=dz;
      }
    }
    let packed=AI_LINE_BOOK[key];if(packed===0)packed=aiRayBookMiss(key);packed--;
    wins+=packed&1;fours+=(packed>>>1)&1;openFours+=(packed>>>2)&1;
    threes+=(packed>>>3)&1;twos+=(packed>>>4)&1;over+=(packed>>>5)&1;
  }
  return {wins,fours,openFours,threes,twos,over};
}

