// ================================================================
//  StudyMind — Patch Script
//  Muammolar: nav tabs, [STUDY:30] ko'rinishi, streak 2x
//  Bu skriptni app.html oxiriga </body> dan oldin qo'shing
// ================================================================

// 1. Title tozalash funksiyasi
function cleanTitle(t) {
  return (t || '')
    .replace(/\[STUDY:\d+\]/gi, '')
    .replace(/\[GRADE:[^\]]+\]/gi, '')
    .replace(/\[SCHED:[^\]]+\]/gi, '')
    .replace(/\[FC:[^\]]+\]/gi, '')
    .replace(/^\s*\.\s*/, '')
    .trim()
}

// 2. siHtml — title ni tozalab ko'rsatadi
window.siHtml = function(x) {
  return `<div class="si">
    <span class="si-em">${x.emoji || '📌'}</span>
    <div class="si-check ${x.isDone ? 'done' : ''} ${x.category === 'life' ? 'life' : ''}"
         onclick="toggleSched('${x._id}',${!x.isDone})">${x.isDone ? '✓' : ''}</div>
    <div class="si-info">
      <div class="si-title ${x.isDone ? 'done' : ''}">${cleanTitle(x.title)}</div>
      <div class="si-meta">
        <span class="si-cat ${x.category}">${x.category === 'life' ? '🌟 Hayot' : '📚 O\'quv'}</span>
        ${x.subjectName ? `<span style="font-size:10px;color:var(--t2)">${x.subjectName}</span>` : ''}
        ${x.repeat && x.repeat !== 'none' ? `<span class="si-rep">${x.repeat === 'daily' ? 'Har kun' : '↩'}</span>` : ''}
      </div>
    </div>
    ${x.time ? `<div class="si-time">${x.time}</div>` : ''}
    <button class="si-del" onclick="delSched('${x._id}')">×</button>
  </div>`
}

// 3. Nav tabs — Garden qo'shilgan
window.nav = function() {
  const FIXED_TABS = [
    { id: 'home',   i: '🏠', l: 'Bosh'    },
    { id: 'ai',     i: '🧠', l: 'AI'      },
    { id: 'garden', i: '🌿', l: 'Bog\''   },
    { id: 'notes',  i: '📝', l: 'Notes'   },
    { id: 'more',   i: '···', l: 'Ko\'proq' },
  ]
  const due = S.stats?.dueCards || 0
  return `<nav id="nav">${FIXED_TABS.map(tb =>
    `<button class="nb ${S.tab === tb.id ? 'on' : ''}" onclick="switchTab('${tb.id}')">
      <div class="nb-wrap">
        <span class="ni">${tb.i}</span>
        ${tb.id === 'more' && due ? `<span class="nb-dot"></span>` : ''}
      </div>
      <span class="nl">${tb.l}</span>
    </button>`
  ).join('')}</nav>`
}

// 4. homePage — streak faqat 1 marta, streak-pill saqlanadi
window.homePage = function() {
  const s = S.stats, u = S.user
  const w = s?.weekly || []
  const maxM = Math.max(...w.map(d => d.tasks), 1)
  const DAYS = ['Du','Se','Ch','Pa','Ju','Sh','Ya']

  function avgGrade() {
    const ss = s?.subjects?.filter(x => x.avgGrade > 0) || []
    return ss.length ? Math.round(ss.reduce((a, x) => a + x.avgGrade, 0) / ss.length) || '—' : '—'
  }

  const gl = S.gardenLevel || 0
  const gardenEmojis = ['🌱','🌿','🌳','🌲','🏡','🌸','🌺','🌈']
  const gEmoji = gardenEmojis[Math.min(gl, 7)]

  const urgent = s?.urgentSubjects?.map(x =>
    `<div class="urgent">⚠️ <div><div class="urgent-name">${x.emoji}${x.name} — imtihon!</div>
     <div class="urgent-days">${Math.ceil((new Date(x.examDate)-new Date())/86400000)} kun qoldi</div></div></div>`
  ).join('') || ''

  // Quote
  const quoteHtml = S.quote
    ? `<div class="quote-box">
        <div class="quote-text">"${S.quote.text}"</div>
        <div class="quote-author">— ${S.quote.author}</div>
        <button class="quote-save" onclick="saveQuote()">💾</button>
       </div>` : ''

  // Streak — FAQAT 1 TA
  const streakHtml = `<div class="streak-pill">
    <span class="streak-fire">🔥</span>
    <div>
      <div style="display:flex;align-items:baseline;gap:6px">
        <span class="streak-num">${u?.streak || 0}</span>
        <span style="font-size:14px;font-weight:700">kunlik streak!</span>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:1px">
        ${gEmoji} Bog': ${['Urug\'','Ko\'chat','Nihal','Daraxt','Bog\'','Gullagan','Mukammal','Jannat'][gl]}
      </div>
    </div>
  </div>`

  // Metrics
  const metricsHtml = `<div class="mgrid">
    <div class="mc"><div class="mc-val" style="color:var(--p)">${avgGrade()}</div><div class="mc-label">O'rtacha baho</div></div>
    <div class="mc"><div class="mc-val" style="color:var(--teal)">${u?.totalStudyMinutes || 0}</div><div class="mc-label">Jami daqiqa</div></div>
    <div class="mc"><div class="mc-val" style="color:var(--amber)">${s?.doneTasks || 0}/${s?.todayTasks || 0}</div><div class="mc-label">Bugungi vazifa</div></div>
    <div class="mc"><div class="mc-val" style="color:var(--red)">${s?.dueCards || 0}</div><div class="mc-label">Kartalar</div></div>
  </div>`

  // AI insight
  const insightHtml = s?.lastInsight?.summary
    ? `<div class="ai-pill">${s.lastInsight.summary}</div>`
    : `<div class="ai-pill">🧠 AI bilan gaplash — baho, reja, karta hammasi avtomatik!</div>`

  // Weekly chart
  const chartHtml = `<div class="sec">
    <div class="sec-title">📈 Haftalik faollik</div>
    <div class="card-box"><div class="wchart">${w.map((d, i) => {
      const h = Math.max(3, Math.round((d.tasks / maxM) * 64))
      const pct = d.tasks > 0 ? Math.round((d.done / d.tasks) * 100) : 0
      return `<div class="wc">
        <div class="wb" style="height:${h}px;background:${pct>=80?'var(--teal)':pct>=50?'var(--p)':'var(--card2)'}"></div>
        <div class="wl">${DAYS[i]}</div>
      </div>`
    }).join('')}</div></div>
  </div>`

  // Schedule
  const schedHtml = `<div class="sec">
    <div class="sec-title">📅 Bugungi reja
      <span class="sec-action" onclick="switchTab('schedule')">Barchasi →</span>
    </div>
    <div class="si-list">
      ${S.schedule.slice(0, 4).map(x => siHtml(x)).join('')
        || `<div style="padding:16px;text-align:center;font-size:13px;color:var(--t2)">Reja yo'q — AI yoki qo'lda qo'shing</div>`}
      <div style="padding:10px 14px;display:flex;gap:8px;border-top:1px solid var(--b)">
        <button class="btn-sm p" onclick="genPlan()">🧠 AI reja</button>
        <button class="btn-sm s" onclick="openModal('addSchedule')">+ Qo'shish</button>
      </div>
    </div>
  </div>`

  return `${urgent}${streakHtml}${quoteHtml}${metricsHtml}${insightHtml}${chartHtml}${schedHtml}<div class="space"></div>`
}

// 5. switchTab — Garden support
window.switchTab = async function(tab) {
  S.tab = tab
  if (tab === 'garden') {
    try {
      const data = await GET('/api/garden')
      S.gardenLevel = data.level
      S.gardenData = data
    } catch {}
  }
  if (tab === 'more' && !S.insights.length) {
    try { S.insights = await GET('/api/insights') } catch {}
  }
  if (tab === 'schedule') {
    try {
      const url = S.schedTab === 'templates'
        ? '/api/schedule?templates=true'
        : '/api/schedule?date=' + (new Date().toISOString().split('T')[0])
      S.schedule = await GET(url)
    } catch {}
  }
  if (tab === 'notes') {
    try { S.notes = await GET('/api/notes') } catch {}
  }
  render()
  document.getElementById('scroll')?.scrollTo({ top: 0, behavior: 'smooth' })
}

// 6. pageCnt — Garden page ni qo'shadi
const _origPageCnt = window.pageCnt
window.pageCnt = function() {
  if (S.tab === 'garden') return typeof gardenPage === 'function' ? gardenPage() : '<div class="empty"><div class="empty-i">🌿</div><div>Bog\' yuklanmoqda...</div></div>'
  if (_origPageCnt) return _origPageCnt()
  switch(S.tab) {
    case 'home':     return homePage()
    case 'schedule': return schedulePage()
    case 'notes':    return notesPage()
    case 'more':     return morePage()
    default:         return homePage()
  }
}

// 7. stdPage subtitles/titles — Garden uchun
window.stdPage = function() {
  const u = S.user
  const xp = nxtLvl(u?.level || 1)
  const pct = Math.min(100, Math.round(((u?.xp || 0) / xp) * 100))
  const h = new Date().getHours()
  const gr = h < 12 ? '🌅 Xayrli tong' : h < 17 ? '☀️ Xayrli kun' : '🌙 Xayrli kech'
  const gl = S.gardenLevel || 0
  const gNames = ['Urug\'','Ko\'chat','Nihal','Daraxt','Bog\'','Gullagan','Mukammal','Jannat']

  const subtitles = {
    home: `Lv.${u?.level} · ${u?.xp}xp · 🔥${u?.streak}`,
    schedule: new Date().toISOString().split('T')[0],
    notes: `${S.notes.length} ta eslatma`,
    garden: `${gNames[Math.min(gl, 7)]} · Streak ${u?.streak || 0}`,
    more: `${S.subjects.length} fan · ${S.stats?.dueCards || 0} karta`
  }
  const titles = {
    home: `${gr}, ${u?.name?.split(' ')[0]}!`,
    schedule: 'Kun tartibi',
    notes: 'Eslatmalar',
    garden: '🌿 Bog\'im',
    more: 'Ko\'proq'
  }

  const init = (u?.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return `<div class="hdr">
    <div class="hdr-row">
      <div>
        <div class="hdr-title">${titles[S.tab] || 'StudyMind'}</div>
        <div class="hdr-sub">${subtitles[S.tab] || ''}</div>
      </div>
      <div class="hdr-av" onclick="openModal('settings')">
        ${u?.avatar ? `<img src="${u.avatar}">` : init}
      </div>
    </div>
  </div>
  <div class="xp-strip"><div class="xp-strip-fill" style="width:${pct}%"></div></div>
  <div id="scroll">${window.pageCnt()}</div>`
}

console.log('✅ StudyMind patch yuklandi')
