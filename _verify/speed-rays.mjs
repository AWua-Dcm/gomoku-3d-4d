import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildSpeed(source,rays=true){
  const eol=source.includes('\r\n')?'\r\n':'\n';let html=source.replace(/\r\n/g,'\n');
  const start=html.indexOf('function aiThreatAt(board, x, y, z, player, winLength, restricted) {'),end=html.indexOf('\n/**',start);
  if(start<0||end<0)throw new Error('威胁函数边界缺失');
  let original=html.slice(start,end);
  const guard='  if (winLength !== 5) return aiThreatAtSlow(board, x, y, z, player, winLength, restricted);';
  if(original.split(guard).length!==2)throw new Error('原回退守卫不唯一');
  original=original.replace(guard,guard+'\n  const ray=AI_RAY_ACTIVE;\n'+
    '  if(ray&&ray.board===board&&ray.wrap===board.wrap&&ray.directions===DIRS13.length&&ray.table)\n'+
    '    return aiThreatAtRays(board,x,y,z,player,ray.table);');
  const part=fs.readFileSync(new URL(rays?'./speed-rays.part.js':'./speed-stream-prototype.part.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  html=html.slice(0,start)+(rays?original+'\n':'')+part+html.slice(end);
  if(rays){
    const from='  const r = aiChooseMoveInner(session, opts);\n  // 计数器统一在这里落进 stats —— 函数体里返回点有十几处，逐个写迟早漏掉一处\n  if (stats) stats.points = aiPointsUsed;\n  return r;';
    if(html.split(from).length!==2)throw new Error('AI上下文锚点不唯一');
    html=html.replace(from,'  const rayBefore=AI_RAY_ACTIVE;\n'+
      '  AI_RAY_ACTIVE=o.level===\'ultra\'?{board,wrap:board.wrap,directions:DIRS13.length,table:aiRayTable(board)}:null;\n'+
      '  try {\n    const r=aiChooseMoveInner(session,opts);\n    if(stats)stats.points=aiPointsUsed;\n    return r;\n'+
      '  } finally { AI_RAY_ACTIVE=rayBefore; }');
  }
  return html.replace(/\n/g,eol);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const at=process.argv.indexOf('--baseline'),source=fs.readFileSync(path.resolve(root,at<0?'Web_Gomoku3D/index.html':process.argv[at+1]),'utf8');
  if(sha(source)!=='44872e86ddbc15b09d46e6565d3613909e7e6747ee51b7950ac065c62c3fbcb0')throw new Error('提速基线变化');
  const baseline='_verify/fixtures/speed-baseline-44872e86ddbc.html';
  for(const rays of [false,true]){
    const candidate=buildSpeed(source,rays),file='_verify/results/speed-ai/'+(rays?'rays-':'stream-')+sha(candidate).slice(0,12)+'.html';
    for(const [f,data] of [[baseline,source],[file,candidate]]){
      fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});
      if(fs.existsSync(path.join(root,f))&&fs.readFileSync(path.join(root,f),'utf8')!==data)throw new Error('冻结文件冲突');
      fs.writeFileSync(path.join(root,f),data);
    }
    const meta={baseline,baselineSha:sha(source),candidate:file,candidateSha:sha(candidate),rays,method:'lossless-ray-indices-and-book-hit',gates:{games:40,seed:1440001,p95Limits:{'3d':720,'4d':870},p99Factor:1.1}};
    fs.writeFileSync(path.join(root,'_verify/results/speed-ai/'+(rays?'rays-meta':'stream-meta')+'.json'),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
  }
}
