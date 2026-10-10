import {
  env,
  GEMINI_MODEL,
  GEMINI_THINKING,
  SYSTEM_PROMPT,
  activeServers,
} from '../config'
import type { AskHandlers, Msg } from './anthropic'

export type { AskHandlers, Msg }

/**
 * JARVIS on Gemini.
 *
 * Same contract as the direct Anthropic path — stream text, announce tools,
 * abort on barge-in — against Google's Interactions API. Written as plain
 * `fetch` plus an SSE reader rather than through @google/genai: the whole
 * surface we need is three event types, and doing it by hand keeps the
 * dependency list and the bundle where they are.
 *
 * The API key ships to the browser exactly as the Anthropic one does in direct
 * mode. Fine for a local demo, not for anything public.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'

/** Conversation turns, in the shape `input` wants them. Gemini has no `role`
 *  field here — a turn is a step, and the step's type says who spoke. */
type Step = {
  type: 'user_input' | 'model_output'
  content: { type: 'text'; text: string }[]
}

/** The turn in flight, so a barge-in can abort it. Cutting JARVIS off has to
 *  stop the generation, not just the speaker. */
let active: AbortController | null = null
let cancelled = false

/**
 * A long tool loop comes back incomplete with a `continuation_token` rather
 * than finished. Left unhandled it reads as JARVIS trailing off mid-sentence.
 * Bounded, because this is a voice assistant: after a few rounds the honest
 * thing is to say so rather than leave the user in silence.
 */
const MAX_CONTINUATIONS = 3

/** History arrives in the Anthropic message shape, which is what the rest of
 *  the app speaks. Content is a plain string on our own turns and can be a
 *  block array on anything a model produced, so flatten both. */
function textOf(content: Msg['content']): string {
  if (typeof content === 'string') return content
  return content
    .map((block) =>
      'text' in block && typeof block.text === 'string' ? block.text : '',
    )
    .join('')
    .trim()
}

function toSteps(history: Msg[]): Step[] {
  return history
    .map((msg) => ({
      type: (msg.role === 'assistant'
        ? 'model_output'
        : 'user_input') as Step['type'],
      content: [{ type: 'text' as const, text: textOf(msg.content) }],
    }))
    .filter((step) => step.content[0].text !== '')
}

/**
 * Tools.
 *
 * `google_search` is Google's own grounding, the counterpart of the hosted web
 * search on the Anthropic path: no provider to wire up, and it is what makes
 * "what happened today" answerable at all. The MCP servers are the same remote
 * endpoints config.ts already defines — Google dials them from its own
 * infrastructure, so there is no CORS to fight and no bridge to keep alive.
 */
function tools() {
  return [
    { type: 'google_search' as const },
    ...activeServers().map((s) => ({
      type: 'mcp_server' as const,
      name: s.name,
      url: s.url,
      ...(s.token ? { headers: { Authorization: `Bearer ${s.token}` } } : {}),
    })),
  ]
}

/** The `data:` payloads of each SSE frame, parsed. Keep-alives and comment
 *  lines yield nothing, which is what the skips are for. */
async function* sseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<any> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Frames are separated by a blank line. Whatever follows the last one is a
    // partial frame and has to stay in the buffer for the next read.
    const frames = buffer.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (!data || data === '[DONE]') continue
      try {
        yield JSON.parse(data)
      } catch {
        // A frame we cannot parse is not worth killing the answer over.
      }
    }
  }
}

/** What the HUD should call a tool. The MCP steps carry a real name; search
 *  does not, and "google search" reads better than the step type. */
function toolLabel(step: any): string | null {
  if (!step || typeof step !== 'object') return null
  if (step.type === 'google_search_call') return 'google search'
  if (step.type === 'mcp_server_tool_call') {
    return typeof step.name === 'string' ? step.name : 'tool'
  }
  return null
}

/** Google puts the useful half of a failure in the body, not the status line. */
async function failure(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  try {
    const detail = JSON.parse(body)?.error?.message
    if (typeof detail === 'string' && detail) return detail
  } catch {
    // Not JSON — fall through to the status line.
  }
  return `Gemini returned ${res.status} ${res.statusText}.`
}

/**
 * One turn of conversation.
 *
 * REST is stateless here, so the whole history goes up every turn — the same
 * arrangement as the Anthropic direct path, and the reason App.tsx keeps a
 * transcript of its own when it is not on the bridge.
 */
export async function ask(
  history: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  if (!env.geminiKey) {
    const line = 'My Gemini key is missing, sir. Set VITE_GEMINI_API_KEY.'
    handlers.onText(line)
    return { text: line, tools: [] }
  }

  const usedTools: string[] = []
  let text = ''
  let continuation: string | undefined
  cancelled = false

  try {
    for (let turn = 0; ; turn++) {
      // A barge-in between continuations has no stream to abort, so the loop
      // checks for itself rather than opening another one.
      if (cancelled) return { text: text.trim(), tools: usedTools }

      const controller = new AbortController()
      active = controller

      let res: Response
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.geminiKey,
          },
          body: JSON.stringify({
            model: GEMINI_MODEL,
            system_instruction: SYSTEM_PROMPT,
            input: toSteps(history),
            stream: true,
            tools: tools(),
            generation_config: {
              max_output_tokens: 4096,
              // Thinking stays on, low. It is what keeps tool calls in real
              // tool steps instead of narrated into the spoken text.
              thinking_level: GEMINI_THINKING,
              thinking_summaries: 'none',
            },
            ...(continuation ? { continuation_token: continuation } : {}),
          }),
        })
      } catch (err) {
        // The abort on a barge-in surfaces here as a rejection. That is not an
        // error the user should get a toast for — hand back what he had said.
        if (cancelled) return { text: text.trim(), tools: usedTools }
        throw err
      }

      if (!res.ok) throw new Error(await failure(res))
      if (!res.body) throw new Error('Gemini returned no stream.')

      let status = ''
      let nextContinuation: string | undefined

      try {
        for await (const event of sseFrames(res.body)) {
          switch (event.event_type) {
            case 'step.start': {
              const label = toolLabel(event.step)
              if (label) {
                usedTools.push(label)
                handlers.onTool(label)
              }
              break
            }
            case 'step.delta': {
              // Text is the only delta we speak. Thought signatures and tool
              // argument fragments arrive on this same event and are not for
              // the user's ears.
              if (
                event.delta?.type === 'text' &&
                typeof event.delta.text === 'string'
              ) {
                text += event.delta.text
                handlers.onText(event.delta.text)
              }
              break
            }
            case 'interaction.status_update':
            case 'interaction.completed': {
              status = event.status ?? event.interaction?.status ?? status
              nextContinuation =
                event.continuation_token ??
                event.interaction?.continuation_token
              break
            }
            case 'error': {
              throw new Error(event.error?.message ?? 'Gemini stream failed.')
            }
          }
        }
      } catch (err) {
        if (cancelled) return { text: text.trim(), tools: usedTools }
        throw err
      } finally {
        active = null
      }

      if (nextContinuation && turn < MAX_CONTINUATIONS) {
        continuation = nextContinuation
        continue
      }

      // Everything below has to go through onText as well as the return value.
      // App speaks the deltas; the returned text only feeds history, so a line
      // that is merely returned is a line nobody ever hears.
      if (nextContinuation) {
        const line = ' That is taking longer than it should, sir. Ask me again.'
        handlers.onText(line)
        text += line
      } else if (status === 'failed') {
        const line = "I couldn't finish that one, sir."
        handlers.onText(line)
        text += line
      } else if (!text.trim()) {
        // A turn stopped by a safety filter completes with no text at all,
        // which otherwise plays as JARVIS simply ignoring the question.
        const line = "I can't help with that one, sir."
        handlers.onText(line)
        text += line
      }

      return { text: text.trim(), tools: usedTools }
    }
  } finally {
    active = null
  }
}

/**
 * Barge-in. Aborts the request so the generation stops along with the voice,
 * rather than muting a model that keeps writing and keeps billing.
 */
export function cancel(): void {
  cancelled = true
  active?.abort()
}

/**
 * Labels for the HUD's SYSTEMS rail.
 *
 * What is *configured*, not what is reachable: Google dials these servers from
 * its own infrastructure when a tool runs, so the browser cannot check one
 * without spending a turn. A revoked token shows green here and fails only at
 * the moment JARVIS tries to use it.
 */
export function connectedLabels(): string[] {
  return ['Gemini', ...activeServers().map((s) => s.label)]
}
