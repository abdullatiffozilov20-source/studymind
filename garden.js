// ================================================================
//  StudyMind Garden v2.0 — Ghibli-style Living World
//  "Design it like a living emotional game world"
//  Isometric-inspired, cinematic, cozy atmosphere
//  Standalone garden.js — faqat shu faylni almashtirish kifoya
// ================================================================
window.StudyMindGarden = (function () {
  'use strict'

  let canvas, ctx, W, H, dpr = 1
  let aT = 0, lastT = 0, rafId = null
  let initialized = false

  // World state
  let W$ = {
    streak: 0, xp: 0, grade: 0,
    unlocks: {},
    // Animated elements
    clouds: [],
    birds: [],
    particles: [],
    texts: [],
    windPhase: 0,
    timeOfDay: 0.3, // 0=midnight 0.5=noon 1=midnight
    char: { x: 0.38, y: 0.68, dir: 1, step: 0, targetX: 0.5, idle: 0 },
    lanterns: [
      { x: 0.28, y: 0.72 },
      { x: 0.62, y: 0.70 },
      { x: 0.18, y: 0.75 },
      { x: 0.72, y: 0.73 },
    ],
    flowers: [],
    grassBlades: [],
  }

  // ── UNLOCK SYSTEM ─────────────────────────────────────────────────
  const UNLOCKS = [
    { key: 'field',     req: s => true,           label: 'Yashil maydon',    emoji: '🌿' },
    { key: 'wind',      req: s => true,            label: 'Shamol',           emoji: '🍃' },
    { key: 'smallPlants',req: s => s.xp >= 30,     label: 'Kichik o\'simlik', emoji: '🌱', xpReq: 30 },
    { key: 'flowers',   req: s => s.xp >= 80,      label: 'Gullar',           emoji: '🌸', xpReq: 80 },
    { key: 'tree1',     req: s => s.streak >= 3,   label: 'Birinchi daraxt',  emoji: '🌳', streakReq: 3 },
    { key: 'birds',     req: s => s.streak >= 5,   label: 'Qushlar',          emoji: '🐦', streakReq: 5 },
    { key: 'river',     req: s => s.streak >= 7,   label: 'Daryo',            emoji: '🏞️', streakReq: 7 },
    { key: 'tree2',     req: s => s.xp >= 250,     label: 'Ko\'proq daraxtlar',emoji: '🌲', xpReq: 250 },
    { key: 'bridge',    req: s => s.streak >= 10,  label: 'Ko\'prik',         emoji: '🌉', streakReq: 10 },
    { key: 'house',     req: s => s.streak >= 14,  label: 'Uy',               emoji: '🏠', streakReq: 14 },
    { key: 'lanterns',  req: s => s.xp >= 600,     label: 'Chiroqlar',        emoji: '🏮', xpReq: 600 },
    { key: 'mountain',  req: s => s.xp >= 800,     label: "Tog'",             emoji: '⛰️', xpReq: 800 },
    { key: 'village',   req: s => s.streak >= 30,  label: 'Qishloq',          emoji: '🏡', streakReq: 30 },
    { key: 'rainbow',   req: s => s.streak >= 30 && s.grade >= 85, label: 'Kamalak', emoji: '🌈' },
  ]

  function calcUnlocks() {
    const prev = { ...W$.unlocks }
    UNLOCKS.forEach(u => { W$.unlocks[u.key] = u.req(W$) })
    return UNLOCKS.filter(u => W$.unlocks[u.key] && !prev[u.key])
  }

  function getNext() {
    const next = UNLOCKS.find(u => !W$.unlocks[u.key])
    if (!next) return { emoji: '🌟', label: 'Mukammal dunyo!', hint: '' }
    let hint = ''
    if (next.streakReq) hint = `${next.streakReq - W$.streak} kun streak kerak`
    else if (next.xpReq) hint = `${next.xpReq - W$.xp} XP kerak`
    return { ...next, hint }
  }

  // ── INIT DATA ──────────────────────────────────────────────────────
  function initData() {
    // Clouds
    W$.clouds = Array.from({ length: 6 }, (_, i) => ({
      x: Math.random(),
      y: 0.05 + Math.random() * 0.2,
      r: 0.06 + Math.random() * 0.08,
      spd: 0.000025 + Math.random() * 0.00003,
      alpha: 0.6 + Math.random() * 0.35,
      offsets: Array.from({ length: 5 }, () => ({
        dx: (Math.random() - 0.5) * 0.06,
        dy: (Math.random() - 0.5) * 0.03,
        r: 0.6 + Math.random() * 0.7,
      }))
    }))
    // Birds
    W$.birds = Array.from({ length: 8 }, (_, i) => ({
      x: Math.random(),
      y: 0.1 + Math.random() * 0.18,
      spd: 0.0003 + Math.random() * 0.0004,
      phase: Math.random() * Math.PI * 2,
      size: 0.6 + Math.random() * 0.6,
      group: Math.floor(i / 3),
    }))
    // Grass blades
    W$.grassBlades = Array.from({ length: 120 }, (_, i) => ({
      x: Math.random(),
      y: 0.58 + Math.random() * 0.38,
      h: 4 + Math.random() * 8,
      phase: Math.random() * Math.PI * 2,
      color: `hsl(${110 + Math.random() * 30},${55 + Math.random() * 25}%,${28 + Math.random() * 18}%)`,
    }))
    // Flowers
    W$.flowers = Array.from({ length: 40 }, (_, i) => ({
      x: 0.06 + Math.random() * 0.88,
      y: 0.58 + Math.random() * 0.35,
      color: ['#ff88bb', '#ff5599', '#dd88ff', '#ffaa44', '#ff6644', '#ff99cc'][i % 6],
      size: 0.7 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
    }))
  }

  // ── SKY & LIGHTING ─────────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t }
  function lerpC(c1, c2, t) {
    return [0, 1, 2].map(i => Math.round(lerp(c1[i], c2[i], t)))
  }
  function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})` }
  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})` }

  const SKY_TIMES = [
    { t: 0.0,  top: [8,12,35],    bot: [18,25,65] },   // midnight
    { t: 0.18, top: [40,20,60],   bot: [120,60,40] },   // dawn
    { t: 0.28, top: [255,180,80], bot: [255,220,130] },  // sunrise
    { t: 0.42, top: [80,160,230], bot: [160,210,255] },  // morning
    { t: 0.5,  top: [55,140,220], bot: [140,200,255] },  // noon
    { t: 0.62, top: [70,150,225], bot: [150,205,255] },  // afternoon
    { t: 0.72, top: [255,160,60], bot: [255,210,120] },  // sunset
    { t: 0.82, top: [40,15,55],   bot: [100,50,80] },    // dusk
    { t: 1.0,  top: [8,12,35],    bot: [18,25,65] },     // midnight
  ]

  function skyAt(t) {
    let i = 0
    while (i < SKY_TIMES.length - 1 && SKY_TIMES[i + 1].t <= t) i++
    const a = SKY_TIMES[i], b = SKY_TIMES[Math.min(i + 1, SKY_TIMES.length - 1)]
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
    return { top: lerpC(a.top, b.top, f), bot: lerpC(a.bot, b.bot, f) }
  }

  function sunAlpha(t) {
    if (t < 0.22 || t > 0.78) return 0
    if (t < 0.3) return (t - 0.22) / 0.08
    if (t > 0.7) return (0.78 - t) / 0.08
    return 1
  }
  function moonAlpha(t) {
    if (t > 0.2 && t < 0.8) return 0
    if (t < 0.1) return 1
    if (t < 0.2) return (0.2 - t) / 0.1
    if (t > 0.9) return 1
    return (t - 0.8) / 0.1
  }

  // ── TERRAIN ────────────────────────────────────────────────────────
  // Gentle rolling hills — isometric feel
  function groundY(nx) {
    return (0.62 + Math.sin(nx * Math.PI * 1.4) * 0.025 + Math.sin(nx * Math.PI * 3.2) * 0.01) * H
  }

  function hillY(nx, offset) {
    return (offset + Math.sin(nx * Math.PI * 0.8 + 1) * 0.04 + Math.sin(nx * Math.PI * 1.6) * 0.015) * H
  }

  // ── DRAW SKY ───────────────────────────────────────────────────────
  function drawSky() {
    const sc = skyAt(W$.timeOfDay)
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.65)
    g.addColorStop(0, rgb(sc.top))
    g.addColorStop(1, rgb(sc.bot))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  function drawCelestial() {
    const t = W$.timeOfDay
    // Sun
    const sa = sunAlpha(t)
    if (sa > 0) {
      const sx = W * (0.72 + Math.sin(t * Math.PI * 0.8) * 0.1)
      const sy = H * (0.08 + (1 - Math.sin((t - 0.25) / 0.55 * Math.PI)) * 0.14)
      ctx.save()
      ctx.globalAlpha = sa * 0.18
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 80)
      sg.addColorStop(0, 'rgba(255,240,150,1)')
      sg.addColorStop(1, 'rgba(255,200,80,0)')
      ctx.fillStyle = sg
      ctx.fillRect(sx - 80, sy - 80, 160, 160)
      ctx.globalAlpha = sa * 0.9
      ctx.fillStyle = '#ffe870'
      ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = sa * 0.25
      ctx.fillStyle = '#fff5a0'
      ctx.beginPath(); ctx.arc(sx, sy, 32, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
    // Moon
    const ma = moonAlpha(t)
    if (ma > 0) {
      const mx = W * 0.2, my = H * 0.12
      ctx.save()
      ctx.globalAlpha = ma * 0.92
      ctx.fillStyle = '#e8dfc8'
      ctx.beginPath(); ctx.arc(mx, my, 16, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(200,190,160,0.5)'
      ctx.beginPath(); ctx.arc(mx + 6, my - 3, 10, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      // Stars
      ctx.save()
      ctx.globalAlpha = ma * 0.85
      for (let i = 0; i < 60; i++) {
        const sx = (i * 73.137 % 1) * W
        const sy = (i * 47.293 % 1) * H * 0.52
        const sr = 0.4 + (Math.sin(i * 1.7 + aT * 1.5) * 0.5 + 0.5) * 0.8
        ctx.fillStyle = 'white'
        ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }
  }

  // ── RAINBOW ────────────────────────────────────────────────────────
  function drawRainbow() {
    if (!W$.unlocks.rainbow) return
    ctx.save()
    const cx = W * 0.5, cy = H * 0.64
    const colors = ['#ff6b6b', '#ff9f43', '#ffd166', '#6bcb77', '#4d96ff', '#a855f7', '#ec4899']
    colors.forEach((c, i) => {
      ctx.beginPath()
      ctx.arc(cx, cy, W * 0.52 - i * 6, Math.PI, 0)
      ctx.strokeStyle = c
      ctx.globalAlpha = 0.32
      ctx.lineWidth = 4.5
      ctx.stroke()
    })
    ctx.restore()
  }

  // ── CLOUDS ─────────────────────────────────────────────────────────
  function drawClouds() {
    W$.clouds.forEach(cl => {
      cl.x = (cl.x + cl.spd) % 1.3
      if (cl.x > 1.25) cl.x = -0.15
      ctx.save()
      ctx.globalAlpha = cl.alpha * (0.75 + sunAlpha(W$.timeOfDay) * 0.2)
      ctx.fillStyle = '#e8eef8'
      const cx = cl.x * W, cy = cl.y * H, r = cl.r * W
      // Fluffy multi-circle cloud
      cl.offsets.forEach(o => {
        ctx.beginPath()
        ctx.arc(cx + o.dx * W, cy + o.dy * H, r * o.r, 0, Math.PI * 2)
        ctx.fill()
      })
      ctx.restore()
    })
  }

  // ── MOUNTAINS ──────────────────────────────────────────────────────
  function drawMountains() {
    if (!W$.unlocks.mountain) return
    const fade = Math.min(1, (W$.xp - 750) / 120)
    ctx.save()
    ctx.globalAlpha = 0.75 * fade
    // Far misty mountains
    const mtColors = ['#8090a8', '#6a7e98', '#5a6e88']
    const mts = [
      { x: 0.12, h: 0.38, w: 0.22 },
      { x: 0.3,  h: 0.32, w: 0.18 },
      { x: 0.68, h: 0.4,  w: 0.24 },
      { x: 0.82, h: 0.34, w: 0.2  },
    ]
    mts.forEach((m, i) => {
      const mx = m.x * W, mh = m.h * H, mw = m.w * W
      const gy = hillY(m.x, 0.62)
      const mg = ctx.createLinearGradient(mx, gy - mh, mx, gy)
      mg.addColorStop(0, mtColors[i % 3])
      mg.addColorStop(0.5, '#5a6878')
      mg.addColorStop(1, '#3a4858')
      ctx.fillStyle = mg
      ctx.beginPath()
      ctx.moveTo(mx - mw * 0.5, gy)
      // Jagged peaks
      ctx.lineTo(mx - mw * 0.25, gy - mh * 0.55)
      ctx.lineTo(mx, gy - mh)
      ctx.lineTo(mx + mw * 0.2, gy - mh * 0.7)
      ctx.lineTo(mx + mw * 0.5, gy - mh * 0.45)
      ctx.lineTo(mx + mw * 0.65, gy)
      ctx.closePath()
      ctx.fill()
      // Snow
      ctx.globalAlpha = 0.85 * fade
      ctx.fillStyle = 'rgba(235,242,255,0.85)'
      ctx.beginPath()
      ctx.moveTo(mx - mw * 0.07, gy - mh * 0.78)
      ctx.lineTo(mx, gy - mh)
      ctx.lineTo(mx + mw * 0.07, gy - mh * 0.78)
      ctx.closePath()
      ctx.fill()
    })
    // Mist
    ctx.globalAlpha = 0.18 * fade
    const mist = ctx.createLinearGradient(0, hillY(0.5, 0.55), 0, hillY(0.5, 0.62))
    mist.addColorStop(0, 'rgba(200,215,235,0.8)')
    mist.addColorStop(1, 'rgba(200,215,235,0)')
    ctx.fillStyle = mist
    ctx.fillRect(0, hillY(0.5, 0.54), W, H * 0.1)
    ctx.restore()
  }

  // ── HILLS ──────────────────────────────────────────────────────────
  function drawHills() {
    // Back hill
    const hg1 = ctx.createLinearGradient(0, H * 0.38, 0, H * 0.64)
    hg1.addColorStop(0, '#4a7a38')
    hg1.addColorStop(0.5, '#3d6830')
    hg1.addColorStop(1, '#2e5224')
    ctx.fillStyle = hg1
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, hillY(x / W, 0.52))
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()

    // Mid hill
    const hg2 = ctx.createLinearGradient(0, H * 0.45, 0, H * 0.66)
    hg2.addColorStop(0, '#5a9040')
    hg2.addColorStop(0.6, '#4a7a35')
    hg2.addColorStop(1, '#38622a')
    ctx.fillStyle = hg2
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, hillY(x / W, 0.57))
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()
  }

  // ── MAIN GROUND ────────────────────────────────────────────────────
  function drawGround() {
    // Rich layered ground
    const gg = ctx.createLinearGradient(0, H * 0.6, 0, H)
    gg.addColorStop(0, '#5aaa3e')
    gg.addColorStop(0.06, '#4e9436')
    gg.addColorStop(0.2, '#3e7a2c')
    gg.addColorStop(0.5, '#2e5e20')
    gg.addColorStop(1, '#1c3e14')
    ctx.fillStyle = gg
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 3) ctx.lineTo(x, groundY(x / W))
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()

    // Grass highlight strip
    ctx.strokeStyle = '#6ec050'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 0; x <= W; x += 3) ctx.lineTo(x, groundY(x / W) - 1)
    ctx.stroke()
  }

  // ── GRASS BLADES ───────────────────────────────────────────────────
  function drawGrass() {
    const wind = W$.windPhase
    W$.grassBlades.forEach(b => {
      const bx = b.x * W
      const by = groundY(b.x)
      if (by > H + 5) return
      const sway = Math.sin(wind + b.phase) * (b.h * 0.35)
      ctx.strokeStyle = b.color
      ctx.lineWidth = 1
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.quadraticCurveTo(bx + sway * 0.5, by - b.h * 0.6, bx + sway, by - b.h)
      ctx.stroke()
    })
  }

  // ── SMALL PLANTS ───────────────────────────────────────────────────
  function drawSmallPlants() {
    if (!W$.unlocks.smallPlants) return
    const fade = Math.min(1, (W$.xp - 20) / 40)
    const positions = [0.15, 0.22, 0.48, 0.55, 0.72, 0.82, 0.9]
    positions.forEach((nx, i) => {
      const px = nx * W, py = groundY(nx)
      ctx.save()
      ctx.globalAlpha = fade
      ctx.strokeStyle = '#4a8830'
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      const sway = Math.sin(W$.windPhase + i * 1.3) * 2
      ctx.beginPath()
      ctx.moveTo(px, py - 1)
      ctx.quadraticCurveTo(px + sway, py - 9, px + sway * 1.5, py - 14)
      ctx.stroke()
      ctx.fillStyle = `hsl(${125 + i * 8},60%,35%)`
      ctx.beginPath(); ctx.arc(px + sway * 1.5, py - 15, 4, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    })
  }

  // ── FLOWERS ────────────────────────────────────────────────────────
  function drawFlowers() {
    if (!W$.unlocks.flowers) return
    const fade = Math.min(1, (W$.xp - 60) / 60)
    W$.flowers.forEach((fl, i) => {
      const fx = fl.x * W, fy = groundY(fl.x)
      if (fy > H + 5) return
      ctx.save()
      ctx.globalAlpha = fade * 0.92
      const sway = Math.sin(W$.windPhase * 0.8 + fl.phase) * 1.8
      // Stem
      ctx.strokeStyle = '#4a8830'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(fx, fy)
      ctx.quadraticCurveTo(fx + sway, fy - 7, fx + sway, fy - 11)
      ctx.stroke()
      // Petals
      const ph = aT * 0.3 + fl.phase
      ctx.fillStyle = fl.color
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + ph
        ctx.beginPath()
        ctx.ellipse(fx + sway + Math.cos(a) * 3.5, fy - 11 + Math.sin(a) * 3.5, 2.5, 1.5, a, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#ffd700'
      ctx.beginPath(); ctx.arc(fx + sway, fy - 11, 2, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    })
  }

  // ── TREES ──────────────────────────────────────────────────────────
  function drawTree(nx, type, size) {
    const tx = nx * W, ty = groundY(nx), s = size || 1
    const sway = Math.sin(W$.windPhase * 0.6 + nx * 5) * (2 * s)

    // Trunk
    const tg = ctx.createLinearGradient(tx, ty - 55 * s, tx, ty)
    tg.addColorStop(0, '#7a4e28')
    tg.addColorStop(1, '#4e2e10')
    ctx.fillStyle = tg
    const tw = 8 * s
    ctx.beginPath()
    ctx.moveTo(tx - tw * 0.5, ty)
    ctx.lineTo(tx - tw * 0.3, ty - 55 * s)
    ctx.lineTo(tx + tw * 0.3, ty - 55 * s)
    ctx.lineTo(tx + tw * 0.5, ty)
    ctx.closePath()
    ctx.fill()

    if (type === 'pine') {
      // Layered pine
      const layers = [
        { y: 50, hw: 20 }, { y: 38, hw: 26 }, { y: 26, hw: 22 },
        { y: 14, hw: 16 }, { y: 4, hw: 10 }
      ]
      layers.forEach((l, i) => {
        const shade = 0.6 + i * 0.1
        const lg = ctx.createLinearGradient(tx - l.hw * s, ty - l.y * s - 22 * s, tx + l.hw * s + sway, ty - l.y * s)
        lg.addColorStop(0, `hsl(130,45%,${22 + i * 4}%)`)
        lg.addColorStop(1, `hsl(125,40%,${18 + i * 3}%)`)
        ctx.fillStyle = lg
        ctx.beginPath()
        ctx.moveTo(tx - l.hw * s, ty - l.y * s)
        ctx.lineTo(tx + sway * 0.7, ty - (l.y + 22) * s)
        ctx.lineTo(tx + l.hw * s + sway, ty - l.y * s)
        ctx.closePath()
        ctx.fill()
      })
    } else {
      // Round canopy tree
      const baseY = ty - 58 * s
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.1)'
      ctx.beginPath(); ctx.ellipse(tx + 5 * s, baseY + 5 * s, 32 * s, 18 * s, 0, 0, Math.PI * 2); ctx.fill()
      // Back leaves
      const lg2 = ctx.createRadialGradient(tx - 5*s, baseY - 5*s, 0, tx + sway, baseY, 34*s)
      lg2.addColorStop(0, '#5aaa3a')
      lg2.addColorStop(0.5, '#3e8828')
      lg2.addColorStop(1, '#2a6618')
      ctx.fillStyle = lg2
      ctx.beginPath(); ctx.arc(tx + sway, baseY, 32 * s, 0, Math.PI * 2); ctx.fill()
      // Sub canopy clusters
      ctx.fillStyle = '#4a9830'
      ctx.beginPath(); ctx.arc(tx - 18*s + sway*0.5, baseY + 10*s, 18*s, 0, Math.PI*2); ctx.fill()
      ctx.beginPath(); ctx.arc(tx + 18*s + sway, baseY + 10*s, 16*s, 0, Math.PI*2); ctx.fill()
      ctx.beginPath(); ctx.arc(tx + sway*0.8, baseY - 20*s, 18*s, 0, Math.PI*2); ctx.fill()
      // Highlight
      ctx.fillStyle = 'rgba(150,220,80,0.2)'
      ctx.beginPath(); ctx.arc(tx - 10*s + sway*0.3, baseY - 12*s, 14*s, 0, Math.PI*2); ctx.fill()
      // Fruit if high grade
      if (W$.grade >= 75) {
        for (let i = 0; i < 4; i++) {
          const ax = tx + Math.cos(i * 1.57 + 0.5) * 20 * s + sway
          const ay = baseY + Math.sin(i * 1.57 + 0.5) * 12 * s + 6 * s
          ctx.fillStyle = '#cc3322'
          ctx.beginPath(); ctx.arc(ax, ay, 3.5 * s, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#ff6655'
          ctx.beginPath(); ctx.arc(ax - s, ay - s, 1.3 * s, 0, Math.PI * 2); ctx.fill()
        }
      }
    }
  }

  function drawTrees() {
    if (W$.unlocks.tree2) {
      drawTree(0.08, 'pine', 0.85)
      drawTree(0.15, 'round', 0.9)
      drawTree(0.82, 'pine', 0.9)
      drawTree(0.9, 'round', 0.85)
    }
    if (W$.unlocks.tree1) {
      drawTree(0.22, 'round', 1.05)
      drawTree(0.72, 'pine', 1.0)
    }
  }

  // ── RIVER ──────────────────────────────────────────────────────────
  function drawRiver() {
    if (!W$.unlocks.river) return
    const fade = Math.min(1, (W$.streak - 5) / 4)
    ctx.save()
    ctx.globalAlpha = fade

    // River path — gentle S-curve
    const ry = groundY(0.48) + 4
    const rg = ctx.createLinearGradient(W * 0.3, ry - 8, W * 0.65, ry + 8)
    rg.addColorStop(0, '#3a88c8')
    rg.addColorStop(0.5, '#2a78b8')
    rg.addColorStop(1, '#1a6898')
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.moveTo(W * 0.28, ry + 10)
    ctx.quadraticCurveTo(W * 0.38, ry - 12, W * 0.48, ry)
    ctx.quadraticCurveTo(W * 0.58, ry + 12, W * 0.66, ry - 5)
    ctx.lineTo(W * 0.68, ry + 5)
    ctx.quadraticCurveTo(W * 0.58, ry + 18, W * 0.48, ry + 10)
    ctx.quadraticCurveTo(W * 0.38, ry - 2, W * 0.28, ry + 20)
    ctx.closePath()
    ctx.fill()

    // Water shimmer
    ctx.strokeStyle = 'rgba(150,220,255,0.45)'
    ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const rx = W * (0.3 + i * 0.07)
      const rwy = ry + Math.sin(aT * 2 + i * 1.2) * 2
      ctx.beginPath()
      ctx.moveTo(rx, rwy)
      ctx.lineTo(rx + 8 + Math.sin(aT + i) * 4, rwy)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── BRIDGE ─────────────────────────────────────────────────────────
  function drawBridge() {
    if (!W$.unlocks.bridge) return
    const fade = Math.min(1, (W$.streak - 8) / 4)
    const bx = W * 0.48, by = groundY(0.48) + 2
    ctx.save()
    ctx.globalAlpha = fade
    // Bridge planks
    ctx.fillStyle = '#a87040'
    ctx.strokeStyle = '#8a5820'
    ctx.lineWidth = 1
    for (let i = 0; i < 6; i++) {
      const px = bx - 22 + i * 8
      ctx.fillRect(px, by - 5, 7, 12)
      ctx.strokeRect(px, by - 5, 7, 12)
    }
    // Railings
    ctx.strokeStyle = '#7a4a18'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bx - 22, by - 5); ctx.lineTo(bx + 24, by - 5)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx - 22, by + 8); ctx.lineTo(bx + 24, by + 8)
    ctx.stroke()
    ctx.restore()
  }

  // ── HOUSE ──────────────────────────────────────────────────────────
  function drawHouse() {
    if (!W$.unlocks.house) return
    const fade = Math.min(1, (W$.streak - 12) / 4)
    const hx = W * 0.78, hy = groundY(0.78)
    const hw = 62, hh = 50
    ctx.save()
    ctx.globalAlpha = fade

    // Foundation shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)'
    ctx.beginPath(); ctx.ellipse(hx, hy + 2, hw * 0.55, 7, 0, 0, Math.PI * 2); ctx.fill()

    // Walls — warm wood
    const wg = ctx.createLinearGradient(hx - hw / 2, hy - hh, hx + hw / 2, hy)
    wg.addColorStop(0, '#d4a86a')
    wg.addColorStop(0.5, '#c09050')
    wg.addColorStop(1, '#a87038')
    ctx.fillStyle = wg
    ctx.beginPath(); ctx.roundRect(hx - hw / 2, hy - hh, hw, hh, [3, 3, 0, 0]); ctx.fill()
    // Wood plank lines
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 0.7
    for (let i = 1; i < 5; i++) {
      ctx.beginPath()
      ctx.moveTo(hx - hw / 2, hy - hh + i * (hh / 5))
      ctx.lineTo(hx + hw / 2, hy - hh + i * (hh / 5))
      ctx.stroke()
    }

    // Roof
    const rg = ctx.createLinearGradient(hx, hy - hh - 36, hx, hy - hh)
    rg.addColorStop(0, '#8a2a1a')
    rg.addColorStop(0.6, '#6e2018')
    rg.addColorStop(1, '#5a1a10')
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.moveTo(hx - hw / 2 - 10, hy - hh + 2)
    ctx.lineTo(hx - 2, hy - hh - 36)
    ctx.lineTo(hx + hw / 2 + 10, hy - hh + 2)
    ctx.closePath()
    ctx.fill()
    // Roof ridge tile
    ctx.fillStyle = '#9a3020'
    ctx.fillRect(hx - 3, hy - hh - 36, 6, 36)

    // Chimney
    ctx.fillStyle = '#8a7060'
    ctx.fillRect(hx + 14, hy - hh - 46, 10, 20)
    // Smoke
    for (let i = 0; i < 4; i++) {
      const puff = (aT * 0.5 + i * 0.25) % 1
      ctx.globalAlpha = (1 - puff) * fade * 0.35
      ctx.fillStyle = '#c8c8c8'
      ctx.beginPath()
      ctx.arc(hx + 19 + Math.sin(puff * 3) * 5, hy - hh - 46 - puff * 22, 3 + puff * 5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = fade

    // Door
    const dg = ctx.createLinearGradient(hx - 10, hy - 26, hx + 10, hy)
    dg.addColorStop(0, '#7a4828')
    dg.addColorStop(1, '#5a3018')
    ctx.fillStyle = dg
    ctx.beginPath(); ctx.roundRect(hx - 9, hy - 25, 18, 25, [4, 4, 0, 0]); ctx.fill()
    ctx.fillStyle = '#f0c040'
    ctx.beginPath(); ctx.arc(hx + 5, hy - 12, 2, 0, Math.PI * 2); ctx.fill()

    // Windows with warm light
    const nightFactor = moonAlpha(W$.timeOfDay)
    const winColor = `rgba(255,${Math.round(200 + Math.sin(aT * 0.3) * 20)},100,${0.6 + nightFactor * 0.3})`
    ctx.fillStyle = winColor
    ctx.beginPath(); ctx.roundRect(hx - hw / 2 + 8, hy - hh + 12, 15, 12, 2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(hx + hw / 2 - 23, hy - hh + 12, 15, 12, 2); ctx.fill()
    // Window frames
    ctx.strokeStyle = '#a87038'
    ctx.lineWidth = 1
    ctx.strokeRect(hx - hw / 2 + 8, hy - hh + 12, 15, 12)
    ctx.strokeRect(hx + hw / 2 - 23, hy - hh + 12, 15, 12)
    // Cross bars
    ctx.beginPath()
    ctx.moveTo(hx - hw / 2 + 15, hy - hh + 12)
    ctx.lineTo(hx - hw / 2 + 15, hy - hh + 24)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(hx + hw / 2 - 16, hy - hh + 12)
    ctx.lineTo(hx + hw / 2 - 16, hy - hh + 24)
    ctx.stroke()

    ctx.restore()
  }

  // ── LANTERNS ───────────────────────────────────────────────────────
  function drawLanterns() {
    if (!W$.unlocks.lanterns) return
    const fade = Math.min(1, (W$.xp - 550) / 100)
    const nightF = moonAlpha(W$.timeOfDay) * 0.85 + 0.15
    W$.lanterns.forEach(ln => {
      const lx = ln.x * W, ly = groundY(ln.x)
      ctx.save()
      ctx.globalAlpha = fade
      // Pole
      ctx.strokeStyle = '#6a4a28'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly - 32); ctx.stroke()
      // Lantern glow
      ctx.globalAlpha = fade * nightF * 0.5
      const gg = ctx.createRadialGradient(lx, ly - 35, 0, lx, ly - 35, 25)
      gg.addColorStop(0, 'rgba(255,200,80,0.8)')
      gg.addColorStop(1, 'rgba(255,160,40,0)')
      ctx.fillStyle = gg
      ctx.fillRect(lx - 25, ly - 60, 50, 50)
      // Lantern body
      ctx.globalAlpha = fade
      ctx.fillStyle = '#c87a20'
      ctx.beginPath(); ctx.roundRect(lx - 6, ly - 42, 12, 14, 2); ctx.fill()
      ctx.fillStyle = `rgba(255,${Math.round(200 + Math.sin(aT + lx) * 20)},80,${0.7 + nightF * 0.25})`
      ctx.beginPath(); ctx.roundRect(lx - 4, ly - 40, 8, 10, 1); ctx.fill()
      ctx.restore()
    })
  }

  // ── VILLAGE ────────────────────────────────────────────────────────
  function drawVillage() {
    if (!W$.unlocks.village) return
    const fade = Math.min(1, (W$.streak - 28) / 4)
    // Extra small houses in background
    const vh = [
      { x: 0.05, s: 0.55 }, { x: 0.94, s: 0.55 },
      { x: 0.88, s: 0.6 },
    ]
    ctx.save()
    ctx.globalAlpha = fade * 0.75
    vh.forEach(v => {
      const vx = v.x * W, vy = hillY(v.x, 0.57), s = v.s
      const vw = 42 * s, vhh = 32 * s
      ctx.fillStyle = '#c8985a'
      ctx.fillRect(vx - vw / 2, vy - vhh, vw, vhh)
      ctx.fillStyle = '#7a2018'
      ctx.beginPath()
      ctx.moveTo(vx - vw / 2 - 6 * s, vy - vhh + 2)
      ctx.lineTo(vx, vy - vhh - 24 * s)
      ctx.lineTo(vx + vw / 2 + 6 * s, vy - vhh + 2)
      ctx.closePath()
      ctx.fill()
    })
    ctx.restore()
  }

  // ── BIRDS ──────────────────────────────────────────────────────────
  function drawBirds() {
    if (!W$.unlocks.birds) return
    W$.birds.forEach(b => {
      b.x = (b.x + b.spd) % 1.2
      if (b.x > 1.15) b.x = -0.1
      const bx = b.x * W, by = b.y * H
      const wing = Math.sin(aT * 9 + b.phase) * 6 * b.size
      ctx.strokeStyle = `rgba(20,20,40,0.75)`
      ctx.lineWidth = 1.5 * b.size
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bx - 7 * b.size, by - wing * 0.5)
      ctx.quadraticCurveTo(bx, by + 1, bx + 7 * b.size, by - wing * 0.5)
      ctx.stroke()
    })
  }

  // ── CHARACTER ──────────────────────────────────────────────────────
  function drawChar() {
    const c = W$.char
    // Move towards target
    const dx = c.targetX - c.x
    if (Math.abs(dx) < 0.006) {
      // Idle — pick new target
      c.idle++
      if (c.idle > 200) {
        c.targetX = 0.12 + Math.random() * 0.55
        c.idle = 0
      }
    } else {
      c.dir = dx > 0 ? 1 : -1
      c.x += dx * 0.0025
      c.step += 0.18
    }

    const px = c.x * W
    const py = groundY(c.x)
    const walking = Math.abs(dx) > 0.008
    const legSwing = walking ? Math.sin(c.step) * 6 : 0
    const breathe = Math.sin(aT * 1.5) * 0.8
    const s = 1.1

    ctx.save()
    ctx.translate(px, py + breathe * 0.3)
    if (c.dir < 0) ctx.scale(-1, 1)

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)'
    ctx.beginPath(); ctx.ellipse(0, 1, 11, 4, 0, 0, Math.PI * 2); ctx.fill()

    // Shoes
    ctx.fillStyle = '#2a2040'
    ctx.beginPath(); ctx.ellipse(-5, -3 + legSwing, 5.5, 2.8, -0.1, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(5, -3 - legSwing, 5.5, 2.8, 0.1, 0, Math.PI * 2); ctx.fill()

    // Legs
    ctx.fillStyle = '#2a4a9a'
    ctx.beginPath(); ctx.roundRect(-7.5, -20, 6, 18 + legSwing, 3); ctx.fill()
    ctx.beginPath(); ctx.roundRect(1.5, -20, 6, 18 - legSwing, 3); ctx.fill()

    // Bag / backpack
    ctx.fillStyle = '#8a6a3a'
    ctx.beginPath(); ctx.roundRect(-9, -38, 8, 14, 3); ctx.fill()
    ctx.fillStyle = '#6a4a20'
    ctx.beginPath(); ctx.roundRect(-8, -36, 6, 5, 1); ctx.fill()

    // Body
    const bg = ctx.createLinearGradient(-8 * s, -42 * s, 8 * s, -20 * s)
    bg.addColorStop(0, '#e85a2a')
    bg.addColorStop(1, '#c84020')
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.roundRect(-8, -42, 16, 23, 4); ctx.fill()

    // Collar
    ctx.fillStyle = '#f0f0f0'
    ctx.fillRect(-4, -42, 8, 4)

    // Head
    ctx.fillStyle = '#f0c090'
    ctx.beginPath(); ctx.arc(0, -50, 9.5, 0, Math.PI * 2); ctx.fill()
    // Cheeks
    ctx.fillStyle = 'rgba(255,150,120,0.35)'
    ctx.beginPath(); ctx.ellipse(-6, -47, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill()

    // Hair — dark, slightly long
    ctx.fillStyle = '#2a1808'
    ctx.beginPath()
    ctx.moveTo(-9.5, -50)
    ctx.quadraticCurveTo(-2, -62, 9.5, -50)
    ctx.arc(0, -50, 9.5, 0, Math.PI, true)
    ctx.closePath(); ctx.fill()
    // Hair wisps
    ctx.beginPath()
    ctx.moveTo(9, -54); ctx.quadraticCurveTo(13, -58, 10, -62); ctx.strokeStyle = '#2a1808'; ctx.lineWidth = 2; ctx.stroke()

    // Eyes
    ctx.fillStyle = '#1a1030'
    ctx.beginPath(); ctx.ellipse(4.5, -49, 2, 2.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'white'
    ctx.beginPath(); ctx.arc(5, -49.8, 0.8, 0, Math.PI * 2); ctx.fill()

    // Smile
    ctx.strokeStyle = '#c07050'
    ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.arc(0, -46, 3.5, 0.15, Math.PI - 0.15); ctx.stroke()

    // Arms
    ctx.strokeStyle = '#e85a2a'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-8, -36); ctx.lineTo(-15, -28 + legSwing * 0.4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(8, -36); ctx.lineTo(15, -28 - legSwing * 0.4); ctx.stroke()
    // Hands
    ctx.fillStyle = '#f0c090'
    ctx.beginPath(); ctx.arc(-15, -27 + legSwing * 0.4, 3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(15, -27 - legSwing * 0.4, 3, 0, Math.PI * 2); ctx.fill()

    ctx.restore()
  }

  // ── MINIMAL HUD ────────────────────────────────────────────────────
  function drawHUD() {
    const pad = 10
    // Small floating XP wooden sign
    ctx.save()
    ctx.globalAlpha = 0.82
    // XP bubble - top right
    const xpText = `${W$.xp} XP`
    ctx.font = '700 12px Inter,system-ui'
    const xpW = ctx.measureText(xpText).width + 20
    ctx.fillStyle = '#c89a50'
    ctx.beginPath(); ctx.roundRect(W - xpW - pad, pad, xpW, 24, 6); ctx.fill()
    ctx.fillStyle = '#6a3a10'
    ctx.beginPath(); ctx.roundRect(W - xpW - pad, pad, xpW, 24, 6)
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#a87a30'; ctx.stroke()
    ctx.fillStyle = '#3a1a08'
    ctx.textAlign = 'center'
    ctx.fillText(`⭐ ${xpText}`, W - xpW / 2 - pad, pad + 16)

    // Streak - top left
    if (W$.streak > 0) {
      const stText = `${W$.streak} 🔥`
      const stW = ctx.measureText(stText).width + 20
      ctx.fillStyle = '#c89a50'
      ctx.beginPath(); ctx.roundRect(pad, pad, stW, 24, 6); ctx.fill()
      ctx.strokeStyle = '#a87a30'
      ctx.beginPath(); ctx.roundRect(pad, pad, stW, 24, 6); ctx.stroke()
      ctx.fillStyle = '#3a1a08'
      ctx.textAlign = 'center'
      ctx.fillText(stText, pad + stW / 2, pad + 16)
    }
    ctx.restore()
  }

  // ── PARTICLES ──────────────────────────────────────────────────────
  function drawParticles() {
    W$.particles = W$.particles.filter(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life -= 0.022; p.r *= 0.97
      if (p.life <= 0) return false
      ctx.save()
      ctx.globalAlpha = p.life
      ctx.fillStyle = p.color
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      return true
    })
    W$.texts = W$.texts.filter(t => {
      t.y -= 1.0; t.life -= 0.016
      if (t.life <= 0) return false
      ctx.save()
      ctx.globalAlpha = t.life
      ctx.font = `700 13px Inter,system-ui`
      ctx.textAlign = 'center'
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, t.y)
      ctx.restore()
      return true
    })
  }

  // ── AMBIENT PARTICLES (fireflies at night) ─────────────────────────
  function maybeSpawnFirefly() {
    if (moonAlpha(W$.timeOfDay) < 0.3) return
    if (Math.random() < 0.02 && W$.unlocks.house) {
      W$.particles.push({
        x: 50 + Math.random() * (W - 100),
        y: groundY(0.5) - 20 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -0.3 - Math.random() * 0.5,
        r: 1.5 + Math.random(),
        color: '#c0ff80',
        life: 1
      })
    }
  }

  // ── MAIN LOOP ──────────────────────────────────────────────────────
  function loop(ts) {
    if (!canvas || !ctx) return
    rafId = requestAnimationFrame(loop)
    const dt = Math.min(ts - lastT, 50); lastT = ts
    aT += dt * 0.001

    W = canvas.width / dpr
    H = canvas.height / dpr
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)

    // Update world
    W$.windPhase = aT * 1.4
    W$.timeOfDay = (Math.sin(aT * 0.07) * 0.5 + 0.5)

    maybeSpawnFirefly()

    // Draw layers (back to front)
    drawSky()
    drawCelestial()
    drawRainbow()
    drawClouds()
    drawMountains()
    drawHills()
    drawGround()
    drawGrass()
    drawSmallPlants()
    drawFlowers()
    drawTrees()
    drawRiver()
    drawBridge()
    drawHouse()
    drawVillage()
    drawLanterns()
    drawBirds()
    drawChar()
    drawParticles()
    drawHUD()

    ctx.restore()
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────
  function init(canvasEl, data) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    canvas = canvasEl
    dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx = canvas.getContext('2d')
    initData()
    update(data)
    lastT = performance.now()
    rafId = requestAnimationFrame(loop)
    initialized = true
  }

  function update(data) {
    if (!data) return
    W$.streak = data.streak || 0
    W$.xp = data.xp || 0
    W$.grade = data.grade || 0
    const newU = calcUnlocks()
    // Celebrate new unlocks
    if (newU.length && canvas) {
      newU.forEach(u => {
        for (let i = 0; i < 25; i++) {
          W$.particles.push({
            x: canvas.width / dpr / 2,
            y: canvas.height / dpr * 0.5,
            vx: (Math.random() - 0.5) * 7,
            vy: -Math.random() * 8 - 2,
            r: 3 + Math.random() * 4,
            color: ['#ffd700','#ff9f43','#00c896','#6c63ff'][Math.floor(Math.random() * 4)],
            life: 1
          })
        }
        W$.texts.push({ x: canvas.width / dpr / 2, y: canvas.height / dpr * 0.4, text: `${u.emoji} ${u.label} ochildi!`, color: '#ffd700', life: 1 })
      })
    }
    return newU
  }

  function destroy() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    canvas = null; ctx = null; initialized = false
  }

  function getNextUnlock() { return getNext() }
  function getUnlocks() { return { ...W$.unlocks } }
  function getDoneCount() { return UNLOCKS.filter(u => W$.unlocks[u.key]).length }
  function getTotalCount() { return UNLOCKS.length }

  return { init, update, destroy, getNextUnlock, getUnlocks, getDoneCount, getTotalCount }
})()
