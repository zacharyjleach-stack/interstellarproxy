import { createArrow } from './arrow.js'

const $ = (id) => document.getElementById(id)
const state = {
  devices: [],
  last: new Map(), // ip -> { ok, ms }
  history: new Map(), // ip -> recent ping results
  selected: null,
  heading: null, // compass heading in degrees, null if unavailable
  draftBearing: null, // slider value while dragging
}
let arrow = null

const api = (path, method = 'GET', body) =>
  fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json())

const device = () => state.devices.find((d) => d.ip === state.selected)
const label = (d) => d.name || d.hostname || d.ip

// ---- Live updates from the server ----
const events = new EventSource('/api/events')
events.addEventListener('devices', (e) => {
  state.devices = JSON.parse(e.data)
  renderList()
  if (state.selected) renderLocate()
})
events.addEventListener('scan', (e) => {
  const s = JSON.parse(e.data)
  $('scan').disabled = s.running
  $('scan').textContent = s.running ? 'Scanning…' : 'Scan network'
  $('scan-status').textContent = s.running && s.total ? `Pinging ${s.done} / ${s.total} addresses…` : ''
})
events.addEventListener('ping', (e) => {
  const p = JSON.parse(e.data)
  state.last.set(p.ip, p)
  const h = state.history.get(p.ip) || []
  h.push(p)
  if (h.length > 60) h.shift()
  state.history.set(p.ip, h)
  updateRow(p.ip)
  if (p.ip === state.selected) {
    arrow?.pulse(p.ok)
    renderPingStat()
  }
})

$('scan').onclick = () => api('/api/scan', 'POST')

// ---- Device list ----
function renderList() {
  const ul = $('devices')
  ul.replaceChildren(
    ...state.devices.map((d) => {
      const li = document.createElement('li')
      li.dataset.ip = d.ip
      li.innerHTML = `
        <span class="dot"></span>
        <div class="info">
          <div class="title"></div>
          <div class="sub mono"></div>
        </div>
        <span class="lat mono"></span>
        <button class="ping"></button>`
      li.querySelector('.title').textContent = label(d) + (d.self ? ' (this computer)' : '')
      li.querySelector('.sub').textContent = [label(d) !== d.ip ? d.ip : null, d.mac, d.offline ? 'not seen in last scan' : null].filter(Boolean).join(' · ')
      li.querySelector('.info').onclick = () => openLocate(d.ip)
      const btn = li.querySelector('.ping')
      btn.textContent = d.pinging ? 'Stop' : 'Ping'
      btn.className = d.pinging ? 'stop' : ''
      btn.onclick = () => togglePing(d)
      return li
    }),
  )
  $('empty').hidden = state.devices.length > 0
  state.devices.forEach((d) => updateRow(d.ip))
}

function updateRow(ip) {
  const li = document.querySelector(`#devices li[data-ip="${ip}"]`)
  if (!li) return
  const d = state.devices.find((x) => x.ip === ip)
  const p = state.last.get(ip)
  const ms = p ? p.ms : d?.ms
  const ok = p ? p.ok : d && !d.offline
  li.querySelector('.dot').className = 'dot ' + (p || d?.ms != null ? (ok ? 'ok' : 'bad') : '')
  li.querySelector('.lat').textContent = ok && ms != null ? `${ms.toFixed(ms < 10 ? 1 : 0)} ms` : p ? 'timeout' : ''
}

const togglePing = (d) => api(`/api/devices/${d.ip}/ping`, d.pinging ? 'DELETE' : 'POST')

// ---- Locate view ----
function openLocate(ip) {
  state.selected = ip
  $('list-view').hidden = true
  $('locate-view').hidden = false
  arrow ||= createArrow($('arrow'))
  $('name').value = device()?.name || ''
  renderLocate()
  renderPingStat()
  window.scrollTo(0, 0)
}

$('back').onclick = () => {
  state.selected = null
  $('locate-view').hidden = true
  $('list-view').hidden = false
}

function renderLocate() {
  const d = device()
  if (!d) return
  $('name').placeholder = d.hostname || 'Name this device'
  $('locate-ip').textContent = [d.ip, d.mac].filter(Boolean).join(' · ')
  $('ping-toggle').textContent = d.pinging ? 'Stop ping' : 'Start ping'
  $('ping-toggle').className = d.pinging ? 'stop' : 'primary'
  if (state.draftBearing === null) $('bearing').value = d.bearing ?? 0
  updateArrow()
}

function bearing() {
  return state.draftBearing ?? device()?.bearing ?? null
}

function updateArrow() {
  if (!arrow || !state.selected) return
  const b = bearing()
  const hint = $('arrow-hint')
  $('bearing-val').textContent = b === null ? 'not set' : `${Math.round(b)}°`
  $('clear').disabled = b === null
  $('mark').disabled = state.heading === null
  if (b === null) {
    arrow.setAngle(null)
    hint.textContent = 'No direction saved yet. Point your phone at the device and tap the button below, or use the slider.'
  } else if (state.heading === null) {
    arrow.setAngle(b)
    hint.textContent = 'No compass: the top of the screen is treated as north.'
  } else {
    arrow.setAngle(b - state.heading)
    const off = Math.round(((b - state.heading + 540) % 360) - 180)
    hint.textContent = Math.abs(off) <= 10 ? 'Straight ahead' : `Turn ${off > 0 ? 'right' : 'left'} ${Math.abs(off)}°`
  }
}

$('name').onchange = (e) => api(`/api/devices/${state.selected}`, 'PATCH', { name: e.target.value.trim() })
$('ping-toggle').onclick = () => device() && togglePing(device())
$('bearing').oninput = (e) => {
  state.draftBearing = Number(e.target.value)
  updateArrow()
}
$('bearing').onchange = async (e) => {
  await api(`/api/devices/${state.selected}`, 'PATCH', { bearing: Number(e.target.value) })
  state.draftBearing = null
}
$('mark').onclick = () => {
  if (state.heading === null) return
  api(`/api/devices/${state.selected}`, 'PATCH', { bearing: Math.round(state.heading) })
}
$('clear').onclick = () => api(`/api/devices/${state.selected}`, 'PATCH', { bearing: null })

function renderPingStat() {
  const h = state.history.get(state.selected) || []
  const p = h[h.length - 1]
  const lost = h.filter((x) => !x.ok).length
  $('ping-stat').textContent = !p ? '–' : p.ok ? `${p.ms.toFixed(1)} ms` : 'timeout'
  if (h.length) $('ping-stat').title = `${h.length} pings, ${lost} lost`
  drawSpark(h)
}

function drawSpark(h) {
  const c = $('spark')
  const w = (c.width = c.clientWidth * devicePixelRatio)
  const ht = (c.height = c.clientHeight * devicePixelRatio)
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, w, ht)
  if (!h.length) return
  const max = Math.max(5, ...h.filter((x) => x.ok).map((x) => x.ms))
  const step = w / 59
  h.forEach((x, i) => {
    const px = w - (h.length - 1 - i) * step
    const barH = x.ok ? Math.max(2, (x.ms / max) * ht) : ht
    ctx.fillStyle = x.ok ? '#3fb950' : '#f85149'
    ctx.fillRect(px - step * 0.35, ht - barH, step * 0.7, barH)
  })
}

// ---- Compass ----
function setCompassStatus(text) {
  $('compass-status').textContent = text
}

function onOrientation(e) {
  let h = null
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading // iOS
  else if (e.absolute && e.alpha !== null) h = 360 - e.alpha // Android
  if (h === null) return
  state.heading = (h + (screen.orientation?.angle || 0) + 360) % 360
  $('compass').hidden = true
  setCompassStatus(`Compass on, facing ${Math.round(state.heading)}°.`)
  updateArrow()
}

async function enableCompass() {
  if (!window.isSecureContext) {
    setCompassStatus('The compass needs HTTPS on phones. Restart the server with `npm run start:https` and open the https:// address.')
    return
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    setCompassStatus('This device has no compass. Use the slider to set a direction.')
    return
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const res = await DeviceOrientationEvent.requestPermission().catch(() => 'denied')
    if (res !== 'granted') return setCompassStatus('Compass permission was denied.')
  }
  window.addEventListener('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onOrientation)
  setCompassStatus('Waiting for compass… (desktops usually have none)')
}

$('compass').onclick = enableCompass
setCompassStatus('Turn on the compass so the arrow follows you as you turn.')
