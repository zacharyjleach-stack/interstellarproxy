// LAN Pinger helper. Run this on your OWN computer so the pinger can ring it
// without keeping a browser page open. It reports that this computer is online
// and plays a loud sound when you press "Ring it" in the app.
//
//   node agent.js https://192.168.1.20:3000           (address the app prints)
//   node agent.js https://192.168.1.20:3000 "My laptop"
//
// It never shares a location (laptops have no GPS) and only ever talks to the
// one server address you give it. Leave it running; press Ctrl+C to stop.

import dgram from 'node:dgram'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import { spawn } from 'node:child_process'

const DISCOVERY_PORT = 41234
const name = process.argv[3] || os.hostname()

// Find the master on the LAN by broadcasting a question and waiting for its reply.
function discover(timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const timer = setTimeout(() => {
      sock.close()
      reject(new Error('No master found on this Wi-Fi. Is the app running on your main laptop?'))
    }, timeoutMs)
    sock.on('message', (msg) => {
      try {
        const d = JSON.parse(msg)
        if (d.lanpinger && d.url) {
          clearTimeout(timer)
          sock.close()
          resolve(d.url)
        }
      } catch {}
    })
    sock.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    sock.bind(() => {
      sock.setBroadcast(true)
      const ask = () => {
        sock.send('lanpinger?', DISCOVERY_PORT, '255.255.255.255')
        sock.send('lanpinger?', DISCOVERY_PORT, '127.0.0.1')
      }
      ask()
      setInterval(ask, 1500).unref?.()
    })
  })
}

let base = process.argv[2]
if (!base) {
  console.log('Looking for your main laptop on this Wi-Fi...')
  try {
    base = await discover()
    console.log('Found it:', base)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}

const url = new URL(base)
const lib = url.protocol === 'https:' ? https : http
// The app makes its own HTTPS certificate, so allow it for this one address.
const tls = url.protocol === 'https:' ? { rejectUnauthorized: false } : {}

function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = lib.request(
      new URL(path, base),
      { method, ...tls, headers: data ? { 'content-type': 'application/json' } : {} },
      (res) => {
        let out = ''
        res.on('data', (c) => (out += c))
        res.on('end', () => resolve(out))
      },
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// --- Making noise, per operating system ---
let alarm = null
function startAlarm() {
  if (alarm) return
  console.log('🔔 Ringing! (press the "I found it" button in the app, or Ctrl+C here, to stop)')
  if (process.platform === 'win32') {
    const script = 'while($true){[console]::beep(1500,300);[console]::beep(950,300)}'
    alarm = spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
  } else if (process.platform === 'darwin') {
    const loop = () => {
      if (!alarm) return
      alarm.proc = spawn('afplay', ['/System/Library/Sounds/Sosumi.aiff'])
      alarm.proc.on('exit', () => alarm && loop())
    }
    alarm = { proc: null }
    loop()
  } else {
    // Linux: try a sound player, then fall back to the terminal bell.
    const beep = () => {
      if (!alarm) return
      const p = spawn('paplay', ['/usr/share/sounds/freedesktop/stereo/bell.oga'], { stdio: 'ignore' })
      p.on('error', () => process.stdout.write('\x07'))
      alarm.t = setTimeout(beep, 700)
    }
    alarm = {}
    beep()
  }
}
function stopAlarm() {
  if (!alarm) return
  if (process.platform === 'win32') alarm.kill()
  else if (process.platform === 'darwin') alarm.proc?.kill()
  else clearTimeout(alarm.t)
  alarm = null
  console.log('Stopped ringing.')
}

let myIp = null

// --- Stay registered as online ---
async function heartbeat() {
  try {
    const r = JSON.parse(await request('/api/beacon', 'POST', { name }))
    myIp = r.ip
    if (r.ringing) startAlarm()
    else stopAlarm()
  } catch (e) {
    console.error('Cannot reach the app at', base, '-', e.code || e.message)
  }
}

// --- Listen for ring commands as they happen ---
function listen() {
  const req = lib.get(new URL('/api/events', base), tls, (res) => {
    res.setEncoding('utf8')
    let buf = ''
    res.on('data', (chunk) => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const type = block.match(/event: (\w+)/)?.[1]
        const data = block.match(/data: (.*)/s)?.[1]
        if (type === 'ring' && data) {
          const ring = JSON.parse(data)
          if (ring.ip === myIp) (ring.on ? startAlarm : stopAlarm)()
        }
      }
    })
    res.on('end', () => setTimeout(listen, 2000))
  })
  req.on('error', () => setTimeout(listen, 2000))
}

console.log(`Ready. "${name}" is now findable from the app at ${base}.`)
console.log('Leave this window open. Press Ctrl+C to stop.')
await heartbeat()
listen()
setInterval(heartbeat, 4000)

const bye = async () => {
  stopAlarm()
  try {
    await request('/api/beacon', 'DELETE')
  } catch {}
  process.exit(0)
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
