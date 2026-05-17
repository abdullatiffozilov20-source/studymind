// ================================================================
//  StudyMind Garden v1.0
//  Standalone garden.js — app.html ga <script src="garden.js"> qo'shiladi
//  O'quvchi streak, xp, grade asosida dunyo quriladi
//  Avtomatik — fake qilib bo'lmaydi
// ================================================================

window.StudyMindGarden = (function(){
  'use strict'

  let canvas, ctx, W, H
  let animT = 0, lastT = 0
  let gardenState = {
    streak: 0, xp: 0, grade: 0,
    level: 0,
    unlocks: {},
    player: { x: 0.25, dir: 1, step: 0 },
    particles: [],
    floatingTexts: [],
    clouds: [
      { x: 0.08, y: 0.1, w: 0.22, spd: 0.00007 },
      { x: 0.5,  y: 0.07, w: 0.18, spd: 0.00005 },
      { x: 0.78, y: 0.14, w: 0.2,  spd: 0.00009 },
    ],
    birds: [
      { x: 0.3, y: 0.16, ph: 0,   spd: 0.0009 },
      { x: 0.6, y: 0.12, ph: 1.5, spd: 0.0007 },
      { x: 0.85,y: 0.19, ph: 0.8, spd: 0.0011 },
    ],
    flowers: [0.06,0.1,0.15,0.34,0.38,0.61,0.65,0.82,0.87,0.92],
    targetX: 0.5,
  }

  // ── UNLOCK RULES ──────────────────────────────────────────────────
  // Faqat real ma'lumotlar asosida — fake qilib bo'lmaydi
  const UNLOCK_RULES = [
    { key: 'ground',   label: 'Yashil maydon',  emoji: '🌿', cond: s => true },
    { key: 'tree1',    label: 'Birinchi daraxt', emoji: '🌳', cond: s => s.streak >= 3 },
    { key: 'flowers',  label: 'Gullar',          emoji: '🌸', cond: s => s.grade >= 70 },
    { key: 'ariq',     label: 'Ariq',            emoji: '💧', cond: s => s.xp >= 100 },
    { key: 'tree2',    label: 'Qarag\'ay',        emoji: '🌲', cond: s => s.streak >= 7 },
    { key: 'lake',     label: "Ko'l",             emoji: '🏞️', cond: s => s.streak >= 10 },
    { key: 'birds',    label: 'Qushlar',          emoji: '🐦', cond: s => s.streak >= 10 },
    { key: 'house',    label: 'Uy',               emoji: '🏠', cond: s => s.streak >= 14 },
    { key: 'mountain', label: "Tog'",             emoji: '⛰️', cond: s => s.xp >= 500 },
    { key: 'rainbow',  label: 'Kamalak',          emoji: '🌈', cond: s => s.streak >= 30 && s.grade >= 85 },
  ]

  function updateUnlocks() {
    const prev = { ...gardenState.unlocks }
    UNLOCK_RULES.forEach(r => {
      gardenState.unlocks[r.key] = r.cond(gardenState)
    })
    // Return newly unlocked items
    return UNLOCK_RULES.filter(r => gardenState.unlocks[r.key] && !prev[r.key])
  }

  function nextUnlock() {
    const next = UNLOCK_RULES.find(r => !gardenState.unlocks[r.key])
    if (!next) return { label: 'Mukammal dunyo!', emoji: '🌟', hint: '' }
    const s = gardenState
    let hint = ''
    if (next.key === 'tree1')    hint = `${3 - s.streak} kun streak kerak`
    else if (next.key === 'flowers')  hint = `Bahongiz ${70 - s.grade} ballga o'sishi kerak`
    else if (next.key === 'ariq')     hint = `${100 - s.xp} XP kerak`
    else if (next.key === 'tree2')    hint = `${7 - s.streak} kun streak kerak`
    else if (next.key === 'lake')     hint = `${10 - s.streak} kun streak kerak`
    else if (next.key === 'birds')    hint = `${10 - s.streak} kun streak kerak`
    else if (next.key === 'house')    hint = `${14 - s.streak} kun streak kerak`
    else if (next.key === 'mountain') hint = `${500 - s.xp} XP kerak`
    else if (next.key === 'rainbow')  hint = `${30 - s.streak} streak + 85 baho`
    return { ...next, hint }
  }

  // ── HELPERS ───────────────────────────────────────────────────────
  function gY(nx) {
    return H * 0.71 + Math.sin(nx * Math.PI * 2.3) * 7 + Math.sin(nx * Math.PI * 5.1) * 3
  }

  function lerpColor(a, b, t) {
    const p = (hex) => [
      parseInt(hex.slice(1,3),16),
      parseInt(hex.slice(3,5),16),
      parseInt(hex.slice(5,7),16)
    ]
    const [ar,ag,ab] = p(a), [br,bg,bb] = p(b)
    const r = Math.round(ar+(br-ar)*t)
    const g = Math.round(ag+(bg-ag)*t)
    const bl = Math.round(ab+(bb-ab)*t)
    return `rgb(${r},${g},${bl})`
  }

  function skyColors(t) {
    // t: 0=noon, slow sine cycle
    const noon  = { top:'#3a7abf', bot:'#7ab8d8' }
    const eve   = { top:'#1a1a50', bot:'#4a2a6a' }
    const night = { top:'#04060e', bot:'#080c1e' }
    const dawn  = { top:'#2a1a40', bot:'#7a4a2a' }
    if (t < 0.25) {
      const f = t / 0.25
      return { top: lerpColor(noon.top, eve.top, f), bot: lerpColor(noon.bot, eve.bot, f) }
    } else if (t < 0.5) {
      const f = (t - 0.25) / 0.25
      return { top: lerpColor(eve.top, night.top, f), bot: lerpColor(eve.bot, night.bot, f) }
    } else if (t < 0.75) {
      const f = (t - 0.5) / 0.25
      return { top: lerpColor(night.top, dawn.top, f), bot: lerpColor(night.bot, dawn.bot, f) }
    } else {
      const f = (t - 0.75) / 0.25
      return { top: lerpColor(dawn.top, noon.top, f), bot: lerpColor(dawn.bot, noon.bot, f) }
    }
  }

  // ── DRAW FUNCTIONS ────────────────────────────────────────────────
  function drawSky() {
    const t = (Math.sin(animT * 0.08) * 0.5 + 0.5)
    const sc = skyColors(t)
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.73)
    g.addColorStop(0, sc.top)
    g.addColorStop(1, sc.bot)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // Stars at night
    if (t > 0.35 && t < 0.85) {
      const op = t < 0.45 ? (t-0.35)*10 : t > 0.75 ? (0.85-t)*10 : 1
      ctx.save()
      ctx.globalAlpha = op * 0.9
      for (let i = 0; i < 50; i++) {
        const sx = (i * 73.137 % 1) * W
        const sy = (i * 47.293 % 1) * H * 0.55
        const r = 0.5 + (Math.sin(i * 1.7 + animT * 2) * 0.5 + 0.5)
        ctx.fillStyle = 'white'
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
  }

  function drawSun() {
    const t = (Math.sin(animT * 0.08) * 0.5 + 0.5)
    if (t > 0.3 && t < 0.7) return
    const op = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1
    ctx.save()
    ctx.globalAlpha = op * 0.92
    const sx = W * 0.8, sy = H * 0.16
    // Outer glow
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 65)
    g.addColorStop(0, 'rgba(255,220,80,0.35)')
    g.addColorStop(1, 'rgba(255,200,50,0)')
    ctx.fillStyle = g
    ctx.fillRect(sx - 65, sy - 65, 130, 130)
    // Sun
    ctx.fillStyle = '#ffd040'
    ctx.beginPath()
    ctx.arc(sx, sy, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffe870'
    ctx.beginPath()
    ctx.arc(sx - 6, sy - 5, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function drawMoon() {
    const t = (Math.sin(animT * 0.08) * 0.5 + 0.5)
    if (t < 0.4 || t > 0.8) return
    const op = t < 0.5 ? (t-0.4)*10 : t > 0.7 ? (0.8-t)*10 : 1
    ctx.save()
    ctx.globalAlpha = op
    ctx.fillStyle = '#e8e0c8'
    ctx.beginPath()
    ctx.arc(W * 0.18, H * 0.14, 24, 0, Math.PI * 2)
    ctx.fill()
    // Crater effect
    ctx.fillStyle = 'rgba(0,0,0,0.08)'
    ctx.beginPath()
    ctx.arc(W * 0.18 + 8, H * 0.14 - 5, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function drawRainbow() {
    if (!gardenState.unlocks.rainbow) return
    ctx.save()
    const cx = W * 0.5, cy = H * 0.68
    const colors = ['#ff6b6b','#ff9f43','#ffd166','#6bcb77','#4d96ff','#a855f7']
    colors.forEach((c, i) => {
      ctx.beginPath()
      ctx.arc(cx, cy, W * 0.58 - i * 7, Math.PI, 0)
      ctx.strokeStyle = c
      ctx.globalAlpha = 0.38
      ctx.lineWidth = 5
      ctx.stroke()
    })
    ctx.restore()
  }

  function drawClouds() {
    gardenState.clouds.forEach(cl => {
      cl.x = (cl.x + cl.spd) % 1.25
      const cx = cl.x * W, cy = cl.y * H, cw = cl.w * W
      ctx.save()
      ctx.fillStyle = 'rgba(215,228,248,0.82)'
      ctx.beginPath()
      ctx.arc(cx, cy, cw * 0.38, 0, Math.PI * 2)
      ctx.arc(cx + cw * 0.28, cy - cw * 0.12, cw * 0.28, 0, Math.PI * 2)
      ctx.arc(cx + cw * 0.52, cy, cw * 0.32, 0, Math.PI * 2)
      ctx.arc(cx - cw * 0.22, cy + cw * 0.05, cw * 0.24, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    })
  }

  function drawMountain() {
    if (!gardenState.unlocks.mountain) return
    const fade = Math.min(1, (gardenState.xp - 450) / 100)
    ctx.save()
    ctx.globalAlpha = 0.7 * fade
    // Far mountain
    const g1 = ctx.createLinearGradient(W*0.55, H*0.25, W*0.82, H*0.72)
    g1.addColorStop(0, '#7a8fa0')
    g1.addColorStop(0.4, '#5a7080')
    g1.addColorStop(1, '#3a5060')
    ctx.fillStyle = g1
    ctx.beginPath()
    ctx.moveTo(W*0.52, H*0.72)
    ctx.lineTo(W*0.7, H*0.24)
    ctx.lineTo(W*0.88, H*0.72)
    ctx.closePath()
    ctx.fill()
    // Snow
    ctx.globalAlpha = 0.9 * fade
    ctx.fillStyle = '#eef3ff'
    ctx.beginPath()
    ctx.moveTo(W*0.7, H*0.24)
    ctx.lineTo(W*0.65, H*0.35)
    ctx.lineTo(W*0.75, H*0.35)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  function drawGround() {
    // Main ground
    const g = ctx.createLinearGradient(0, H*0.69, 0, H)
    g.addColorStop(0, '#4a8a32')
    g.addColorStop(0.08, '#3a7028')
    g.addColorStop(0.3, '#2a5a1e')
    g.addColorStop(1, '#162e10')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 3) ctx.lineTo(x, gY(x / W))
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fill()
    // Grass highlights
    ctx.strokeStyle = '#5aaa42'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 0; x <= W; x += 3) ctx.lineTo(x, gY(x / W) - 1.5)
    ctx.stroke()
    // Grass blades
    ctx.strokeStyle = '#62b84a'
    ctx.lineWidth = 1
    for (let i = 0; i < 60; i++) {
      const gx = (i * 61.3 % 1) * W
      const gy = gY(gx / W)
      const tilt = Math.sin(animT * 1.5 + i * 0.8) * 3
      ctx.beginPath()
      ctx.moveTo(gx, gy - 1)
      ctx.lineTo(gx + tilt, gy - 7)
      ctx.stroke()
    }
  }

  function drawAriq() {
    if (!gardenState.unlocks.ariq) return
    const ay = gY(0.4) + 1
    // Water
    const g = ctx.createLinearGradient(W*0.28, ay, W*0.52, ay)
    g.addColorStop(0, 'rgba(60,140,220,0.6)')
    g.addColorStop(0.5, 'rgba(80,180,240,0.7)')
    g.addColorStop(1, 'rgba(60,140,220,0.6)')
    ctx.strokeStyle = g
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(W*0.28, ay)
    ctx.quadraticCurveTo(W*0.38, ay + 9, W*0.52, ay + 1)
    ctx.stroke()
    // Shimmer
    ctx.strokeStyle = 'rgba(180,230,255,0.5)'
    ctx.lineWidth = 1.5
    for (let i = 0; i < 3; i++) {
      const rx = W * (0.3 + i * 0.06)
      const ry = ay + 2 + i * 1.5
      ctx.beginPath()
      ctx.moveTo(rx, ry)
      ctx.lineTo(rx + 6 + Math.sin(animT * 3 + i) * 4, ry)
      ctx.stroke()
    }
  }

  function drawLake() {
    if (!gardenState.unlocks.lake) return
    const lx = W*0.6, ly = gY(0.64), lw = W*0.24, lh = 20
    // Water
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, lw/2)
    g.addColorStop(0, '#3a8abf')
    g.addColorStop(0.6, '#2a6a9f')
    g.addColorStop(1, '#1a4a7f')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(lx, ly, lw/2, lh/2, 0, 0, Math.PI*2)
    ctx.fill()
    // Reflection lines
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = 'rgba(150,210,255,0.4)'
    ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const ry = ly - 5 + i * 4
      const rw = (lw * 0.4) * (1 - Math.abs(i-2)/3)
      ctx.beginPath()
      ctx.moveTo(lx - rw, ry + Math.sin(animT*2+i)*1.5)
      ctx.lineTo(lx + rw, ry + Math.sin(animT*2+i+1)*1.5)
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawTree(nx, size, type) {
    const tx = nx * W
    const ty = gY(nx)
    const s = size || 1

    // Trunk
    const tg = ctx.createLinearGradient(tx-5*s, ty-50*s, tx+5*s, ty)
    tg.addColorStop(0, type===2?'#6a4020':'#8a5830')
    tg.addColorStop(1, type===2?'#4a2a10':'#6a4020')
    ctx.fillStyle = tg
    const tw = 9*s
    ctx.beginPath()
    ctx.roundRect(tx-tw/2, ty-48*s, tw, 48*s, 3)
    ctx.fill()

    if (type === 2) {
      // Pine — layered triangles
      const layers = [
        {y:48, w:0},
        {y:38, w:22},
        {y:26, w:18},
        {y:14, w:14},
        {y:2,  w:8},
      ]
      for (let i = 0; i < layers.length - 1; i++) {
        const l1 = layers[i], l2 = layers[i+1]
        const shade = i / layers.length
        ctx.fillStyle = `rgb(${Math.round(20+shade*20)},${Math.round(70+shade*30)},${Math.round(20+shade*15)})`
        ctx.beginPath()
        ctx.moveTo(tx - l1.w*s*0.5, ty - l1.y*s)
        ctx.lineTo(tx, ty - (l1.y + 28)*s)
        ctx.lineTo(tx + l1.w*s*0.5, ty - l1.y*s)
        ctx.closePath()
        ctx.fill()
        // Snow on top levels
        if (i >= 2 && gardenState.grade >= 85) {
          ctx.fillStyle = 'rgba(240,248,255,0.7)'
          ctx.beginPath()
          ctx.moveTo(tx - l1.w*s*0.15, ty - l1.y*s)
          ctx.lineTo(tx, ty - (l1.y+28)*s)
          ctx.lineTo(tx + l1.w*s*0.15, ty - l1.y*s)
          ctx.closePath()
          ctx.fill()
        }
      }
    } else {
      // Round tree with depth layers
      const baseY = ty - 60*s
      // Shadow layer
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      ctx.beginPath()
      ctx.arc(tx + 6*s, baseY + 4*s, 34*s, 0, Math.PI*2)
      ctx.fill()
      // Main canopy
      const cg = ctx.createRadialGradient(tx-8*s, baseY-8*s, 0, tx, baseY, 36*s)
      cg.addColorStop(0, '#6ab040')
      cg.addColorStop(0.5, '#4a9030')
      cg.addColorStop(1, '#2a6020')
      ctx.fillStyle = cg
      ctx.beginPath()
      ctx.arc(tx, baseY, 34*s, 0, Math.PI*2)
      ctx.fill()
      // Highlight
      ctx.fillStyle = 'rgba(140,210,80,0.25)'
      ctx.beginPath()
      ctx.arc(tx - 12*s, baseY - 12*s, 16*s, 0, Math.PI*2)
      ctx.fill()
      // Apple / fruit if grade good
      if (gardenState.grade >= 80) {
        for (let i = 0; i < 3; i++) {
          const ax = tx + Math.cos(i*2.1)*20*s
          const ay = baseY + Math.sin(i*2.1)*14*s + 8*s
          ctx.fillStyle = '#e84040'
          ctx.beginPath()
          ctx.arc(ax, ay, 4*s, 0, Math.PI*2)
          ctx.fill()
          ctx.fillStyle = '#ff6060'
          ctx.beginPath()
          ctx.arc(ax-1.5*s, ay-1.5*s, 1.5*s, 0, Math.PI*2)
          ctx.fill()
        }
      }
    }
  }

  function drawHouse() {
    if (!gardenState.unlocks.house) return
    const hx = W*0.76, hy = gY(0.79)
    const hw = 58, hh = 45
    // Wall with texture
    const wg = ctx.createLinearGradient(hx-hw/2, hy-hh, hx+hw/2, hy)
    wg.addColorStop(0, '#e0b87a')
    wg.addColorStop(1, '#c89a58')
    ctx.fillStyle = wg
    ctx.beginPath()
    ctx.roundRect(hx-hw/2, hy-hh, hw, hh, 2)
    ctx.fill()
    ctx.strokeStyle = '#b08040'
    ctx.lineWidth = 1
    ctx.strokeRect(hx-hw/2, hy-hh, hw, hh)
    // Roof
    const rg = ctx.createLinearGradient(hx, hy-hh-34, hx, hy-hh)
    rg.addColorStop(0, '#9a3020')
    rg.addColorStop(1, '#7a2010')
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.moveTo(hx-hw/2-8, hy-hh+1)
    ctx.lineTo(hx, hy-hh-34)
    ctx.lineTo(hx+hw/2+8, hy-hh+1)
    ctx.closePath()
    ctx.fill()
    // Roof ridge
    ctx.strokeStyle = '#6a1808'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(hx-hw/2-8, hy-hh+1)
    ctx.lineTo(hx, hy-hh-34)
    ctx.lineTo(hx+hw/2+8, hy-hh+1)
    ctx.stroke()
    // Door
    const dg = ctx.createLinearGradient(hx-9, hy-24, hx+9, hy)
    dg.addColorStop(0, '#8a5030')
    dg.addColorStop(1, '#6a3818')
    ctx.fillStyle = dg
    ctx.beginPath()
    ctx.roundRect(hx-9, hy-24, 18, 24, [4,4,0,0])
    ctx.fill()
    // Door knob
    ctx.fillStyle = '#f0c040'
    ctx.beginPath()
    ctx.arc(hx+5, hy-12, 2.5, 0, Math.PI*2)
    ctx.fill()
    // Windows
    const winColor = `rgba(${Math.round(150+Math.sin(animT*0.5)*50)},${Math.round(200+Math.sin(animT*0.5)*30)},255,0.7)`
    ctx.fillStyle = winColor
    ctx.beginPath()
    ctx.roundRect(hx-hw/2+8, hy-hh+12, 14, 11, 2)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(hx+hw/2-22, hy-hh+12, 14, 11, 2)
    ctx.fill()
    // Window frames
    ctx.strokeStyle = '#c89a58'
    ctx.lineWidth = 1
    ctx.strokeRect(hx-hw/2+8, hy-hh+12, 14, 11)
    ctx.strokeRect(hx+hw/2-22, hy-hh+12, 14, 11)
    // Chimney smoke
    const smokeX = hx + 16, smokeY = hy - hh - 28
    ctx.save()
    for (let i = 0; i < 3; i++) {
      const puff = (animT * 0.8 + i * 0.33) % 1
      ctx.globalAlpha = (1 - puff) * 0.4
      ctx.fillStyle = '#aaaaaa'
      ctx.beginPath()
      ctx.arc(smokeX + Math.sin(puff*4)*6, smokeY - puff*18, 3+puff*5, 0, Math.PI*2)
      ctx.fill()
    }
    ctx.restore()
  }

  function drawFlowers() {
    if (!gardenState.unlocks.flowers) return
    const colors = ['#ff69b4','#ff1493','#da70d6','#ffa500','#ff6347','#ff85c0']
    gardenState.flowers.forEach((nx, i) => {
      const fx = nx * W, fy = gY(nx)
      const sway = Math.sin(animT * 1.2 + i * 0.7) * 2
      // Stem
      ctx.strokeStyle = '#4a8830'
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(fx, fy)
      ctx.quadraticCurveTo(fx + sway, fy - 8, fx + sway, fy - 13)
      ctx.stroke()
      // Petals
      const c = colors[i % colors.length]
      ctx.fillStyle = c
      const ph = animT * 0.6 + i * 0.9
      for (let p = 0; p < 5; p++) {
        const angle = (p / 5) * Math.PI * 2 + ph
        ctx.beginPath()
        ctx.ellipse(
          fx + sway + Math.cos(angle) * 4.5,
          fy - 13 + Math.sin(angle) * 4.5,
          3, 2, angle, 0, Math.PI * 2
        )
        ctx.fill()
      }
      // Center
      ctx.fillStyle = '#ffd700'
      ctx.beginPath()
      ctx.arc(fx + sway, fy - 13, 2.5, 0, Math.PI*2)
      ctx.fill()
    })
  }

  function drawBirds() {
    if (!gardenState.unlocks.birds) return
    gardenState.birds.forEach(b => {
      b.x = (b.x + b.spd) % 1.15
      const bx = b.x * W, by = b.y * H
      const wing = Math.sin(animT * 9 + b.ph) * 7
      ctx.strokeStyle = '#1a1a2a'
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bx - 7, by - wing * 0.5)
      ctx.quadraticCurveTo(bx, by + 1, bx + 7, by - wing * 0.5)
      ctx.stroke()
    })
  }

  function drawPlayer() {
    // Auto walk towards target
    const dx = gardenState.targetX - gardenState.player.x
    if (Math.abs(dx) < 0.008) {
      gardenState.targetX = 0.1 + Math.random() * 0.55
    } else {
      gardenState.player.dir = dx > 0 ? 1 : -1
      gardenState.player.x += dx * 0.003
    }

    const px = gardenState.player.x * W
    const py = gY(gardenState.player.x)
    const walking = Math.abs(dx) > 0.01
    const step = walking ? Math.sin(animT * 12) * 5 : 0
    const dir = gardenState.player.dir

    // Shadow
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.ellipse(px, py + 1, 10, 4, 0, 0, Math.PI*2)
    ctx.fill()

    ctx.translate(px, py)
    if (dir < 0) ctx.scale(-1, 1)

    // Legs
    ctx.fillStyle = '#2255bb'
    ctx.beginPath(); ctx.roundRect(-7, -20, 5, 16+step, 2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(2, -20, 5, 16-step, 2); ctx.fill()
    // Shoes
    ctx.fillStyle = '#1a1a2a'
    ctx.beginPath(); ctx.ellipse(-5, -4+step, 5, 2.5, 0, 0, Math.PI*2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(5, -4-step, 5, 2.5, 0, 0, Math.PI*2); ctx.fill()
    // Body
    const bg1 = ctx.createLinearGradient(-8, -38, 8, -20)
    bg1.addColorStop(0, '#ee5533')
    bg1.addColorStop(1, '#cc3322')
    ctx.fillStyle = bg1
    ctx.beginPath(); ctx.roundRect(-8, -38, 16, 20, 3); ctx.fill()
    // Head
    ctx.fillStyle = '#f5c5a0'
    ctx.beginPath(); ctx.arc(0, -44, 9, 0, Math.PI*2); ctx.fill()
    // Hair
    ctx.fillStyle = '#3a2010'
    ctx.beginPath()
    ctx.moveTo(-9, -46)
    ctx.quadraticCurveTo(0, -56, 9, -46)
    ctx.closePath()
    ctx.fill()
    // Eye
    ctx.fillStyle = '#222'
    ctx.beginPath(); ctx.arc(4.5, -45, 1.8, 0, Math.PI*2); ctx.fill()
    ctx.fillStyle = 'white'
    ctx.beginPath(); ctx.arc(5, -45.5, 0.7, 0, Math.PI*2); ctx.fill()
    // Smile
    ctx.strokeStyle = '#c87050'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(0, -42, 4, 0.2, Math.PI-0.2)
    ctx.stroke()
    // Arms
    ctx.strokeStyle = '#ee5533'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-8,-34); ctx.lineTo(-15,-28+step*0.4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(8,-34); ctx.lineTo(15,-28-step*0.4); ctx.stroke()

    ctx.restore()
  }

  function drawParticles() {
    gardenState.particles = gardenState.particles.filter(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.025; p.r *= 0.96
      if (p.life <= 0) return false
      ctx.save()
      ctx.globalAlpha = p.life * 0.9
      ctx.fillStyle = p.color
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill()
      ctx.restore()
      return true
    })
    gardenState.floatingTexts = gardenState.floatingTexts.filter(ft => {
      ft.y -= 1.2; ft.life -= 0.018
      if (ft.life <= 0) return false
      ctx.save()
      ctx.globalAlpha = ft.life
      ctx.fillStyle = ft.color
      ctx.font = `700 13px Inter,system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(ft.text, ft.x, ft.y)
      ctx.restore()
      return true
    })
  }

  // ── EFFECTS ───────────────────────────────────────────────────────
  function burst(x, y, color, n) {
    for (let i = 0; i < (n||10); i++) {
      gardenState.particles.push({
        x, y,
        vx: (Math.random()-0.5)*5,
        vy: -Math.random()*6-2,
        r: 3 + Math.random()*4,
        color,
        life: 1
      })
    }
  }

  function floatText(x, y, text, color) {
    gardenState.floatingTexts.push({ x, y, text, color: color||'#ffd700', life: 1 })
  }

  // ── MAIN LOOP ─────────────────────────────────────────────────────
  function loop(ts) {
    if (!canvas) return
    const dt = ts - lastT; lastT = ts
    animT += dt * 0.001

    W = canvas.width; H = canvas.height

    ctx.clearRect(0, 0, W, H)
    drawSky()
    drawMoon()
    drawSun()
    drawRainbow()
    drawClouds()
    drawMountain()
    drawGround()
    if (gardenState.unlocks.tree1) drawTree(0.23, 1, 1)
    if (gardenState.unlocks.tree2) drawTree(0.44, 1.05, 2)
    drawAriq()
    drawLake()
    drawFlowers()
    drawHouse()
    drawBirds()
    drawPlayer()
    drawParticles()

    requestAnimationFrame(loop)
  }

  // ── PUBLIC API ────────────────────────────────────────────────────
  function init(canvasEl, data) {
    canvas = canvasEl
    ctx = canvas.getContext('2d')
    update(data)
    requestAnimationFrame(loop)
  }

  function update(data) {
    if (!data) return
    gardenState.streak = data.streak || 0
    gardenState.xp = data.xp || 0
    gardenState.grade = data.grade || 0
    gardenState.level = data.level || 0
    const newUnlocks = updateUnlocks()
    // Celebrate new unlocks
    if (newUnlocks.length && canvas) {
      newUnlocks.forEach(u => {
        burst(canvas.width/2, canvas.height*0.5, '#ffd700', 20)
        floatText(canvas.width/2, canvas.height*0.35, `${u.emoji} ${u.label} ochildi!`, '#ffd700')
      })
    }
    return newUnlocks
  }

  function getNextUnlock() { return nextUnlock() }

  function getUnlocks() { return gardenState.unlocks }

  function celebrate(x, y, color) {
    burst(x, y, color||'#6c63ff', 12)
  }

  return { init, update, getNextUnlock, getUnlocks, celebrate }
})()
