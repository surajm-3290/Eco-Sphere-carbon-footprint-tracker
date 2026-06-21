/* app.js — Eco-Sphere Carbon Intelligence
   =========================================
   Vanilla JS, no dependencies.
   Emission factors sourced from IPCC / EPA / Our World in Data averages.
*/

'use strict';

// ═══════════════════════════════════════════
// ── EMISSION FACTORS (kg CO₂e per unit) ──
// ═══════════════════════════════════════════
const EF = {
  electricity_kwh:   0.417,   // kg CO₂e / kWh (global avg grid)
  natural_gas_low:   30,      // kg CO₂e / month (low heating)
  natural_gas_med:   80,
  natural_gas_high:  160,
  petrol_car_km:     0.192,   // kg CO₂e / km (avg petrol car)
  ev_km:             0.053,   // kg CO₂e / km (EV, global avg grid)
  flight_shorthaul:  255,     // kg CO₂e per short-haul flight (~1000km)
  transit_discount:  [0, 0.05, 0.12, 0.22], // reduction multiplier per transit level
  diet_monthly:      1,       // multiplier * diet base value (kg/mo)
  shopping_item:     25,      // kg CO₂e per clothing/consumer item
  recycle_discount:  [0, 0.03, 0.07, 0.12], // reduction on lifestyle co2
};

const GLOBAL_AVG_MONTHLY   = 417;  // kg CO₂e per capita per month
const TARGET_MONTHLY       = 125;  // 1.5°C pathway (Paris Accord)
const TREE_ABSORPTION_YR   = 21;   // kg CO₂e per mature tree per year

// ═══════════════════════════════════════════
// ── APP STATE ──
// ═══════════════════════════════════════════
const state = {
  electricity:    300,  // kWh/mo
  solar:          0,    // % offset
  heating:        0,    // kg CO₂e/mo
  carKm:          0,    // km/mo
  evKm:           0,    // km/mo
  flights:        0,    // count/mo
  transitLevel:   0,    // 0-3
  dietBase:       80,   // kg CO₂e/mo
  shopping:       2,    // items/mo
  recycleLevel:   1,    // 0-3
  microReduction: 0,    // kg CO₂e total from micro-actions

  // Sector totals (computed)
  energyCO2:    0,
  mobilityCO2:  0,
  lifestyleCO2: 0,
  totalCO2:     0,
};

// ═══════════════════════════════════════════
// ── STREAK STATE ──
// (in-memory only for this session; a real deployment
//  would persist this server-side or via window.storage)
// ═══════════════════════════════════════════
const streak = {
  count: 0,
  lastCheckIn: null,     // 'YYYY-MM-DD' string of last check-in
  unlockedBadges: new Set(), // e.g. {10, 50, 100}
};

const STREAK_MILESTONES = [10, 50, 100];
const BADGE_ICONS = { 10: '🥉', 50: '🥈', 100: '🥇' };

// ═══════════════════════════════════════════
// ── DOM REFERENCES ──
// ═══════════════════════════════════════════
const dom = {
  canvas:           document.getElementById('ecosCanvas'),
  co2Display:       document.getElementById('co2-display'),
  headerCo2:        document.getElementById('header-co2'),
  ringFill:         document.getElementById('ring-fill'),
  treesNeeded:      document.getElementById('trees-needed'),
  planetLabel:      document.getElementById('planet-health-label'),
  insightsList:     document.getElementById('insights-list'),
  insightsBox:      document.getElementById('insights-box'),
  energyChip:       document.getElementById('energy-chip'),
  mobilityChip:     document.getElementById('mobility-chip'),
  lifestyleChip:    document.getElementById('lifestyle-chip'),
  actionsChip:      document.getElementById('actions-chip'),
  compBarGlobal:    document.getElementById('comp-bar-global'),
  compBarTarget:    document.getElementById('comp-bar-target'),

  elecSlider:       document.getElementById('electricity'),
  solarSlider:      document.getElementById('solar'),
  carSlider:        document.getElementById('car-km'),
  evSlider:         document.getElementById('ev-km'),
  shoppingSlider:   document.getElementById('shopping'),

  elecVal:          document.getElementById('electricity-val'),
  solarVal:         document.getElementById('solar-val'),
  carVal:           document.getElementById('car-val'),
  evVal:            document.getElementById('ev-val'),
  shoppingVal:      document.getElementById('shopping-val'),

  flightsCount:     document.getElementById('flights-count'),
  toast:            document.getElementById('toast'),

  // Streak elements
  streakCount:        document.getElementById('streak-count'),
  streakFlame:        document.getElementById('streak-flame'),
  streakCheckin:       document.getElementById('streak-checkin'),
  streakProgressFill:  document.getElementById('streak-progress-fill'),
  headerStreakCount:   document.getElementById('header-streak-count'),
  headerStreakPill:    document.getElementById('header-streak-pill'),
  badgeOverlay:        document.getElementById('badge-overlay'),
  badgeOverlayIcon:    document.getElementById('badge-overlay-icon'),
  badgeOverlaySub:     document.getElementById('badge-overlay-sub'),
  badgeOverlayClose:   document.getElementById('badge-overlay-close'),
};

// ═══════════════════════════════════════════
// ── CANVAS / ECO-SPHERE ENGINE ──
// ═══════════════════════════════════════════
const canvas = dom.canvas;
const ctx    = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const CY = H / 2;

// Sphere draw state (lerped toward target)
let sphereHealth = 1.0;   // 1 = lush, 0 = dead
let healthTarget = 1.0;
let tick = 0;

// Particle pool for birds / leaves
const particles = [];

function spawnParticle(type) {
  if (sphereHealth < 0.3) return;
  const angle = Math.random() * Math.PI;
  const r = 100 + Math.random() * 50;
  particles.push({
    type,
    x: CX + Math.cos(angle) * r,
    y: CY - Math.abs(Math.sin(angle)) * r * 0.6,
    vx: (Math.random() - 0.5) * 1.5 * sphereHealth,
    vy: -Math.random() * 0.5 * sphereHealth,
    life: 1,
    decay: 0.004 + Math.random() * 0.003,
    size: 0.6 + Math.random() * 0.8,
  });
}

// Spontaneously spawn life particles when healthy
setInterval(() => {
  if (sphereHealth > 0.4 && particles.length < 18) {
    if (Math.random() > 0.4) spawnParticle('bird');
    if (Math.random() > 0.6) spawnParticle('leaf');
  }
}, 800);

function drawSphere() {
  ctx.clearRect(0, 0, W, H);
  tick++;

  // Lerp health toward target
  sphereHealth += (healthTarget - sphereHealth) * 0.025;

  const h = sphereHealth;
  const polluted = 1 - h;

  /* ── Sky background ── */
  const skyTop    = lerpColor('#0a1628', '#87CEEB', h * 0.65);
  const skyBottom = lerpColor('#1a1a2e', '#c8e8f5', h * 0.55);
  const skyGrad = ctx.createRadialGradient(CX, CY - 40, 30, CX, CY, 200);
  skyGrad.addColorStop(0, skyTop);
  skyGrad.addColorStop(1, skyBottom);

  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, 192, 0, Math.PI * 2);
  ctx.fillStyle = skyGrad;
  ctx.fill();
  ctx.clip();

  /* ── Smog layer when polluted ── */
  if (polluted > 0.2) {
    const smogAlpha = Math.min((polluted - 0.2) * 0.7, 0.55);
    const smogGrad = ctx.createRadialGradient(CX, CY + 60, 40, CX, CY, 195);
    smogGrad.addColorStop(0, `rgba(90,90,90,${smogAlpha})`);
    smogGrad.addColorStop(0.5, `rgba(60,60,60,${smogAlpha * 0.6})`);
    smogGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = smogGrad;
    ctx.fillRect(0, 0, W, H);
  }

  /* ── Sun / haze ── */
  const sunOpacity = h * 0.9;
  if (sunOpacity > 0.05) {
    const sunGrad = ctx.createRadialGradient(CX + 60, CY - 100, 0, CX + 60, CY - 100, 55);
    sunGrad.addColorStop(0, `rgba(255,235,150,${sunOpacity})`);
    sunGrad.addColorStop(0.5, `rgba(255,200,80,${sunOpacity * 0.5})`);
    sunGrad.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(CX + 60, CY - 100, 55, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ── Water / ocean ── */
  const waterColor = lerpColor('#2a2a3a', '#1e90c8', h * 0.7);
  const waveOffset = Math.sin(tick * 0.02) * 4;
  const waterGrad = ctx.createLinearGradient(0, CY + 40, 0, H);
  waterGrad.addColorStop(0, waterColor);
  waterGrad.addColorStop(1, lerpColor('#1a1a2e', '#0d5f8c', h * 0.6));
  ctx.beginPath();
  ctx.moveTo(0, CY + 55 + waveOffset);
  for (let x = 0; x <= W; x += 20) {
    const y = CY + 55 + Math.sin((x * 0.04) + tick * 0.03) * (4 * h + 1) + waveOffset;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = waterGrad;
  ctx.fill();

  /* ── Ground / island ── */
  const groundColor = lerpColor('#3d3d3d', '#5d7a3e', h);
  const groundGrad = ctx.createRadialGradient(CX, CY + 120, 20, CX, CY + 80, 130);
  groundGrad.addColorStop(0, lerpColor('#4a3520', '#8aad54', h));
  groundGrad.addColorStop(1, groundColor);

  ctx.beginPath();
  ctx.ellipse(CX, CY + 65, 130, 55, 0, 0, Math.PI * 2);
  ctx.fillStyle = groundGrad;
  ctx.fill();

  /* ── Grass fringe ── */
  if (h > 0.15) {
    const grassAlpha = Math.max(0, h - 0.15);
    ctx.fillStyle = `rgba(80,160,60,${grassAlpha})`;
    for (let gx = CX - 100; gx < CX + 100; gx += 8) {
      const gy = CY + 30 + Math.sin(gx * 0.15) * 10;
      const gh = 10 + Math.sin(gx * 0.2 + tick * 0.02) * 4;
      ctx.beginPath();
      ctx.moveTo(gx, gy + gh);
      ctx.quadraticCurveTo(gx + 2 + Math.sin(tick * 0.03) * 1.5, gy, gx + 4, gy + gh);
      ctx.fill();
    }
  }

  /* ── Trees ── */
  drawTrees(h);

  /* ── Smoke stacks when very polluted ── */
  if (polluted > 0.5) {
    drawSmokestacks(polluted);
  }

  /* ── Clouds ── */
  drawClouds(h, tick);

  /* ── Particles ── */
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    ctx.save();
    ctx.globalAlpha = p.life * h;
    ctx.font = `${p.size * 14}px serif`;
    ctx.fillText(p.type === 'bird' ? '🐦' : '🍃', p.x, p.y);
    ctx.restore();
  }

  /* ── Sphere border glow ── */
  const borderGrad = ctx.createRadialGradient(CX, CY, 180, CX, CY, 196);
  borderGrad.addColorStop(0, 'rgba(0,0,0,0)');
  borderGrad.addColorStop(1, lerpColor('rgba(107,114,128,0.8)', 'rgba(16,185,129,0.5)', h));
  ctx.fillStyle = borderGrad;
  ctx.beginPath();
  ctx.arc(CX, CY, 196, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  /* ── Outer border ring ── */
  const ringAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(CX, CY, 193, 0, Math.PI * 2);
  ctx.strokeStyle = lerpColor(`rgba(107,114,128,${ringAlpha})`, `rgba(52,211,153,${ringAlpha})`, h);
  ctx.lineWidth = 2.5;
  ctx.stroke();

  requestAnimationFrame(drawSphere);
}

function drawTrees(h) {
  if (h < 0.1) return;
  const alpha = Math.min(1, (h - 0.1) / 0.3);

  const trees = [
    { x: CX - 70, y: CY + 40, scale: 0.8 },
    { x: CX,      y: CY + 20, scale: 1.1 },
    { x: CX + 70, y: CY + 42, scale: 0.75 },
    { x: CX - 35, y: CY + 32, scale: 0.65 },
    { x: CX + 38, y: CY + 30, scale: 0.6  },
  ];

  trees.forEach(t => {
    ctx.save();
    ctx.globalAlpha = alpha;
    // Sway
    const sway = Math.sin(tick * 0.018 + t.x) * 1.2 * h;
    ctx.translate(t.x, t.y);
    ctx.rotate(sway * 0.015);

    const trunkH = 22 * t.scale;
    const canopyR = 22 * t.scale;

    // Trunk
    ctx.fillStyle = lerpColor('#3d2b1f', '#6b4226', h);
    ctx.fillRect(-3 * t.scale, -trunkH, 6 * t.scale, trunkH);

    // Canopy layers
    const leafColor = lerpColor('#4a5a4a', '#2d7a2d', h);
    const leafColor2 = lerpColor('#3d4d3d', '#3da83d', h);

    ctx.beginPath();
    ctx.arc(0, -trunkH - canopyR * 0.5, canopyR * 1.1, 0, Math.PI * 2);
    ctx.fillStyle = leafColor;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, -trunkH - canopyR * 0.85, canopyR * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = leafColor2;
    ctx.fill();

    ctx.restore();
  });
}

function drawSmokestacks(polluted) {
  const alpha = Math.min(0.85, (polluted - 0.5) * 1.7);
  ctx.save();
  ctx.globalAlpha = alpha;

  // Stack bodies
  [CX - 50, CX + 30].forEach((sx, i) => {
    const sy = CY + 50;
    ctx.fillStyle = '#333';
    ctx.fillRect(sx - 8, sy - 35, 16, 35);

    // Animated smoke
    for (let s = 0; s < 5; s++) {
      const smokeY = sy - 35 - s * 18 + ((tick * 1.2 + s * 7) % 90);
      const smokeX = sx + Math.sin(tick * 0.04 + s) * 6;
      const smokeSize = 10 + s * 4;
      const smokeAlpha = alpha * (1 - s * 0.18) * 0.6;
      const smGrad = ctx.createRadialGradient(smokeX, smokeY, 0, smokeX, smokeY, smokeSize);
      smGrad.addColorStop(0, `rgba(80,80,80,${smokeAlpha})`);
      smGrad.addColorStop(1, 'rgba(80,80,80,0)');
      ctx.fillStyle = smGrad;
      ctx.beginPath();
      ctx.arc(smokeX, smokeY, smokeSize, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

function drawClouds(h, t) {
  const clouds = [
    { x: CX - 80 + Math.sin(t * 0.008) * 15, y: CY - 120, scale: 0.9 },
    { x: CX + 70 + Math.sin(t * 0.006 + 1) * 12, y: CY - 140, scale: 0.65 },
    { x: CX + 10 + Math.sin(t * 0.01 + 2) * 10, y: CY - 155, scale: 0.5 },
  ];

  clouds.forEach(c => {
    const cloudAlpha = 0.55 + (h * 0.3);
    const cloudColor = h > 0.5
      ? `rgba(240,248,255,${cloudAlpha})`
      : `rgba(160,160,160,${cloudAlpha * 0.7})`;

    ctx.save();
    ctx.fillStyle = cloudColor;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 20 * c.scale, 0, Math.PI * 2);
    ctx.arc(c.x + 18 * c.scale, c.y + 5 * c.scale, 15 * c.scale, 0, Math.PI * 2);
    ctx.arc(c.x - 14 * c.scale, c.y + 6 * c.scale, 13 * c.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// Helper: lerp between two hex or rgba colors
function lerpColor(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const pa = parseColor(a);
  const pb = parseColor(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  const al = pa[3] + (pb[3] - pa[3]) * t;
  return `rgba(${r},${g},${bl},${al})`;
}

function parseColor(c) {
  const tmp = document.createElement('div');
  tmp.style.color = c;
  document.body.appendChild(tmp);
  const cs = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const m = cs.match(/[\d.]+/g);
  return m ? [+m[0], +m[1], +m[2], m[3] !== undefined ? +m[3] : 1] : [0, 0, 0, 1];
}


// ═══════════════════════════════════════════
// ── COMPUTE EMISSIONS ──
// ═══════════════════════════════════════════
function computeEmissions() {
  // ENERGY
  const elecNet = state.electricity * (1 - state.solar / 100);
  const energyCO2 = elecNet * EF.electricity_kwh + state.heating;

  // MOBILITY
  const carCO2     = state.carKm * EF.petrol_car_km;
  const evCO2      = state.evKm  * EF.ev_km;
  const flightCO2  = state.flights * EF.flight_shorthaul;
  const transitDiscount = state.transitLevel > 0
    ? (carCO2 + evCO2) * EF.transit_discount[state.transitLevel]
    : 0;
  const mobilityCO2 = Math.max(0, carCO2 + evCO2 + flightCO2 - transitDiscount);

  // LIFESTYLE
  const dietCO2  = state.dietBase;
  const shopCO2  = state.shopping * EF.shopping_item;
  const rawLifestyle = dietCO2 + shopCO2;
  const recycleDiscount = rawLifestyle * EF.recycle_discount[state.recycleLevel];
  const lifestyleCO2 = Math.max(0, rawLifestyle - recycleDiscount);

  // TOTAL (with micro-action reduction)
  const baseCO2 = energyCO2 + mobilityCO2 + lifestyleCO2;
  const totalCO2 = Math.max(0, baseCO2 - state.microReduction);

  state.energyCO2    = energyCO2;
  state.mobilityCO2  = mobilityCO2;
  state.lifestyleCO2 = lifestyleCO2;
  state.totalCO2     = totalCO2;

  return { energyCO2, mobilityCO2, lifestyleCO2, totalCO2 };
}


// ═══════════════════════════════════════════
// ── UPDATE UI ──
// ═══════════════════════════════════════════
function updateUI() {
  const { energyCO2, mobilityCO2, lifestyleCO2, totalCO2 } = computeEmissions();

  /* Score display */
  dom.co2Display.textContent = Math.round(totalCO2);
  dom.headerCo2.textContent  = `${Math.round(totalCO2)} kg`;

  /* Section chips */
  dom.energyChip.textContent    = `${Math.round(energyCO2)} kg`;
  dom.mobilityChip.textContent  = `${Math.round(mobilityCO2)} kg`;
  dom.lifestyleChip.textContent = `${Math.round(lifestyleCO2)} kg`;
  dom.actionsChip.textContent   = `−${state.microReduction} kg`;

  /* Colour the chips by intensity */
  styleChip(dom.energyChip,    energyCO2, 200);
  styleChip(dom.mobilityChip,  mobilityCO2, 200);
  styleChip(dom.lifestyleChip, lifestyleCO2, 150);

  /* Ring progress: 0–600 kg range */
  const RING_MAX = 600;
  const RING_CIRC = 326.7;
  const pct = Math.min(totalCO2 / RING_MAX, 1);
  const offset = RING_CIRC * (1 - pct);
  dom.ringFill.style.strokeDashoffset = offset;

  // Ring colour
  if (pct < 0.25)       dom.ringFill.style.stroke = '#10b981';
  else if (pct < 0.5)   dom.ringFill.style.stroke = '#fbbf24';
  else if (pct < 0.75)  dom.ringFill.style.stroke = '#f97316';
  else                  dom.ringFill.style.stroke = '#ef4444';

  /* Score text colour */
  if (pct < 0.25)      dom.co2Display.style.color = '#34d399';
  else if (pct < 0.5)  dom.co2Display.style.color = '#fbbf24';
  else if (pct < 0.75) dom.co2Display.style.color = '#f97316';
  else                 dom.co2Display.style.color = '#f87171';

  /* Comparison bars */
  const globalPct = Math.min((totalCO2 / GLOBAL_AVG_MONTHLY) * 100, 200);
  const targetPct = Math.min((totalCO2 / TARGET_MONTHLY) * 100, 200);
  dom.compBarGlobal.style.width  = Math.min(globalPct, 100) + '%';
  dom.compBarTarget.style.width  = Math.min(targetPct, 100) + '%';

  /* Trees needed per year */
  const annualCO2 = totalCO2 * 12;
  const trees = Math.ceil(annualCO2 / TREE_ABSORPTION_YR);
  dom.treesNeeded.textContent = trees.toLocaleString();

  /* Eco-Sphere health (0 = worst, 1 = best) */
  healthTarget = Math.max(0, Math.min(1, 1 - (totalCO2 / 700)));

  /* Planet health label */
  let label = '', labelClass = '';
  if (healthTarget > 0.75)      { label = 'Thriving 🌿';    labelClass = 'good'; }
  else if (healthTarget > 0.5)  { label = 'Stable 🌱';      labelClass = 'okay'; }
  else if (healthTarget > 0.3)  { label = 'Stressed 🌾';    labelClass = 'warn'; }
  else if (healthTarget > 0.1)  { label = 'Critical 🔥';    labelClass = 'danger'; }
  else                          { label = 'Depleted 💀';     labelClass = 'dead'; }
  dom.planetLabel.textContent = label;

  /* Header score colour */
  dom.headerCo2.style.color = dom.co2Display.style.color;

  /* Canvas glow */
  canvas.className = healthTarget < 0.4 ? 'polluted' : '';

  /* Insights engine */
  generateInsights(totalCO2, energyCO2, mobilityCO2, lifestyleCO2);
}

function styleChip(el, val, threshold) {
  if (val > threshold * 1.5) {
    el.style.background = 'rgba(239,68,68,0.18)';
    el.style.color = '#f87171';
  } else if (val > threshold * 0.75) {
    el.style.background = 'rgba(251,191,36,0.15)';
    el.style.color = '#fbbf24';
  } else {
    el.style.background = 'rgba(16,185,129,0.15)';
    el.style.color = '#34d399';
  }
}


// ═══════════════════════════════════════════
// ── INSIGHTS ENGINE ──
// ═══════════════════════════════════════════
function generateInsights(total, energy, mobility, lifestyle) {
  const insights = [];

  // ── Overall status
  if (total <= TARGET_MONTHLY) {
    insights.push({ type: 'good', text: `🎉 You're within the 1.5°C pathway target! Keep it up — you're in the top ~5% globally.` });
  } else {
    const overBy = Math.round(total - TARGET_MONTHLY);
    insights.push({ type: 'warn', text: `You're ${overBy} kg/mo over the 1.5°C sustainability target of ${TARGET_MONTHLY} kg.` });
  }

  // ── Energy insights
  if (state.electricity > 500) {
    insights.push({ type: 'danger', text: `⚡ High electricity use (${state.electricity} kWh/mo). Switching to LED lighting and smart appliances could cut this by 20–30%.` });
  }
  if (state.solar === 0 && state.electricity > 200) {
    insights.push({ type: 'warn', text: `☀️ Even a 25% solar offset on your ${state.electricity} kWh usage would save ~${Math.round(state.electricity * 0.25 * EF.electricity_kwh)} kg CO₂e/mo.` });
  }
  if (state.solar > 50) {
    insights.push({ type: 'good', text: `☀️ Excellent! Your ${state.solar}% solar offset is preventing ${Math.round(state.electricity * (state.solar/100) * EF.electricity_kwh)} kg CO₂e/mo from grid emissions.` });
  }
  if (state.heating >= 160) {
    insights.push({ type: 'danger', text: `🔥 Heavy gas heating adds 160 kg/mo. A heat pump at COP 3 would cut this by ~65% and reduce your bill.` });
  }

  // ── Mobility insights
  if (state.carKm > 1000) {
    insights.push({ type: 'danger', text: `🚗 Driving ${state.carKm} km/mo of petrol adds ${Math.round(state.carKm * EF.petrol_car_km)} kg CO₂e. Switching to an EV would drop this to ${Math.round(state.carKm * EF.ev_km)} kg.` });
  }
  if (state.flights > 0) {
    insights.push({ type: 'danger', text: `✈️ ${state.flights} short-haul flight(s) = ${Math.round(state.flights * EF.flight_shorthaul)} kg CO₂e. One avoided flight saves more than 3 months of average diet changes.` });
  }
  if (state.transitLevel === 0 && state.carKm > 200) {
    insights.push({ type: 'warn', text: `🚌 Replacing even 20% of your driving with public transit could save ~${Math.round(state.carKm * 0.2 * (EF.petrol_car_km - 0.04))} kg CO₂e/mo.` });
  }
  if (state.evKm > 0 && state.solar > 30) {
    insights.push({ type: 'good', text: `⚡🚗 Charging your EV with ${state.solar}% solar is synergistic — your effective transport emissions are impressively low.` });
  }

  // ── Lifestyle insights
  if (state.dietBase >= 80) {
    insights.push({ type: 'danger', text: `🥩 A heavy meat diet contributes ~80 kg/mo. Shifting to vegetarian would save ~45 kg/mo — equivalent to removing a car from the road.` });
  } else if (state.dietBase === 55) {
    insights.push({ type: 'warn', text: `🍗 Reducing red meat to 2×/week could save ~15–20 kg CO₂e/mo with minimal lifestyle change.` });
  } else if (state.dietBase <= 20) {
    insights.push({ type: 'good', text: `🥗 Your plant-based diet is one of the highest-impact personal climate actions. Excellent choice.` });
  }
  if (state.shopping > 8) {
    insights.push({ type: 'warn', text: `🛍️ Buying ${state.shopping} new items/mo adds ${state.shopping * EF.shopping_item} kg CO₂e. Second-hand or repair-first choices could halve this instantly.` });
  }
  if (state.recycleLevel < 2) {
    insights.push({ type: 'warn', text: `♻️ Maximising recycling and composting can reduce lifecycle waste emissions by 8–12% — set up a sorting system today.` });
  }

  // ── Micro-action encouragement
  if (state.microReduction > 20) {
    insights.push({ type: 'good', text: `✅ Your daily micro-actions are preventing ${state.microReduction} kg CO₂e this cycle. Habit stacking works!` });
  }

  // Render (max 5 shown)
  dom.insightsList.innerHTML = insights.slice(0, 5).map(i =>
    `<li class="insight-item insight-${i.type}">${i.text}</li>`
  ).join('');

  // Update insights box border colour
  if (total <= TARGET_MONTHLY) {
    dom.insightsBox.style.borderLeftColor = '#10b981';
  } else if (total < GLOBAL_AVG_MONTHLY) {
    dom.insightsBox.style.borderLeftColor = '#fbbf24';
  } else {
    dom.insightsBox.style.borderLeftColor = '#ef4444';
  }
}


// ═══════════════════════════════════════════
// ── SLIDER FILL UTILITY ──
// ═══════════════════════════════════════════
function updateSliderFill(slider, isGreen = false) {
  const min = +slider.min;
  const max = +slider.max;
  const val = +slider.value;
  const pct = ((val - min) / (max - min)) * 100;
  const col = isGreen ? '#10b981' : '#f59e0b';
  const track = isGreen ? '#1e2a45' : '#1e2a45';
  slider.style.background = `linear-gradient(to right, ${col} 0%, ${col} ${pct}%, ${track} ${pct}%, ${track} 100%)`;
}


// ═══════════════════════════════════════════
// ── TOAST ──
// ═══════════════════════════════════════════
let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 3200);
}


// ═══════════════════════════════════════════
// ── FLOAT PARTICLE ON MICRO ACTION ──
// ═══════════════════════════════════════════
function spawnFloatText(el, text, isGood) {
  const rect = el.getBoundingClientRect();
  const particle = document.createElement('span');
  particle.classList.add('float-particle');
  particle.textContent = text;
  particle.style.left   = (rect.left + rect.width / 2) + 'px';
  particle.style.top    = rect.top + 'px';
  particle.style.position = 'fixed';
  particle.style.color  = isGood ? '#34d399' : '#f87171';
  particle.style.fontWeight = '700';
  particle.style.fontSize   = '0.9rem';
  particle.style.zIndex     = '9999';
  particle.style.pointerEvents = 'none';
  document.body.appendChild(particle);
  setTimeout(() => particle.remove(), 1200);
}


// ═══════════════════════════════════════════
// ── STREAK SYSTEM ──
// ═══════════════════════════════════════════
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function nextMilestone(count) {
  for (const m of STREAK_MILESTONES) {
    if (count < m) return m;
  }
  return null; // beyond all milestones
}

function checkIn() {
  const today = todayStr();
  if (streak.lastCheckIn === today) return; // already checked in

  if (streak.lastCheckIn === yesterdayStr()) {
    streak.count += 1;          // consecutive day
  } else {
    streak.count = 1;           // streak broken, restart
  }
  streak.lastCheckIn = today;

  // Check for newly unlocked milestone badges
  STREAK_MILESTONES.forEach(ms => {
    if (streak.count >= ms && !streak.unlockedBadges.has(ms)) {
      streak.unlockedBadges.add(ms);
      // Slight delay so the streak UI updates visibly before the modal pops
      setTimeout(() => showBadgeUnlock(ms), 350);
    }
  });

  updateStreakUI();
  showToast(`🔥 Day ${streak.count} checked in — keep the streak alive!`);
}

function showBadgeUnlock(milestone) {
  dom.badgeOverlayIcon.textContent = BADGE_ICONS[milestone];
  dom.badgeOverlaySub.textContent = `${milestone}-Day Streak`;
  dom.badgeOverlay.classList.add('visible');
}

function hideBadgeUnlock() {
  dom.badgeOverlay.classList.remove('visible');
}

function updateStreakUI() {
  dom.streakCount.textContent = streak.count;
  dom.headerStreakCount.textContent = streak.count;

  // Flame lights up once streak has started
  dom.streakFlame.classList.toggle('lit', streak.count > 0);
  dom.headerStreakPill.style.opacity = streak.count > 0 ? '1' : '0.5';

  // Disable check-in button if already done today
  const doneToday = streak.lastCheckIn === todayStr();
  dom.streakCheckin.disabled = doneToday;
  dom.streakCheckin.textContent = doneToday ? "Checked in today ✓" : 'Check in today';

  // Progress bar: scale 0–100, with soft compression past 100
  const cap = 100;
  const pct = Math.min((streak.count / cap) * 100, 100);
  dom.streakProgressFill.style.width = pct + '%';

  // Milestone dots
  STREAK_MILESTONES.forEach(ms => {
    const dot = document.querySelector(`.streak-milestone-dot[data-ms="${ms}"]`);
    if (dot) dot.classList.toggle('reached', streak.count >= ms);

    const slot = document.getElementById(`badge-${ms}`);
    if (slot) slot.classList.toggle('unlocked', streak.unlockedBadges.has(ms));
  });
}


// ═══════════════════════════════════════════
// ── EVENT BINDING ──
// ═══════════════════════════════════════════
function bindEvents() {

  // ── SLIDERS ──
  const sliderMap = [
    { el: dom.elecSlider,    key: 'electricity', display: dom.elecVal,     fmt: v => `${v} kWh/mo` },
    { el: dom.solarSlider,   key: 'solar',       display: dom.solarVal,    fmt: v => `${v}%`, green: true },
    { el: dom.carSlider,     key: 'carKm',       display: dom.carVal,      fmt: v => `${v} km/mo` },
    { el: dom.evSlider,      key: 'evKm',        display: dom.evVal,       fmt: v => `${v} km/mo`, green: true },
    { el: dom.shoppingSlider, key: 'shopping',   display: dom.shoppingVal, fmt: v => `${v} items/mo` },
  ];

  sliderMap.forEach(({ el, key, display, fmt, green }) => {
    updateSliderFill(el, green);
    el.addEventListener('input', () => {
      state[key] = +el.value;
      display.textContent = fmt(el.value);
      updateSliderFill(el, green);
      updateUI();
    });
  });

  // ── TOGGLE GROUPS ──
  const toggleGroups = [
    { id: 'heating-toggle',  key: 'heating',      type: 'value' },
    { id: 'transit-toggle',  key: 'transitLevel', type: 'value' },
    { id: 'recycle-toggle',  key: 'recycleLevel', type: 'value' },
  ];

  toggleGroups.forEach(({ id, key, type }) => {
    const group = document.getElementById(id);
    group.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state[key] = +btn.dataset.value;
        updateUI();
      });
    });
  });

  // ── DIET SELECTOR ──
  const dietSel = document.getElementById('diet-selector');
  dietSel.querySelectorAll('.diet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      dietSel.querySelectorAll('.diet-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.dietBase = +btn.dataset.value;
      updateUI();
    });
  });

  // ── FLIGHT TAP COUNTER ──
  document.querySelectorAll('[data-target="flights"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('tap-plus')) {
        state.flights = Math.min(state.flights + 1, 20);
      } else {
        state.flights = Math.max(state.flights - 1, 0);
      }
      dom.flightsCount.textContent = state.flights;
      dom.flightsCount.parentElement.classList.add('shake');
      setTimeout(() => dom.flightsCount.parentElement.classList.remove('shake'), 400);
      updateUI();
    });
  });

  // ── MICRO-ACTIONS ──
  document.querySelectorAll('.micro-action').forEach(card => {
    card.addEventListener('click', () => {
      const active   = card.classList.toggle('active');
      const toggle   = card.querySelector('.micro-toggle');
      const reduction = +card.dataset.reduction;
      const label    = card.querySelector('strong').textContent;

      toggle.setAttribute('aria-checked', active ? 'true' : 'false');

      if (active) {
        state.microReduction += reduction;
        spawnFloatText(card, `−${reduction} kg`, true);
        showToast(`✅ "${label}" — saving ${reduction} kg CO₂e`);
      } else {
        state.microReduction -= reduction;
        spawnFloatText(card, `+${reduction} kg`, false);
        showToast(`↩️ "${label}" deactivated`);
      }

      state.microReduction = Math.max(0, state.microReduction);
      updateUI();
    });
  });

  // ── STREAK CHECK-IN ──
  dom.streakCheckin.addEventListener('click', checkIn);
  dom.badgeOverlayClose.addEventListener('click', hideBadgeUnlock);
  dom.badgeOverlay.addEventListener('click', (e) => {
    if (e.target === dom.badgeOverlay) hideBadgeUnlock();
  });
}


// ═══════════════════════════════════════════
// ── INIT ──
// ═══════════════════════════════════════════
function init() {
  bindEvents();
  updateUI();
  updateStreakUI();
  requestAnimationFrame(drawSphere);

  // Seed a couple particles on load
  setTimeout(() => {
    spawnParticle('bird');
    spawnParticle('leaf');
  }, 800);

  // Welcome toast
  setTimeout(() => {
    showToast('🌍 Adjust sliders and actions to see your Eco-Sphere respond');
  }, 1200);
}

document.addEventListener('DOMContentLoaded', init);
