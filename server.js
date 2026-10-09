import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { probe, scan, localNetworks } from './lib/net.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const dataDir = path.join(root, 'data')
const devicesFile = path.join(dataDir, 'devices.json')
const PORT = Number(process.env.PORT) || 3000
const useHttps = process.argv.includes('--https') || process.env.HTTPS === '1'

// Saved per-device info (name, bearing), keyed by IP.
let saved = {}
try {
  saved = JSON.parse(await fs.readFile(devicesFile, 'utf8'))
} catch {}
let devices = []
let scanning = false

async function persist() {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(devicesFile, JSON.stringify(saved, null, 2))
}

const view = () => {
  const known = new Map(devices.map((d) => [d.ip, d]))
  for (const ip of Object.keys(saved)) if (!known.has(ip)) known.set(ip, { ip, offline: true })
  return [...known.values()].map((d) => ({ ...d, ...saved[d.ip], pinging: pingers.has(d.ip) }))
}

// Server-sent events to every open browser tab.
const clients = new Set()
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) res.write(msg)
}

// Continuous pings: one loop per device, once a second.
const pingers = new Map()
function startPing(ip) {
  if (pingers.has(ip)) return
  const state = { stopped: false }
  pingers.set(ip, state)
  ;(async () => {
    let seq = 0
    while (!state.stopped) {
      const t = Date.now()
      const res = await probe(ip, 1000)
      if (state.stopped) break
      broadcast('ping', { ip, seq: seq++, ...res, t })
      await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t))))
    }
  })()
  broadcast('devices', view())
}
function stopPing(ip) {
  const state = pingers.get(ip)
  if (state) state.stopped = true
  pingers.delete(ip)
  broadcast('devices', view())
}

async function runScan() {
  if (scanning) return
  scanning = true
  broadcast('scan', { running: true, done: 0, total: 0 })
  let last = 0
  try {
    devices = await scan((done, total) => {
      if (done === total || Date.now() - last > 200) {
        last = Date.now()
        broadcast('scan', { running: true, done, total })
      }
    })
  } finally {
    scanning = false
    broadcast('scan', { running: false })
    broadcast('devices', view())
  }
}

const readBody = (req) =>
  new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
  })

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const threeBuild = path.join(path.dirname(require.resolve('three')), '..', 'build')
const staticFiles = {
  '/vendor/three.module.js': path.join(threeBuild, 'three.module.js'),
  '/vendor/three.core.js': path.join(threeBuild, 'three.core.js'),
}

async function serveFile(res, file) {
  try {
    const body = await fs.readFile(file)
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}

const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s)

async function handler(req, res) {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  const m = p.match(/^\/api\/devices\/([\d.]+)(\/ping)?$/)

  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(`event: devices\ndata: ${JSON.stringify(view())}\n\n`)
    res.write(`event: scan\ndata: ${JSON.stringify({ running: scanning })}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  if (p === '/api/devices' && req.method === 'GET') return json(res, 200, view())
  if (p === '/api/networks') return json(res, 200, localNetworks())
  if (p === '/api/scan' && req.method === 'POST') {
    runScan()
    return json(res, 202, { started: true })
  }
  if (m && isIp(m[1])) {
    const ip = m[1]
    if (m[2] && req.method === 'POST') {
      startPing(ip)
      return json(res, 200, { pinging: true })
    }
    if (m[2] && req.method === 'DELETE') {
      stopPing(ip)
      return json(res, 200, { pinging: false })
    }
    if (!m[2] && req.method === 'PATCH') {
      const body = await readBody(req)
      const entry = (saved[ip] ||= {})
      if (typeof body.name === 'string') entry.name = body.name.slice(0, 60) || undefined
      if (body.bearing === null) delete entry.bearing
      else if (Number.isFinite(body.bearing)) entry.bearing = ((body.bearing % 360) + 360) % 360
      await persist()
      broadcast('devices', view())
      return json(res, 200, entry)
    }
  }
  if (staticFiles[p]) return serveFile(res, staticFiles[p])
  if (req.method === 'GET') {
    const file = path.join(root, 'public', p === '/' ? 'index.html' : p)
    if (file.startsWith(path.join(root, 'public'))) return serveFile(res, file)
  }
  res.writeHead(404).end('Not found')
}

async function certificate() {
  const certFile = path.join(dataDir, 'cert.json')
  try {
    return JSON.parse(await fs.readFile(certFile, 'utf8'))
  } catch {}
  const selfsigned = require('selfsigned')
  const ips = localNetworks().map((n) => ({ type: 7, ip: n.address }))
  const notAfterDate = new Date()
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 2)
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'lan-pinger' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips] }],
  })
  const cert = { key: pems.private, cert: pems.cert }
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(certFile, JSON.stringify(cert))
  return cert
}

const server = useHttps ? https.createServer(await certificate(), handler) : http.createServer(handler)
server.listen(PORT, () => {
  const scheme = useHttps ? 'https' : 'http'
  console.log(`LAN Pinger running:`)
  console.log(`  ${scheme}://localhost:${PORT}`)
  for (const n of localNetworks()) console.log(`  ${scheme}://${n.address}:${PORT}   (${n.iface})`)
  if (!useHttps) console.log('Phones need HTTPS for the compass: run `npm run start:https` instead.')
})
