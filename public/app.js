import { createArrow } from './arrow.js'
import { createBeacon, distanceM, bearingDeg, fmtDistance } from './findable.js'

const $ = (id) => document.getElementById(id)
const state = {
  devices: [],
  last: new Map(), // ip -> { ok, ms }
  history: new Map(), // ip -> recent ping results
  selected: null,
  heading: null, // compass heading in degrees, null if unavailable
  draftBearing: null, // slider value while dragging
  myPos: null, // this phone's GPS position, while finding a 📡 device
}
let geoWatch = null
const myPings = new Set() // pings started from this screen; only these beep here
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
  if (p.ok && myPings.has(p.ip)) beep()
  if (p.ip === state.selected) {
    arrow?.pulse(p.ok)
    renderPingStat()
  }
})

events.addEventListener('ring', (e) => beacon.onRing(JSON.parse(e.data)))

$('scan').onclick = () => api('/api/scan', 'POST')

// ---- Findable mode (this device is the one being found) ----
const beacon = createBeacon({
  $,
  api,
  onExit: () => {
    $('beacon-view').hidden = true
    $('list-view').hidden = false
  },
})
$('become-beacon').onclick = () => {
  $('list-view').hidden = true
  $('beacon-view').hidden = false
  beacon.start()
}

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
        <button class="ping"></button>
        <button class="find primary">Find</button>`
      li.querySelector('.title').textContent = label(d) + (d.self ? ' (this computer)' : '')
      if (d.beacon) li.querySelector('.title').insertAdjacentHTML('beforeend', '<span class="badge">📡 findable</span>')
      li.querySelector('.sub').textContent = [
        label(d) !== d.ip ? d.ip : null,
        d.mac,
        d.offline ? 'not seen in last scan' : null,
        d.quiet ? 'ignores ping' : null,
      ]
        .filter(Boolean)
        .join(' · ')
      li.onclick = () => openLocate(d.ip)
      li.querySelector('.find').onclick = (e) => {
        e.stopPropagation()
        openLocate(d.ip)
      }
      const btn = li.querySelector('.ping')
      btn.textContent = d.pinging ? 'Stop' : 'Ping'
      btn.className = d.pinging ? 'ping stop' : 'ping'
      btn.onclick = (e) => {
        e.stopPropagation()
        togglePing(d)
      }
      return li
    }),
  )
  $('empty').hidden = state.devices.length > 0
  $('list-help').hidden = state.devices.length === 0
  state.devices.forEach((d) => updateRow(d.ip))
}

function updateRow(ip) {
  const li = document.querySelector(`#devices li[data-ip="${ip}"]`)
  if (!li) return
  const d = state.devices.find((x) => x.ip === ip)
  const p = state.last.get(ip)
  const ms = p ? p.ms : d?.ms
  const ok = p ? p.ok : d && !d.offline
  li.querySelector('.dot').className = 'dot ' + (p ? (ok ? 'ok' : 'bad') : ok ? 'ok' : '')
  li.querySelector('.lat').textContent = ok ? fmtMs(ms) : p ? 'no reply' : ''
}

const fmtMs = (ms) => (ms == null ? 'online' : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`)

const togglePing = (d) => {
  unlockSound()
  if (d.pinging) myPings.delete(d.ip)
  else myPings.add(d.ip)
  return api(`/api/devices/${d.ip}/ping`, d.pinging ? 'DELETE' : 'POST')
}

// ---- Locate view ----
function openLocate(ip) {
  state.selected = ip
  $('list-view').hidden = true
  $('locate-view').hidden = false
  if (!arrow) {
    try {
      arrow = createArrow($('arrow'))
    } catch {
      $('arrow-wrap').innerHTML = '<p id="arrow-error" class="muted">This browser can\'t show 3D graphics (WebGL is off). Ping and directions still work.</p>'
      arrow = { setAngle() {}, pulse() {} }
    }
  }
  $('name').value = device()?.name || ''
  $('app-url').textContent = location.origin
  renderLocate()
  renderPingStat()
  window.scrollTo(0, 0)
}

$('back').onclick = () => {
  state.selected = null
  stopMyPosition()
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

  const findable = Boolean(d.beacon)
  const hasLocation = d.beacon?.lat != null
  $('ring').hidden = !findable
  $('ring').textContent = d.ringing ? '🔕 Stop ringing' : '🔔 Ring it'
  $('ring').classList.toggle('on', Boolean(d.ringing))
  $('auto-panel').hidden = !findable
  $('manual-panel').hidden = hasLocation
  if (hasLocation) startMyPosition()
  else stopMyPosition()
  updateArrow()
}

$('ring').onclick = () => {
  const d = device()
  if (d) api(`/api/devices/${d.ip}/ring`, 'POST', { on: !d.ringing })
}

// This phone's own location, needed to point at a 📡 device's location.
function startMyPosition() {
  if (geoWatch !== null || !navigator.geolocation || !window.isSecureContext) return
  geoWatch = navigator.geolocation.watchPosition(
    (p) => {
      state.myPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }
      updateArrow()
    },
    () => {
      state.myPos = null
      updateArrow()
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  )
}

function stopMyPosition() {
  if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch)
  geoWatch = null
  state.myPos = null
  $('distance').textContent = ''
}

// Where the 📡 device is relative to us, from both devices' locations. Null if not available.
function autoTarget() {
  const b = device()?.beacon
  if (b?.lat == null || !state.myPos) return null
  return {
    bearing: bearingDeg(state.myPos, b),
    distance: distanceM(state.myPos, b),
    uncertainty: (b.acc || 0) + (state.myPos.acc || 0),
  }
}

function autoStatus(d, target) {
  if (!d.beacon) return ''
  if (d.beacon.lat == null) return 'This device is findable but isn\'t sharing a location (it may have said no to location access). Use Ring it and follow the sound.'
  if (!window.isSecureContext) return 'Your phone needs the https:// address to use its location. Restart the app with npm run start:https.'
  if (!state.myPos) return 'Getting your location… Allow location access if your phone asks.'
  return `Both devices share their location over Wi-Fi. Phone locations are only accurate to about ${Math.round(target.uncertainty)} m, so the arrow gets you close, then Ring it gets you the rest of the way.`
}

function bearing() {
  return state.draftBearing ?? device()?.bearing ?? null
}

function updateArrow() {
  if (!arrow || !state.selected) return
  const hint = $('arrow-hint')
  const d = device()
  const target = autoTarget()
  $('auto-status').textContent = d ? autoStatus(d, target) : ''
  $('distance').textContent = target ? `≈ ${fmtDistance(target.distance)}` : ''
  if (target && target.distance <= target.uncertainty / 2) {
    arrow.setAngle(null)
    hint.textContent = 'You\'re very close. Tap Ring it and follow the sound.'
    return
  }
  const b = target ? target.bearing : bearing()
  $('bearing-val').textContent = b === null ? 'not set' : `${Math.round(b)}°`
  $('clear').disabled = b === null
  $('mark').disabled = state.heading === null
  if (b === null) {
    arrow.setAngle(null)
    hint.textContent = d?.beacon
      ? 'Waiting for locations…'
      : 'Not set up yet. See "Find it automatically" below.'
  } else if (state.heading === null) {
    arrow.setAngle(b)
    hint.textContent = 'Turn on the compass so the arrow turns with you.'
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
  $('ping-stat').textContent = !p ? '–' : p.ok ? fmtMs(p.ms) + (p.via === 'tcp' ? ' (TCP)' : '') : 'no reply'
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
  const max = Math.max(5, ...h.filter((x) => x.ok && x.ms != null).map((x) => x.ms))
  const step = w / 59
  h.forEach((x, i) => {
    const px = w - (h.length - 1 - i) * step
    const barH = x.ok ? Math.max(2, ((x.ms ?? max / 2) / max) * ht) : ht
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
setCompassStatus('')

// ---- Sound: a short sonar "ping" on every reply ----
let audio = null
let soundOn = false
try {
  soundOn = localStorage.getItem('sound') === 'on'
} catch {}

function unlockSound() {
  // Browsers only allow audio after a tap, so create it on the first button press.
  if (soundOn && !audio) audio = new (window.AudioContext || window.webkitAudioContext)()
  audio?.resume()
}

function beep() {
  if (!soundOn || !audio) return
  const t = audio.currentTime
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1400, t)
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.35)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.4, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
  osc.connect(gain).connect(audio.destination)
  osc.start(t)
  osc.stop(t + 0.5)
}

function renderSound() {
  $('sound').textContent = soundOn ? '🔊' : '🔇'
  $('sound').title = soundOn ? 'Sound on: beeps when a device you ping replies' : 'Sound off'
  $('sound').setAttribute('aria-pressed', String(soundOn))
}

$('sound').onclick = () => {
  soundOn = !soundOn
  try {
    localStorage.setItem('sound', soundOn ? 'on' : 'off')
  } catch {}
  unlockSound()
  if (soundOn) beep()
  renderSound()
}
renderSound()
