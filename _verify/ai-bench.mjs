import fs from "node:fs";
const html = fs.readFileSync("Web_Gomoku3D/index.html", "utf8");
const s = html.indexOf("<script>"), e = html.lastIndexOf("</script>");
const full = html.slice(s + 8, e);
const B = "/* GOMOKU-CORE-BEGIN */", E = "/* GOMOKU-CORE-END */";
const core = full.slice(full.indexOf(B) + B.length, full.indexOf(E));
const C = new Function(core + `return {FourDSession,RuleSet,RotationMove,MoveStatus,EMPTY,BLACK,WHITE,aiChooseMove,aiRng};`)();
function mk(n, fourD, cd) { const r = new C.RuleSet(); r.allowRotation = !!fourD;
  if (cd !== undefined) r.rotationCooldownPlacements = cd; return C.FourDSession.create(n, C.BLACK, r); }
for (const [n, fourD, cd, tag] of [[15,false,0,"三维 15³"],[30,false,0,"三维 30³"],[8,true,3,"四维 8³"]]) {
  for (const lv of ["low","medium","high","xhigh","ultra"]) {
    const t=[]; let rot=0;
    for (let g=0; g<3; g++) {
      const s2 = mk(n, fourD, cd); const rng = C.aiRng(700+g); let plies=0;
      while (s2.status==="Playing" && plies<120) {
        const t0 = Date.now();
        const a = C.aiChooseMove(s2, { level: lv, seed: (rng()*4294967296)>>>0 });
        t.push(Date.now()-t0);
        if (a.kind==="none") break;
        const r = a.kind==="place" ? s2.place(a.x,a.y,a.z)
                : s2.rotate(C.RotationMove.fromClockwiseTurns(a.axis,a.layer,a.turns));
        if (a.kind==="rotate") rot++;
        if (!r || r.status===C.MoveStatus.Rejected || (a.kind==="rotate" && !r.accepted)) break;
        plies++;
      }
    }
    t.sort((a,b)=>a-b);
    console.log(tag+" "+lv+"：中位 "+t[t.length>>1]+"ms / 95% "+(t[Math.floor(t.length*0.95)]||0)+
                "ms / 最慢 "+t[t.length-1]+"ms（"+t.length+" 手）");
  }
}
