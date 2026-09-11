import {
  TILE, COLS, ROWS, BASE_LIVES, FIXED_DT, PARTICLE_POOL,
  LEVELS, TOWER_TYPES, ENEMY_TYPES, DIFFICULTY,
  save, persist
} from './config.js';

let canvas = null;
let ctx = null;
let viewW = 0, viewH = 0, scale = 1, offsetX = 0, offsetY = 0, dpr = 1;
let mapCache = null;
let callbacks = {};
let audioCtx = null;

let currentLevel = 0;
let currentDifficulty = 'normal';
let currentPicks = ['cannon','frost','laser','mortar'];
let PATH = [], PATH_PX = [], PATH_CELLS = new Set();

const state = {
  money:200, lives:BASE_LIVES, wave:0, score:0,
  paused:false, speed:1, gameOver:false, running:false, ended:false,
  waveActive:false, waveSpawnQueue:[], waveSpawnTimer:0,
  selectedTowerType:null, selectedTower:null,
  hoverCell:{x:-1,y:-1}, totalWaves:10, hpMult:1.0
};

const towers = [];
const enemies = [];
const projectiles = [];
const floatingTexts = [];
const particlePool = [];
let particleIdx = 0;

for (let i=0;i<PARTICLE_POOL;i++) {
  particlePool.push({active:false,x:0,y:0,vx:0,vy:0,life:0,maxLife:0,color:'',size:0});
}

let lastTime = 0, uiTimer = 0;

function getParticle() {
  for (let i=0;i<PARTICLE_POOL;i++) {
    const p = particlePool[(particleIdx+i)%PARTICLE_POOL];
    if (!p.active) { particleIdx = (particleIdx+i+1)%PARTICLE_POOL; p.active=true; return p; }
  }
  const p = particlePool[particleIdx];
  particleIdx = (particleIdx+1)%PARTICLE_POOL;
  return p;
}

function emit(name, payload) {
  const fn = callbacks[name];
  if (fn) fn(payload);
}

export function setCallbacks(cb) { callbacks = cb; }

export function init(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d', { alpha:false });
  attachPointerEvents();
}

export function resize() {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio||1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = viewW*dpr;
  canvas.height = viewH*dpr;
  canvas.style.width = viewW+'px';
  canvas.style.height = viewH+'px';
  const mapW = COLS*TILE, mapH = ROWS*TILE;
  const isMobile = viewW < 640;
  const topH = isMobile ? 60 : 65;
  const botH = isMobile ? 130 : 130;
  const availH = viewH - topH - botH;
  const availW = viewW - (isMobile ? 16 : 180);
  const sw = availW/mapW, sh = availH/mapH;
  scale = Math.max(0.4, Math.min(sw, sh, 1.6));
  const scaledW = mapW*scale, scaledH = mapH*scale;
  offsetX = isMobile ? (viewW-scaledW)/2 : ((viewW-180)-scaledW)/2;
  offsetY = topH + (availH-scaledH)/2;
}

function screenToCell(sx, sy) {
  return { x: Math.floor(((sx-offsetX)/scale)/TILE), y: Math.floor(((sy-offsetY)/scale)/TILE) };
}

function rebuildMapCache() {
  if (!mapCache) mapCache = document.createElement('canvas');
  mapCache.width = COLS*TILE;
  mapCache.height = ROWS*TILE;
  const mc = mapCache.getContext('2d');
  for (let y=0;y<ROWS;y++) {
    for (let x=0;x<COLS;x++) {
      const px=x*TILE, py=y*TILE;
      if (PATH_CELLS.has(x+','+y)) {
        mc.fillStyle='#3b3524';
        mc.fillRect(px,py,TILE,TILE);
        mc.fillStyle='rgba(95,85,55,.55)';
        mc.fillRect(px+3,py+3,TILE-6,TILE-6);
      } else {
        mc.fillStyle=((x+y)%2===0)?'#1a2a1a':'#1f3020';
        mc.fillRect(px,py,TILE,TILE);
      }
    }
  }
  mc.strokeStyle='rgba(100,140,220,.08)';
  mc.lineWidth=1;
  for (let x=0;x<=COLS;x++){mc.beginPath();mc.moveTo(x*TILE,0);mc.lineTo(x*TILE,ROWS*TILE);mc.stroke();}
  for (let y=0;y<=ROWS;y++){mc.beginPath();mc.moveTo(0,y*TILE);mc.lineTo(COLS*TILE,y*TILE);mc.stroke();}
  const s=PATH_PX[0], e=PATH_PX[PATH_PX.length-1];
  mc.fillStyle='rgba(239,68,68,.45)';
  mc.beginPath(); mc.arc(s.x,s.y,TILE*.4,0,Math.PI*2); mc.fill();
  mc.fillStyle='rgba(34,197,94,.45)';
  mc.beginPath(); mc.arc(e.x,e.y,TILE*.55,0,Math.PI*2); mc.fill();
}

function loadLevel(idx) {
  currentLevel = idx;
  const lvl = LEVELS[idx];
  PATH = lvl.p.map(pt=>({x:pt[0],y:pt[1]}));
  PATH_PX = PATH.map(p=>({x:p.x*TILE+TILE/2,y:p.y*TILE+TILE/2}));
  PATH_CELLS = new Set();
  for (let i=0;i<PATH.length-1;i++) {
    const a=PATH[i], b=PATH[i+1];
    const dx=Math.sign(b.x-a.x), dy=Math.sign(b.y-a.y);
    let x=a.x, y=a.y;
    PATH_CELLS.add(x+','+y);
    while (x!==b.x || y!==b.y) { x+=dx; y+=dy; PATH_CELLS.add(x+','+y); }
  }
  const diff = DIFFICULTY[currentDifficulty];
  state.totalWaves = lvl.w;
  state.hpMult = lvl.hp * diff.hpMult;
  state.money = Math.round(lvl.mx * diff.moneyMult);
  state.lives = BASE_LIVES + diff.livesBonus;
  rebuildMapCache();
}

function generateWave(n) {
  const groups = [];
  const baseCount = 5 + Math.floor(n*1.4);
  if (n%10===0) {
    groups.push({type:'boss',count:1,delay:0.3,gap:1.5});
    groups.push({type:'tank',count:2+Math.floor(n/5),delay:3,gap:0.8});
    groups.push({type:'basic',count:baseCount,delay:2,gap:0.4});
  } else if (n%5===0) {
    groups.push({type:'tank',count:2+Math.floor(n/4),delay:0,gap:0.7});
    groups.push({type:'runner',count:baseCount,delay:1,gap:0.3});
    groups.push({type:'basic',count:baseCount,delay:2,gap:0.35});
  } else {
    groups.push({type:'basic',count:baseCount,delay:0,gap:0.4});
    if (n>=3) groups.push({type:'runner',count:3+Math.floor(n/3),delay:2,gap:0.3});
    if (n>=6) groups.push({type:'tank',count:1+Math.floor(n/6),delay:4,gap:0.8});
  }
  const hpMult = (1+(n-1)*0.12) * state.hpMult;
  return { groups, hpMult };
}

function canBuildAt(cx, cy) {
  if (cx<0||cx>=COLS||cy<0||cy>=ROWS) return false;
  if (PATH_CELLS.has(cx+','+cy)) return false;
  for (let i=0;i<towers.length;i++) if (towers[i].cx===cx && towers[i].cy===cy) return false;
  return true;
}

function createTower(cx, cy, key) {
  const type = TOWER_TYPES[key];
  if (!type || currentPicks.indexOf(key)===-1) return false;
  if (state.money < type.cost) { emit('toast',{text:'Мало денег',type:'error'}); return false; }
  if (!canBuildAt(cx,cy)) { emit('toast',{text:'Здесь нельзя',type:'error'}); return false; }
  state.money -= type.cost;
  towers.push({
    typeKey:key, cx, cy, x:cx*TILE+TILE/2, y:cy*TILE+TILE/2,
    level:1, cooldown:0, totalCost:type.cost, angle:-Math.PI/2, recoil:0,
    target:null, _statsCache:null, _statsCacheLvl:0
  });
  refreshHUD();
  playSound('build');
  return true;
}

function getTowerStats(t) {
  if (t._statsCacheLvl === t.level && t._statsCache) return t._statsCache;
  const type = TOWER_TYPES[t.typeKey];
  const lv = t.level - 1;
  const up = type.upgrades || {};
  const range = (type.range||0)+(up.range||0)*lv;
  const stats = {
    damage:(type.damage||0)+(up.damage||0)*lv,
    range,
    rangePx: range*TILE,
    fireRate: Math.max(0.05,(type.fireRate||1)+(up.fireRate||0)*lv),
    aoeRadius:(type.aoeRadius||0)+(up.aoeRadius||0)*lv,
    slowDuration:(type.slowDuration||0)+(up.slowDuration||0)*lv,
    poisonDPS:(type.poisonDPS||0)+(up.poisonDPS||0)*lv,
    poisonDuration:(type.poisonDuration||0)+(up.poisonDuration||0)*lv
  };
  t._statsCache = stats;
  t._statsCacheLvl = t.level;
  return stats;
}

export function getUpgradeCost(t) {
  return Math.round(TOWER_TYPES[t.typeKey].cost*0.7*Math.pow(1.55,t.level-1));
}
export function getSellValue(t) {
  return Math.round(t.totalCost*0.65);
}
export function getTowerStatsFor(t) { return getTowerStats(t); }

export function upgradeTower(t) {
  if (!t || t.level>=5) return;
  const cost = getUpgradeCost(t);
  if (state.money<cost) { emit('toast',{text:'Мало денег',type:'error'}); return; }
  state.money -= cost;
  t.totalCost += cost;
  t.level++;
  t._statsCacheLvl = 0;
  playSound('upgrade');
  spawnParticles(t.x, t.y, '#60a5fa', 10);
  refreshHUD();
  refreshTowerInfo();
}

export function sellTower(t) {
  if (!t) return;
  state.money += getSellValue(t);
  const i = towers.indexOf(t);
  if (i>=0) towers.splice(i,1);
  for (let k=0;k<enemies.length;k++) if (enemies[k]._targetTower===t) enemies[k]._targetTower = null;
  for (let k=0;k<projectiles.length;k++) if (projectiles[k].target===t) projectiles[k].target = null;
  spawnParticles(t.x, t.y, '#fbbf24', 8);
  state.selectedTower = null;
  emit('towerInfo', null);
  refreshHUD();
  playSound('sell');
}

function towerFire(t) {
  const stats = getTowerStats(t);
  const type = TOWER_TYPES[t.typeKey];
  const tgt = t.target;
  if (!tgt || !tgt.alive) return;
  const dx = tgt.x-t.x, dy = tgt.y-t.y;
  t.angle = Math.atan2(dy,dx);
  t.recoil = 1;
  if (type.instant) {
    damageEnemy(tgt, stats.damage);
    projectiles.push({ beam:true, x1:t.x, y1:t.y, x2:tgt.x, y2:tgt.y, life:0.08, maxLife:0.08, color:type.beamColor||'#fff' });
    playSound('laser');
  } else {
    projectiles.push({
      x:t.x, y:t.y, target:tgt, speed:type.projectileSpeed,
      damage:stats.damage, aoeRadius:stats.aoeRadius||0,
      slowFactor:type.slowFactor||0, slowDuration:stats.slowDuration,
      poisonDPS:stats.poisonDPS, poisonDuration:stats.poisonDuration,
      color:type.projectileColor, trail:[]
    });
    playSound(t.typeKey==='mortar'?'mortar':(t.typeKey==='frost'?'frost':'shoot'));
  }
}

function damageEnemy(e, dmg) {
  if (!e || !e.alive) return;
  const actual = Math.max(1, dmg-(e.armor||0));
  e.hp -= actual;
  e.hitFlash = 0.15;
  if (e.hp<=0) {
    e.alive = false;
    state.money += e.reward;
    state.score += e.reward*2;
    floatingTexts.push({x:e.x,y:e.y,text:'+'+e.reward,color:'#fbbf24',life:0.9,maxLife:0.9});
    spawnParticles(e.x,e.y,e.color,10);
    refreshHUD();
    playSound('kill');
  }
}

function spawnEnemy(key, hpMult) {
  const type = ENEMY_TYPES[key];
  if (!type) return;
  const start = PATH_PX[0];
  const dx = (Math.random()-0.5)*8, dy = (Math.random()-0.5)*8;
  enemies.push({
    typeKey:key, x:start.x+dx, y:start.y+dy,
    hp:type.hp*hpMult, maxHp:type.hp*hpMult, speed:type.speed,
    reward:Math.round(type.reward*(1+(hpMult-1)*0.3)),
    color:type.color, size:type.size, armor:type.armor||0,
    alive:true, waypointIdx:1, hitFlash:0, slowTimer:0, slowFactor:1,
    poisonTimer:0, poisonDPS:0, angle:0
  });
}

function updateEnemies(dt) {
  for (let i=enemies.length-1;i>=0;i--) {
    const e = enemies[i];
    if (!e.alive) { enemies.splice(i,1); continue; }
    if (e.slowTimer>0) { e.slowTimer-=dt; if (e.slowTimer<=0) e.slowFactor=1; }
    if (e.poisonTimer>0) {
      e.poisonTimer -= dt;
      e.hp -= e.poisonDPS*dt;
      if (e.hp<=0) {
        e.alive=false;
        state.money+=e.reward;
        state.score+=e.reward*2;
        floatingTexts.push({x:e.x,y:e.y,text:'+'+e.reward,color:'#84cc16',life:0.9,maxLife:0.9});
        spawnParticles(e.x,e.y,'#84cc16',8);
        refreshHUD();
        continue;
      }
    }
    const tgt = PATH_PX[e.waypointIdx];
    if (!tgt) {
      state.lives--;
      e.alive=false;
      enemies.splice(i,1);
      playSound('lose_life');
      spawnParticles(e.x,e.y,'#ef4444',14);
      refreshHUD();
      if (state.lives<=0) endGame(false);
      continue;
    }
    const dx=tgt.x-e.x, dy=tgt.y-e.y;
    const dist = Math.sqrt(dx*dx+dy*dy);
    const sp = e.speed*e.slowFactor;
    const step = sp*dt;
    if (dist < step+2) { e.x=tgt.x; e.y=tgt.y; e.waypointIdx++; }
    else { e.x += dx/dist*step; e.y += dy/dist*step; e.angle = Math.atan2(dy,dx); }
    if (e.hitFlash>0) e.hitFlash -= dt;
  }
}

function updateProjectiles(dt) {
  for (let i=projectiles.length-1;i>=0;i--) {
    const p = projectiles[i];
    if (p.beam) { p.life-=dt; if (p.life<=0) projectiles.splice(i,1); continue; }
    const tgt = p.target;
    if (!tgt || !tgt.alive) { projectiles.splice(i,1); continue; }
    const dx=tgt.x-p.x, dy=tgt.y-p.y;
    const dist = Math.sqrt(dx*dx+dy*dy);
    const step = p.speed*dt;
    if (!p.trail) p.trail = [];
    p.trail.push(p.x, p.y);
    if (p.trail.length > 12) p.trail.splice(0,2);
    if (dist < step+4) {
      p.x=tgt.x; p.y=tgt.y;
      if (p.aoeRadius>0) {
        const r = p.aoeRadius*TILE;
        for (let k=0;k<enemies.length;k++) {
          const e = enemies[k];
          if (!e.alive) continue;
          const ddx=e.x-p.x, ddy=e.y-p.y;
          if (ddx*ddx+ddy*ddy <= r*r) {
            damageEnemy(e, p.damage);
            if (p.slowFactor>0) { e.slowFactor=Math.min(e.slowFactor,p.slowFactor); e.slowTimer=Math.max(e.slowTimer,p.slowDuration); }
            if (p.poisonDPS>0) { e.poisonDPS=Math.max(e.poisonDPS,p.poisonDPS); e.poisonTimer=Math.max(e.poisonTimer,p.poisonDuration); }
          }
        }
        spawnParticles(p.x,p.y,p.color,10);
      } else {
        damageEnemy(tgt, p.damage);
        if (p.slowFactor>0) { tgt.slowFactor=Math.min(tgt.slowFactor,p.slowFactor); tgt.slowTimer=Math.max(tgt.slowTimer,p.slowDuration); }
        if (p.poisonDPS>0) { tgt.poisonDPS=Math.max(tgt.poisonDPS,p.poisonDPS); tgt.poisonTimer=Math.max(tgt.poisonTimer,p.poisonDuration); }
        spawnParticles(p.x,p.y,p.color,4);
      }
      projectiles.splice(i,1);
      continue;
    }
    p.x += dx/dist*step;
    p.y += dy/dist*step;
  }
}

function spawnParticles(x,y,color,count) {
  for (let i=0;i<count;i++) {
    const p = getParticle();
    const a = Math.random()*Math.PI*2;
    const sp = 40+Math.random()*100;
    p.x=x; p.y=y;
    p.vx=Math.cos(a)*sp;
    p.vy=Math.sin(a)*sp;
    p.life = 0.35+Math.random()*0.35;
    p.maxLife = p.life;
    p.color = color;
    p.size = 1.5+Math.random()*2.5;
  }
}

function updateParticles(dt) {
  for (let i=0;i<PARTICLE_POOL;i++) {
    const p = particlePool[i];
    if (!p.active) continue;
    p.life -= dt;
    if (p.life<=0) { p.active=false; continue; }
    p.x += p.vx*dt;
    p.y += p.vy*dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
  }
  for (let i=floatingTexts.length-1;i>=0;i--) {
    const t = floatingTexts[i];
    t.life -= dt;
    if (t.life<=0) { floatingTexts.splice(i,1); continue; }
    t.y -= 30*dt;
  }
}

function findTarget(t) {
  const stats = getTowerStats(t);
  const r2 = stats.rangePx * stats.rangePx;
  let best = null, bestProgress = -Infinity;
  for (let i=0;i<enemies.length;i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const ddx = e.x-t.x, ddy = e.y-t.y;
    const d2 = ddx*ddx+ddy*ddy;
    if (d2 > r2) continue;
    const wp = PATH_PX[e.waypointIdx] || PATH_PX[PATH_PX.length-1];
    const rdx = wp.x-e.x, rdy = wp.y-e.y;
    const remaining = Math.sqrt(rdx*rdx+rdy*rdy);
    const progress = e.waypointIdx*1000 - remaining;
    if (progress > bestProgress) { bestProgress = progress; best = e; }
  }
  return best;
}

function updateTowers(dt) {
  for (let i=0;i<towers.length;i++) {
    const t = towers[i];
    const stats = getTowerStats(t);
    if (!t.target || !t.target.alive) {
      t.target = findTarget(t);
    } else {
      const ddx = t.target.x-t.x, ddy = t.target.y-t.y;
      if (ddx*ddx+ddy*ddy > stats.rangePx*stats.rangePx) t.target = findTarget(t);
    }
    t.cooldown -= dt;
    if (t.recoil>0) t.recoil -= dt*5;
    if (t.target && t.cooldown<=0) { towerFire(t); t.cooldown = stats.fireRate; }
  }
}

function drawMap() {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  if (mapCache) ctx.drawImage(mapCache, 0, 0);
  if (state.selectedTowerType && state.hoverCell.x>=0 && state.hoverCell.x<COLS && state.hoverCell.y>=0 && state.hoverCell.y<ROWS) {
    const c = state.hoverCell;
    const ok = canBuildAt(c.x, c.y);
    ctx.fillStyle = ok ? 'rgba(96,165,250,0.35)' : 'rgba(239,68,68,0.35)';
    ctx.fillRect(c.x*TILE, c.y*TILE, TILE, TILE);
    ctx.strokeStyle = ok ? '#60a5fa' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x*TILE+1, c.y*TILE+1, TILE-2, TILE-2);
  }
  ctx.restore();
}

function drawTowers() {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  for (let i=0;i<towers.length;i++) {
    const t = towers[i];
    const type = TOWER_TYPES[t.typeKey];
    const recoil = Math.max(0,t.recoil)*3;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(t.x, t.y+5, TILE*0.38, TILE*0.15, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.arc(t.x, t.y, TILE*0.42, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = type.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = type.color + '33';
    ctx.beginPath(); ctx.arc(t.x, t.y, TILE*0.32, 0, Math.PI*2); ctx.fill();
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle);
    ctx.translate(-recoil, 0);
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = type.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(0, -4, TILE*0.42, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = type.color;
    ctx.beginPath(); ctx.arc(TILE*0.42, 0, 4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    if (t.level>1) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath(); ctx.arc(t.x+TILE*0.32, t.y-TILE*0.32, TILE*0.14, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold '+(TILE*0.2)+'px Arial';
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.fillText(t.level, t.x+TILE*0.32, t.y-TILE*0.32);
    }
    if (state.selectedTower === t) {
      const stats = getTowerStats(t);
      ctx.strokeStyle = type.color + '90';
      ctx.lineWidth = 2;
      ctx.setLineDash([6,4]);
      ctx.beginPath(); ctx.arc(t.x, t.y, stats.rangePx, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = type.color + '15';
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawEnemies() {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  for (let i=0;i<enemies.length;i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y+e.size*0.8, e.size*0.9, e.size*0.3, 0, 0, Math.PI*2); ctx.fill();
    if (e.slowTimer>0) {
      ctx.fillStyle = 'rgba(147,197,253,0.3)';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.size*1.3, 0, Math.PI*2); ctx.fill();
    }
    if (e.poisonTimer>0) {
      ctx.fillStyle = 'rgba(132,204,22,0.3)';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.size*1.15, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = e.hitFlash>0 ? '#ffffff' : e.color;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.size, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const angle = e.angle||0, off = e.size*0.35;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.arc(e.x+Math.cos(angle-0.5)*off, e.y+Math.sin(angle-0.5)*off, e.size*0.16, 0, Math.PI*2);
    ctx.arc(e.x+Math.cos(angle+0.5)*off, e.y+Math.sin(angle+0.5)*off, e.size*0.16, 0, Math.PI*2);
    ctx.fill();
    const barW = e.size*2.2, barH = 4;
    const barX = e.x-barW/2, barY = e.y-e.size-10;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(barX, barY, barW, barH);
    const pct = Math.max(0, e.hp/e.maxHp);
    ctx.fillStyle = pct>0.5 ? '#22c55e' : (pct>0.25 ? '#fbbf24' : '#ef4444');
    ctx.fillRect(barX+1, barY+1, (barW-2)*pct, barH-2);
  }
  ctx.restore();
}

function drawProjectiles() {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  for (let i=0;i<projectiles.length;i++) {
    const p = projectiles[i];
    if (p.beam) {
      const a = p.life/p.maxLife;
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      if (p.trail && p.trail.length >= 4) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(p.trail[0], p.trail[1]);
        for (let k=2;k<p.trail.length;k+=2) ctx.lineTo(p.trail[k], p.trail[k+1]);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI*2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  for (let i=0;i<PARTICLE_POOL;i++) {
    const p = particlePool[i];
    if (!p.active) continue;
    const a = p.life/p.maxLife;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    const s = p.size*a;
    ctx.fillRect(p.x-s/2, p.y-s/2, s, s);
  }
  ctx.globalAlpha = 1;
  for (let i=0;i<floatingTexts.length;i++) {
    const t = floatingTexts[i];
    ctx.globalAlpha = t.life/t.maxLife;
    ctx.fillStyle = t.color;
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, viewH);
  bg.addColorStop(0, '#0a0e1a');
  bg.addColorStop(1, '#050810');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, viewW, viewH);
  drawMap();
  drawTowers();
  drawEnemies();
  drawProjectiles();
  drawParticles();
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!lastTime) lastTime = now;
  let dt = (now-lastTime)/1000;
  lastTime = now;
  if (dt > 0.1) dt = 0.1;
  if (state.running && !state.paused && !state.gameOver) {
    const stepDt = dt * state.speed;
    const steps = Math.max(1, Math.ceil(stepDt/FIXED_DT));
    const sub = stepDt/steps;
    for (let i=0;i<steps;i++) {
      updateEnemies(sub);
      updateTowers(sub);
      updateProjectiles(sub);
      updateParticles(sub);
    }
    if (state.waveActive) {
      state.waveSpawnTimer -= dt * state.speed;
      if (state.waveSpawnTimer<=0 && state.waveSpawnQueue.length>0) {
        const nx = state.waveSpawnQueue.shift();
        if (nx.type === '__pause') state.waveSpawnTimer += nx.delay;
        else { spawnEnemy(nx.type, nx.hpMult); state.waveSpawnTimer += nx.gap || 0.5; }
      }
    }
    if (state.waveActive && state.waveSpawnQueue.length===0 && enemies.length===0) {
      state.waveActive = false;
      onWaveComplete();
    }
    uiTimer += dt;
    if (uiTimer > 0.25) { uiTimer = 0; refreshWaveInfo(); }
  }
  render();
}

export function startWave() {
  if (state.waveActive || state.gameOver) return;
  if (state.wave >= state.totalWaves) return;
  state.wave++;
  const wd = generateWave(state.wave);
  state.waveSpawnQueue = [];
  for (const g of wd.groups) {
    if (g.delay>0) state.waveSpawnQueue.push({ type:'__pause', delay:g.delay });
    for (let i=0;i<g.count;i++) state.waveSpawnQueue.push({ type:g.type, hpMult:wd.hpMult, gap:g.gap });
  }
  if (state.waveSpawnQueue[0] && state.waveSpawnQueue[0].type === '__pause') state.waveSpawnQueue.shift();
  state.waveSpawnTimer = 0;
  state.waveActive = true;
  refreshHUD();
  refreshWaveInfo();
  playSound('wave_start');
  emit('toast', { text:'Волна ' + state.wave, type:'info', duration:1000 });
}

function onWaveComplete() {
  state.score += 50*state.wave;
  state.money += 30 + state.wave*3;
  refreshHUD();
  playSound('wave_complete');
  if (state.wave >= state.totalWaves) {
    endGame(true);
  } else {
    emit('toast', { text:'Волна ' + state.wave + ' пройдена! +' + (30+state.wave*3) + '💰', type:'success', duration:1800 });
  }
  refreshWaveInfo();
}

function endGame(won) {
  if (state.ended) return;
  state.ended = true;
  state.gameOver = true;
  state.running = false;
  let stars = 0;
  if (won) {
    const lost = (BASE_LIVES + DIFFICULTY[currentDifficulty].livesBonus) - state.lives;
    if (lost<=2) stars=3;
    else if (lost<=6) stars=2;
    else stars=1;
    if (currentDifficulty==='hard' && stars<3) stars++;
    if (currentDifficulty==='easy' && stars>1) stars--;
  }
  const lvlKey = String(currentLevel);
  const prevStars = save.stars[lvlKey]||0;
  const prevBest = save.best[lvlKey]||0;
  if (won) {
    if (stars > prevStars) save.stars[lvlKey] = stars;
    if (state.score > prevBest) save.best[lvlKey] = state.score;
    if (currentLevel+1 >= save.unlocked && currentLevel+1 < LEVELS.length) {
      save.unlocked = Math.min(LEVELS.length, currentLevel+2);
    }
    persist();
  }
  playSound(won ? 'win' : 'lose');
  emit('gameEnd', {
    won, stars,
    levelIdx: currentLevel,
    levelName: LEVELS[currentLevel].n,
    wave: state.wave,
    totalWaves: state.totalWaves,
    score: state.score,
    best: Math.max(state.score, prevBest),
    lives: Math.max(0, state.lives),
    hasNext: won && currentLevel+1 < LEVELS.length && save.unlocked > currentLevel+1
  });
}

function refreshHUD() {
  emit('hud', {
    money: state.money,
    lives: Math.max(0, state.lives),
    wave: state.wave,
    score: state.score,
    totalWaves: state.totalWaves
  });
}

function refreshWaveInfo() {
  let btnText, btnDisabled, infoText;
  if (state.gameOver) {
    btnText = '—';
    btnDisabled = true;
    infoText = '';
  } else if (state.waveActive) {
    btnText = 'ИДЁТ';
    btnDisabled = true;
    infoText = 'Врагов ' + enemies.length + ' / В очереди ' + state.waveSpawnQueue.length;
  } else if (state.wave === 0) {
    btnText = 'НАЧАТЬ ВОЛНУ';
    btnDisabled = false;
    infoText = 'Волна 1 / ' + state.totalWaves;
  } else if (state.wave >= state.totalWaves) {
    btnText = 'ФИНИШ';
    btnDisabled = true;
    infoText = 'Все волны отбиты';
  } else {
    btnText = 'НАЧАТЬ ВОЛНУ';
    btnDisabled = false;
    infoText = 'Следующая: ' + (state.wave+1) + ' / ' + state.totalWaves;
  }
  emit('waveInfo', { btnText, btnDisabled, infoText });
}

function refreshTowerInfo() {
  emit('towerInfo', state.selectedTower);
}

export function setSelectedTowerType(key) {
  if (state.money < TOWER_TYPES[key].cost) {
    emit('toast', { text:'Мало денег', type:'error' });
    return;
  }
  state.selectedTowerType = (state.selectedTowerType === key) ? null : key;
  state.selectedTower = null;
  emit('towerInfo', null);
  emit('towerListUpdate', null);
}

export function clearSelection() {
  state.selectedTower = null;
  emit('towerInfo', null);
}

export function getCurrentLevel() { return currentLevel; }
export function getCurrentPicks() { return currentPicks.slice(); }
export function getState() { return state; }
export function getTowers() { return towers; }
export function getSelectedTower() { return state.selectedTower; }

export function loadAndStart(idx, difficulty, picks) {
  currentDifficulty = difficulty || 'normal';
  currentPicks = picks && picks.length ? picks.slice() : currentPicks.slice();
  loadLevel(idx);
  cleanState();
  state.running = true;
  state.ended = false;
  resize();
  refreshHUD();
  refreshWaveInfo();
  emit('towerListUpdate', null);
  emit('toast', { text:'Уровень ' + (idx+1) + ': ' + LEVELS[idx].n, type:'info', duration:1800 });
}

function cleanState() {
  towers.length = 0;
  enemies.length = 0;
  projectiles.length = 0;
  floatingTexts.length = 0;
  for (let i=0;i<PARTICLE_POOL;i++) particlePool[i].active = false;
  state.wave = 0;
  state.score = 0;
  state.paused = false;
  state.speed = 1;
  state.gameOver = false;
  state.ended = false;
  state.running = false;
  state.waveActive = false;
  state.waveSpawnQueue = [];
  state.waveSpawnTimer = 0;
  state.selectedTowerType = null;
  state.selectedTower = null;
  state.hoverCell.x = -1;
  state.hoverCell.y = -1;
}

export function stop() {
  state.running = false;
  state.paused = false;
  state.selectedTower = null;
  state.selectedTowerType = null;
}

export function togglePause() {
  if (state.gameOver) return false;
  state.paused = !state.paused;
  return state.paused;
}

export function cycleSpeed() {
  const sp = [1,2,3];
  const i = sp.indexOf(state.speed);
  state.speed = sp[(i+1)%sp.length];
  return state.speed;
}

export function upgradeSelected() { upgradeTower(state.selectedTower); }
export function sellSelected() { sellTower(state.selectedTower); }

function onPointerDown(e) {
  if (e.type === 'touchstart') e.preventDefault();
  if (!state.running || state.gameOver) return;
  const pos = getPos(e);
  if (!pos) return;
  const c = screenToCell(pos.x, pos.y);
  if (c.x<0||c.x>=COLS||c.y<0||c.y>=ROWS) return;
  let found = null;
  for (let i=0;i<towers.length;i++) {
    if (towers[i].cx===c.x && towers[i].cy===c.y) { found = towers[i]; break; }
  }
  if (found) {
    state.selectedTower = found;
    state.selectedTowerType = null;
    emit('towerListUpdate', null);
    refreshTowerInfo();
    return;
  }
  if (state.selectedTowerType) {
    createTower(c.x, c.y, state.selectedTowerType);
    refreshTowerInfo();
    return;
  }
  state.selectedTower = null;
  emit('towerInfo', null);
}

function onPointerMove(e) {
  if (e.type === 'touchmove') e.preventDefault();
  if (!state.running || state.gameOver) return;
  const pos = getPos(e);
  if (!pos) return;
  state.hoverCell = screenToCell(pos.x, pos.y);
}

function onPointerUp(e) {
  if (e.type === 'touchend') e.preventDefault();
}

function getPos(e) {
  let x, y;
  if (e.touches && e.touches.length) {
    x = e.touches[0].clientX;
    y = e.touches[0].clientY;
  } else if (e.changedTouches && e.changedTouches.length) {
    x = e.changedTouches[0].clientX;
    y = e.changedTouches[0].clientY;
  } else if (e.clientX !== undefined) {
    x = e.clientX;
    y = e.clientY;
  } else return null;
  return { x, y };
}

function attachPointerEvents() {
  canvas.addEventListener('touchstart', onPointerDown, { passive:false });
  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('touchmove', onPointerMove, { passive:false });
  canvas.addEventListener('touchend', onPointerUp, { passive:false });
  canvas.addEventListener('mouseup', onPointerUp);
}

export function initAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
}

function playSound(type) {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.value = 0;
    let f=440,d=0.05,v=0.06,w='sine';
    switch(type){
      case 'shoot': f=300;d=0.06;v=0.05;w='square'; break;
      case 'laser': f=800;d=0.08;v=0.04;w='sawtooth'; break;
      case 'mortar': f=120;d=0.15;v=0.07;w='triangle'; break;
      case 'frost': f=600;d=0.07;v=0.04; break;
      case 'build': f=660;d=0.15;v=0.08;w='triangle'; break;
      case 'upgrade': f=880;d=0.2;v=0.09;w='triangle'; break;
      case 'sell': f=500;d=0.1;v=0.07;w='sawtooth'; break;
      case 'kill': f=200;d=0.05;v=0.05;w='square'; break;
      case 'lose_life': f=150;d=0.3;v=0.14;w='sawtooth'; break;
      case 'wave_start': f=440;d=0.4;v=0.11;w='triangle'; break;
      case 'wave_complete': f=700;d=0.3;v=0.1;w='triangle'; break;
      case 'win': f=880;d=0.6;v=0.14;w='triangle'; break;
      case 'lose': f=130;d=0.6;v=0.14;w='sawtooth'; break;
    }
    o.frequency.value = f;
    o.type = w;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(v, now+0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now+d);
    o.start(now);
    o.stop(now+d+0.02);
  } catch(e){}
}

export function start() {
  requestAnimationFrame(loop);
}