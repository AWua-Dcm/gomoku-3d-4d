import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {sha} from './p2-e1.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildScratchPart(part){
 const eol=part.includes('\r\n')?'\r\n':'\n';let text=part.replace(/\r\n/g,'\n');
 const from='function ai2ChooseMove(session,opts={}){';if(text.split(from).length!==2)throw new Error('2D入口不唯一');
 text=text.replace(from,fs.readFileSync(new URL('./two-d-scratch.part.js',import.meta.url),'utf8').replace(/\r\n/g,'\n')+from);
 const begin='const initial=session.clone(),moves=candidates(initial,true);';if(text.split(begin).length!==2)throw new Error('2D根克隆不唯一');
 text=text.replace(begin,'const initial=ai2UseScratch(session.clone()),moves=candidates(initial,true);');
 return text.replace(/\n/g,eol);
}
export function embedPart(html,part){
 const begin='/* GOMOKU-2D-EMBED-CORE-BEGIN */',end='/* GOMOKU-2D-EMBED-CORE-END */',a=html.indexOf(begin),b=html.indexOf(end);
 if(a<0||b<a)throw new Error('2D嵌入边界缺失');return html.slice(0,a)+begin+'\n'+part.replace(/\r\n/g,'\n')+'\n'+end+html.slice(b+end.length);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const baseline='_verify/fixtures/two-d-speed-baseline-84175210ebb2.html',partBaseline='_verify/fixtures/two-d-speed-baseline-core.part.js';
 const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
 const html=fs.readFileSync(path.resolve(root,arg('--baseline','Web_Gomoku3D/index.html')),'utf8'),part=fs.readFileSync(path.resolve(root,arg('--part','_verify/two-d-core.part.js')),'utf8');
 if(sha(html)!=='84175210ebb2bec3cc6d2ffc138cce63f1e40c30a76d14de166c44f41420653c'||sha(part)!=='ef7afece198d191463d9e680e6856f8338aa1270a38e6391309ffe7a0ee8aa03')throw new Error('二维提速基线变化');
 const nextPart=buildScratchPart(part),next=embedPart(html,nextPart),file='_verify/results/two-d-speed/scratch-'+sha(next).slice(0,12)+'.html';
 const partCandidate='_verify/results/two-d-speed/scratch-core-'+sha(nextPart).slice(0,12)+'.part.js';
 for(const [p,data]of[[baseline,html],[partBaseline,part],[file,next],[partCandidate,nextPart]]){
  fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});if(fs.existsSync(path.join(root,p))&&fs.readFileSync(path.join(root,p),'utf8')!==data)throw new Error('冻结冲突');fs.writeFileSync(path.join(root,p),data);
 }
 const meta={baseline,baselineSha:sha(html),partBaseline,partBaselineSha:sha(part),candidate:file,candidateSha:sha(next),partCandidate,partSha:sha(nextPart),method:'AI-only-scratch-copy-no-undo',gates:{games:40,seed:1760001,p95Factor:1,p99Factor:1.1}};
 fs.writeFileSync(path.join(root,'_verify/results/two-d-speed/meta.json'),JSON.stringify(meta,null,2)+'\n');console.log(JSON.stringify(meta));
}
