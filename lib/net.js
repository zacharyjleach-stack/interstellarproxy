import { execFile } from 'node:child_process'
import os from 'node:os'
import dns from 'node:dns/promises'
import net from 'node:net'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || '') })
    })
  })
}

// Sends one ICMP echo using the system ping command (no root needed).
export async function ping(ip, timeoutMs = 1000) {
  const args = isWin
    ? ['-n', '1', '-w', String(timeoutMs), ip]
    : isMac
      ? ['-c', '1', '-W', String(timeoutMs), ip]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), ip]
  const { ok, out } = await run('ping', args, timeoutMs + 1500)
  // Windows exits 0 on "Destination host unreachable", so also require a TTL= reply line.
  // Matching "TTL=" and "=12ms"/"<1ms" rather than "time=" keeps this working in other languages.
  if (!ok || !/ttl=/i.test(out)) return { ok: false, ms: null }
  const match = out.match(/[=<]\s*([\d.,]+)\s*ms/i)
  return { ok: true, ms: match ? parseFloat(match[1].replace(',', '.')) : null }
}

// Ports that phones and computers commonly have open or actively refuse.
// 62078 is the iPhone/iPad sync service, which answers even when the phone ignores pings.
const PROBE_PORTS = [62078, 80, 443, 445, 139, 22, 8080, 7000, 5000]

// Tries a TCP connection. A device that answers at all (accepts, or refuses with a reset) is online.
function tcpProbe(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const start = performance.now()
    const sock = net.connect({ host: ip, port })
    const done = (ok) => {
      sock.destroy()
      resolve(ok ? performance.now() - start : null)
    }
    sock.setTimeout(timeoutMs, () => done(false))
    sock.once('connect', () => done(true))
    sock.once('error', (err) => done(err.code === 'ECONNREFUSED'))
  })
}

// Is the device online? Tries a normal ping first, then TCP for devices that block pings.
export async function probe(ip, timeoutMs = 1000) {
  const res = await ping(ip, timeoutMs)
  if (res.ok) return { ...res, via: 'ping' }
  const times = await Promise.all(PROBE_PORTS.map((port) => tcpProbe(ip, port, timeoutMs)))
  const best = times.filter((t) => t !== null).sort((a, b) => a - b)[0]
  return best === undefined ? { ok: false, ms: null, via: null } : { ok: true, ms: best, via: 'tcp' }
}

// The IPv4 networks this machine is on (non-internal interfaces only).
export function localNetworks() {
  const nets = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) nets.push({ iface: name, address: a.address, netmask: a.netmask })
    }
  }
  return nets
}

const toInt = (ip) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0
const toIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')

// Host addresses to sweep. Large subnets are capped to the /24 around our own address.
export function hostsFor({ address, netmask }) {
  let mask = toInt(netmask)
  if (mask < toInt('255.255.255.0')) mask = toInt('255.255.255.0')
  const base = toInt(address) & mask
  const size = (~mask >>> 0) + 1
  const hosts = []
  for (let i = 1; i < size - 1; i++) hosts.push(toIp(base + i))
  return hosts
}

// IP -> MAC from the OS neighbour/ARP cache, which the ping sweep has just filled.
export async function arpTable() {
  const table = new Map()
  const ipRe = /(\d{1,3}(?:\.\d{1,3}){3})/
  const macRe = /([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})/i
  for (const [cmd, args] of [['arp', ['-a']], ['ip', ['neigh']]]) {
    const { out } = await run(cmd, args, 5000)
    for (const line of out.split('\n')) {
      const ip = line.match(ipRe)
      const mac = line.match(macRe)
      if (ip && mac) {
        const norm = mac[1].toLowerCase().replace(/-/g, ':').split(':').map((p) => p.padStart(2, '0')).join(':')
        if (norm !== 'ff:ff:ff:ff:ff:ff') table.set(ip[1], norm)
      }
    }
    if (table.size) break
  }
  return table
}

export async function hostname(ip) {
  try {
    const names = await Promise.race([dns.reverse(ip), new Promise((_, rej) => setTimeout(rej, 1500))])
    return names[0] || null
  } catch {
    return null
  }
}

// Pings every host on the local networks and returns the ones that answered.
export async function scan(onProgress = () => {}) {
  const nets = localNetworks()
  const self = new Set(nets.map((n) => n.address))
  const hosts = [...new Set(nets.flatMap(hostsFor))]
  const found = []
  let done = 0
  let next = 0
  async function worker() {
    while (next < hosts.length) {
      const ip = hosts[next++]
      const res = await ping(ip, 800)
      if (res.ok) found.push({ ip, ms: res.ms, self: self.has(ip) })
      onProgress(++done, hosts.length)
    }
  }
  await Promise.all(Array.from({ length: 64 }, worker))
  const arp = await arpTable()
  // Devices that ignored the ping but still answered the network's address lookup (ARP) are online too.
  const inRange = new Set(hosts)
  const seen = new Set(found.map((d) => d.ip))
  for (const ip of arp.keys()) {
    if (inRange.has(ip) && !seen.has(ip)) found.push({ ip, ms: null, self: false, quiet: true })
  }
  await Promise.all(
    found.map(async (d) => {
      d.mac = arp.get(d.ip) || null
      d.hostname = await hostname(d.ip)
    }),
  )
  return found.sort((a, b) => toInt(a.ip) - toInt(b.ip))
}
