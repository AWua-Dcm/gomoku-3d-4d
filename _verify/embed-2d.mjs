import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(here,'../Web_Gomoku3D/index.html');
let html=fs.readFileSync(file,'utf8');
const read=name=>fs.readFileSync(path.join(here,name),'utf8').replace(/\r\n/g,'\n');
function block(begin,end,body,before){
  const a=html.indexOf(begin),b=html.indexOf(end),text=begin+'\n'+body+'\n'+end;
  if(a>=0&&b>a)html=html.slice(0,a)+text+html.slice(b+end.length);
  else {const at=html.indexOf(before);if(at<0)throw Error('Missing insertion: '+before);html=html.slice(0,at)+text+'\n'+html.slice(at);}
}
block('/* GOMOKU-2D-EMBED-CORE-BEGIN */','/* GOMOKU-2D-EMBED-CORE-END */',read('two-d-core.part.js'),'/* GOMOKU-CORE-END */');
const css=read('two-d-integration.part.css')+(fs.existsSync(path.join(here,'two-d-ui.part.css'))?'\n'+read('two-d-ui.part.css'):'');
block('/* GOMOKU-2D-CSS-BEGIN */','/* GOMOKU-2D-CSS-END */',css,'</style>');
block('<!-- GOMOKU-2D-DIALOGS-BEGIN -->','<!-- GOMOKU-2D-DIALOGS-END -->',read('two-d-integration.part.html'),'<script>\n"use strict";');
const js=(fs.existsSync(path.join(here,'two-d-ui.part.js'))?read('two-d-ui.part.js')+'\n':'')+read('two-d-integration.part.js');
block('/* GOMOKU-2D-INTEGRATION-BEGIN */','/* GOMOKU-2D-INTEGRATION-END */',js,'const GameExport =');
fs.writeFileSync(file,html,'utf8');
console.log('Embedded 2D core, interface, offline interface and dialogs.');
