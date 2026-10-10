import { WebSocket } from 'ws'
const ws = new WebSocket('ws://127.0.0.1:8787', { origin: 'http://localhost:5173' })
const t0 = Date.now()
ws.on('open', () => ws.send(JSON.stringify({ type: 'ask', text: process.argv[2] ?? 'Jarvis', id: 'probe-1' })))
ws.on('message', (raw) => {
  const s = raw.toString()
  console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${s.slice(0, 400)}`)
})
ws.on('error', (e) => { console.log('ws error:', e.message); process.exit(1) })
setTimeout(() => process.exit(0), 60000)
