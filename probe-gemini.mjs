// Checks the Gemini brain from the terminal, before you go looking for the
// fault in the browser. Three things in order, each one a different failure:
// does the key work, does the model id exist, and does a streaming turn with
// Google Search attached actually come back as text.
//
//   VITE_GEMINI_API_KEY=... node probe-gemini.mjs
//   node probe-gemini.mjs            # reads .env.local for you
import { readFileSync } from 'node:fs'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta'

function fromEnvFile(name) {
  try {
    const line = readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith(`${name}=`))
    return line?.slice(line.indexOf('=') + 1).trim() || undefined
  } catch {
    return undefined
  }
}

const KEY = process.env.VITE_GEMINI_API_KEY ?? fromEnvFile('VITE_GEMINI_API_KEY')
const MODEL =
  process.env.VITE_GEMINI_MODEL ?? fromEnvFile('VITE_GEMINI_MODEL') ?? 'gemini-3.8-flash'

if (!KEY) {
  console.log('No key. Set VITE_GEMINI_API_KEY in .env.local or the environment.')
  process.exit(1)
}

const headers = { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' }

// 1. The key, and what it can reach. A 400 here is a bad key; the list is the
//    authority on model ids, which Google renames faster than anyone's config.
const res = await fetch(`${ENDPOINT}/models`, { headers })
if (!res.ok) {
  console.log(`key rejected — ${res.status} ${res.statusText}`)
  console.log((await res.text()).slice(0, 400))
  process.exit(1)
}
const models = (await res.json()).models ?? []
const ids = models.map((m) => m.name.replace(/^models\//, ''))
console.log(`key ok — ${ids.length} models visible`)

// 2. The model id in config. Worth saying plainly, because a model that isn't
//    there fails at the first spoken word and nowhere earlier.
console.log(
  ids.includes(MODEL)
    ? `model ok — ${MODEL}`
    : `model MISSING — "${MODEL}" is not in the list. Text-capable ids:\n  ${ids
        .filter((id) => id.startsWith('gemini') && !/tts|live|image|embedding/.test(id))
        .join('\n  ')}`,
)

// 3. One real streaming turn, in the same shape src/lib/gemini.ts sends: a
//    user_input step, a system instruction, Google Search attached, stream on.
const turn = await fetch(`${ENDPOINT}/interactions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: MODEL,
    system_instruction: 'You are JARVIS. Reply in under fifteen words.',
    input: [{ type: 'user_input', content: [{ type: 'text', text: 'Say good evening, sir.' }] }],
    stream: true,
    tools: [{ type: 'google_search' }],
    generation_config: { max_output_tokens: 256, thinking_level: 'low', thinking_summaries: 'none' },
  }),
})

if (!turn.ok) {
  console.log(`stream rejected — ${turn.status} ${turn.statusText}`)
  console.log((await turn.text()).slice(0, 600))
  process.exit(1)
}

let spoken = ''
const seen = new Set()
for await (const chunk of turn.body) {
  for (const frame of chunk.toString().split(/\r?\n\r?\n/)) {
    for (const line of frame.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let event
      try {
        event = JSON.parse(data)
      } catch {
        continue
      }
      seen.add(event.event_type)
      if (event.event_type === 'step.delta' && event.delta?.type === 'text') {
        spoken += event.delta.text
      }
      if (event.event_type === 'error') console.log('stream error —', event.error?.message)
    }
  }
}

console.log(`events — ${[...seen].join(', ')}`)
console.log(spoken.trim() ? `spoke — "${spoken.trim()}"` : 'spoke — NOTHING (no text deltas)')
process.exit(spoken.trim() ? 0 : 1)
