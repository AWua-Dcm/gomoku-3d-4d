/* KEYMAP-BEGIN */
const Keymap = (() => {
  const defs = [
    ['undo','z','悔棋','Undo'],['restart','r','重开','Restart'],['ghost','g','切换视图','View mode'],
    ['grid','h','格线','Grid'],['filter','b','棋子筛选','Stone filter'],['prev','q','上一层','Previous layer'],
    ['next','e','下一层','Next layer'],['rotate','t','预览转动','Preview rotation'],['cancel','y','取消转动','Cancel rotation'],
    ['left','ArrowLeft','二维光标向左','2D cursor left'],['right','ArrowRight','二维光标向右','2D cursor right'],
    ['up','ArrowUp','二维光标向上','2D cursor up'],['down','ArrowDown','二维光标向下','2D cursor down'],
    ['place','Enter','二维键盘落子','2D place stone'],['zoomIn','+','二维放大','2D zoom in'],
    ['zoomOut','-','二维缩小','2D zoom out'],['reset','0','二维恢复大小','2D reset size']
  ];
  const storage='gomoku.keybindings.v1';let bindings={},draft=null,panel=null,editing=null,rulesScroll=0;
  const label=(d)=>LANG==='zh'?d[2]:d[3];
  const word=(zh,en)=>LANG==='zh'?zh:en;
  function normalize(key){if(key===' ')return 'Space';return key.length===1?key.toLowerCase():key;}
  function valid(key){return /^[a-z0-9+\-\[\];,.\/='`\\]$/.test(key)||['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Space'].includes(key);}
  function defaults(){return Object.fromEntries(defs.map(d=>[d[0],d[1]]));}
  function load(){const out=defaults();try{const saved=JSON.parse(storeGet(storage)||'{}');const candidate=Object.assign({},out);for(const d of defs)if(typeof saved[d[0]]==='string'&&valid(saved[d[0]]))candidate[d[0]]=saved[d[0]];if(new Set(Object.values(candidate)).size===defs.length)return candidate;}catch{}return out;}
  bindings=load();
  function display(key){return ({ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',Enter:'Enter',Space:'Space'})[key]||key.toUpperCase();}
  function key(id){return bindings[id];}
  function dirty(){return !!draft&&(defs.some(d=>draft[d[0]]!==bindings[d[0]])||(editing&&panel.querySelector('#keymapManual').value.trim()&&normalize(panel.querySelector('#keymapManual').value.trim())!==draft[editing]));}
  function save(id,raw){
    const value=normalize(String(raw).trim());
    if(!draft)return word('请先打开自定义按键','Open key settings first');
    if(!valid(value))return word('请使用字母、数字、符号、方向键、Enter或Space。','Use a letter, digit, symbol, arrow, Enter or Space.');
    const used=defs.find(d=>d[0]!==id&&draft[d[0]]===value);
    if(used)return word('该键已用于：','Already assigned: ')+label(used);
    draft[id]=value;editing=null;panel.querySelector('#keymapManual').value='';render();return '';
  }
  function hideDiscard(){if(panel)panel.querySelector('#keymapDiscard').classList.add('off');}
  function finish(){editing=null;draft=null;hideDiscard();panel.classList.add('off');Game.openRules();Game.el.rulesBody.scrollTop=rulesScroll;}
  function back(){if(!panel||panel.classList.contains('off'))return;if(dirty()){panel.querySelector('#keymapDiscard').classList.remove('off');panel.querySelector('#keymapKeepEditing').focus();}else finish();}
  function confirm(){
    if(!draft)return;
    if(editing&&panel.querySelector('#keymapManual').value.trim()){
      const error=save(editing,panel.querySelector('#keymapManual').value);
      if(error){panel.querySelector('#keymapError').textContent=error;return;}
    }
    bindings=Object.assign({},draft);storeSet(storage,JSON.stringify(bindings));sync();finish();
  }
  function action(e){const value=normalize(e.key||'');let found=defs.find(d=>bindings[d[0]]===value);if(!found&&value==='['&&bindings.prev==='q')found=defs.find(d=>d[0]==='prev');if(!found&&value===']'&&bindings.next==='e')found=defs.find(d=>d[0]==='next');if(!found&&value==='Space'&&bindings.place==='Enter')found=defs.find(d=>d[0]==='place');return found&&found[0];}
  function handle(e){if(e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return false;const id=action(e);if(!id)return false;
    if(panel&&!panel.classList.contains('off'))return true;
    const actions={undo:()=>Game.undo(),restart:()=>Game.restart(),ghost:()=>Game.setGhostMode(!Game.ghostMode),grid:()=>Game.toggleGrid(),filter:()=>Game.cycleStoneFilter(),prev:()=>Game.setActiveLayer(Game.activeLayer-1),next:()=>Game.setActiveLayer(Game.activeLayer+1),rotate:()=>Game.doRotate(),cancel:()=>Game.restoreRotation()};
    if(actions[id]){if(e.preventDefault)e.preventDefault();actions[id]();return true;}return false;
  }
  function node(tag,text,parent){const e=document.createElement(tag);if(text)e.textContent=text;if(parent)parent.appendChild(e);return e;}
  function render(){if(!panel)return;const list=panel.querySelector('#keymapList');list.textContent='';
    panel.querySelector('h2').textContent=word('自定义按键','Custom keybindings');
    panel.querySelector('#keymapInstructions').textContent=word('点击键位后按新键；Esc取消。点击确认后保存并返回规则；冲突时不会覆盖。','Select a binding and press a key. Escape cancels. Confirm saves and returns to the rules; conflicts are rejected.');
    for(const d of defs){const row=node('div','',list);row.className='keymapRow';node('label',label(d),row);const button=node('button',editing===d[0]?word('按下新键…','Press a key…'):display((draft||bindings)[d[0]]),row);button.type='button';button.dataset.action=d[0];button.onclick=()=>{editing=d[0];render();panel.querySelector('[data-action="'+d[0]+'"]').focus();};}
  }
  function open(){if(!panel||!panel.classList.contains('off'))return;rulesScroll=Game.el.rulesBody.scrollTop;Game.cancelPendingTap();Game.closePanels();draft=Object.assign({},bindings);editing=null;panel.querySelector('#keymapManual').value='';panel.querySelector('#keymapError').textContent='';hideDiscard();panel.classList.remove('off');render();panel.querySelector('#keymapBack').focus();}
  function close(){back();}
  function sync(){if(!panel||!Game.el)return;
    const text=defs.filter(d=>!['left','right','up','down','place','zoomIn','zoomOut','reset'].includes(d[0])).map(d=>display(bindings[d[0]])+' '+label(d)).join(' · ');
    const hint=document.getElementById('keymapHint');if(hint){hint.querySelector('span').textContent=text;hint.querySelector('button').textContent=word('键位','Keys');}
    const card=document.getElementById('keymapRules');if(card){card.querySelector('h3').textContent=word('当前快捷键（可自定义）','Current shortcuts (customizable)');card.querySelector('p').textContent=defs.map(d=>display(bindings[d[0]])+' '+label(d)).join(' · ');card.querySelector('button').textContent=word('自定义按键','Customize keys');}
    // Rewrite existing help tokens from their saved originals, so remapping twice never compounds replacements.
    const replace=text=>text.replace(/\b(Z|R|G|H|B|Q|E|T|Y)\b/g,k=>{const d=defs.find(d=>d[1]===k.toLowerCase());return d?display(bindings[d[0]]):k;});
    if(Game.el.hint){const walker=document.createTreeWalker(Game.el.hint,4);let n;while(n=walker.nextNode()){if(n._keymapOriginal===undefined)n._keymapOriginal=n.nodeValue;n.nodeValue=replace(n._keymapOriginal);}}
    if(Game.el.rulesBody)for(const code of Game.el.rulesBody.querySelectorAll('code')){if(code._keymapOriginal===undefined)code._keymapOriginal=code.textContent;if(/^(Z|R|G|H|B|Q|E|T|Y|Q\/E)$/.test(code._keymapOriginal))code.textContent=replace(code._keymapOriginal);}
    for(const [id,act] of [['undoBtn','undo'],['restartBtn','restart'],['rotGo','rotate'],['rotCancel','cancel']]){const e=document.getElementById(id);if(e)e.title=label(defs.find(d=>d[0]===act))+' ('+display(bindings[act])+')';}
  }
  function rules(){if(!panel||!Game.el.rulesBody)return;let card=document.getElementById('keymapRules');if(!card){card=node('section','');card.id='keymapRules';node('h3','',card);node('p','',card);node('button','',card).onclick=open;Game.el.rulesBody.prepend(card);}sync();}
  function init(){if(panel||!document.head||typeof document.head.appendChild!=="function")return;const style=node('style','',document.head);style.textContent='#keymapCard{position:relative}#keymapHeader{position:sticky;top:-18px;background:var(--panel);display:flex;align-items:center;gap:12px;padding:8px 0;z-index:1}#keymapFooter{display:flex;justify-content:space-between;gap:12px;margin-top:12px}#keymapConfirm{background:var(--accent);color:white;min-width:100px}#keymapDiscard{position:absolute;left:18px;right:18px;top:58px;z-index:3;padding:14px;background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 25px rgba(0,0,0,.2)}#keymapDiscard.off{display:none}#keymapDiscard button{margin-right:8px}'+'#keymapPanel{position:fixed;inset:0;z-index:90;background:rgba(30,25,20,.25);display:grid;place-items:center;padding:12px;box-sizing:border-box}#keymapPanel.off{display:none}#keymapCard{width:min(460px,100%);max-height:85dvh;overflow-y:auto;background:var(--panel);color:var(--text);padding:18px;border:1px solid var(--border);border-radius:10px;box-sizing:border-box}#keymapCard h2{font-size:18px;margin:0}#keymapCard p{font-size:12px}#keymapList{display:grid;gap:6px}.keymapRow{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}.keymapRow button{min-width:75px}#keymapError{color:var(--danger);min-height:1.5em}#keymapHint{font-size:11px;line-height:1.4;max-width:330px}#keymapHint button{font-size:11px;padding:2px 5px;margin-left:5px}#keymapRules{border-bottom:1px solid var(--border);padding-bottom:10px}';
    panel=node('div','',document.body);panel.id='keymapPanel';panel.className='off';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',word('自定义按键','Custom keybindings'));
    const card=node('div','',panel);card.id='keymapCard';
    const header=node('header','',card);header.id='keymapHeader';
    const returnButton=node('button',word('← 返回','← Back'),header);returnButton.id='keymapBack';returnButton.type='button';returnButton.onclick=back;
    node('h2','',header);const desc=node('p','',card);desc.id='keymapInstructions';node('div','',card).id='keymapList';node('p','',card).id='keymapError';
    const manual=node('input','',card);manual.id='keymapManual';manual.type='text';manual.placeholder=word('选中键位后输入键名，如 U / ArrowLeft','Select a binding, then enter U / ArrowLeft');manual.setAttribute('aria-label',word('输入新键名','New key name'));manual.style.cssText='width:100%;box-sizing:border-box;margin-top:10px';
    node('button',word('应用输入键名','Apply entered key'),card).onclick=()=>{panel.querySelector('#keymapError').textContent=editing?save(editing,manual.value):word('请先点击要调整的键位','Select a binding first');};
    const footer=node('div','',card);footer.id='keymapFooter';
    const reset=node('button',word('恢复默认','Reset defaults'),footer);reset.id='keymapReset';reset.onclick=()=>{draft=defaults();editing=null;manual.value='';panel.querySelector('#keymapError').textContent='';render();};
    const accept=node('button',word('确认','Confirm'),footer);accept.id='keymapConfirm';accept.onclick=confirm;
    const ask=node('div','',card);ask.id='keymapDiscard';ask.className='off';ask.setAttribute('role','alertdialog');ask.setAttribute('aria-label',word('是否放弃更改','Discard changes'));
    node('p',word('有未保存的更改，是否放弃？','Discard your unsaved changes?'),ask);
    const discard=node('button',word('放弃更改并返回','Discard and return'),ask);discard.id='keymapDiscardConfirm';discard.onclick=finish;
    const keep=node('button',word('继续编辑','Keep editing'),ask);keep.id='keymapKeepEditing';keep.onclick=hideDiscard;
    panel.addEventListener('click',e=>{if(!ask.classList.contains('off')&&!ask.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();hideDiscard();}},true);
    panel.addEventListener('click',e=>{if(e.target===panel)back();});
    document.addEventListener('keydown',e=>{
      if(panel.classList.contains('off'))return;
      if(e.key==='Escape'){if(e.preventDefault)e.preventDefault();e.stopImmediatePropagation();if(!ask.classList.contains('off'))hideDiscard();else if(editing){editing=null;manual.value='';render();}else back();return;}
      if(!ask.classList.contains('off'))return;
      if(e.key==='Tab'||e.target.id==='keymapManual'||!editing)return;
      if(e.preventDefault)e.preventDefault();e.stopImmediatePropagation();
      if(!e.isComposing&&!e.ctrlKey&&!e.metaKey&&!e.altKey){panel.querySelector('#keymapError').textContent=save(editing,e.key);}
    },true);
    sync();
  }
  return {init,sync,rules,open,close,confirm,handle,action,key,save,display,get isOpen(){return panel&&!panel.classList.contains('off');}};
})();
for(const method of ['applyLang','syncOnlineControls']){if(typeof Game[method]==='function'){const original=Game[method];Game[method]=function(...args){const result=original.apply(this,args);Keymap.sync();return result;};}}
{const original=Game.openRules;Game.openRules=function(...args){const result=original.apply(this,args);Keymap.rules();return result;};}
/* KEYMAP-END */
