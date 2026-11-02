/* 2D integration. All runtime code is embedded into index.html by embed-2d.mjs. */
const D2_LABELS = {
  mode: ['二维','2D','二次元','2D','2D','2D'],
  tutorialPosition: ['教学局面','Training position','練習局面','학습 국면','Учебная позиция','Position d’entraînement'],
  link2: ['双轴联动','Link both axes','二軸連動','두 축 연동','Связать оси','Lier les axes'],
  spinSummary: ['每落 {n} 子可转动一层','Rotate a layer after {n} placements','{n} 手ごとに一層回転','{n}수마다 한 층 회전','Поворот слоя через {n} ходов','Tourner une couche après {n} poses'],
  spinCompact: ['转动冷却 {n} 手','Rotation cooldown {n}','回転待ち {n} 手','회전 대기 {n}수','Пауза поворота {n}','Délai de rotation {n}'],
  wrapSummary: ['六面贯通 · 边界相连','Six faces joined · Edges wrap','六面貫通・境界がつながる','여섯 면 연결 · 경계 연결','Грани соединены · Сквозные края','Six faces reliées · Bords connectés'],
  settings: ['二维设置','2D settings','二次元の設定','2D 설정','Настройки 2D','Réglages 2D'],
  holes: ['黑洞奇点','Black holes','ブラックホール','블랙홀','Чёрные дыры','Trous noirs'],
  float: ['浮空连珠','Floating stones','浮遊連珠','공중 오목','Два слоя','Deux couches'],
  age: ['刹那昙花','Ephemeral stones','移ろう石','찰나의 돌','Срок жизни','Pierres éphémères'],
  random: ['随机黑洞数（3–{max}）','Random holes (3–{max})','ランダムな穴の数 (3–{max})','무작위 블랙홀 수 (3–{max})','Случайные дыры (3–{max})','Trous aléatoires (3–{max})'],
  floatNote: ['前 8 个落子只能铺地基，第 9 个起才能在顶层落子。地基归落子方所有：只有主人能在上面放同色顶子；对方放上后，每过一手寿命减 1，减到 0 时地基摧毁，顶子坠落成为新地基。初始寿命 {n} 手（10–30，可调）。灰子暂停计时。','The first 8 placements are foundations only; top stones are allowed from the 9th placement. A foundation belongs to the player who placed it: only the owner can put a matching top stone on it. If the opponent places on it, its life drops by 1 per action; at 0 the foundation is destroyed and the top stone falls and becomes a new foundation. Initial life {n} (10–30, adjustable). Gray stones pause the timer.','最初の8手は土台のみ。9手目から上層に置けます。土台は置いた側の所有で、所有者だけが同色の上石を置けます。相手が置くと1手ごとに寿命が1減り、0で土台が壊れ、上石が落ちて新しい土台になります。初期寿命 {n} 手（10–30、変更可）。灰色の石は計時を止めます。','처음 8수는 기초만 놓을 수 있고, 9수째부터 윗층에 놓을 수 있습니다. 기초는 놓은 쪽의 소유이며, 주인만 같은 색 윗돌을 놓을 수 있습니다. 상대가 놓으면 수마다 수명이 1씩 줄고, 0이 되면 기초가 파괴되며 윗돌이 떨어져 새 기초가 됩니다. 초기 수명 {n}수(10–30, 조정 가능). 회색 돌은 시간이 멈춥니다.','Первые 8 ходов — только основания; с 9-го хода можно ставить верхние камни. Основание принадлежит поставившему: только владелец может положить на него свой верхний камень. Если на нём играет соперник, жизнь уменьшается на 1 за ход; при 0 основание разрушается, а верхний камень падает и становится новым основанием. Начальная жизнь {n} (10–30, настраивается). Серые камни останавливают отсчёт.','Les 8 premières poses sont des fondations ; les pierres du dessus sont autorisées à partir de la 9e pose. Une fondation appartient à celui qui l’a posée : seul le propriétaire peut y placer une pierre de sa couleur. Si l’adversaire y joue, sa vie diminue de 1 par action ; à 0, la fondation est détruite et la pierre du dessus tombe et devient une nouvelle fondation. Vie initiale {n} (10–30, réglable). Les pierres grises suspendent le compte.'],
  floatLifeLabel: ['排斥寿命（10–30 手）','Repulsion life (10–30 moves)','排斥寿命（10–30 手）','배척 수명(10–30수)','Жизнь отталкивания (10–30 ходов)','Vie de répulsion (10–30 coups)'],
  holeNote: ['双方轮流放置相同数量的黑洞。交换仅移动黑洞，占一回合；黑洞只吞顶子，地基保留。','Players alternate placing equal numbers of holes. A swap moves only holes and uses a turn; top stones are swallowed, foundations remain.','穴は同数ずつ交互に置きます。交換は穴だけを動かして一手を使い、上の石だけを消し土台は残します。','같은 수의 블랙홀을 번갈아 놓습니다. 교환은 한 수를 쓰며 블랙홀만 움직입니다. 윗돌만 삼키고 기초는 남습니다.','Игроки по очереди ставят равное число дыр. Обмен занимает ход и двигает только дыры; верхние камни поглощаются, основания остаются.','Chacun place le même nombre de trous à tour de rôle. Un échange utilise un tour et ne déplace que les trous ; les fondations restent.'],
  perPlayer: ['双方各放黑洞数（0–5）','Holes placed per player (0–5)','各自が置く穴 (0–5)','각자 놓을 블랙홀 (0–5)','Дыр на игрока (0–5)','Trous par joueur (0–5)'],
  cooldown: ['交换冷却（落子数 3–10）','Swap cooldown (3–10 placements)','交換待ち (3–10 手)','교환 대기 (착수 3–10회)','Пауза обмена (3–10 ходов)','Délai d’échange (3–10 poses)'],
  ageMode: ['寿命档位','Lifetime mode','寿命モード','수명 모드','Режим старения','Mode de vieillissement'],
  ageLong: ['昙花 · 含 3 手灰期','Ephemeral · 3 gray turns','移ろい · 灰色期 3 手','찰나 · 회색 기간 3수','Увядание · 3 серых хода','Éphémère · 3 tours gris'],
  ageShort: ['基础风化 · 5 手','Erosion · 5 turns','風化 · 5 手','풍화 · 5수','Эрозия · 5 ходов','Érosion · 5 tours'],
  turns: ['寿命 T（24–42 手）','Lifetime T (24–42 turns)','寿命 T (24–42 手)','수명 T (24–42수)','Срок T (24–42 хода)','Durée T (24–42 tours)'],
  aura: ['黑洞附近时间变慢：内圈每手老化 0.25 手，外圈 0.5 手，其余 1 手。交换也推进老化；黑洞只吞顶层，不吞地基。','Time slows near holes: inner ring ages 0.25 turn, outer ring 0.5, elsewhere 1. Swaps also age stones. Holes swallow top stones, never foundations.','穴の内周は 0.25 手、外周は 0.5 手、他は 1 手ずつ老化。交換でも時間が進む。穴は上層だけを飲み込み、土台は残る。','블랙홀 안쪽은 0.25수, 바깥쪽은 0.5수, 그 외는 1수씩 노화합니다. 교환도 노화하며 윗돌만 삼키고 기초는 남깁니다.','У дыр время замедляется: внутреннее кольцо 0.25, внешнее 0.5, вне колец 1 ход. Обмен тоже старит камни. Дыры поглощают только верхние камни.','Près des trous : vieillissement de 0.25 tour dans le premier anneau, 0.5 dans le second, 1 ailleurs. Les échanges font vieillir. Seules les pierres du dessus sont absorbées.'],
  shortNote: ['5 手风化适合机制体验：无黑洞时通常无法凑齐同色五连。正常对局推荐 24–42 手。','The 5-turn mode demonstrates erosion: without holes, five same-color stones cannot normally coexist. Use 24–42 turns for a regular game.','5 手風化は体験向け。穴なしでは通常五連を作れない。通常対局は 24–42 手推奨。','5수 풍화는 체험용입니다. 블랙홀이 없으면 보통 오목을 만들 수 없습니다. 일반 대국은 24–42수를 권장합니다.','Режим 5 ходов — демонстрация: без дыр пять камней одного цвета обычно не сохраняются. Для партии: 24–42 хода.','Le mode 5 tours illustre l’érosion : sans trous, cinq pierres de même couleur ne peuvent normalement coexister. Pour jouer : 24–42 tours.'],
  close: ['关闭','Close','閉じる','닫기','Закрыть','Fermer'],
  closeEsc: ['关闭 Esc','Close Esc','閉じる Esc','닫기 Esc','Закрыть Esc','Fermer Esc'],
  holesSummary: ['随机 {a} · 双方各放 {b}\n交换冷却 {n} 手','Random {a} · Each {b}\nSwap after {n} placements','ランダム {a}・各自 {b}\n交換待ち {n} 手','무작위 {a} · 각자 {b}\n교환 대기 {n}수','Случайных {a} · По {b}\nОбмен через {n} ходов','Aléatoires {a} · Chacun {b}\nÉchange après {n} poses'],
  holesCompact: ['随机 {a} · 各放 {b} · 冷却 {n}','Random {a} · Each {b} · Wait {n}','ランダム{a}・各自{b}・待ち{n}','무작위{a} · 각자{b} · 대기{n}','Случ. {a} · По {b} · Пауза {n}','Aléat. {a} · Chacun {b} · Délai {n}'],
  floatSummary: ['归属地基 · 前8手铺底\n排斥 {l} 手','Owned bases · 8 base moves\nrepel {l}','所有土台・最初8手は下層\n排斥 {l} 手','소유 기초 · 처음 8수 바닥\n배척 {l}수','Свои основания · 8 ходов вниз\nотталкивание {l}','Bases possédées · 8 poses en bas\nrépulsion {l}'],
  floatCompact: ['归属·8手·{l}','Owned·8·{l}','所有・8手・{l}','소유·8수·{l}','Своё·8·{l}','Possédé·8·{l}'],
  ageSummary: ['寿命 {t} 手 · 灰期 {g} 手','Lifetime {t} · Gray {g} turns','寿命 {t} 手・灰色期 {g} 手','수명 {t}수 · 회색 {g}수','Срок {t} · Серых ходов {g}','Durée {t} · Gris {g} tours'],
  comboNote: ['组合额外效果：黑洞附近的棋子老化减慢','Combo bonus: holes slow aging.','組合せ効果：穴の周囲は老化が遅くなる','조합 효과: 블랙홀 주변 노화 감소','Бонус: дыры замедляют старение.','Effet combiné : vieillissement ralenti.'],
  save: ['保存设置','Save settings','保存','저장','Сохранить','Enregistrer'],
  replay: ['回放棋局','Replay game','棋譜を再生','기보 재생','Повтор партии','Revoir la partie'],
  moves: ['落子 {n} · 交换 {s} · 动作 {a}','Placements {n} · Swaps {s} · Actions {a}','着手 {n} · 交換 {s} · 操作 {a}','착수 {n} · 교환 {s} · 행동 {a}','Камни {n} · Обмены {s} · Действия {a}','Poses {n} · Échanges {s} · Actions {a}'],
  waiting: ['等待对方操作','Waiting for the other player','相手の操作を待っています','상대 차례입니다','Ожидание соперника','Au tour de l’adversaire'],
  aiTurn: ['电脑思考中…','Computer thinking…','コンピューター思考中…','컴퓨터 생각 중…','Компьютер думает…','L’ordinateur réfléchit…'],
  invalid: ['设置超出允许范围','Settings are outside the allowed range','設定が許容範囲外です','설정 범위를 벗어났습니다','Недопустимые настройки','Réglages hors limites'],
  classicRule: ['横、竖、两斜方向连五。先手必须恰好五连，六连及以上判负；后手五连及以上获胜。','Five along a row, column or diagonal. The first player needs exactly five and loses with six or more; the second wins with five or more.','横・縦・斜めで五連。先手はちょうど五連で勝ち、六連以上は負け。後手は五連以上で勝ち。','가로·세로·대각선 오목. 선수는 정확히 5개면 승리, 6개 이상이면 패배. 후수는 5개 이상이면 승리.','Пять по прямой или диагонали. Первый игрок побеждает ровно с пятью, а с шестью и более проигрывает; второму достаточно пяти или более.','Cinq en ligne, colonne ou diagonale. Le premier joueur doit en aligner exactement cinq et perd avec six ou plus ; le second gagne dès cinq.'],
  swap: ['交换','Swap','交換','교환','Обмен','Échange'],
  base: ['地基','Foundation','土台','기초','Основание','Fondation'],
  top: ['顶层','Top','上層','윗층','Верх','Dessus'],
  badRecord: ['棋谱数据损坏，无法回放','This record is damaged and cannot be replayed','棋譜が破損しているため再生できません','손상된 기보는 재생할 수 없습니다','Запись повреждена','Cette partie est endommagée'],
  nextSaved: ['二维设置已保存，双方同意后下一局生效','2D settings saved; apply next game after both players agree','設定を保存。双方の同意後、次の対局に適用','저장했습니다. 양측 동의 후 다음 대국에 적용','Настройки сохранятся для следующей партии после согласия обоих','Réglages enregistrés pour la prochaine partie, après accord des deux joueurs'],
};
function d2Text(key, vars, lang) {
  const row = D2_LABELS[key];
  let result = row ? row[Math.max(0, LANGS.indexOf(lang || LANG))] : key;
  if (vars) for (const k of Object.keys(vars)) result = result.split('{' + k + '}').join(String(vars[k]));
  return result;
}
function isSession2(s) { return !!(s && s.variant2 && s.variant2.on); }
function sessionFingerprint(s) { return isSession2(s) ? fingerprint2(s) : fingerprint(s); }

(function install2DGame() {
  const ui = () => window.TwoDUI;
  const byId = id => document.getElementById(id);
  const wrap = (name, fn) => {
    const previous = Game[name];
    Game[name] = function (...args) { return fn.call(this, previous, ...args); };
  };
  Game.twoD = false;
  Game.setupLink2 = true;
  Game.setupVariant2 = {on:true,w:15,h:15,freeRule:false,holes:{on:false,randomCount:7,perPlayer:0,cooldown:5,seed:0,layout:null},float:{on:false,life:20,opening:8},age:{on:false,turns:30,gray:3,aura:false}};
  Game.twoDConfig = function () {
    const v = JSON.parse(JSON.stringify(this.setupVariant2));
    v.freeRule = false;
    v.float.life = Math.max(10, Math.min(30, Number(v.float.life) || 20));
    v.float.opening = v.float.opening === undefined ? 8 : v.float.opening;
    v.age.aura = !!(v.holes.on && v.age.on);
    v.holes.layout = null;
    return v;
  };
  Game.syncTwoDSetup = function () {
    if (!this.el || !byId('mode2d')) return;
    const v = this.setupVariant2;
    byId('mode2d').textContent = d2Text('mode');
    byId('mode2d').classList.toggle('sel', this.twoD);
    this.el.setup.classList.toggle('twoDSetup', this.twoD);
    byId('dimsRow2d').classList.toggle('hide', !this.twoD);
    if (this.twoD) {
      this.el.mode3d.classList.remove('sel'); this.el.mode4d.classList.remove('sel');
      this.el.dimsRow3d.classList.add('hide'); this.el.dimsRow4d.classList.add('hide');
    }
    byId('dim2W').value = v.w; byId('dim2H').value = v.h;
    byId('dim2Link').textContent=d2Text('link2');
    byId('dim2Link').classList.toggle('sel',this.setupLink2);
    byId('dim2Link').setAttribute('aria-pressed',String(this.setupLink2));
    byId('twoDRange').textContent=say(() => "可填 10–30", "range.allowed", {range:"10–30"});
    byId('twoDSizeLabel').textContent = byId('rowLabelSize3d').textContent;
    for (const [key,prop] of [['holes','holes'],['float','float'],['age','age']]) {
      const el = byId('twoDToggle' + key);
      byId('twoDLabel' + key).textContent = d2Text(key);
      el.setAttribute('aria-pressed', String(v[prop].on));
      const summary=byId('twoDParam'+key);
      const params={a:v.holes.randomCount,b:v.holes.perPlayer,n:v.holes.cooldown,t:v.age.turns,g:v.age.gray,l:v.float.life};
      byId('twoDFullParam'+key).textContent=d2Text(key+'Summary',params);
      byId('twoDCompactParam'+key).textContent=d2Text(key==='holes'?'holesCompact':key==='float'?'floatCompact':key+'Summary',params);
      summary.hidden=!v[prop].on;
      if(el.parentElement)el.parentElement.classList.toggle('hasParams',v[prop].on);
    }
    byId('twoDCurrentSummary').textContent=v.w+' × '+v.h+' · '+d2Text('mode');
    byId('twoDComboNote').hidden=!(v.holes.on&&v.age.on);
    byId('twoDComboNote').textContent=d2Text('comboNote');
    byId('twoDSettingsBtn').textContent = d2Text('settings');
    byId('twoDSettingsBtn').classList.toggle('off', ![v.holes,v.float,v.age].some(p=>p.on));
    const labels = {twoDSettingsTitle:'settings',twoDSettingsClose:'closeEsc',twoDFixedRule:'classicRule',twoDFloatNote:'floatNote',twoDHoleNote:'holeNote',twoDPerPlayerLabel:'perPlayer',twoDCoolLabel:'cooldown',twoDAgeModeLabel:'ageMode',twoDAgeLong:'ageLong',twoDAgeShort:'ageShort',twoDTurnsLabel:'turns',twoDAuraNote:'aura',twoDShortNote:'shortNote',twoDSettingsSave:'save',twoDReplayTitle:'replay',twoDReplayClose:'close'};
    for (const id in labels) byId(id).textContent = d2Text(labels[id]);
    byId('twoDFloatNote').textContent = d2Text('floatNote', {n: v.float.life});
    byId('twoDFloatLifeLabel').textContent = d2Text('floatLifeLabel');
    if (this.twoD) {
      this.el.tutorialBtn.style.display = ui().tutorial.plan(v).length ? '' : 'none';
      byId('twoDRuleNote').textContent = d2Text('classicRule');
    }
    this.syncThreeDParams();
  };
  Game.syncThreeDParams=function(){
    const active=!this.fourD&&!this.twoD;
    byId('threeDSpinFull').textContent=d2Text('spinSummary',{n:this.setupCool});
    byId('threeDSpinCompact').textContent=d2Text('spinCompact',{n:this.setupCool});
    for(const id of ['threeDWrapFull','threeDWrapCompact'])byId(id).textContent=d2Text('wrapSummary');
    for(const [id,button,on] of [['threeDSpinNote','optSpinBtn',this.setupSpin],['threeDWrapNote','optWrapBtn',this.setupWrap]]){
      byId(id).hidden=!(active&&on);byId(button).classList.toggle('hasParams',!!(active&&on));
    }
  };
  wrap('syncExtraRow',function(old,...args){old.apply(this,args);this.syncThreeDParams();});
  wrap('setSetupCool',function(old,n){old.call(this,n);this.syncThreeDParams();});
  Game.openTwoDSettings = function (onlineNext) {
    this.twoDSettingsNext = !!onlineNext;
    const v = onlineNext && isSession2(this.session) ? (this.nextConfig && this.nextConfig.variant || this.session.variant2) : this.setupVariant2;
    if (![v.holes,v.float,v.age].some(p=>p.on)) return;
    this.twoDSettingsDraft = JSON.parse(JSON.stringify(v));
    byId('twoDRandom').value = v.holes.randomCount; byId('twoDRandom').max = Math.floor(v.w*v.h/15);
    byId('twoDPerPlayer').value = v.holes.perPlayer; byId('twoDCool').value = v.holes.cooldown;
    byId('twoDFloatLife').value = v.float.life;
    byId('twoDAgeMode').value = v.age.turns === 5 ? '5' : '30';
    byId('twoDTurns').value = v.age.turns === 5 ? 30 : v.age.turns;
    for (const id of ['twoDRandom','twoDPerPlayer','twoDCool']) byId(id).disabled = !v.holes.on;
    byId('twoDFloatLife').disabled = !v.float.on;
    byId('twoDAgeMode').disabled = !v.age.on;
    byId('twoDTurns').disabled = !v.age.on || v.age.turns === 5;
    byId('twoDSettingsError').textContent = '';
    this.syncTwoDSetup();
    this.syncTwoDSettingsFields();
    byId('twoDSettings').classList.remove('off');
  };
  Game.syncTwoDSettingsFields = function () {
    const v=this.twoDSettingsDraft;if(!v)return;
    const field=(id,on)=>{const el=byId(id);if(el.parentElement)el.parentElement.hidden=!on;};
    for(const id of ['twoDRandom','twoDPerPlayer','twoDCool'])field(id,v.holes.on);
    field('twoDFloatLife',v.float.on);
    field('twoDAgeMode',v.age.on);
    const short=byId('twoDAgeMode').value==='5';
    field('twoDTurns',v.age.on&&!short);
    byId('twoDRandomLabel').textContent=d2Text('random',{max:Math.floor(v.w*v.h/15)});
    byId('twoDFloatLifeLabel').textContent=d2Text('floatLifeLabel');
    byId('twoDFloatNote').textContent=d2Text('floatNote',{n:v.float.life});
    byId('twoDFloatNote').hidden=!v.float.on;
    byId('twoDHoleNote').hidden=!v.holes.on;
    byId('twoDAuraNote').hidden=!(v.holes.on&&v.age.on);
    byId('twoDShortNote').hidden=!(v.age.on&&short);
  };
  Game.saveTwoDSettings = function () {
    const v = this.twoDSettingsDraft;
    if (!v) return;
    v.freeRule = false;
    v.holes.randomCount = Number(byId('twoDRandom').value);
    v.holes.perPlayer = Number(byId('twoDPerPlayer').value);
    v.holes.cooldown = Number(byId('twoDCool').value);
    v.holes.layout = null;
    v.float.life = Number(byId('twoDFloatLife').value);
    v.float.opening = v.float.opening === undefined ? 8 : v.float.opening;
    v.age.turns = byId('twoDAgeMode').value === '5' ? 5 : Number(byId('twoDTurns').value);
    v.age.gray = v.age.turns === 5 ? 0 : 3;
    v.age.aura = v.holes.on && v.age.on;
    const check = validateVariant2(v, v.w, v.h);
    if (!check.ok) { byId('twoDSettingsError').textContent = d2Text('invalid'); return; }
    if (this.twoDSettingsNext) {
    } else this.setupVariant2 = v;
    byId('twoDSettings').classList.add('off');
    this.syncTwoDSetup(); this.refreshSetupSummary();
  };
  // 二维→三维切换时，三维的层视图画布可能停在 1×1（二维期间被隐藏后没有重新量尺寸）。
  // 手动 drawLayerBase 会按 CSS 尺寸重建；只在确实缩成 1 时补，避免每局重复画。
  const redraw3DLayers=function(g){
    if(!g.session||isSession2(g.session)||!g.el||!g.el.layerBase)return;
    if(g.el.layerBase.width<=1||g.el.layerOverlay.width<=1){g.drawLayerBase();g.drawLayerOverlay();g.drawStrip();g.drawTimeline();}
  };
  function drawExportOwnerRing(ctx,cx,cy,r,owner){
    if(!owner)return;
    ctx.beginPath();ctx.arc(cx,cy,r*1.16,0,Math.PI*2);
    ctx.strokeStyle=owner===BLACK?"#182526":"#fbf8eb";ctx.lineWidth=Math.max(1.5,r*.16);ctx.stroke();
    ctx.beginPath();ctx.arc(cx,cy,r*1.28,0,Math.PI*2);
    ctx.strokeStyle=owner===BLACK?"rgba(247,242,230,.55)":"rgba(24,37,38,.35)";ctx.lineWidth=1;ctx.stroke();
  }
  function drawExportHole(ctx,cx,cy,r){
    const g=ctx.createRadialGradient(cx-r*.2,cy-r*.2,r*.1,cx,cy,r*.95);
    g.addColorStop(0,"#0b1416");g.addColorStop(1,"#020506");
    ctx.beginPath();ctx.arc(cx,cy,r*.94,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
    ctx.strokeStyle="#e8c87a";ctx.lineWidth=Math.max(1,r*.09);ctx.stroke();
    ctx.strokeStyle="rgba(72,196,184,.75)";ctx.lineWidth=Math.max(1,r*.1);
    ctx.beginPath();ctx.arc(cx,cy,r*1.18,.4,2.2);ctx.stroke();
    ctx.strokeStyle="rgba(244,194,92,.85)";
    ctx.beginPath();ctx.arc(cx,cy,r*1.32,2.6,4.4);ctx.stroke();
  }
  /** 导出专用的二维棋盘图：双盘、归属环、寿命、黑洞、获胜线；不依赖实时 UI 状态。 */
  function capture2DBoard(session,game){
    const W=1200,H=1200,cv=document.createElement("canvas");cv.width=W;cv.height=H;
    const ctx=cv.getContext("2d");if(!ctx)return null;
    const v=session.variant2,float=!!(v.float&&v.float.on),age=!!(v.age&&v.age.on),w=session.w,h=session.h;
    ctx.fillStyle="#f4eedf";ctx.fillRect(0,0,W,H);
    const margin=46,gap=34,labelH=32;
    const panels=float?[
      {x:margin,y:margin+labelH,w:(W-margin*2-gap)/2,h:H-margin*2-labelH,label:ui().text("base",LANG),layer:"base"},
      {x:margin+(W-margin*2-gap)/2+gap,y:margin+labelH,w:(W-margin*2-gap)/2,h:H-margin*2-labelH,label:ui().text("top",LANG),layer:"top"}
    ]:[{x:margin,y:margin+labelH,w:W-margin*2,h:H-margin*2-labelH,label:ui().text("board",LANG),layer:"top"}];
    for(const p of panels){
      ctx.fillStyle="#faf6ea";ctx.fillRect(p.x,p.y,p.w,p.h);
      ctx.strokeStyle="#b9ad91";ctx.lineWidth=2;ctx.strokeRect(p.x+.5,p.y+.5,p.w-1,p.h-1);
      ctx.fillStyle="#536b63";ctx.font="600 20px system-ui,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(p.label,p.x+p.w/2,p.y-labelH/2);
      const pad=42;
      const step=Math.min((p.w-pad*2)/Math.max(1,w-1),(p.h-pad*2)/Math.max(1,h-1));
      const left=p.x+(p.w-(w-1)*step)/2,bottom=p.y+(p.h+(h-1)*step)/2;
      const px=(x)=>left+x*step,py=(y)=>bottom-y*step;
      if(game.gridAlpha!==0){
        ctx.save();ctx.globalAlpha=game.gridAlpha==null?.4:Math.max(0,Math.min(1,game.gridAlpha));
        ctx.strokeStyle=game.gridColor||"#566a62";ctx.lineWidth=1;ctx.beginPath();
        for(let x=0;x<w;x++){ctx.moveTo(px(x),py(0));ctx.lineTo(px(x),py(h-1));}
        for(let y=0;y<h;y++){ctx.moveTo(px(0),py(y));ctx.lineTo(px(w-1),py(y));}
        ctx.stroke();ctx.restore();
      }
      const radius=Math.max(3,Math.min(step*.34,26));
      ctx.fillStyle="#8a8676";ctx.font="12px system-ui,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
      const stride=Math.max(1,Math.ceil(w/15));
      for(let x=0;x<w;x+=stride)ctx.fillText(String(x),px(x),p.y+p.h-14);
      for(let y=0;y<h;y+=stride)ctx.fillText(String(y),p.x+14,py(y));
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const k=session.index(x,y),cx=px(x),cy=py(y);
        if(session.hole[k]){
          if(p.layer==="base"){
            ctx.strokeStyle="#a35948";ctx.lineWidth=Math.max(1.2,radius*.16);
            ctx.beginPath();ctx.moveTo(cx-radius*.5,cy-radius*.5);ctx.lineTo(cx+radius*.5,cy+radius*.5);
            ctx.moveTo(cx+radius*.5,cy-radius*.5);ctx.lineTo(cx-radius*.5,cy+radius*.5);ctx.stroke();
          }else drawExportHole(ctx,cx,cy,radius);
          continue;
        }
        if(p.layer==="base"){
          if(!session.base[k])continue;
          ctx.beginPath();ctx.arc(cx,cy,radius*.82,0,Math.PI*2);ctx.fillStyle="#a9afa0";ctx.fill();
          ctx.strokeStyle="#747e70";ctx.lineWidth=1;ctx.stroke();
          drawExportOwnerRing(ctx,cx,cy,radius*.82,session.baseOwner[k]);
          const life=session.floatLifeOf(x,y);
          ctx.fillStyle=session.baseOwner[k]===BLACK?"#f5efe0":"#22302e";
          ctx.font=Math.max(9,radius*.8)+"px system-ui,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
          ctx.fillText(String(life),cx,cy);
        }else{
          const c=session.top[k];if(!c)continue;
          const gray=c===3,fill=gray?"#b2b2a8":c===BLACK?"#293636":"#fbf8eb",edge=gray?"#a28661":c===BLACK?"#182526":"#66736d";
          ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();
          ctx.strokeStyle=edge;ctx.lineWidth=Math.max(1,radius*.08);ctx.stroke();
          if(float)drawExportOwnerRing(ctx,cx,cy,radius,session.baseOwner[k]);
          if(age&&c!==3){const rem=session.remainingOf(x,y),T=v.age.turns;
            if(T>0){ctx.strokeStyle=rem<=3?"#ad7654":"#4a8076";ctx.lineWidth=Math.max(1,radius*.09);
              ctx.beginPath();ctx.arc(cx,cy,radius*1.16,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.max(0,Math.min(1,rem/T)));ctx.stroke();}}
        }
      }
      if(p.layer==="top"){
        const lines=RuleEngine.fullScan(session.board,session.rules.winLength);
        for(const line of lines){
          const sx=line.start[0],sy=line.start[1],dx=line.dir[0],dy=line.dir[1];
          ctx.strokeStyle="rgba(220,170,60,.85)";ctx.lineWidth=Math.max(2,radius*.32);ctx.lineCap="round";
          ctx.beginPath();ctx.moveTo(px(sx),py(sy));ctx.lineTo(px(sx+dx*(line.length-1)),py(sy+dy*(line.length-1)));ctx.stroke();
          ctx.lineCap="butt";
        }
      }
    }
    return cv;
  }
  Game.syncTwoDScene = function () {
    if (!this.el || !this.el.stage) return;
    const active = isSession2(this.session) && !this.setupOpen;
    this.el.stage.classList.toggle('twod', active);
    this.el.stage.classList.toggle('twoDTutorial', active && this.tutActive);
    if (!active) { redraw3DLayers(this); return; }
    if (!this.twoDMounted) {
      ui().mount(byId('twoDBoardHost'), {onCancelTap:()=>this.cancelPendingTap(),onTap:(...args)=>this.handleTap(...args),onAction:a=>this.twoDAction(a),onNotice:msg=>this.toast(msg,false),lang:LANG,gridColor:this.gridColor,gridAlpha:this.gridAlpha});
      this.twoDMounted = true;
    }
    ui().setLanguage(LANG);
    ui().setSession(this.session);
    ui().setAppearance({gridColor:this.gridColor,gridAlpha:this.gridAlpha,gridVisible:this.gridVisible,stoneFilter:this.stoneFilter});
    ui().resize();
  };
  Game.twoDAction = function (action) {
    const s = this.session;
    if (!isSession2(s) || this.setupOpen || this.replayViewing) return {ok:false};
    if (this.isAiTurn()) { this.toast(d2Text('aiTurn'),false); return {ok:false}; }
    if (this.tutActive && ui().tutorial.allowed && !ui().tutorial.allowed(this.tutIndex,action)) {
      this.toast(ui().text('tutorial.actionHint',LANG),false); return {ok:false};
    }
    if (s.status === 'Setup') action = {kind:'placeHole',x:action.x,y:action.y};
    const kind = action.kind === 'swap' ? 'swapLines' : action.kind;
    const payload = Object.assign({},action,{z: s.variant2.float.on && action.layer === 'top' ? 1 : 0});
    if (kind === 'swapLines') { payload.orient = action.axis === 'col' || action.axis === 1 ? 1 : 0; payload.lineA=action.i; payload.lineB=action.j; }
    const result = this.commit(kind,payload);
    if (!result.ok && result.reason) this.toast(result.reason,false);
    return result;
  };
  wrap('bindUi',function (old) {
    old.call(this);
    byId('twoDSettings').classList.add('off');byId('twoDReplay').classList.add('off');
    byId('mode2d').addEventListener('click',()=>{this.setSetupMode(false);this.twoD=true;this.fourD=false;this.syncTwoDSetup();this.refreshSetupSummary();this.syncInscription();});
    const dimension = e => {
      const v=this.setupVariant2;
      v.w=Math.min(30,Math.max(10,Math.round(Number(byId('dim2W').value)||15)));
      v.h=Math.min(30,Math.max(10,Math.round(Number(byId('dim2H').value)||15)));
      if(this.setupLink2){const n=e.currentTarget===byId('dim2H')?v.h:v.w;v.w=v.h=n;}
      v.holes.randomCount=Math.min(Math.floor(v.w*v.h/15),Math.max(3,v.holes.randomCount));
      this.syncTwoDSetup();this.refreshSetupSummary();
    };
    byId('dim2W').addEventListener('change',dimension); byId('dim2H').addEventListener('change',dimension);
    byId('dim2Link').addEventListener('click',()=>{this.setupLink2=!this.setupLink2;if(this.setupLink2){this.setupVariant2.h=this.setupVariant2.w;this.setupVariant2.holes.randomCount=Math.min(Math.floor(this.setupVariant2.w*this.setupVariant2.h/15),this.setupVariant2.holes.randomCount);}this.syncTwoDSetup();this.refreshSetupSummary();});
    for (const key of ['holes','float','age']) byId('twoDToggle'+key).addEventListener('click',()=>{this.setupVariant2[key].on=!this.setupVariant2[key].on;this.syncTwoDSetup();this.refreshSetupSummary();});
    byId('twoDSettingsBtn').addEventListener('click',()=>this.openTwoDSettings(false));
    byId('twoDSettingsClose').addEventListener('click',()=>byId('twoDSettings').classList.add('off'));
    byId('twoDSettings').addEventListener('click',e=>{if(e.target===byId('twoDSettings'))byId('twoDSettings').classList.add('off');});
    byId('twoDSettingsSave').addEventListener('click',()=>this.saveTwoDSettings());
    byId('twoDAgeMode').addEventListener('change',()=>{byId('twoDTurns').disabled=byId('twoDAgeMode').value==='5';this.syncTwoDSettingsFields();});
    byId('twoDReplayClose').addEventListener('click',()=>{byId('twoDReplay').classList.add('off');this.replayViewing=false;});
    byId('twoDReplayRange').addEventListener('input',()=>this.renderTwoDReplay());
    for (const [id,delta] of [['twoDReplayPrev',-1],['twoDReplayNext',1]]) byId(id).addEventListener('click',()=>{
      const input=byId('twoDReplayRange');input.value=Math.max(0,Math.min(Number(input.max),Number(input.value)+delta));this.renderTwoDReplay();
    });
    this.el.historyBody.addEventListener('click',e=>{const target=e.target.closest && e.target.closest('[data-replay2]');if(target)this.openTwoDReplay(target.getAttribute('data-replay2'));});
    document.addEventListener('keydown',e=>{
      if (e.key !== 'Escape') return;
      for (const id of ['twoDSettings','twoDReplay']) byId(id).classList.add('off');
      this.replayViewing=false;
    });
    this.syncTwoDSetup();
  });
  wrap('setSetupMode',function (old,fourD) { this.twoD=false;old.call(this,fourD);this.syncTwoDSetup();applyStatic(); });
  wrap('refreshSetupSummary',function (old) {
    if (!this.twoD) return old.call(this);
    const v=this.setupVariant2;
    this.el.sizeSummary.textContent=v.w+' × '+v.h+' · '+d2Text('mode');
    this.syncTwoDSetup();
  });
  wrap('applyLang',function (old) { old.call(this);this.syncTwoDSetup();if(isSession2(this.session))this.syncTwoDScene(); });
  wrap('wireSession',function (old) {
    const s=this.session;if(!isSession2(s))return old.call(this);
    s.onMoveApplied.push((session,rec,outcome)=>this.onMoveApplied(rec,outcome));
    s.onMoveUndone.push((session,rec)=>this.onMoveUndone(rec));
    s.onSwapApplied.push((session,rec,outcome)=>this.onMoveApplied(rec,outcome));
    s.onSwapUndone.push((session,rec)=>this.onMoveUndone(rec));
    s.onReset.push(()=>this.onReset());
    s.onSetupChanged.push(()=>{this.onBoardChanged(false);this.maybeScheduleAi();});
  });
  wrap('newGame',function (old,dims,first) {
    if (!this.twoD) { if(isSession2(this.session))this.session=null;const r=old.call(this,dims,first);this.syncTwoDScene();redraw3DLayers(this);return r; }
    this.cancelAiTimer();this.clearLocalLimitClock();this.hideBanner();
    const v=this.twoDConfig();v.holes.seed=(0x2d2026+this.startCount*2654435761)>>>0;
    this.session=Session2D.create(v.w,v.h,first,new RuleSet(),v);this.wireSession();
    this.resetViewState(1);this.resetClock();
    this.isOnlineGame=false;this.gameTimed=!!this.setupTiming;
    this.recLimitSec=this.gameTimed&&this.setupLimit?this.clampSetupLimitSec(this.setupLimitSec):0;
    this.recId=null;this.recSession=null;this.recordEndReason=0;this.clockReady=true;
    this.aiMode=this.setupAi!=='human';this.aiLevel=AI_LEVELS[this.setupLevel]||'medium';this.aiMyColor=this.setupMyColor;
    this.onBoardChanged(true);this.armLocalLimitClock();this.updateClockHud(true);this.maybeScheduleAi();
  });
  wrap('adoptSession',function (old,s) {this.twoD=isSession2(s);const r=old.call(this,s);this.syncTwoDScene();return r;});
  wrap('onBoardChanged',function (old,full) {
    if(!isSession2(this.session))return old.call(this,full);
    this.refreshTexts();this.syncTwoDScene();
  });
  wrap('refreshTexts',function (old) {
    old.call(this);if(!isSession2(this.session))return;
    const s=this.session;
    this.el.rule.textContent=d2Text('classicRule');
    this.el.info.textContent=d2Text('moves',{n:s.moveCount,s:s.swaps.length,a:s.actionCount})+' · '+s.dims.join('×')+(this.aiThinking?' · '+d2Text('aiTurn'):'');
    if(this.tutActive&&s.tutorialPosition){this.el.info.textContent=d2Text('tutorialPosition')+' · '+s.dims.join('×');if(s.status==='Playing')this.el.status.textContent=ui().text('turn',LANG,{player:ui().text(s.currentPlayer===1?'black':'white',LANG)});}
    if(this.twoDMounted&&!this.setupOpen)ui().render();
  });
  for(const name of ['drawLayerBase','drawLayerOverlay','drawStrip','drawTimeline','uploadGrid','uploadActiveGrid','uploadInstances','uploadHoverLines'])wrap(name,function(old,...a){if(isSession2(this.session))return;return old.apply(this,a);});
  wrap('draw3D',function(old,...a){if(isSession2(this.session)&&!this.setupOpen)return;return old.apply(this,a);});
  wrap('resize',function(old){old.call(this);if(this.twoDMounted&&!this.setupOpen)ui().resize();});
  for(const name of ['openSetup','closeSetup'])wrap(name,function(old,...a){const r=old.apply(this,a);this.syncTwoDSetup();this.syncTwoDScene();return r;});
  wrap('commitLocal',function(old,kind,payload){
    if(!isSession2(this.session))return old.call(this,kind,payload);
    const s=this.session,p=payload||{};let result;
    if(kind==='place')result=s.place(p.x,p.y,p.layer);
    else if(kind==='placeHole')result=s.placeHole(p.x,p.y);
    else if(kind==='swapLines')result=s.swapLines(p.orient,p.lineA,p.lineB);
    else return old.call(this,kind,payload);
    return result.status===MoveStatus.Rejected?{ok:false,reason:result.reason}:{ok:true};
  });
  wrap('tryPlace',function(old,x,y){if(isSession2(this.session))return this.twoDAction({kind:'place',x,y});return old.call(this,x,y);});
  wrap('undo',function(old){if(isSession2(this.session)&&ui().swapPreview){ui().cancelSwap();return;}return old.call(this);});
  wrap('restart',function(old){if(!isSession2(this.session)||this.tutActive)return old.call(this);
    this.startCount++;this.newGame(this.session.dims,this.session.firstPlayer);
  });
  // 二维棋盘外观：底部「设置」打开的是同一个格线外观浮窗；setGridColor/Alpha
  // 原来只重画三维。这里补一次二维 setAppearance + render，拖动拉条时实时预览。
  const refreshGrid2D=function(g){if(!g.setupOpen&&isSession2(g.session)&&g.twoDMounted){ui().setAppearance({gridColor:g.gridColor,gridAlpha:g.gridAlpha,gridVisible:g.gridVisible,stoneFilter:g.stoneFilter});ui().render();}};
  wrap('setGridColor',function(old,hex,save){const r=old.call(this,hex,save);refreshGrid2D(this);return r;});
  wrap('setGridAlphaPercent',function(old,pct,save){const r=old.call(this,pct,save);refreshGrid2D(this);return r;});
  wrap('isAiTurn',function(old){const s=this.session;if(isSession2(s))return !!(this.aiMode&&!this.tutActive&&['Playing','Setup'].includes(s.status)&&s.currentPlayer===this.aiColor);return old.call(this);});
  wrap('runAi',function(old){
    const s=this.session;if(!isSession2(s))return old.call(this);if(!this.isAiTurn())return;
    const action=ai2ChooseMove(s,{level:this.aiLevel,seed:(this.aiSeed+s.actionCount*2654435761+s.setupHoles.length)>>>0});
    if(action.kind==='place')s.place(action.x,action.y,action.layer);
    else if(action.kind==='placeHole')s.placeHole(action.x,action.y);
    else if(action.kind==='swap')s.swapLines(action.axis,action.i,action.j);
    this.aiThinking=false;this.refreshTexts();
  });
  wrap('recomputeClockTotals',function(old){old.call(this);if(isSession2(this.session))for(const a of this.session.swaps){if(a.player===BLACK)this.clockBlack+=Math.max(0,a.dt|0);else this.clockWhite+=Math.max(0,a.dt|0);}});
  wrap('tutorialPlan',function(old){return this.twoD?ui().tutorial.plan(this.setupVariant2):old.call(this);});
  wrap('tutorialLevels',function(old){return this.twoD?ui().tutorial.levels().map((l,i)=>({build:()=>ui().tutorial.build(i),goal:s=>ui().tutorial.goal(i,s)})):old.call(this);});
  wrap('tutorialBuild',function(old,i){if(!this.twoD)return old.call(this,i);this.cancelTutTimer();this.cancelAiTimer();this.aiMode=false;this.tutIndex=i;this.tutPassed=false;this.adoptSession(ui().tutorial.build(i));this.syncTutorialUi();this.refreshTexts();this.syncTwoDScene();});
  wrap('tutorialText',function(old,i,key){if(!this.twoD)return old.call(this,i,key);const l=ui().tutorial.levels()[i];return typeof l[key]==='function'?l[key](LANG):l[key];});
  wrap('syncTutorialUi',function(old){old.call(this);if(this.el&&this.el.stage)this.el.stage.classList.toggle('twoDTutorial',isSession2(this.session)&&this.tutActive&&!this.setupOpen);});
  wrap('buildRecord',function(old){
    const rec=old.call(this),s=this.session;if(!isSession2(s))return rec;
    const timed=rec.timed===1;
    Object.assign(rec,{v:3,m:2,d:s.dims.slice(),cfg2:JSON.parse(JSON.stringify(s.variant2)),ih:s.initialHoles.map(p=>[p.x,p.y]),sh:s.setupHoles.map(p=>[p.x,p.y,p.player]),fp:fingerprint2(s),r:s.swaps.length});
    rec.mv=s.history.map(m=>[m.x,m.y,m.player,m.layer==='base'?0:1,m.action,timed?m.el|0:0,timed?m.dt|0:0]);
    rec.sw=s.swaps.map(m=>[m.axis==='col'||m.orient===1?1:0,m.i,m.j,m.placementsBefore,m.player,timed?m.el|0:0,timed?m.dt|0:0,m.action]);
    delete rec.rt;return rec;
  });
  wrap('isReplayableRecord',function(old,r){if(r&&r.m===2)return r.v===3&&Array.isArray(r.d)&&r.d.length===2&&Array.isArray(r.mv)&&Array.isArray(r.sw)&&Array.isArray(r.ih)&&Array.isArray(r.sh)&&r.mv.length===r.n&&r.sw.length===r.r&&!!r.cfg2;return old.call(this,r);});
  wrap('recordSizeText',function(old,r){return r&&r.m===2?r.d.join('×'):old.call(this,r);});
  wrap('recordRowText',function(old,r){if(!r||r.m!==2)return old.call(this,r);const text=old.call(this,Object.assign({},r,{m:3,r:0,o:0})).split(' · ');text[1]='2D '+this.recordSizeText(r)+' · '+ui().modeName(r.cfg2,LANG);if(r.r)text.push(d2Text('swap')+' '+r.r);return text.join(' · ');});
  wrap('recordActionRows',function(old,r){if(!r||r.m!==2)return old.call(this,r);return r.mv.map((m,i)=>({type:'m2',m,n:i+1,action:m[4]})).concat(r.sw.map(s=>({type:'s2',r:s,action:s[7]}))).sort((a,b)=>a.action-b.action);});
  wrap('recordTimedActions',function(old,r){if(!r||r.m!==2)return old.call(this,r);return this.recordActionRows(r).map(a=>({act:a,dt:Math.max(0,(a.m||a.r)[6]|0)}));});
  wrap('recordTimeStats',function(old,r){if(!r||r.m!==2)return old.call(this,r);let black=0,white=0;for(const v of this.recordTimedActions(r)){const p=v.act.m?v.act.m[2]:v.act.r[4];if(p===1)black+=v.dt;else white+=v.dt;}return {black,white,total:Math.max(0,r.dur|0)};});
  wrap('renderMoveListInto',function(old,box,rid){
    const r=this.histCache&&this.histCache[rid];if(!r||r.m!==2)return old.call(this,box,rid);
    box.innerHTML=this.recordTimedActions(r).map(({act:a,dt})=>{
      const player=a.m?a.m[2]:a.r[4];const text=a.m?'('+a.m[0]+','+a.m[1]+') · '+d2Text(a.m[3]===0?'base':'top'):d2Text('swap')+' '+(a.r[0]?'↔':'↕')+' '+a.r[1]+' / '+a.r[2];
      return '<div class="histMove">'+(r.timed?'<span class="histTime">'+this.fmtMoveMs(dt)+'</span>':'')+'<span class="histDot '+(player===1?'black':'white')+'"></span>'+escapeHtml(text)+'</div>';
    }).join('');
  });
  Game.replay2DRecord = function(r,limit,verify) {
    try {
      if(!this.isReplayableRecord(r)||r.mv.length+r.sw.length>50000)return null;
      const v=JSON.parse(JSON.stringify(r.cfg2));v.holes.layout=r.ih.map(p=>({x:p[0],y:p[1]}));
      const s=Session2D.create(r.d[0],r.d[1],r.f,new RuleSet(),v);
      for(const [x,y,player] of r.sh){if(s.currentPlayer!==player||s.placeHole(x,y).status===MoveStatus.Rejected)return null;}
      const acts=this.recordActionRows(r),end=limit===undefined?acts.length:Math.min(acts.length,limit);
      for(let i=0;i<end;i++){
        const a=acts[i],p=a.m?a.m[2]:a.r[4];if(s.currentPlayer!==p||a.action!==i+1)return null;
        const out=a.m?s.place(a.m[0],a.m[1],a.m[3]===0?'base':'top'):s.swapLines(a.r[0],a.r[1],a.r[2]);
        if(out.status===MoveStatus.Rejected)return null;
      }
      if(verify&&end===acts.length){
        if(s.status!=='Decided'&&(r.rs||r.to||r.er)){
          if(r.w)s.concede(opponentOf(r.w));else {s.status='Decided';s.winner=0;s.isDraw=true;}
        }
        if(fingerprint2(s)!==r.fp)return null;
      }
      return s;
    }catch(e){return null;}
  };
  wrap('replayRecord',function(old,r){return r&&r.m===2?this.replay2DRecord(r,undefined,true):old.call(this,r);});
  wrap('renderHistory',function(old){old.call(this);if(!this.el.historyBody.querySelectorAll)return;for(const detail of this.el.historyBody.querySelectorAll('details[data-id]')){const r=this.histCache[detail.getAttribute('data-id')];if(r&&r.m===2){const bar=detail.querySelector('.histActions');let html='<button class="mini" data-replay2="'+escapeHtml(r.id)+'">'+escapeHtml(d2Text('replay'))+'</button>';html+='<button type="button" class="mini" data-export="long" data-id="'+escapeHtml(r.id)+'">'+escapeHtml(say(()=>"导出长图","rec.exportLong"))+'</button>';if(this.isAiWinRecord(r))html+='<button type="button" class="mini" data-export="poster" data-id="'+escapeHtml(r.id)+'">'+escapeHtml(say(()=>"纪念海报","rec.exportPoster"))+'</button>';bar.innerHTML=html;}}});
  // 二维导出：用专门的双盘渲染器，而不是三维 WebGL 取图。
  wrap('captureBoardCanvas',function(old,session){if(isSession2(session))return capture2DBoard(session,this);return old.call(this,session);});
  wrap('syncBannerExports',function(old){old.call(this);});
  Game.openTwoDReplay=function(id){const r=this.histCache&&this.histCache[id];if(!r||!this.replayRecord(r)){this.toast(d2Text('badRecord'),false);return;}this.twoDReplayRecord=r;this.replayViewing=true;const input=byId('twoDReplayRange');input.max=r.n+r.r;input.value=input.max;byId('twoDReplay').classList.remove('off');this.renderTwoDReplay();};
  Game.renderTwoDReplay=function(){
    const r=this.twoDReplayRecord;if(!r)return;const n=Number(byId('twoDReplayRange').value),s=this.replay2DRecord(r,n,false);if(!s)return;
    byId('twoDReplayStep').textContent=n+' / '+(r.n+r.r);const canvas=byId('twoDReplayCanvas');const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle=Palette.hex('--panel');ctx.fillRect(0,0,rect.width,rect.height);
    const boards=s.variant2.float.on?2:1,vertical=rect.width<rect.height,cw=rect.width/(vertical?1:boards),ch=rect.height/(vertical?boards:1);
    for(let b=0;b<boards;b++){const ox=vertical?0:b*cw,oy=vertical?b*ch:0,cell=Math.min((cw-44)/(s.dims[0]-1),(ch-54)/(s.dims[1]-1)),x0=ox+(cw-cell*(s.dims[0]-1))/2,y0=oy+30+(ch-40-cell*(s.dims[1]-1))/2;ctx.fillStyle=Palette.hex('--text');ctx.textAlign='center';ctx.font='13px sans-serif';ctx.fillText(boards===2?d2Text(b?'top':'base'):ui().modeName(s.variant2,LANG),ox+cw/2,oy+18);ctx.strokeStyle='#998b73';ctx.lineWidth=.7;
      for(let x=0;x<s.dims[0];x++){ctx.beginPath();ctx.moveTo(x0+x*cell,y0);ctx.lineTo(x0+x*cell,y0+(s.dims[1]-1)*cell);ctx.stroke();}
      for(let y=0;y<s.dims[1];y++){ctx.beginPath();ctx.moveTo(x0,y0+y*cell);ctx.lineTo(x0+(s.dims[0]-1)*cell,y0+y*cell);ctx.stroke();}
      for(let k=0;k<s.top.length;k++){const x=x0+(k%s.dims[0])*cell,y=y0+Math.floor(k/s.dims[0])*cell,t=boards===2&&b===0?(s.base[k]?4:0):s.top[k];if(!t&&!s.hole[k])continue;ctx.fillStyle=s.hole[k]?'#132e3b':t===1?'#1c1a16':t===2?'#fdfaf2':t===3?'#a3a09a':'#a69b85';ctx.beginPath();ctx.arc(x,y,cell*.34,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#4a4034';ctx.stroke();if(s.hole[k]){ctx.strokeStyle='#5d9aaa';ctx.beginPath();ctx.arc(x,y,cell*.41,0,Math.PI*2);ctx.stroke();}}
    }
  };
})();
