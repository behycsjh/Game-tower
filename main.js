import {
  LEVELS, TOWER_TYPES, TOWER_DESC, DIFFICULTY, MAX_PICKS,
  COLS, ROWS, MAX_STARS,
  save, persist, totalStars, totalScore,
  SAVE_KEY, INITIAL_UNLOCKED
} from './config.js';

import * as Eng from './engine.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game-canvas');
const toastWrap = $('toast-wrap');
const menuScreen = $('menu-screen');
const levelsScreen = $('levels-screen');
const loadoutScreen = $('loadout-screen');
const endScreen = $('end-screen');
const gameHud = $('game-hud');

let currentDifficulty = 'normal';
let currentPicks = ['cannon','frost','laser','mortar'];
let pendingLevel = 0;

function showScreen(s) {
  menuScreen.classList.toggle('hidden', s !== 'menu');
  levelsScreen.classList.toggle('hidden', s !== 'levels');
  loadoutScreen.classList.toggle('hidden', s !== 'loadout');
  endScreen.classList.toggle('hidden', s !== 'end');
  gameHud.classList.toggle('active', s === 'game');
}

function toast(text, type, duration) {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = text;
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, duration || 1500);
  while (toastWrap.children.length > 3) toastWrap.removeChild(toastWrap.firstChild);
}

function updateMenuProgress() {
  $('menu-stars').textContent = totalStars()+'/'+MAX_STARS;
  $('menu-score').textContent = totalScore();
  $('menu-unlocked').textContent = save.unlocked+'/'+LEVELS.length;
  $('hdr-stars').textContent = totalStars()+'/'+MAX_STARS;
  $('hdr-score').textContent = totalScore();
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const r = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (r) r.call(el).catch(()=>{});
  } else {
    const r = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (r) r.call(document).catch(()=>{});
  }
}

let lastBtnText = '', lastBtnDisabled = null, lastInfoText = '';
function applyWaveInfo({ btnText, btnDisabled, infoText }) {
  const btn = $('btn-start-wave');
  const info = $('wave-info');
  if (btnText !== lastBtnText) { btn.textContent = btnText; lastBtnText = btnText; }
  if (btnDisabled !== lastBtnDisabled) { btn.disabled = btnDisabled; lastBtnDisabled = btnDisabled; }
  if (infoText !== lastInfoText) { info.textContent = infoText; lastInfoText = infoText; }
}

function applyHUD({ money, lives, wave, score, totalWaves }) {
  $('money-val').textContent = money;
  $('lives-val').textContent = lives;
  $('wave-val').textContent = wave+'/'+totalWaves;
  $('score-val').textContent = score;
  refreshTowerList();
}

let lastPicksKey = '';
function refreshTowerList() {
  const list = $('tower-list');
  const picks = Eng.getCurrentPicks();
  const key = picks.join(',');
  if (key !== lastPicksKey) {
    list.innerHTML = '';
    for (const k of picks) {
      const t = TOWER_TYPES[k];
      const item = document.createElement('div');
      item.className = 'tower-item';
      item.dataset.type = k;
      item.style.borderLeftColor = t.color;
      item.style.borderTopColor = t.color;
      item.innerHTML = '<div><div class="tower-name">'+t.name+'</div><div class="tower-cost">'+t.cost+'💰</div></div>';
      item.addEventListener('click', () => Eng.setSelectedTowerType(k));
      list.appendChild(item);
    }
    lastPicksKey = key;
  }
  const state = Eng.getState();
  const selectedType = state.selectedTowerType;
  for (const item of list.children) {
    const k = item.dataset.type;
    item.classList.toggle('selected', selectedType === k);
    item.classList.toggle('disabled', state.money < TOWER_TYPES[k].cost);
  }
}

function applyTowerInfo(tower) {
  const panel = $('tower-info-panel');
  if (!tower) {
    panel.classList.add('hidden');
    return;
  }
  const type = TOWER_TYPES[tower.typeKey];
  const stats = Eng.getTowerStatsFor(tower);
  const upCost = Eng.getUpgradeCost(tower);
  const sellVal = Eng.getSellValue(tower);
  panel.classList.remove('hidden');
  $('ti-name').textContent = type.name;
  $('ti-level').textContent = 'Ур.' + tower.level;
  let h = '';
  h += '<div class="ti-stat"><span>Урон</span><span class="v">'+stats.damage.toFixed(0)+'</span></div>';
  h += '<div class="ti-stat"><span>Радиус</span><span class="v">'+stats.range.toFixed(1)+'</span></div>';
  h += '<div class="ti-stat"><span>Скорость</span><span class="v">'+(1/stats.fireRate).toFixed(1)+'/с</span></div>';
  h += '<div class="ti-stat"><span>DPS</span><span class="v">'+(stats.damage/stats.fireRate).toFixed(0)+'</span></div>';
  if (stats.aoeRadius) h += '<div class="ti-stat"><span>AoE</span><span class="v">'+stats.aoeRadius.toFixed(1)+'</span></div>';
  if (stats.slowDuration) h += '<div class="ti-stat"><span>Замедл</span><span class="v">'+stats.slowDuration.toFixed(1)+'с</span></div>';
  if (stats.poisonDPS) h += '<div class="ti-stat"><span>Яд</span><span class="v">'+stats.poisonDPS+'/с</span></div>';
  $('ti-stats').innerHTML = h;
  const upBtn = $('btn-upgrade');
  if (tower.level >= 5) { upBtn.textContent = 'МАКС'; upBtn.disabled = true; }
  else {
    upBtn.textContent = 'УЛУЧШИТЬ '+upCost+'💰';
    upBtn.disabled = Eng.getState().money < upCost;
  }
  $('btn-sell').textContent = 'ПРОДАТЬ '+sellVal+'💰';
}

function showEndScreen(data) {
  const titleEl = $('end-title');
  titleEl.textContent = data.won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  titleEl.className = data.won ? 'win' : 'lose';
  const starsEl = $('end-stars');
  let sh = '';
  for (let i=1;i<=3;i++) sh += '<span class="'+(i<=data.stars?'s-on':'s-off')+'">★</span>';
  starsEl.innerHTML = data.won ? sh : '';
  $('end-sub').textContent = data.won
    ? ('Уровень '+(data.levelIdx+1)+': '+data.levelName)
    : 'База пала';
  $('end-stats').innerHTML =
    'Волн: <span>'+data.wave+'</span> / '+data.totalWaves+'<br>' +
    'Очки: <span>'+data.score+'</span>' +
      (data.best > data.score ? ' (рекорд '+data.best+')' : '') + '<br>' +
    'Жизней осталось: <span>'+data.lives+'</span>';
  const nextBtn = $('btn-end-next');
  if (data.hasNext) {
    nextBtn.hidden = false;
    nextBtn.textContent = 'УРОВЕНЬ '+(data.levelIdx+2)+': '+LEVELS[data.levelIdx+1].n;
  } else nextBtn.hidden = true;
  showScreen('end');
  updateMenuProgress();
}

function drawLevelPreview(canvasEl, lvl, unlocked) {
  const pc = canvasEl.getContext('2d');
  const pw = canvasEl.width, ph = canvasEl.height;
  pc.fillStyle = '#0d1420';
  pc.fillRect(0, 0, pw, ph);
  const sx = pw/COLS, sy = ph/ROWS;
  pc.strokeStyle = 'rgba(100,140,220,0.08)';
  pc.lineWidth = 0.5;
  for (let x=0;x<=COLS;x++){pc.beginPath();pc.moveTo(x*sx,0);pc.lineTo(x*sx,ph);pc.stroke();}
  for (let y=0;y<=ROWS;y++){pc.beginPath();pc.moveTo(0,y*sy);pc.lineTo(pw,y*sy);pc.stroke();}
  pc.strokeStyle = unlocked ? '#fbbf24' : '#4a5165';
  pc.lineWidth = Math.max(2, sx*0.55);
  pc.lineJoin = 'round';
  pc.lineCap = 'round';
  pc.beginPath();
  for (let k=0;k<lvl.p.length;k++) {
    const pt = lvl.p[k];
    const px = pt[0]*sx + sx/2;
    const py = pt[1]*sy + sy/2;
    if (k===0) pc.moveTo(px, py); else pc.lineTo(px, py);
  }
  pc.stroke();
  const s0 = lvl.p[0];
  const e0 = lvl.p[lvl.p.length-1];
  pc.fillStyle = '#ef4444';
  pc.beginPath(); pc.arc(s0[0]*sx+sx/2, s0[1]*sy+sy/2, 3, 0, Math.PI*2); pc.fill();
  pc.fillStyle = '#22c55e';
  pc.beginPath(); pc.arc(e0[0]*sx+sx/2, e0[1]*sy+sy/2, 4, 0, Math.PI*2); pc.fill();
}

function buildLevelCards() {
  const grid = $('levels-grid');
  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (let i=0;i<LEVELS.length;i++) {
    const lvl = LEVELS[i];
    const unlocked = i < save.unlocked;
    const completed = (save.stars[i]||0) > 0;
    const card = document.createElement('div');
    card.className = 'level-card';
    if (!unlocked) card.classList.add('locked');
    else if (completed) card.classList.add('completed');
    else card.classList.add('available');
    card.style.animationDelay = Math.min(i*15, 400) + 'ms';
    const stars = save.stars[i]||0;
    let sh = '';
    for (let s=1;s<=3;s++) sh += '<span class="'+(s<=stars?'s-on':'s-off')+'">★</span>';
    const best = save.best[i]||0;
    card.innerHTML =
      '<div class="level-num">#'+(i+1)+'</div>' +
      '<div class="level-preview"><canvas width="120" height="72"></canvas></div>' +
      '<div class="level-name">'+lvl.n+'</div>' +
      '<div class="level-desc">'+lvl.d+'</div>' +
      '<div class="level-meta"><span class="level-stars">'+sh+'</span><span>'+lvl.w+' волн</span></div>' +
      (best>0 ? '<div class="level-best">🏆 '+best+'</div>' : '') +
      '<div class="level-lock-icon">🔒</div>';
    const pv = card.querySelector('canvas');
    drawLevelPreview(pv, lvl, unlocked);
    if (unlocked) {
      card.addEventListener('click', () => {
        Eng.initAudio();
        openLoadout(i);
      });
    }
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
}

function buildLoadoutTowerCards() {
  const grid = $('tower-select-grid');
  grid.innerHTML = '';
  for (const key of Object.keys(TOWER_TYPES)) {
    const t = TOWER_TYPES[key];
    const picked = currentPicks.indexOf(key) !== -1;
    const card = document.createElement('div');
    card.className = 'tower-select-card' + (picked ? ' picked' : '');
    card.style.borderLeftColor = t.color;
    card.dataset.key = key;
    card.innerHTML =
      '<div class="ts-check">+</div>' +
      '<div class="ts-name">'+t.name+'</div>' +
      '<div class="ts-cost">Цена: '+t.cost+'💰</div>' +
      '<div class="ts-desc">'+TOWER_DESC[key]+'</div>';
    card.addEventListener('click', () => {
      const i = currentPicks.indexOf(key);
      if (i !== -1) {
        if (currentPicks.length <= 1) { toast('Минимум 1 башня','error'); return; }
        currentPicks.splice(i, 1);
      } else {
        if (currentPicks.length >= MAX_PICKS) { toast('Максимум '+MAX_PICKS+' башен','error'); return; }
        currentPicks.push(key);
      }
      buildLoadoutTowerCards();
    });
    grid.appendChild(card);
  }
  $('pick-counter').textContent = currentPicks.length + '/' + MAX_PICKS;
}

function openLoadout(idx) {
  pendingLevel = idx;
  $('loadout-title').textContent = 'УРОВЕНЬ '+(idx+1)+': '+LEVELS[idx].n;
  $('loadout-diff').textContent = DIFFICULTY[currentDifficulty].name;
  document.querySelectorAll('.diff-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.diff === currentDifficulty);
  });
  buildLoadoutTowerCards();
  showScreen('loadout');
}

Eng.setCallbacks({
  hud: applyHUD,
  waveInfo: applyWaveInfo,
  towerInfo: applyTowerInfo,
  towerListUpdate: () => refreshTowerList(),
  gameEnd: showEndScreen,
  toast: ({ text, type, duration }) => toast(text, type, duration)
});

$('btn-start-wave').addEventListener('click', () => Eng.startWave());
$('btn-pause').addEventListener('click', () => {
  const paused = Eng.togglePause();
  $('btn-pause').textContent = paused ? '▶' : 'II';
});
$('btn-speed').addEventListener('click', () => {
  const sp = Eng.cycleSpeed();
  $('btn-speed').textContent = sp + 'x';
});
$('btn-upgrade').addEventListener('click', () => Eng.upgradeSelected());
$('btn-sell').addEventListener('click', () => Eng.sellSelected());
$('btn-close-ti').addEventListener('click', () => Eng.clearSelection());

$('btn-restart').addEventListener('click', () => {
  Eng.loadAndStart(Eng.getCurrentLevel(), currentDifficulty, currentPicks);
  $('btn-pause').textContent = 'II';
  $('btn-speed').textContent = '1x';
});

$('btn-exit').addEventListener('click', () => {
  Eng.stop();
  showScreen('menu');
  updateMenuProgress();
});

$('btn-play').addEventListener('click', () => {
  Eng.initAudio();
  buildLevelCards();
  showScreen('levels');
  updateMenuProgress();
});

$('btn-back').addEventListener('click', () => {
  showScreen('menu');
  updateMenuProgress();
});

$('btn-loadout-back').addEventListener('click', () => {
  buildLevelCards();
  showScreen('levels');
  updateMenuProgress();
});

$('btn-fullscreen-menu').addEventListener('click', toggleFullscreen);
$('btn-fullscreen-game').addEventListener('click', toggleFullscreen);

$('btn-reset').addEventListener('click', () => {
  if (confirm('Удалить весь прогресс?')) {
    try { localStorage.removeItem(SAVE_KEY); } catch(e){}
    save.unlocked = INITIAL_UNLOCKED;
    save.stars = {};
    save.best = {};
    updateMenuProgress();
    toast('Прогресс сброшен', 'success');
  }
});

$('btn-export').addEventListener('click', () => {
  try {
    const data = JSON.stringify(save, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tower-defense-save-'+Date.now()+'.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Файл сохранён', 'success');
  } catch(e) {
    toast('Ошибка экспорта', 'error');
  }
});

$('btn-import').addEventListener('click', () => $('import-input').click());

$('import-input').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (typeof data !== 'object' || data === null) throw new Error('bad');
      save.unlocked = Math.max(INITIAL_UNLOCKED, Math.min(LEVELS.length, data.unlocked || INITIAL_UNLOCKED));
      save.stars = data.stars || {};
      save.best = data.best || {};
      persist();
      updateMenuProgress();
      toast('Прогресс загружен', 'success');
    } catch(err) {
      toast('Ошибка файла', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentDifficulty = btn.dataset.diff;
    document.querySelectorAll('.diff-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.diff === currentDifficulty);
    });
    $('loadout-diff').textContent = DIFFICULTY[currentDifficulty].name;
  });
});

$('btn-loadout-start').addEventListener('click', () => {
  if (currentPicks.length === 0) { toast('Выберите башню', 'error'); return; }
  Eng.initAudio();
  Eng.loadAndStart(pendingLevel, currentDifficulty, currentPicks);
  $('btn-pause').textContent = 'II';
  $('btn-speed').textContent = '1x';
  showScreen('game');
});

$('btn-end-next').addEventListener('click', () => {
  Eng.initAudio();
  openLoadout(Eng.getCurrentLevel() + 1);
});

$('btn-end-retry').addEventListener('click', () => {
  Eng.initAudio();
  openLoadout(Eng.getCurrentLevel());
});

$('btn-end-menu').addEventListener('click', () => {
  showScreen('menu');
  updateMenuProgress();
});

document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

document.addEventListener('visibilitychange', () => {
  const st = Eng.getState();
  if (document.hidden && st.running && !st.paused) {
    st.paused = true;
    $('btn-pause').textContent = '▶';
  }
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => Eng.resize(), 100);
});
window.addEventListener('orientationchange', () => setTimeout(() => Eng.resize(), 200));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

Eng.init(canvas);
Eng.resize();
Eng.start();
showScreen('menu');
updateMenuProgress();