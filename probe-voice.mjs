// Temporary diagnostic, round two: watch window.__voice while a recorded
// "Hey Jarvis, what time is it?" plays as the microphone.
import WebSocket from 'ws'

const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let target
for (let i = 0; i < 40 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    target = list.find((t) => t.type === 'page' && t.url.includes('5173'))
  } catch { /* chrome still starting */ }
  if (!target) await sleep(500)
}
if (!target) { console.log('NO PAGE FOUND'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.once('open', r))
let id = 0
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const my = ++id
    const on = (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.id === my) { ws.off('message', on); resolve(m.result) }
    }
    ws.on('message', on)
    ws.send(JSON.stringify({ id: my, method, params }))
  })
const evaluate = async (expr) =>
  (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value

await sleep(2500)
await evaluate(`[...document.querySelectorAll('button')].find(b => /initiali/i.test(b.textContent))?.click()`)

let last = ''
for (let t = 0; t < 50; t++) {
  await sleep(1000)
  const v = await evaluate(`(() => {
    const d = window.__voice || {};
    return JSON.stringify({
      status: document.querySelector('.status-text')?.textContent,
      engine: d.engine, running: d.running, mode: d.mode, sessions: d.sessions,
      heard: d.heard, dropped: d.dropped, wakes: d.wakes, accepted: d.accepted,
      lastError: d.lastError, restarts: d.restarts,
      turns: [...document.querySelectorAll('.comms-msg')].map(m => m.textContent.slice(0, 70)),
    });
  })()`)
  if (v !== last) { console.log(`t=${t}s ${v}`); last = v }
}
ws.close()
process.exit(0)
