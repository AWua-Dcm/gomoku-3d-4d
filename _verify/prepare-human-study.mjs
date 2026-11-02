// 生成盲测材料，不生成任何玩家结果，不向外发送数据。
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'_verify/results/human/blind-study-20261101');fs.mkdirSync(out,{recursive:true});
const responses=path.join(out,'responses.jsonl');if(fs.existsSync(responses)&&fs.readFileSync(responses,'utf8').trim())throw new Error('已有真实记录，不得改写盲测条件；请另建版本');
const e1=JSON.parse(fs.readFileSync(path.join(root,'_verify/results/ai-eval/e1-meta.json')));
const arg=k=>{const i=process.argv.indexOf('--'+k);return i<0?null:process.argv[i+1];};
const accepted2D=arg('accepted-2d'),accepted3D=arg('accepted-3d'),accepted4D=arg('accepted-4d');
const newer={'2d':accepted2D||e1.baseline,'3d':accepted3D||e1.candidate,'4d':accepted4D||e1.candidate};
const old='_verify/fixtures/ultra-baseline-6203b1a0.html',sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
const sessions=[],privateSessions=[];let index=0;
for(const [mode,folder] of [['2d','fair-2d-classic-2000'],['3d','full'],['4d','fair-4d-default-10000']]){
  const dir=path.join(root,'_verify/results/selfplay',folder),recs=[];
  outer:for(const file of fs.readdirSync(dir).filter(f=>/^shard-\d+\.jsonl$/.test(f)).sort())for(const line of fs.readFileSync(path.join(dir,file),'utf8').split('\n')){
    if(!line.trim())continue;const r=JSON.parse(line);
    if(r.mode!==mode||r.invalid||!r.aIsBlack||!r.opening?.length)continue;
    if(recs.some(v=>v.pairId===r.pairId))continue;
    recs.push(r);if(recs.length===2)break outer;
  }
  if(recs.length!==2)throw new Error('缺少盲测开局：'+mode);
  for(let opening=0;opening<2;opening++)for(const playerColor of [1,2]){
    const reversed=(opening+playerColor)%2===0;
    for(let trial=0;trial<2;trial++){
      const id='S'+String(++index).padStart(3,'0'),isNew=(trial===0)!==reversed,r=recs[opening];
      sessions.push({id,block:mode+'-'+opening+'-'+playerColor,mode,size:r.size,rules:r.rules,opening:r.opening,playerColor,level:'ultra',trial:trial+1});
      const engine=isNew?newer[mode]:old;
      privateSessions.push({id,engine,sha256:sha(engine),condition:isNew?'new':'old',
        eligible:mode==='2d'||(mode==='3d'&&accepted3D)||(mode==='4d'&&accepted4D)?'accepted':'hold until acceptance'});
    }
  }
}
fs.writeFileSync(path.join(out,'participant-sessions.json'),JSON.stringify({note:'仅向参与者提供本文件；每一 block 两局，玩家颜色和开局相同，条件顺序交替平衡',sessions},null,2)+'\n');
fs.writeFileSync(path.join(out,'administrator-private.json'),JSON.stringify({note:'管理员私有；不可在完成评分前向参与者展示引擎路径/条件',sessions:privateSessions},null,2)+'\n');
const schema={type:'object',additionalProperties:false,required:['participant','sessionId','result','difficulty','lossType'],properties:{
  participant:{type:'string',minLength:1},sessionId:{enum:sessions.map(s=>s.id)},result:{enum:['human-win','ai-win','draw','aborted']},
  difficulty:{type:'integer',minimum:1,maximum:5},lossType:{enum:['calculated-kill','double-threat','comeback','other','not-applicable']},
  notes:{type:'string'},recordFile:{type:'string'}}};
fs.writeFileSync(path.join(out,'result.schema.json'),JSON.stringify(schema,null,2)+'\n');
const protocol=`# ultra 人工盲测包\n\n状态：材料已准备，真实玩家数据 0 条。\n\n每个模式两套开局，每套开局旧/新各执黑白，共 24 局。可按 block 分配给不同参与者；同一 block 必须由同一人完成两局。新旧引擎身份只给管理员看，不向参与者展示路径、版本名或条件。不要把自对弈结果写成人工结果。\n\n## 管理员操作\n\n1. 核对 administrator-private.json 的文件 SHA；加载对应冻结引擎，设置同一 ultra 档、尺寸、规则和 participant-sessions.json 的开局。不要用会继续变化的源码替代已锁定版本。\n2. 只开展 administrator-private.json 标记 eligible=accepted 的 block；hold 条件先封存。若候选回退，重新准备使用实际获准候选的材料，不能把回退候选当发行成果。\n3. 玩家按 trial 顺序对局，完成每局后立刻填写难度 1–5 分和输棋类型；完成同一 block 后再问“哪一局更难”。不提示新旧，不中途调参。\n4. 将每条真实结果写成一行 JSON，保存到本目录 responses.jsonl，字段遵循 result.schema.json；棋谱独立存储，用 recordFile 引用。参与者只用匿名编号。\n5. 只比较完成的配对 block，按模式和玩家颜色分别汇总；中断/缺失记录单列，不填补，不与自对弈混用。保留原始棋谱。有真实结果后不得改写本包条件；更换引擎应另建版本。\n\n## 参与者说明\n\n请按管理员提供的开局与颜色进行对局，每局独立评分：1 很容易、2 较容易、3 适中、4 较难、5 很难。输棋类型可选被连续算杀、被双威胁、优势被翻盘、其他；未输填不适用。不需要知道引擎版本。\n\n## 当前结果\n\n没有真实玩家记录，因此尚无“对人更强”的结论。此包只交付采集方法与配置，不是人工盲测完成报告。\n`;
fs.writeFileSync(path.join(out,'protocol.md'),protocol.replace('## 管理员操作\n\n','## 管理员操作\n\n所有引擎路径均相对于开源工程根目录，不是本包目录。new/old只是版本标签；accepted表示允许开展采集，不预设新版更强。仅有等价提速的模式也须如实记录，不能据此宣称棋力增长。\n\n'));
console.log('盲测包已准备：'+out+'；24 个 session，真实结果 0 条');
