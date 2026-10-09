// "Make this device findable": this page reports where the device is and rings when asked.

const R = 6371000 // Earth radius in metres
const rad = (d) => (d * Math.PI) / 180

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Compass direction from a to b, in degrees clockwise from north.
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export const fmtDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

function guessName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Mac/.test(ua)) return 'Mac'
  return 'My device'
}

export function createBeacon({ $, api, onExit }) {
  let active = false
  let ip = null
  let pos = null
  let watchId = null
  let timer = null
  let wakeLock = null
  let audio = null
  let siren = null

  const name = () => $('beacon-name').value.trim() || guessName()

  function status() {
    const where = pos
      ? `Location shared (accurate to about ${Math.round(pos.acc)} m).`
      : navigator.geolocation && window.isSecureContext
        ? 'Waiting for location…'
        : 'Location is unavailable (needs HTTPS), but this device can still ring.'
    $('beacon-status').textContent = `Other devices on this Wi-Fi can now find and ring it. ${where} Keep this page open with the screen on.`
  }

  async function send() {
    if (!active) return
    try {
      const r = await api('/api/beacon', 'POST', { name: name(), ...(pos || {}) })
      ip = r.ip
      if (r.ringing && !siren) startAlarm()
      if (!r.ringing && siren) stopAlarm(false)
    } catch {}
  }

  async function start() {
    active = true
    $('beacon-name').value ||= guessName()
    // Create the audio now, while we have a tap, so ringing works later.
    audio ||= new (window.AudioContext || window.webkitAudioContext)()
    audio.resume()
    if (navigator.geolocation && window.isSecureContext) {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }
          status()
          send()
        },
        (err) => {
          $('beacon-status').textContent = `Couldn't get location (${err.message}). This device can still ring.`
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      )
    }
    timer = setInterval(send, 4000)
    try {
      wakeLock = await navigator.wakeLock?.request('screen')
    } catch {}
    status()
    send()
  }

  async function stop() {
    active = false
    if (watchId !== null) navigator.geolocation.clearWatch(watchId)
    clearInterval(timer)
    wakeLock?.release().catch(() => {})
    stopAlarm(false)
    watchId = timer = wakeLock = pos = null
    await api('/api/beacon', 'DELETE').catch(() => {})
    onExit()
  }

  function startAlarm() {
    if (siren) return
    $('alarm').hidden = false
    audio?.resume()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'square'
    gain.gain.value = 0.5
    osc.connect(gain).connect(audio.destination)
    osc.start()
    let high = false
    const tick = () => {
      high = !high
      osc.frequency.setValueAtTime(high ? 1500 : 950, audio.currentTime)
    }
    tick()
    const iv = setInterval(tick, 350)
    navigator.vibrate?.([400, 200, 400, 200, 400, 200, 400, 200, 400])
    const vib = setInterval(() => navigator.vibrate?.([400, 200, 400, 200, 400]), 2000)
    siren = { osc, iv, vib }
  }

  function stopAlarm(tellServer = true) {
    if (!siren) return
    siren.osc.stop()
    clearInterval(siren.iv)
    clearInterval(siren.vib)
    navigator.vibrate?.(0)
    siren = null
    $('alarm').hidden = true
    if (tellServer && ip) api(`/api/devices/${ip}/ring`, 'POST', { on: false })
  }

  // Ring requests arrive over the live event stream (and on the next heartbeat as a backup).
  function onRing({ ip: target, on }) {
    if (!active || target !== ip) return
    on ? startAlarm() : stopAlarm(false)
  }

  document.addEventListener('visibilitychange', async () => {
    if (active && document.visibilityState === 'visible') {
      try {
        wakeLock = await navigator.wakeLock?.request('screen')
      } catch {}
      send()
    }
  })

  $('beacon-name').onchange = () => {
    status()
    send()
  }
  $('beacon-stop').onclick = stop
  $('found').onclick = () => stopAlarm(true)

  return { start, onRing, get active() { return active }, get ip() { return ip } }
}
