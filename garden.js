// ================================================================
//  StudyMind Garden v3.0 — Interactive Animated Painting
//  Pre-rendered painterly stages + cinematic animations
//  "I built this world by studying"
// ================================================================
window.StudyMindGarden = (function () {
  'use strict'

  // ── WORLD STAGES ─────────────────────────────────────────────────
  // Each stage = painterly CSS gradient scene + overlay elements
  const STAGES = [
    {
      id: 0, xpReq: 0, streakReq: 0,
      name: "Bo'sh maydon", nameEn: "Empty Field",
      sky: ['#c8dff5','#a8c8e8','#88b0d8'],
      horizon: '#6a9a5a',
      ground: ['#5a9a42','#3d7028','#2a4e1c'],
      mood: 'peaceful',
      elements: ['grass', 'clouds', 'character'],
      ambientColor: 'rgba(200,220,255,0.08)',
    },
    {
      id: 1, xpReq: 50, streakReq: 0,
      name: "Gullar unmoqda", nameEn: "Flowers Blooming",
      sky: ['#d4e8f8','#b8d4f0','#98bce0'],
      horizon: '#72a862',
      ground: ['#62a848','#488030','#305820'],
      mood: 'blossoming',
      elements: ['grass', 'clouds', 'flowers', 'smallPlants', 'character', 'butterfly'],
      ambientColor: 'rgba(220,200,255,0.1)',
    },
    {
      id: 2, xpReq: 150, streakReq: 3,
      name: "Daraxtlar o'smoqda", nameEn: "Trees Growing",
      sky: ['#b8d8f0','#90bce0','#70a0cc'],
      horizon: '#5a9858',
      ground: ['#509840','#387028','#224818'],
      mood: 'growing',
      elements: ['grass', 'clouds', 'flowers', 'tree1', 'tree2', 'birds', 'character'],
      ambientColor: 'rgba(180,220,200,0.1)',
    },
    {
      id: 3, xpReq: 350, streakReq: 7,
      name: "Daryo paydo bo'ldi", nameEn: "River Appears",
      sky: ['#a0c8e8','#80b0d8','#5890c0'],
      horizon: '#508850',
      ground: ['#489040','#306820','#1c4810'],
      mood: 'serene',
      elements: ['grass', 'clouds', 'flowers', 'tree1', 'tree2', 'river', 'birds', 'character', 'mist'],
      ambientColor: 'rgba(160,210,240,0.12)',
    },
    {
      id: 4, xpReq: 600, streakReq: 14,
      name: "Uy qurildi", nameEn: "House Built",
      sky: ['#90b8e0','#6898c8','#4878a8'],
      horizon: '#487848',
      ground: ['#407838','#286018','#184008'],
      mood: 'warm',
      elements: ['grass', 'clouds', 'flowers', 'tree1', 'tree2', 'tree3', 'river', 'house', 'lanterns', 'birds', 'character', 'mist'],
      ambientColor: 'rgba(255,210,160,0.1)',
    },
    {
      id: 5, xpReq: 1000, streakReq: 21,
      name: "Sehrli qishloq", nameEn: "Magical Village",
      sky: ['#7898c8','#5878a8','#385880'],
      horizon: '#406040',
      ground: ['#386830','#205010','#103008'],
      mood: 'magical',
      elements: ['grass', 'clouds', 'flowers', 'tree1', 'tree2', 'tree3', 'river', 'house', 'village', 'lanterns', 'birds', 'fireflies', 'character', 'mist', 'rainbow'],
      ambientColor: 'rgba(180,160,255,0.12)',
    },
  ]

  const UNLOCKS = [
    { key: 'stage0', label: "Bo'sh maydon",      emoji: '🌿', req: s => true },
    { key: 'flowers', label: 'Gullar',            emoji: '🌸', req: s => s.xp >= 50 },
    { key: 'tree1',  label: 'Birinchi daraxt',   emoji: '🌳', req: s => s.streak >= 3 },
    { key: 'river',  label: 'Daryo',              emoji: '🏞️', req: s => s.streak >= 7 },
    { key: 'birds',  label: 'Qushlar',            emoji: '🐦', req: s => s.streak >= 5 },
    { key: 'house',  label: 'Uy',                 emoji: '🏠', req: s => s.streak >= 14 },
    { key: 'lanterns',label: 'Chiroqlar',         emoji: '🏮', req: s => s.xp >= 600 },
    { key: 'mountain',label: "Tog'",              emoji: '⛰️', req: s => s.xp >= 800 },
    { key: 'village', label: 'Qishloq',           emoji: '🏡', req: s => s.streak >= 21 },
    { key: 'rainbow', label: 'Kamalak',           emoji: '🌈', req: s => s.streak >= 30 && s.grade >= 85 },
  ]

  // ── STATE ─────────────────────────────────────────────────────────
  let canvas, ctx, W, H, DPR = 1
  let aT = 0, lastT = 0, rafId = null
  let G = {
    streak: 0, xp: 0, grade: 0,
    stage: 0, stageBlend: 0, // for smooth transitions
    unlocks: {},
    timeOfDay: 0.35, // 0=night, 0.5=noon
    wind: 0,
    // animated elements
    clouds: [], birds: [], particles: [], texts: [],
    grassBlades: [], flowers: [], fireflies: [],
    char: { x: 0.38, vx: 0, targetX: 0.45, dir: 1, step: 0, idle: 0, bobY: 0 },
    riverShimmer: 0,
    lanternGlow: 0,
    transitionAlpha: 0, // for stage transition flash
  }

  function calcStage() {
    let s = 0
    STAGES.forEach((st, i) => {
      if (G.xp >= st.xpReq && G.streak >= st.streakReq) s = i
    })
    return s
  }

  function calcUnlocks() {
    const prev = { ...G.unlocks }
    UNLOCKS.forEach(u => { G.unlocks[u.key] = u.req(G) })
    return UNLOCKS.filter(u => G.unlocks[u.key] && !prev[u.key])
  }

  function getNext() {
    const n = UNLOCKS.find(u => !G.unlocks[u.key])
    if (!n) return { emoji:'🌟', label:'Mukammal dunyo!', hint:'' }
    let hint = ''
    const rules = { flowers:'50 XP', tree1:'3 streak', river:'7 streak', birds:'5 streak', house:'14 streak', lanterns:'600 XP', mountain:'800 XP', village:'21 streak', rainbow:'30 streak + 85 baho' }
    hint = rules[n.key] || ''
    return { ...n, hint }
  }

  // ── HELPERS ───────────────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
  function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t }

  function parseHex(h) {
    const r = parseInt(h.slice(1,3),16)
    const g = parseInt(h.slice(3,5),16)
    const b = parseInt(h.slice(5,7),16)
    return [r,g,b]
  }
  function lerpHex(a, b, t) {
    const [ar,ag,ab] = parseHex(a), [br,bg,bb] = parseHex(b)
    return `rgb(${Math.round(lerp(ar,br,t))},${Math.round(lerp(ag,bg,t))},${Math.round(lerp(ab,bb,t))})`
  }

  // ground y at normalised x
  function gY(nx) {
    return H * (0.64 + Math.sin(nx*Math.PI*1.3)*0.018 + Math.sin(nx*Math.PI*3.1)*0.007)
  }
  // hill y
  function hY(nx, base) {
    return H * (base + Math.sin(nx*Math.PI*0.7+0.8)*0.035 + Math.sin(nx*Math.PI*1.8)*0.012)
  }

  // ── INIT ──────────────────────────────────────────────────────────
  function initElements() {
    G.clouds = Array.from({length:7}, (_, i) => ({
      x: Math.random(), y: 0.06 + Math.random()*0.18,
      w: 0.08 + Math.random()*0.1, alpha: 0.55 + Math.random()*0.35,
      spd: 0.000018 + Math.random()*0.000025,
      puffs: Array.from({length:6}, () => ({
        dx: (Math.random()-0.3)*0.85, dy: (Math.random()-0.5)*0.4,
        r: 0.5 + Math.random()*0.8,
      }))
    }))
    G.birds = Array.from({length:9}, (_, i) => ({
      x: Math.random(), y: 0.1 + Math.random()*0.2,
      spd: 0.00022 + Math.random()*0.00028,
      phase: Math.random()*Math.PI*2,
      sz: 0.7 + Math.random()*0.6,
    }))
    G.grassBlades = Array.from({length:160}, (_, i) => ({
      x: Math.random(), y: 0, // y computed from gY
      h: 5 + Math.random()*9,
      phase: Math.random()*Math.PI*2,
      hue: 110 + Math.random()*28,
      sat: 48 + Math.random()*22,
      lit: 26 + Math.random()*16,
    }))
    G.flowers = Array.from({length:55}, (_, i) => ({
      x: 0.04 + Math.random()*0.92,
      hue: [340,320,290,30,15,0][i%6],
      sat: 75 + Math.random()*20,
      lit: 55 + Math.random()*15,
      sz: 0.6 + Math.random()*0.9,
      phase: Math.random()*Math.PI*2,
    }))
    G.fireflies = Array.from({length:20}, (_, i) => ({
      x: 0.1 + Math.random()*0.8, y: 0,
      phase: Math.random()*Math.PI*2,
      spd: (Math.random()-0.5)*0.0004,
      vy: -0.0001 - Math.random()*0.0002,
    }))
  }

  // ── SKY PAINTING ──────────────────────────────────────────────────
  function drawSky() {
    const st = STAGES[G.stage]
    const t = G.timeOfDay

    // Base sky gradient — 3 stops
    const skyG = ctx.createLinearGradient(0, 0, 0, H*0.68)
    skyG.addColorStop(0, st.sky[0])
    skyG.addColorStop(0.5, st.sky[1])
    skyG.addColorStop(1, st.sky[2])
    ctx.fillStyle = skyG
    ctx.fillRect(0, 0, W, H)

    // Golden hour glow (sunrise/sunset feel)
    const hourGlow = Math.max(0, Math.sin(t * Math.PI)) * 0.28
    if (hourGlow > 0.02) {
      const hg = ctx.createRadialGradient(W*0.72, H*0.15, 0, W*0.72, H*0.15, H*0.5)
      hg.addColorStop(0, `rgba(255,200,80,${hourGlow})`)
      hg.addColorStop(0.4, `rgba(255,160,60,${hourGlow*0.4})`)
      hg.addColorStop(1, 'rgba(255,140,40,0)')
      ctx.fillStyle = hg
      ctx.fillRect(0, 0, W, H*0.7)
    }

    // Dusk/dawn color wash
    if (t < 0.2 || t > 0.85) {
      const duskA = t < 0.2 ? (0.2-t)/0.2 : (t-0.85)/0.15
      const dg = ctx.createLinearGradient(0,0,0,H*0.6)
      dg.addColorStop(0, `rgba(40,20,80,${duskA*0.6})`)
      dg.addColorStop(1, `rgba(120,60,20,${duskA*0.3})`)
      ctx.fillStyle = dg
      ctx.fillRect(0, 0, W, H*0.6)
    }
  }

  function drawSun() {
    const t = G.timeOfDay
    if (t < 0.1 || t > 0.9) return
    const a = t < 0.2 ? (t-0.1)/0.1 : t > 0.8 ? (0.9-t)/0.1 : 1
    const sx = W * (0.68 + Math.sin(t*Math.PI*0.5)*0.1)
    const sy = H * (0.08 + (1 - Math.sin(clamp((t-0.15)/0.7,0,1)*Math.PI)) * 0.18)

    ctx.save()
    // Soft sun corona
    const corona = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90)
    corona.addColorStop(0, `rgba(255,235,150,${a*0.22})`)
    corona.addColorStop(0.3, `rgba(255,200,80,${a*0.12})`)
    corona.addColorStop(1, 'rgba(255,180,60,0)')
    ctx.fillStyle = corona
    ctx.globalAlpha = 1
    ctx.fillRect(sx-90, sy-90, 180, 180)

    // Sun disc
    ctx.globalAlpha = a * 0.88
    ctx.fillStyle = '#ffe878'
    ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI*2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,200,0.6)'
    ctx.beginPath(); ctx.arc(sx-4, sy-4, 7, 0, Math.PI*2); ctx.fill()
    ctx.restore()
  }

  function drawMoonStars() {
    const t = G.timeOfDay
    if (t > 0.15 && t < 0.85) return
    const a = t < 0.15 ? (0.15-t)/0.15 : (t-0.85)/0.15

    ctx.save()
    // Stars
    ctx.globalAlpha = a * 0.88
    for (let i = 0; i < 80; i++) {
      const sx = (i*73.13%1)*W, sy = (i*47.29%1)*H*0.55
      const sz = 0.3 + (Math.sin(i*1.7 + aT*1.8)*0.5+0.5)*1.1
      const tw = Math.sin(aT*0.8+i)*0.5+0.5
      ctx.fillStyle = `rgba(255,255,255,${0.4+tw*0.5})`
      ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI*2); ctx.fill()
    }
    // Moon
    const mx = W*0.22, my = H*0.12
    ctx.globalAlpha = a * 0.9
    const moonG = ctx.createRadialGradient(mx-4, my-4, 0, mx, my, 18)
    moonG.addColorStop(0, '#f5f0e0')
    moonG.addColorStop(0.7, '#e0d8c0')
    moonG.addColorStop(1, '#c8c0a0')
    ctx.fillStyle = moonG
    ctx.beginPath(); ctx.arc(mx, my, 16, 0, Math.PI*2); ctx.fill()
    // Moon shadow
    ctx.fillStyle = 'rgba(180,170,140,0.35)'
    ctx.beginPath(); ctx.arc(mx+5, my+3, 7, 0, Math.PI*2); ctx.fill()
    ctx.restore()
  }

  // ── RAINBOW ───────────────────────────────────────────────────────
  function drawRainbow() {
    if (!G.unlocks.rainbow) return
    ctx.save()
    const arc = ['#ff8888','#ffbb66','#ffee88','#88dd88','#88aaff','#cc88ff']
    arc.forEach((c,i) => {
      ctx.beginPath()
      ctx.arc(W*0.5, H*0.72, W*0.48-i*5.5, Math.PI, 0)
      ctx.strokeStyle = c; ctx.globalAlpha = 0.28; ctx.lineWidth = 4.5
      ctx.stroke()
    })
    ctx.restore()
  }

  // ── CLOUDS ────────────────────────────────────────────────────────
  function drawClouds() {
    G.clouds.forEach(cl => {
      cl.x = (cl.x + cl.spd) % 1.28
      if (cl.x > 1.22) cl.x = -0.12
      const cx = cl.x*W, cy = cl.y*H, r = cl.w*W

      ctx.save()
      // Soft painterly cloud
      ctx.globalAlpha = cl.alpha * 0.82
      cl.puffs.forEach(p => {
        const px = cx + p.dx*r*2, py = cy + p.dy*r*1.2
        const pr = r*p.r
        // shadow
        const sg = ctx.createRadialGradient(px+pr*0.15, py+pr*0.1, 0, px, py, pr)
        sg.addColorStop(0, 'rgba(255,255,255,0.95)')
        sg.addColorStop(0.5, 'rgba(240,245,255,0.85)')
        sg.addColorStop(0.85, 'rgba(215,225,245,0.6)')
        sg.addColorStop(1, 'rgba(200,215,240,0)')
        ctx.fillStyle = sg
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI*2); ctx.fill()
      })
      ctx.restore()
    })
  }

  // ── MOUNTAINS (background depth) ──────────────────────────────────
  function drawMountains() {
    if (!G.unlocks.mountain) return
    const fade = clamp((G.xp-750)/120, 0, 1)
    ctx.save()

    // Atmosphere haze
    ctx.globalAlpha = 0.55 * fade
    const haze = ctx.createLinearGradient(0, H*0.3, 0, H*0.65)
    haze.addColorStop(0, 'rgba(160,185,220,0.5)')
    haze.addColorStop(1, 'rgba(160,185,220,0)')
    ctx.fillStyle = haze
    ctx.fillRect(0, H*0.28, W, H*0.38)

    // Far mountains — muted blue-purple
    const peaks = [{x:0.1,h:0.38,w:0.22},{x:0.3,h:0.32,w:0.18},{x:0.65,h:0.42,w:0.26},{x:0.86,h:0.34,w:0.2}]
    peaks.forEach((m,i) => {
      const mx=m.x*W, mw=m.w*W, mh=m.h*H
      const gy = hY(m.x, 0.62)
      ctx.globalAlpha = (0.5+i%2*0.1) * fade

      const mg = ctx.createLinearGradient(mx, gy-mh, mx+mw*0.2, gy)
      mg.addColorStop(0, `hsl(${210+i*8},${25+i*4}%,${42+i*4}%)`)
      mg.addColorStop(0.55, `hsl(${205+i*6},${20+i*3}%,${35+i*3}%)`)
      mg.addColorStop(1, `hsl(${200+i*5},${18+i*2}%,${28+i*2}%)`)
      ctx.fillStyle = mg
      ctx.beginPath()
      ctx.moveTo(mx-mw*0.5, gy)
      ctx.lineTo(mx-mw*0.2, gy-mh*0.62)
      ctx.lineTo(mx, gy-mh)
      ctx.lineTo(mx+mw*0.18, gy-mh*0.75)
      ctx.lineTo(mx+mw*0.38, gy-mh*0.45)
      ctx.lineTo(mx+mw*0.6, gy)
      ctx.closePath(); ctx.fill()

      // Snow — soft
      ctx.globalAlpha = 0.78 * fade
      ctx.fillStyle = 'rgba(240,246,255,0.88)'
      ctx.beginPath()
      ctx.moveTo(mx-mw*0.08, gy-mh*0.78)
      ctx.lineTo(mx, gy-mh)
      ctx.lineTo(mx+mw*0.09, gy-mh*0.78)
      ctx.quadraticCurveTo(mx+mw*0.04, gy-mh*0.72, mx, gy-mh*0.72)
      ctx.quadraticCurveTo(mx-mw*0.04, gy-mh*0.72, mx-mw*0.08, gy-mh*0.78)
      ctx.fill()
    })
    ctx.restore()
  }

  // ── HILLS ────────────────────────────────────────────────────────
  function drawHills() {
    const st = STAGES[G.stage]
    const gc = st.ground

    // Far hill
    const h1 = ctx.createLinearGradient(0, H*0.42, 0, H*0.65)
    h1.addColorStop(0, gc[0]+'dd')
    h1.addColorStop(0.6, gc[1]+'cc')
    h1.addColorStop(1, gc[2]+'bb')
    ctx.fillStyle = h1
    ctx.beginPath(); ctx.moveTo(0, H)
    for (let x=0; x<=W; x+=4) ctx.lineTo(x, hY(x/W, 0.52))
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()

    // Mid hill — lighter
    const h2 = ctx.createLinearGradient(0, H*0.49, 0, H*0.67)
    h2.addColorStop(0, gc[0])
    h2.addColorStop(0.5, gc[1])
    h2.addColorStop(1, gc[2])
    ctx.fillStyle = h2
    ctx.beginPath(); ctx.moveTo(0, H)
    for (let x=0; x<=W; x+=4) ctx.lineTo(x, hY(x/W, 0.57))
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()

    // Hill edge soft glow
    ctx.save()
    ctx.globalAlpha = 0.2
    const hglow = ctx.createLinearGradient(0, H*0.56, 0, H*0.62)
    hglow.addColorStop(0, 'rgba(180,230,140,0.6)')
    hglow.addColorStop(1, 'rgba(180,230,140,0)')
    ctx.fillStyle = hglow
    ctx.fillRect(0, H*0.55, W, H*0.08)
    ctx.restore()
  }

  // ── GROUND ────────────────────────────────────────────────────────
  function drawGround() {
    const st = STAGES[G.stage]
    const gc = st.ground

    const gg = ctx.createLinearGradient(0, H*0.63, 0, H)
    gg.addColorStop(0, gc[0])
    gg.addColorStop(0.07, `hsl(115,42%,28%)`)
    gg.addColorStop(0.3, gc[1])
    gg.addColorStop(0.7, gc[2])
    gg.addColorStop(1, '#0e2208')
    ctx.fillStyle = gg
    ctx.beginPath(); ctx.moveTo(0, H)
    for (let x=0; x<=W; x+=3) ctx.lineTo(x, gY(x/W))
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill()

    // Ambient occlusion at base
    ctx.save()
    const ao = ctx.createLinearGradient(0, H*0.63, 0, H*0.68)
    ao.addColorStop(0, 'rgba(0,20,0,0.25)')
    ao.addColorStop(1, 'rgba(0,20,0,0)')
    ctx.fillStyle = ao
    ctx.fillRect(0, H*0.62, W, H*0.07)
    ctx.restore()
  }

  // ── GRASS ─────────────────────────────────────────────────────────
  function drawGrass() {
    const wind = G.wind
    G.grassBlades.forEach(b => {
      const bx = b.x * W
      const by = gY(b.x) - 1
      const sway = Math.sin(wind + b.phase) * b.h * 0.38
      const sway2 = Math.sin(wind*1.3 + b.phase + 0.5) * b.h * 0.15

      // Shadow blade
      ctx.strokeStyle = `hsla(${b.hue-8},${b.sat-15}%,${b.lit-10}%,0.5)`
      ctx.lineWidth = 1.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bx+1, by)
      ctx.quadraticCurveTo(bx+sway*0.5+1, by-b.h*0.55, bx+sway+1, by-b.h)
      ctx.stroke()
      // Main blade
      ctx.strokeStyle = `hsla(${b.hue},${b.sat}%,${b.lit}%,0.88)`
      ctx.lineWidth = 1.0
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.bezierCurveTo(bx+sway2, by-b.h*0.35, bx+sway*0.7, by-b.h*0.65, bx+sway, by-b.h)
      ctx.stroke()
      // Tip highlight
      ctx.strokeStyle = `hsla(${b.hue+10},${b.sat+10}%,${b.lit+18}%,0.55)`
      ctx.lineWidth = 0.7
      ctx.beginPath()
      ctx.moveTo(bx+sway*0.7, by-b.h*0.65)
      ctx.lineTo(bx+sway, by-b.h)
      ctx.stroke()
    })
  }

  // ── SMALL PLANTS ──────────────────────────────────────────────────
  function drawSmallPlants() {
    const stage = G.stage
    if (stage < 1) return
    const fade = clamp((G.xp-30)/40, 0, 1)
    const positions = [0.12,0.19,0.52,0.58,0.75,0.84,0.92]
    positions.forEach((nx, i) => {
      const px = nx*W, py = gY(nx)
      const sway = Math.sin(G.wind*0.9 + i*1.4) * 2.5
      ctx.save(); ctx.globalAlpha = fade
      // Stem
      ctx.strokeStyle = `hsl(${120+i*5},52%,${30+i*3}%)`
      ctx.lineWidth = 1.5; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(px, py-1)
      ctx.quadraticCurveTo(px+sway*0.5, py-10, px+sway, py-16); ctx.stroke()
      // Leaf cluster
      const lg = ctx.createRadialGradient(px+sway, py-18, 0, px+sway, py-16, 6)
      lg.addColorStop(0, `hsl(${125+i*6},60%,42%)`)
      lg.addColorStop(1, `hsl(${118+i*4},50%,32%)`)
      ctx.fillStyle = lg
      ctx.beginPath(); ctx.ellipse(px+sway, py-18, 5.5, 4, Math.sin(aT+i)*0.3, 0, Math.PI*2); ctx.fill()
      ctx.restore()
    })
  }

  // ── FLOWERS ───────────────────────────────────────────────────────
  function drawFlowers() {
    if (G.stage < 1 && G.xp < 50) return
    const fade = clamp((G.xp-40)/50, 0, 1)
    G.flowers.forEach((fl, i) => {
      const fx = fl.x*W, fy = gY(fl.x)
      if (fy > H+5) return
      const sway = Math.sin(G.wind*0.75 + fl.phase) * 2
      ctx.save(); ctx.globalAlpha = fade * 0.9

      // Stem with subtle curve
      ctx.strokeStyle = `hsl(118,48%,30%)`
      ctx.lineWidth = 1; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(fx, fy-1)
      ctx.quadraticCurveTo(fx+sway*0.5, fy-7, fx+sway, fy-12); ctx.stroke()

      // Petals — soft painterly
      const pe = 5
      const ph = aT*0.25 + fl.phase
      for (let p=0; p<pe; p++) {
        const angle = (p/pe)*Math.PI*2 + ph
        const pex = fx+sway+Math.cos(angle)*3.8
        const pey = fy-12+Math.sin(angle)*3.8
        const pg = ctx.createRadialGradient(pex, pey, 0, pex, pey, 3.5*fl.sz)
        pg.addColorStop(0, `hsla(${fl.hue},${fl.sat}%,${fl.lit+15}%,0.95)`)
        pg.addColorStop(1, `hsla(${fl.hue},${fl.sat-10}%,${fl.lit}%,0.7)`)
        ctx.fillStyle = pg
        ctx.beginPath(); ctx.ellipse(pex, pey, 2.8*fl.sz, 1.8*fl.sz, angle, 0, Math.PI*2); ctx.fill()
      }
      // Center — warm gold
      const cg = ctx.createRadialGradient(fx+sway, fy-12, 0, fx+sway, fy-12, 2.5)
      cg.addColorStop(0, '#ffe060')
      cg.addColorStop(1, '#e8a820')
      ctx.fillStyle = cg
      ctx.beginPath(); ctx.arc(fx+sway, fy-12, 2.2, 0, Math.PI*2); ctx.fill()
      ctx.restore()
    })
  }

  // ── TREES ─────────────────────────────────────────────────────────
  function drawTree(nx, type, sz) {
    const tx = nx*W, ty = gY(nx), s = sz||1
    const sway = Math.sin(G.wind*0.5 + nx*6) * 2.8 * s

    // Root shadow
    ctx.save()
    ctx.globalAlpha = 0.12
    ctx.fillStyle = '#000'
    ctx.beginPath(); ctx.ellipse(tx+sway*0.2, ty+1, 14*s, 5*s, 0, 0, Math.PI*2); ctx.fill()
    ctx.restore()

    // Trunk — textured
    const tg = ctx.createLinearGradient(tx-6*s, ty-52*s, tx+6*s, ty)
    tg.addColorStop(0, '#7a4e28')
    tg.addColorStop(0.4, '#6a3e1a')
    tg.addColorStop(1, '#4a2a0c')
    ctx.fillStyle = tg
    ctx.beginPath()
    ctx.moveTo(tx-6*s, ty)
    ctx.bezierCurveTo(tx-5*s+sway*0.1, ty-20*s, tx-3*s+sway*0.4, ty-38*s, tx-2*s+sway*0.7, ty-52*s)
    ctx.lineTo(tx+2*s+sway, ty-52*s)
    ctx.bezierCurveTo(tx+3*s+sway*0.6, ty-38*s, tx+5*s+sway*0.3, ty-20*s, tx+6*s, ty)
    ctx.closePath(); ctx.fill()

    if (type === 'pine') {
      const layers = [{y:50,w:0},{y:40,w:26},{y:28,w:22},{y:16,w:17},{y:5,w:11}]
      for (let i=0; i<layers.length-1; i++) {
        const l=layers[i], nxt=layers[i+1]
        const shade = i/layers.length
        const lg = ctx.createLinearGradient(tx-l.w*s+sway*0.3, ty-l.y*s-25*s, tx+l.w*s+sway, ty-l.y*s)
        lg.addColorStop(0, `hsl(130,${48-shade*8}%,${26+shade*8}%)`)
        lg.addColorStop(0.5, `hsl(125,${42-shade*6}%,${22+shade*6}%)`)
        lg.addColorStop(1, `hsl(120,${38-shade*4}%,${18+shade*4}%)`)
        ctx.fillStyle = lg
        ctx.beginPath()
        ctx.moveTo(tx-l.w*s, ty-l.y*s)
        ctx.lineTo(tx+sway*0.6, ty-(l.y+25)*s)
        ctx.lineTo(tx+l.w*s+sway, ty-l.y*s)
        ctx.closePath(); ctx.fill()
        // Snow dusting if high grade
        if (G.grade >= 80 && i >= 2) {
          ctx.fillStyle = 'rgba(235,245,255,0.6)'
          ctx.beginPath()
          ctx.moveTo(tx-l.w*s*0.12, ty-l.y*s)
          ctx.lineTo(tx+sway*0.6, ty-(l.y+25)*s)
          ctx.lineTo(tx+l.w*s*0.12+sway, ty-l.y*s)
          ctx.closePath(); ctx.fill()
        }
      }
    } else {
      // Round canopy — layered painterly
      const cy = ty - 62*s
      const cx = tx + sway*0.8

      // Deep shadow layer
      ctx.fillStyle = 'rgba(0,0,0,0.1)'
      ctx.beginPath(); ctx.ellipse(cx+6*s, cy+8*s, 34*s, 20*s, 0, 0, Math.PI*2); ctx.fill()

      // Back cluster
      const b1 = ctx.createRadialGradient(cx-10*s, cy+8*s, 0, cx, cy+5*s, 32*s)
      b1.addColorStop(0, `hsl(128,${40+G.stage*3}%,${28+G.stage*2}%)`)
      b1.addColorStop(1, `hsl(122,${35+G.stage*2}%,${22+G.stage}%)`)
      ctx.fillStyle = b1
      ctx.beginPath(); ctx.arc(cx-14*s, cy+6*s, 22*s, 0, Math.PI*2); ctx.fill()
      ctx.beginPath(); ctx.arc(cx+14*s, cy+6*s, 20*s, 0, Math.PI*2); ctx.fill()

      // Main canopy
      const mg = ctx.createRadialGradient(cx-8*s, cy-10*s, 0, cx, cy, 36*s)
      mg.addColorStop(0, `hsl(132,${55+G.stage*4}%,${38+G.stage*3}%)`)
      mg.addColorStop(0.45, `hsl(126,${48+G.stage*3}%,${30+G.stage*2}%)`)
      mg.addColorStop(0.8, `hsl(120,${40+G.stage*2}%,${24+G.stage}%)`)
      mg.addColorStop(1, `hsl(115,${35+G.stage}%,${18+G.stage}%)`)
      ctx.fillStyle = mg
      ctx.beginPath(); ctx.arc(cx, cy, 34*s, 0, Math.PI*2); ctx.fill()

      // Top highlight — rim light
      const hl = ctx.createRadialGradient(cx-10*s, cy-14*s, 0, cx-10*s, cy-14*s, 18*s)
      hl.addColorStop(0, 'rgba(180,240,120,0.28)')
      hl.addColorStop(1, 'rgba(180,240,120,0)')
      ctx.fillStyle = hl
      ctx.beginPath(); ctx.arc(cx-10*s, cy-14*s, 18*s, 0, Math.PI*2); ctx.fill()

      // Fruit overlay (grade >= 75)
      if (G.grade >= 75) {
        for (let i=0; i<5; i++) {
          const ax = cx+Math.cos(i*1.26+0.4)*22*s, ay = cy+Math.sin(i*1.26+0.4)*14*s+5*s
          const fg = ctx.createRadialGradient(ax-s, ay-s, 0, ax, ay, 4*s)
          fg.addColorStop(0, '#ff8870'); fg.addColorStop(1, '#cc2820')
          ctx.fillStyle = fg
          ctx.beginPath(); ctx.arc(ax, ay, 3.5*s, 0, Math.PI*2); ctx.fill()
        }
      }
    }
  }

  function drawTrees() {
    if (G.stage >= 2 || (G.unlocks.tree1 && G.xp >= 150)) {
      drawTree(0.07, 'pine', 0.82)
      drawTree(0.92, 'round', 0.85)
    }
    if (G.stage >= 4 || G.xp >= 500) drawTree(0.78, 'pine', 0.88)
    if (G.unlocks.tree1) {
      drawTree(0.21, 'round', 1.05)
      drawTree(0.72, 'pine', 0.98)
    }
  }

  // ── RIVER ─────────────────────────────────────────────────────────
  function drawRiver() {
    if (!G.unlocks.river) return
    const fade = clamp((G.streak-5)/4, 0, 1)
    const ry = gY(0.47)+3

    ctx.save(); ctx.globalAlpha = fade

    // River bed shadow
    ctx.fillStyle = 'rgba(0,30,60,0.25)'
    ctx.beginPath()
    ctx.moveTo(W*0.26, ry+14)
    ctx.quadraticCurveTo(W*0.38, ry+2, W*0.47, ry+7)
    ctx.quadraticCurveTo(W*0.56, ry+12, W*0.67, ry-2)
    ctx.lineTo(W*0.69, ry+10)
    ctx.quadraticCurveTo(W*0.57, ry+20, W*0.47, ry+17)
    ctx.quadraticCurveTo(W*0.37, ry+12, W*0.26, ry+24)
    ctx.closePath(); ctx.fill()

    // River water — gradient
    const rg = ctx.createLinearGradient(W*0.28, ry-5, W*0.67, ry+15)
    rg.addColorStop(0, `rgba(45,115,195,0.85)`)
    rg.addColorStop(0.35, `rgba(35,145,200,0.78)`)
    rg.addColorStop(0.7, `rgba(25,95,175,0.82)`)
    rg.addColorStop(1, `rgba(15,75,155,0.88)`)
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.moveTo(W*0.27, ry+12)
    ctx.quadraticCurveTo(W*0.38, ry-8, W*0.48, ry+2)
    ctx.quadraticCurveTo(W*0.57, ry+12, W*0.67, ry-4)
    ctx.lineTo(W*0.685, ry+8)
    ctx.quadraticCurveTo(W*0.575, ry+20, W*0.48, ry+12)
    ctx.quadraticCurveTo(W*0.38, ry+2, W*0.27, ry+22)
    ctx.closePath(); ctx.fill()

    // Shimmer lines
    G.riverShimmer += 0.035
    for (let i=0; i<6; i++) {
      const rx = W*(0.3+i*0.055), rwy = ry+4+Math.sin(G.riverShimmer+i*1.1)*3
      const shimA = 0.35+Math.sin(G.riverShimmer*1.2+i*0.9)*0.2
      ctx.strokeStyle = `rgba(180,230,255,${shimA})`
      ctx.lineWidth = 0.8; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(rx, rwy); ctx.lineTo(rx+7+Math.sin(aT+i)*3, rwy); ctx.stroke()
    }

    // Edge reflection highlight
    ctx.strokeStyle = 'rgba(150,210,255,0.3)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(W*0.27, ry+12); ctx.quadraticCurveTo(W*0.38, ry-8, W*0.48, ry+2); ctx.stroke()
    ctx.restore()
  }

  // ── BRIDGE ────────────────────────────────────────────────────────
  function drawBridge() {
    if (!G.unlocks.river || G.streak < 10) return
    const fade = clamp((G.streak-8)/4, 0, 1)
    const bx = W*0.475, by = gY(0.475)+1
    ctx.save(); ctx.globalAlpha = fade

    // Wooden planks — warm aged wood
    for (let i=0; i<7; i++) {
      const px = bx-26+i*7.5
      const plg = ctx.createLinearGradient(px, by-5, px+6, by+10)
      plg.addColorStop(0, `hsl(${28+i*2},${45+i}%,${36+i*2}%)`)
      plg.addColorStop(1, `hsl(${24+i},${40+i}%,${28+i}%)`)
      ctx.fillStyle = plg
      ctx.beginPath(); ctx.roundRect(px, by-5, 6.5, 13, 1); ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'
      ctx.lineWidth = 0.5; ctx.strokeRect(px, by-5, 6.5, 13)
    }
    // Rails
    ctx.strokeStyle = '#8a5828'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(bx-27, by-6); ctx.lineTo(bx+27, by-6); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(bx-27, by+9); ctx.lineTo(bx+27, by+9); ctx.stroke()
    // Posts
    for (let i=0; i<3; i++) {
      const ppx = bx-24+i*24
      ctx.beginPath(); ctx.moveTo(ppx, by+9); ctx.lineTo(ppx, by-14); ctx.stroke()
    }
    ctx.restore()
  }

  // ── HOUSE ─────────────────────────────────────────────────────────
  function drawHouse() {
    if (!G.unlocks.house) return
    const fade = clamp((G.streak-12)/4, 0, 1)
    const hx=W*0.78, hy=gY(0.78), hw=65, hh=52
    ctx.save(); ctx.globalAlpha = fade

    // Ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.beginPath(); ctx.ellipse(hx, hy+2, hw*0.55, 6, 0, 0, Math.PI*2); ctx.fill()

    // Walls — warm plaster
    const wg = ctx.createLinearGradient(hx-hw/2, hy-hh, hx+hw/2, hy)
    wg.addColorStop(0, '#e0c08a')
    wg.addColorStop(0.4, '#cca870')
    wg.addColorStop(1, '#b08850')
    ctx.fillStyle = wg
    ctx.beginPath(); ctx.roundRect(hx-hw/2, hy-hh, hw, hh, [3,3,0,0]); ctx.fill()

    // Stone base
    ctx.fillStyle = '#9a8060'
    ctx.fillRect(hx-hw/2, hy-10, hw, 10)

    // Subtle wall texture
    ctx.strokeStyle = 'rgba(120,80,30,0.08)'
    ctx.lineWidth = 0.6
    for (let i=1; i<5; i++) {
      ctx.beginPath(); ctx.moveTo(hx-hw/2, hy-hh+i*(hh/5))
      ctx.lineTo(hx+hw/2, hy-hh+i*(hh/5)); ctx.stroke()
    }

    // Roof — dark tiles
    const rg = ctx.createLinearGradient(hx, hy-hh-40, hx, hy-hh)
    rg.addColorStop(0, '#6a2018')
    rg.addColorStop(0.5, '#5a1a12')
    rg.addColorStop(1, '#4a1408')
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.moveTo(hx-hw/2-12, hy-hh+2)
    ctx.lineTo(hx-2, hy-hh-40)
    ctx.lineTo(hx+hw/2+12, hy-hh+2)
    ctx.closePath(); ctx.fill()
    // Roof ridge
    ctx.strokeStyle = '#3a1008'; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(hx-hw/2-12, hy-hh+2)
    ctx.lineTo(hx-2, hy-hh-40); ctx.lineTo(hx+hw/2+12, hy-hh+2); ctx.stroke()
    // Roof shading
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.beginPath()
    ctx.moveTo(hx-hw/2-12, hy-hh+2); ctx.lineTo(hx-2, hy-hh-40); ctx.lineTo(hx, hy-hh-38)
    ctx.lineTo(hx-hw/2-8, hy-hh+2); ctx.closePath(); ctx.fill()

    // Chimney
    ctx.fillStyle = '#8a7060'
    ctx.fillRect(hx+15, hy-hh-50, 11, 22)
    ctx.fillStyle = '#9a8070'
    ctx.fillRect(hx+13, hy-hh-52, 15, 4)
    // Smoke
    for (let i=0; i<5; i++) {
      const pf = (aT*0.45+i*0.2)%1
      ctx.globalAlpha = (1-pf)*fade*0.28
      const sr = 3+pf*7
      ctx.fillStyle = `rgba(200,200,200,${0.6-pf*0.5})`
      ctx.beginPath()
      ctx.arc(hx+20+Math.sin(pf*4+i)*6, hy-hh-52-pf*25, sr, 0, Math.PI*2)
      ctx.fill()
    }
    ctx.globalAlpha = fade

    // Door — arched
    const dg = ctx.createLinearGradient(hx-9, hy-28, hx+9, hy)
    dg.addColorStop(0, '#7a4828'); dg.addColorStop(1, '#5a3018')
    ctx.fillStyle = dg
    ctx.beginPath()
    ctx.moveTo(hx-10, hy); ctx.lineTo(hx-10, hy-20)
    ctx.arc(hx, hy-20, 10, Math.PI, 0)
    ctx.lineTo(hx+10, hy); ctx.closePath(); ctx.fill()
    // Door panels
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.8
    ctx.strokeRect(hx-8, hy-18, 7, 8); ctx.strokeRect(hx+1, hy-18, 7, 8)
    // Knob
    ctx.fillStyle = '#e0b030'
    ctx.beginPath(); ctx.arc(hx+7, hy-12, 2, 0, Math.PI*2); ctx.fill()

    // Windows — warm light
    const nightF = G.timeOfDay < 0.2 || G.timeOfDay > 0.75 ? 1 : Math.max(0, (G.timeOfDay-0.7)/0.1)
    const winAlpha = 0.55 + nightF * 0.35
    const winR = 255, winG2 = Math.round(180+Math.sin(aT*0.4)*20), winB = Math.round(80+nightF*30)
    ctx.fillStyle = `rgba(${winR},${winG2},${winB},${winAlpha})`
    ctx.beginPath(); ctx.roundRect(hx-hw/2+8, hy-hh+13, 16, 13, 2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(hx+hw/2-24, hy-hh+13, 16, 13, 2); ctx.fill()
    if (nightF > 0.3) {
      // Window glow
      ctx.globalAlpha = fade * nightF * 0.3
      const wglow = ctx.createRadialGradient(hx-hw/2+16, hy-hh+19, 0, hx-hw/2+16, hy-hh+19, 20)
      wglow.addColorStop(0, `rgba(255,200,80,0.8)`); wglow.addColorStop(1, 'rgba(255,180,60,0)')
      ctx.fillStyle = wglow; ctx.fillRect(hx-hw/2-4, hy-hh+3, 40, 30)
      const wglow2 = ctx.createRadialGradient(hx+hw/2-16, hy-hh+19, 0, hx+hw/2-16, hy-hh+19, 20)
      wglow2.addColorStop(0, `rgba(255,200,80,0.8)`); wglow2.addColorStop(1, 'rgba(255,180,60,0)')
      ctx.fillStyle = wglow2; ctx.fillRect(hx+hw/2-36, hy-hh+3, 40, 30)
      ctx.globalAlpha = fade
    }
    // Window frames
    ctx.strokeStyle = '#b08848'; ctx.lineWidth = 1
    ctx.strokeRect(hx-hw/2+8, hy-hh+13, 16, 13)
    ctx.strokeRect(hx+hw/2-24, hy-hh+13, 16, 13)
    // Cross bar
    ctx.beginPath(); ctx.moveTo(hx-hw/2+16, hy-hh+13); ctx.lineTo(hx-hw/2+16, hy-hh+26); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(hx+hw/2-16, hy-hh+13); ctx.lineTo(hx+hw/2-16, hy-hh+26); ctx.stroke()
    ctx.restore()
  }

  // ── VILLAGE BG HOUSES ─────────────────────────────────────────────
  function drawVillage() {
    if (!G.unlocks.village) return
    const fade = clamp((G.streak-19)/4, 0, 1)
    const extras = [{x:0.04,y:0.57,s:0.52},{x:0.91,y:0.57,s:0.5},{x:0.85,y:0.56,s:0.55}]
    ctx.save(); ctx.globalAlpha = fade * 0.72
    extras.forEach(v => {
      const vx=v.x*W, vy=hY(v.x,v.y), s=v.s, vw=44*s, vhh=34*s
      ctx.fillStyle = '#c09868'
      ctx.fillRect(vx-vw/2, vy-vhh, vw, vhh)
      ctx.fillStyle = '#622018'
      ctx.beginPath()
      ctx.moveTo(vx-vw/2-7*s, vy-vhh+1)
      ctx.lineTo(vx, vy-vhh-26*s)
      ctx.lineTo(vx+vw/2+7*s, vy-vhh+1)
      ctx.closePath(); ctx.fill()
      // Tiny window
      ctx.fillStyle = 'rgba(255,210,120,0.65)'
      ctx.fillRect(vx-5*s, vy-vhh+8*s, 10*s, 8*s)
    })
    ctx.restore()
  }

  // ── LANTERNS ──────────────────────────────────────────────────────
  function drawLanterns() {
    if (!G.unlocks.lanterns) return
    const fade = clamp((G.xp-550)/100, 0, 1)
    const nightF = G.timeOfDay < 0.22 || G.timeOfDay > 0.75 ? 1 : Math.max(0, (G.timeOfDay-0.68)/0.1)
    G.lanternGlow += 0.04
    const positions = [
      {x:0.24,side:'L'},{x:0.6,side:'R'},{x:0.14,side:'L'},{x:0.7,side:'R'}
    ]
    positions.forEach((lp, i) => {
      const lx=lp.x*W, ly=gY(lp.x)
      const flicker = Math.sin(G.lanternGlow+i*1.7)*0.06
      ctx.save(); ctx.globalAlpha = fade

      // Pole
      const pg = ctx.createLinearGradient(lx-1.5, ly-34, lx+1.5, ly)
      pg.addColorStop(0,'#8a6840'); pg.addColorStop(1,'#5a4020')
      ctx.fillStyle = pg
      ctx.fillRect(lx-1.5, ly-34, 3, 34)

      // Glow — night only
      if (nightF > 0.05) {
        ctx.globalAlpha = fade * nightF * (0.55+flicker)
        const gg = ctx.createRadialGradient(lx, ly-38, 0, lx, ly-38, 32)
        gg.addColorStop(0, `rgba(255,200,80,0.85)`)
        gg.addColorStop(0.4, `rgba(255,160,40,0.4)`)
        gg.addColorStop(1, 'rgba(255,140,20,0)')
        ctx.fillStyle = gg
        ctx.fillRect(lx-32, ly-70, 64, 64)
        ctx.globalAlpha = fade
      }

      // Lantern body
      const lg = ctx.createLinearGradient(lx-7, ly-48, lx+7, ly-34)
      lg.addColorStop(0, '#d88030'); lg.addColorStop(1, '#a86020')
      ctx.fillStyle = lg
      ctx.beginPath(); ctx.roundRect(lx-7, ly-48, 14, 16, 3); ctx.fill()
      // Lantern light pane
      const lfa = 0.65 + nightF * 0.3
      ctx.fillStyle = `rgba(255,${Math.round(210+flicker*40)},${Math.round(80+nightF*30)},${lfa})`
      ctx.beginPath(); ctx.roundRect(lx-5, ly-46, 10, 12, 2); ctx.fill()
      // Cap
      ctx.fillStyle = '#8a5820'
      ctx.beginPath(); ctx.moveTo(lx-9, ly-48); ctx.lineTo(lx, ly-56); ctx.lineTo(lx+9, ly-48); ctx.closePath(); ctx.fill()
      ctx.restore()
    })
  }

  // ── FIREFLIES ─────────────────────────────────────────────────────
  function drawFireflies() {
    if (!G.unlocks.village) return
    const nightF = G.timeOfDay < 0.2 || G.timeOfDay > 0.8 ? 1 : 0
    if (nightF < 0.5) return
    G.fireflies.forEach((ff, i) => {
      ff.x = (ff.x + ff.spd + 0.001) % 1
      ff.y = clamp(ff.y + ff.vy, 0.3, 0.72)
      if (ff.y <= 0.3 || ff.y >= 0.72) ff.vy *= -1
      const pulse = Math.sin(aT*3+ff.phase)*0.5+0.5
      const fx = ff.x*W, fy = ff.y*H
      ctx.save()
      ctx.globalAlpha = pulse * 0.85 * nightF
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 7)
      fg.addColorStop(0, 'rgba(180,255,120,1)')
      fg.addColorStop(0.4, 'rgba(140,255,80,0.5)')
      fg.addColorStop(1, 'rgba(120,255,60,0)')
      ctx.fillStyle = fg
      ctx.fillRect(fx-7, fy-7, 14, 14)
      ctx.fillStyle = 'rgba(200,255,150,0.95)'
      ctx.beginPath(); ctx.arc(fx, fy, 1.5, 0, Math.PI*2); ctx.fill()
      ctx.restore()
    })
  }

  // ── BIRDS ─────────────────────────────────────────────────────────
  function drawBirds() {
    if (!G.unlocks.birds) return
    G.birds.forEach(b => {
      b.x = (b.x + b.spd) % 1.18
      if (b.x > 1.12) b.x = -0.1
      const bx=b.x*W, by=b.y*H
      const wing = Math.sin(aT*8.5+b.phase)*5.5*b.sz
      ctx.strokeStyle = `rgba(25,25,45,0.72)`
      ctx.lineWidth = 1.5*b.sz; ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bx-7*b.sz, by-wing*0.5)
      ctx.quadraticCurveTo(bx, by+1, bx+7*b.sz, by-wing*0.5)
      ctx.stroke()
    })
  }

  // ── MIST / ATMOSPHERE ─────────────────────────────────────────────
  function drawMist() {
    if (G.stage < 3) return
    ctx.save()
    // Ground mist
    const mist = ctx.createLinearGradient(0, H*0.58, 0, H*0.68)
    mist.addColorStop(0, 'rgba(200,220,240,0.08)')
    mist.addColorStop(0.5, 'rgba(180,210,235,0.05)')
    mist.addColorStop(1, 'rgba(160,200,230,0)')
    ctx.fillStyle = mist
    ctx.fillRect(0, H*0.57, W, H*0.12)

    // Hill mist
    const mist2 = ctx.createLinearGradient(0, H*0.5, 0, H*0.6)
    mist2.addColorStop(0, 'rgba(200,215,235,0.12)')
    mist2.addColorStop(1, 'rgba(200,215,235,0)')
    ctx.fillStyle = mist2
    ctx.fillRect(0, H*0.48, W, H*0.14)
    ctx.restore()
  }

  // ── CHARACTER ─────────────────────────────────────────────────────
  function drawChar() {
    const c = G.char
    const dx = c.targetX - c.x
    if (Math.abs(dx) < 0.005) {
      c.idle++
      if (c.idle > 160+Math.random()*120) {
        c.targetX = 0.12 + Math.random()*0.5
        c.idle = 0
      }
    } else {
      c.dir = dx > 0 ? 1 : -1
      c.x += dx * 0.002
      c.step += 0.16
    }
    const px = c.x*W, py = gY(c.x)
    const walking = Math.abs(dx) > 0.006
    const leg = walking ? Math.sin(c.step)*6 : 0
    const bob = Math.sin(aT*1.3)*0.8
    const s = 1.15

    ctx.save()
    ctx.translate(px, py + bob*0.4)
    if (c.dir < 0) ctx.scale(-1, 1)

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.14)'
    ctx.beginPath(); ctx.ellipse(0, 1, 11, 4, 0, 0, Math.PI*2); ctx.fill()

    // Shoes
    ctx.fillStyle = '#28183a'
    ctx.beginPath(); ctx.ellipse(-5, -3+leg, 5.5, 2.8, -0.08, 0, Math.PI*2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(5, -3-leg, 5.5, 2.8, 0.08, 0, Math.PI*2); ctx.fill()

    // Legs
    const lg1 = ctx.createLinearGradient(-8,-20,0,0)
    lg1.addColorStop(0,'#2a4aaa'); lg1.addColorStop(1,'#1a3488')
    ctx.fillStyle = lg1
    ctx.beginPath(); ctx.roundRect(-8, -21, 6.5, 19+leg, 3); ctx.fill()
    ctx.beginPath(); ctx.roundRect(1.5, -21, 6.5, 19-leg, 3); ctx.fill()

    // Backpack
    ctx.fillStyle = '#9a7848'
    ctx.beginPath(); ctx.roundRect(-10, -39, 8, 15, 3); ctx.fill()
    ctx.fillStyle = '#7a5828'
    ctx.beginPath(); ctx.roundRect(-9, -37, 6, 6, 1); ctx.fill()
    ctx.fillStyle = '#c09060'
    ctx.fillRect(-9.5, -30, 7, 2)

    // Body — warm autumn jacket
    const bg = ctx.createLinearGradient(-8*s, -42*s, 8*s, -20*s)
    bg.addColorStop(0,'#d85830'); bg.addColorStop(0.6,'#b84020'); bg.addColorStop(1,'#983010')
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.roundRect(-8, -43, 16, 24, 4); ctx.fill()
    // Jacket shading
    ctx.fillStyle = 'rgba(0,0,0,0.1)'
    ctx.beginPath(); ctx.roundRect(-8, -43, 6, 24, [4,0,0,4]); ctx.fill()
    // Collar
    ctx.fillStyle = '#f5f0e0'; ctx.fillRect(-5, -43, 10, 4)

    // Head
    const hg = ctx.createRadialGradient(-3, -53, 0, 0, -50, 10)
    hg.addColorStop(0, '#f8d0a0'); hg.addColorStop(1, '#e8b880')
    ctx.fillStyle = hg
    ctx.beginPath(); ctx.arc(0, -50, 9.5, 0, Math.PI*2); ctx.fill()
    // Cheeks
    ctx.fillStyle = 'rgba(255,140,110,0.3)'
    ctx.beginPath(); ctx.ellipse(-6, -47, 4, 2.8, 0, 0, Math.PI*2); ctx.fill()

    // Hair — dark wavy
    ctx.fillStyle = '#221008'
    ctx.beginPath()
    ctx.moveTo(-9.5,-50)
    ctx.bezierCurveTo(-10,-58, 2,-64, 9.5,-50)
    ctx.arc(0,-50, 9.5, 0, Math.PI, true)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#2a1510'
    ctx.beginPath(); ctx.moveTo(9,-53); ctx.quadraticCurveTo(13,-57, 11,-62); ctx.strokeStyle='#2a1510'; ctx.lineWidth=2; ctx.lineCap='round'; ctx.stroke()

    // Eyes
    ctx.fillStyle = '#181028'
    ctx.beginPath(); ctx.ellipse(4.5,-49, 2, 2.5, 0, 0, Math.PI*2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath(); ctx.arc(5,-49.8, 0.8, 0, Math.PI*2); ctx.fill()
    // Smile
    ctx.strokeStyle = '#b86848'; ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.arc(0,-46, 3.5, 0.2, Math.PI-0.2); ctx.stroke()

    // Arms
    ctx.strokeStyle = '#d85830'; ctx.lineWidth = 5; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-8,-36); ctx.lineTo(-15,-28+leg*0.4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(8,-36); ctx.lineTo(15,-28-leg*0.4); ctx.stroke()
    ctx.fillStyle = '#f0c090'
    ctx.beginPath(); ctx.arc(-15,-27+leg*0.4, 3, 0, Math.PI*2); ctx.fill()
    ctx.beginPath(); ctx.arc(15,-27-leg*0.4, 3, 0, Math.PI*2); ctx.fill()

    ctx.restore()
  }

  // ── PARTICLES & TEXTS ─────────────────────────────────────────────
  function drawFX() {
    G.particles = G.particles.filter(p => {
      p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.life-=0.022; p.r*=0.96
      if (p.life<=0) return false
      ctx.save(); ctx.globalAlpha = p.life*0.9
      ctx.fillStyle = p.color
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill()
      ctx.restore(); return true
    })
    G.texts = G.texts.filter(t => {
      t.y-=0.9; t.life-=0.015
      if (t.life<=0) return false
      ctx.save(); ctx.globalAlpha = t.life
      ctx.font = `700 13px Inter,system-ui`; ctx.textAlign = 'center'
      ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y)
      ctx.restore(); return true
    })
  }

  // ── AMBIENT OVERLAY ────────────────────────────────────────────────
  function drawAmbient() {
    const st = STAGES[G.stage]
    ctx.save()
    ctx.globalAlpha = 0.06
    ctx.fillStyle = st.ambientColor
    ctx.fillRect(0, 0, W, H)
    // Stage transition flash
    if (G.transitionAlpha > 0) {
      ctx.globalAlpha = G.transitionAlpha
      ctx.fillStyle = 'rgba(255,255,220,1)'
      ctx.fillRect(0,0,W,H)
      G.transitionAlpha = Math.max(0, G.transitionAlpha - 0.04)
    }
    ctx.restore()
  }

  // ── MINIMAL HUD ───────────────────────────────────────────────────
  function drawHUD() {
    ctx.save()
    // XP — wooden sign top right
    const xpStr = `⭐ ${G.xp} XP`
    ctx.font = '600 11px Inter,system-ui'
    const xw = ctx.measureText(xpStr).width + 18
    ctx.globalAlpha = 0.78
    // Sign bg
    const sg = ctx.createLinearGradient(W-xw-10, 10, W-10, 34)
    sg.addColorStop(0, '#c89a50'); sg.addColorStop(1, '#a87830')
    ctx.fillStyle = sg
    ctx.beginPath(); ctx.roundRect(W-xw-10, 10, xw, 24, 6); ctx.fill()
    ctx.strokeStyle = '#8a5e20'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.roundRect(W-xw-10, 10, xw, 24, 6); ctx.stroke()
    ctx.fillStyle = '#3a1a06'; ctx.textAlign = 'center'
    ctx.fillText(xpStr, W-xw/2-10, 26)

    // Streak — top left
    if (G.streak > 0) {
      const str = `🔥 ${G.streak}`
      const sw = ctx.measureText(str).width + 18
      const sg2 = ctx.createLinearGradient(10, 10, 10+sw, 34)
      sg2.addColorStop(0, '#c89a50'); sg2.addColorStop(1, '#a87830')
      ctx.fillStyle = sg2
      ctx.beginPath(); ctx.roundRect(10, 10, sw, 24, 6); ctx.fill()
      ctx.strokeStyle = '#8a5e20'
      ctx.beginPath(); ctx.roundRect(10, 10, sw, 24, 6); ctx.stroke()
      ctx.fillStyle = '#3a1a06'; ctx.textAlign = 'center'
      ctx.fillText(str, 10+sw/2, 26)
    }
    ctx.restore()
  }

  // ── MAIN LOOP ─────────────────────────────────────────────────────
  function loop(ts) {
    if (!canvas||!ctx) return
    rafId = requestAnimationFrame(loop)
    const dt = Math.min(ts-lastT, 48); lastT = ts
    aT += dt*0.001

    // Update
    G.wind = aT * 1.35
    G.timeOfDay = (Math.sin(aT*0.065)*0.5+0.5)

    // Canvas resolution
    W = canvas.width/DPR; H = canvas.height/DPR
    ctx.clearRect(0,0,canvas.width,canvas.height)
    ctx.save(); ctx.scale(DPR, DPR)

    // ── Render layers ──────────────────────────────────────────────
    drawSky()
    drawMoonStars()
    drawSun()
    drawRainbow()
    drawClouds()
    drawMountains()
    drawHills()
    drawMist()
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
    drawFireflies()
    drawBirds()
    drawChar()
    drawAmbient()
    drawFX()
    drawHUD()

    ctx.restore()
  }

  // ── PUBLIC API ────────────────────────────────────────────────────
  function init(canvasEl, data) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    canvas = canvasEl
    DPR = Math.min(window.devicePixelRatio||1, 2)
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width*DPR)
    canvas.height = Math.round(rect.height*DPR)
    ctx = canvas.getContext('2d', { alpha: false })
    initElements()
    update(data)
    lastT = performance.now()
    rafId = requestAnimationFrame(loop)
  }

  function update(data) {
    if (!data) return
    const prevStage = G.stage
    G.streak = data.streak||0; G.xp = data.xp||0; G.grade = data.grade||0
    G.stage = calcStage()
    if (G.stage > prevStage) G.transitionAlpha = 0.8
    const newU = calcUnlocks()
    if (newU.length && canvas) {
      newU.forEach(u => {
        for (let i=0; i<28; i++) {
          G.particles.push({
            x: canvas.width/DPR/2, y: canvas.height/DPR*0.48,
            vx: (Math.random()-0.5)*8, vy: -Math.random()*9-2,
            r: 3+Math.random()*5,
            color: ['#ffd700','#ff9f43','#00c896','#6c63ff','#ff88bb'][Math.floor(Math.random()*5)],
            life: 1
          })
        }
        G.texts.push({
          x: canvas.width/DPR/2, y: canvas.height/DPR*0.38,
          text: `${u.emoji} ${u.label} ochildi!`, color: '#ffe060', life: 1
        })
      })
    }
    return newU
  }

  function destroy() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    canvas = null; ctx = null
  }

  function getNextUnlock() { return getNext() }
  function getUnlocks() { return { ...G.unlocks } }
  function getDoneCount() { return UNLOCKS.filter(u => G.unlocks[u.key]).length }
  function getTotalCount() { return UNLOCKS.length }

  return { init, update, destroy, getNextUnlock, getUnlocks, getDoneCount, getTotalCount }
})()
