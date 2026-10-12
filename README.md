# J.A.R.V.I.S.

A browser voice assistant with an Iron Man holographic interface. Say
**"Hey Jarvis"**, he wakes, listens, and does real things through your tools —
searches the web, generates images, drives your phone, reads your mail. The face
is a web page (React + Vite + Three.js + custom GLSL). The brain is Claude Code,
run headless as a library.

**The only subscription you need is Claude Code.** No API keys, no OpenAI
account, no cloud bill — the brain runs on your existing Claude Code login, and
the heavy work (the model itself) runs on Anthropic's servers, so even a low-end
laptop only has to draw the interface. **ElevenLabs is an optional add-on** that
gives JARVIS a much better voice and sharper hearing; without it he speaks and
listens through the browser's own speech, and everything still works.

---

## Requirements

**In one line:** a Claude Code subscription, plus two free things every computer
can have — Node.js and Chrome. That's the whole list.

- **Claude Code, installed and logged in** — this is the only account you need.
  Install it with the official method — `npm install -g @anthropic-ai/claude-code`,
  or the platform installer at <https://docs.claude.com/en/docs/claude-code> —
  then run `claude` once and complete login. The bridge reuses that login. **No
  API key**, and usage is billed to your existing Claude account.
- **Node.js 20 or newer** — free, one installer from <https://nodejs.org>. This
  is a Node web app, so it is the one unavoidable tool.
- **Google Chrome or Microsoft Edge**, in a **real browser window** — not an
  embedded preview pane. Preview panes (including the one inside editors and
  Claude Code) block microphone access, so the page loads and looks right but
  never hears you. JARVIS also needs WebGL, which these browsers provide.
- **Optional: an ElevenLabs API key** — a good add-on, not a requirement. It
  gives a better voice and sharper transcription; the free tier is plenty for a
  demo. Without it, everything runs on the browser's own speech.

Run `npm run setup` after cloning and it checks all of this for you, in plain
language.

---

## Quick start

First, install, then start it:

```bash
npm install
npm start          # runs the brain and the face together
```

Then open the URL it prints (http://localhost:5173) in **Chrome**, click **INITIALISE**, and say **“Hey Jarvis”**.

Prefer two terminals? Run them separately instead:

```bash
npm install
```

Terminal 1 — the brain:

```bash
npm run bridge
```

Terminal 2 — the face:

```bash
npm run dev
```

Then open the app in a **real Chrome or Edge window**:

```bash
open http://localhost:5173
```

Click **INITIALISE**, allow the microphone when asked, and say **"Hey Jarvis"**.

> It has to be a real browser window. Embedded preview panes block the
> microphone, so JARVIS will look perfectly alive and simply never respond.

---

## How it works

JARVIS is two processes. The browser is the face and the voice; the bridge is
the brain and the hands.

```
  ┌─ browser (the face) ───────────────┐        ┌─ bridge (the brain) ─────────────┐
  │  "Hey Jarvis" wake word            │        │  Node · bridge/server.mjs        │
  │  local VAD  →  speech to text      │   ws   │  Claude Agent SDK                │
  │  reactor UI (Three.js + GLSL)      │◄─────► │   = Claude Code, headless        │
  │  text to speech                    │  8787  │  spawns your MCP servers         │
  │  heads-up display                  │        │  permission gate (decideTool)    │
  └────────────────────────────────────┘        └──────────────────────────────────┘
```

Everything you see and hear happens in the browser. The bridge is a single Node
process (`bridge/server.mjs`) that runs the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`) — this spawns the real `claude` CLI as a child
process, so **the brain literally is Claude Code, headless.** They talk over a
WebSocket (plus a few HTTP endpoints) on `ws://localhost:8787`.

**Why a bridge at all?** A browser tab cannot spawn the local stdio MCP servers —
`higgsfield`, `elevenlabs`, `android`, `playwright`, `exa`, `serper`, and the
rest. The bridge can. And because it is the Agent SDK, it authenticates off your
existing Claude Code login: no API key, billed to that same Claude account.

**The model.** `claude-opus-5` at effort `medium` by default. Override with the
`JARVIS_MODEL` and `JARVIS_EFFORT` environment variables. On startup the bridge
prints its choice, e.g. `[jarvis] model claude-opus-5 · effort medium`.

### The voice pipeline

The loop is designed so that nothing silently dies and barge-in feels natural.

- **Detection is local.** An energy-based voice-activity detector
  (`src/lib/vad.ts`) decides when you are speaking. It is instant, cannot quietly
  fail, and is what makes **barge-in** work — speak while JARVIS is talking and he
  stops.
- **Transcription has two tiers, chosen automatically at boot.** The browser asks
  the bridge `/health` and picks the best available:
  - **ElevenLabs key present** → ElevenLabs Scribe, via the bridge `/stt` endpoint.
  - **Nothing configured** → the browser's own `SpeechRecognition` (Chrome/Edge),
    guarded by a heartbeat so it recovers when Chrome throttles it.
- **Speaking** uses the **ElevenLabs voice when a key is present**, and the
  browser's `speechSynthesis` otherwise. If a cloud call fails it falls back to
  the browser voice, and if the OS voice itself is broken it latches over to the
  cloud voice.

So it works with no keys and auto-upgrades when a key appears — there is no flag
to set. Capability detection lives in `src/lib/capabilities.ts`, which probes the
bridge's `GET /health` (returning `{ ok, tts, stt }`, both tracking the
ElevenLabs key) once at boot and picks the engines.

---

## What JARVIS can do

Beyond answering, JARVIS reaches every MCP server in your Claude Code
configuration, and can drive his own interface.

### Your tools

Every server in your `~/.claude.json` is handed to the SDK explicitly. Depending
on what you have installed, that is roughly:

- **Web & search** — `exa`, `serper`, `serpapi`
- **Images & video** — `higgsfield`, `openrouter-image`, `palmier-pro`
- **Voice** — `elevenlabs`
- **Your phone** — `android`
- **The browser** — `playwright`

A few things you can say:

- *"What's happening in AI this week?"*
- *"Generate an image of the Mark VII suit."*
- *"Take a screenshot of my phone."*
- *"Open my GitHub notifications."*

> **Note on account connectors.** Servers you added through your **claude.ai
> account** are not stored on disk, so the bridge cannot see them — it works from
> the servers in `~/.claude.json` (about 14), not the claude.ai ones.

### JARVIS controls the interface

He drives the UI through MCP tools the bridge exposes:

- `ui_theme` — accent, background, per-phase colours
- `ui_reactor` — colour, scale, intensity, spin, and style (`ring` | `sphere` | `wire`), visibility
- `ui_orbit` — put images in orbit around the reactor
- `ui_chrome` — show or hide rails, transcript, badges
- `ui_effect` — `glitch` | `pulse` | `scan` | `shake` | `flash`
- `ui_screen` — clear
- `ui_reset` — back to defaults

So *"make it red, hide the systems list, put that render in orbit"* is a spoken
command.

### The heads-up display

JARVIS authors panels with a `display` tool against a fixed `.hud-*` design
system. The browser sanitises the markup (DOMPurify, a class allowlist and a
strict CSP) before rendering. Rich media works — images, `<video>`, and
YouTube/Vimeo embeds. Remote images and video are fetched **server-side** through
the bridge (`/img` and `/media`, both SSRF-guarded), so hotlink-blocked news
thumbnails still appear and the page never beacons your IP to a host the model
chose.

---

## Controls

| Key / phrase | Does |
|---|---|
| **"Hey Jarvis"** | Wake him |
| **Space** | Talk without the wake word |
| Just speak | Interrupt him mid-sentence (barge-in) |
| **V** | Cycle the browser voice |
| **Escape** | Stand down |
| **D** | Live diagnostics panel |
| **T** | One-line audio self-test |

---

## The boot sequence

Power-up plays a four-beat Iron Man start-up (`src/ui/Boot.tsx`): an
"INITIATING SYSTEM" status bar with a segmented progress bar and boot log; then
concentric reticle rings resolving into "J.A.R.V.I.S"; then a suit schematic;
then the triangular arc reactor lighting up — with a start-up sound under it
(`public/audio/boot-music.mp3`).

---

## The desktop app

JARVIS also builds as an installed Windows application — own window, own icon,
Start menu entry, no terminal.

```bash
npm run app        # build the UI and run the app from source
npm run app:dist   # build an installer into release/
```

The installer is `release/JARVIS Setup <version>.exe`. It is unsigned, so
SmartScreen warns, and a machine with **Smart App Control** on refuses it
outright with no override — and turning that off is permanent until Windows is
reinstalled. Worth knowing before handing the installer to anyone else.

[`electron/main.cjs`](electron/main.cjs) is the whole shell. It:

- serves `dist/` over a loopback HTTP server rather than `file://`, because on
  `file://` the page's origin is `null` and the bridge rejects the socket;
- passes that server's port to the bridge as `JARVIS_ALLOWED_ORIGINS`, which is
  why the server binds *before* the bridge is spawned;
- spawns the bridge itself with `ELECTRON_RUN_AS_NODE=1`, so the packaged app
  needs no separate Node install, and kills the process tree on quit;
- starts VoiceStudio and the LiteLLM proxy if they are not already running, and
  waits for them;
- grants microphone and camera access, which Electron otherwise denies with no
  way for the page to ask;
- logs to `%APPDATA%\JARVIS\jarvis.log`. **Read that first when something is
  wrong** — it records what started, what did not, and why.

Three things that are easy to get wrong here, all of them learned the hard way:

- **`asar: false` is deliberate.** Packed into an archive, the bridge cannot be
  spawned: an asar is not a directory, so it cannot be a working directory and
  real `node_modules` cannot be resolved from it. The failure surfaces as
  `spawn …\JARVIS.exe ENOENT`, which names the executable and means the cwd.
- **Never write to `process.stdout` from the main process.** Launched from a
  shortcut there is no console, so every write throws `EPIPE`, and an uncaught
  `EPIPE` is shown to the user as a crash dialog — one per log line.
- **The app does not contain VoiceStudio or the proxy.** It starts them; it
  cannot ship them. Without the proxy there is no brain and nothing works;
  without VoiceStudio the voice falls back to the system one and everything
  else is fine. The launch dialog distinguishes the two.

### Setting it up on another machine

The installer carries the UI and the bridge. Everything else is per-machine:

| Needed | Why |
|---|---|
| A billing-enabled Google Cloud project, and `gcloud auth application-default login` | The brain. Nothing works without it. |
| `litellm` in a venv, plus `google-auth` | The translation proxy |
| VoiceStudio + the Balanced model pack | Voice and transcription; optional but it is the difference between JARVIS and a satnav |
| A **cloned voice profile**, made on that machine | Profile ids are local rows; they do not copy across |
| `~/.claude.json` | Where the bridge reads MCP servers from |

To share a Google Cloud project rather than an account, add the person at
**IAM & Admin → Grant access** with `roles/aiplatform.user` *and*
`roles/serviceusage.serviceUsageConsumer` — the second is easy to miss and
nothing works without it. Never share account credentials; set a budget alert
first, because access is project-wide with no per-person cap.

---

## Configuration

Everything is optional in bridge mode. Frontend settings live in `.env.local`
(copy `.env.example`); bridge settings are environment variables.

### Bridge

| Variable | Default | Effect |
|---|---|---|
| `JARVIS_BRIDGE_PORT` | `8787` | Port for the WebSocket + HTTP endpoints |
| `JARVIS_MODEL` | `claude-opus-5` | Model to run |
| `JARVIS_EFFORT` | `medium` | Reasoning effort |
| `JARVIS_ALLOW_WRITES` | off | `1` allows effectful tools (see below) |
| `JARVIS_ALLOWED_ORIGINS` | local dev | Extra WebSocket origins to accept |
| `JARVIS_ALLOW_NO_ORIGIN` | off | Accept connections with no `Origin` header |
| `JARVIS_FILE_ROOTS` | — | Roots the `/file` endpoint may serve from |
| `JARVIS_VOICE_ID` | — | ElevenLabs voice id |
| `ELEVENLABS_API_KEY` | — | Optional; enables the ElevenLabs voice + Scribe |
| `JARVIS_VS_URL` | `http://127.0.0.1:3900` | Where VoiceStudio is listening |
| `JARVIS_VS_VOICE` | — | VoiceStudio profile id; set it and the voice goes local |
| `JARVIS_VS_STT` | on | `0` forces transcription back off VoiceStudio |
| `ANTHROPIC_BASE_URL` | — | Point the agent SDK at a proxy instead of Anthropic |
| `ANTHROPIC_AUTH_TOKEN` | — | Token that proxy expects |

### Frontend (`.env.local`)

| Variable | Effect |
|---|---|
| `VITE_BACKEND` | `bridge` (default), `direct`, or `gemini` |
| `VITE_BRIDGE_URL` | Where to reach the bridge |
| `VITE_TTS_ENGINE` | `system` or `kokoro` |
| `VITE_KOKORO_VOICE` | Voice for the Kokoro engine |
| `VITE_USE_ELEVENLABS` | Force the ElevenLabs voice on |
| `VITE_ANTHROPIC_API_KEY` | Direct mode only |
| `VITE_GEMINI_API_KEY` | Gemini mode only |
| `VITE_GEMINI_MODEL` | Gemini model id (default `gemini-3.8-flash`) |
| `VITE_GEMINI_THINKING` | `minimal`, `low` (default), `medium`, `high` |

### Running JARVIS on Gemini

```bash
echo "VITE_BACKEND=gemini"                   >> .env.local
echo "VITE_GEMINI_API_KEY=your-key-here"     >> .env.local
npm run dev
```

No bridge process. The browser talks to Google's Interactions API directly:
Google Search handles grounding, and the `MCP_SERVERS` block in
[`src/config.ts`](src/config.ts) works unchanged — Google dials those endpoints
from its own infrastructure, same as Anthropic does on the direct path. Get a
free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

The usual direct-mode caveat applies: the key is inlined into the bundle, so
this is for a local demo, not a public deploy. Panels, blades and the `ui_*`
theme tools stay bridge-only — they need a socket a server can push down
mid-turn, which no browser-side backend has.

### Adding an ElevenLabs key

You do not have to touch a flag. Either:

- Set `ELEVENLABS_API_KEY` on the bridge before starting it, **or**
- Add the key to your `elevenlabs` MCP server's env in `~/.claude.json` — the
  bridge reads it from there too.

Either way, `/health` starts reporting the capability, the browser picks it up on
the next boot, and both the voice and transcription upgrade automatically.

### VoiceStudio: the voice and the ears, locally

[VoiceStudio](https://github.com/debpalash/VoiceStudio) runs speech synthesis and
transcription on your own GPU. It costs nothing per word, needs no key, and
nothing you say leaves the machine. Install it, let it fetch the **Balanced**
model pack, then clone a voice from a reference recording and give the bridge
its profile id:

```bash
curl http://127.0.0.1:3900/profiles          # find your profile's id
JARVIS_VS_VOICE=<profile-id> npm start
```

The bridge then serves `/tts` from VoiceStudio instead of ElevenLabs, and
`/stt` too. Both fall back to ElevenLabs if a key is present and VoiceStudio is
unreachable, so a stopped VoiceStudio costs quality rather than the turn.

**Clone a voice; do not design one.** VoiceStudio will also build a voice from a
written description, and it is not worth the time: asking for *"British male,
middle-aged, low pitch"* and then *"very low"* returns the same speaker both
times. Measured across seven generated voices the median pitch sat between 85
and 103 Hz — one man. Three clones of real recordings came out at 121, 129 and
141 Hz. Only a reference recording changes who is speaking.

**Transcription is the part that matters most in the desktop app.** The browser's
own `SpeechRecognition` depends on a speech service that official Chrome builds
carry keys for and Electron's do not, so inside the packaged app it fails
silently — the microphone opens, the indicator lights, and nothing is ever
transcribed. Routing `/stt` through VoiceStudio is what lets the app hear at
all. It also fixes JARVIS interrupting himself: the browser gives
`SpeechRecognition` its own capture that no echo cancellation can be applied
to, whereas this path uses the app's own stream, where it is on.

### Running the bridge on Gemini

This is distinct from `VITE_BACKEND=gemini` above. That path drops the bridge
and with it every local tool; this one keeps all of them and swaps only the
model, by putting a translation proxy in front of the Agent SDK — which speaks
the Anthropic wire format and nothing else.

```bash
pip install "litellm[proxy]" google-auth google-cloud-aiplatform
litellm --config ~/.jarvis/litellm.yaml --port 4000 --host 127.0.0.1
```

```yaml
# ~/.jarvis/litellm.yaml
model_list:
  - model_name: jarvis-brain
    litellm_params:
      model: vertex_ai/gemini-2.5-flash
      vertex_project: your-project-id
      vertex_location: us-central1
      reasoning_effort: disable   # Pro-style thinking is too slow to talk to
litellm_settings:
  drop_params: true               # discard `effort` and other Anthropic-only params
general_settings:
  master_key: sk-jarvis-local
```

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:4000 \
ANTHROPIC_AUTH_TOKEN=sk-jarvis-local \
JARVIS_MODEL=jarvis-brain \
npm start
```

Authentication is Application Default Credentials (`gcloud auth
application-default login`), not an API key — tick every box on the consent
screen or it fails with `cloud-platform scope is required but not consented`.
Install `google-auth` explicitly: `litellm[proxy]` omits it, and without it the
proxy starts and then fails every request with `No module named 'google'`,
which reads like a credentials fault and is not.

Expect roughly 3.5s to the first spoken sentence, against about 1.2s for the
local voice to render it — the model is the slow part, not the speech. A
non-Anthropic model also picks up `CROSS_MODEL_GUARD` in
`bridge/server.mjs`: the persona is written as prose, which Claude infers from
and Gemini does not, so the hardest constraints are restated as flat
imperatives. Without it Gemini introduces itself, prints `**headings**` into
speech, and reports the same tool failure three times in one answer.

---

## Enabling actions

The tool gate starts **read-only**. Search, generation and lookups run freely;
anything effectful — send, tap, delete, install, pay — is denied. Voice is a poor
interface for a confirmation dialog, so the decision is made ahead of time in
`decideTool()` in `bridge/server.mjs`, not at the moment of use. The bridge sets
`settingSources: []`, which makes its own gate the only authority — filesystem
settings and any global `bypassPermissions` cannot override it.

To allow effectful tools (phone, browser driving, sending), run the bridge this
way instead:

```bash
npm run bridge:writes
```

> Read `decideTool()` before you do. *"Hey Jarvis, clean up my downloads folder"*
> means something rather different with writes enabled.

---

## Troubleshooting

**I can't hear him, or he can't hear me.** Press **D** for the diagnostics panel
— it states plainly whether he is hearing you and whether he is producing sound.
Press **T** for a one-line audio self-test.

**No voice at all.** You must be in **Chrome or Edge**, in a **real browser
window** (not an embedded preview), and you must have **allowed the microphone**.

**Bridge not reachable.** Check that `npm run bridge` is still running in its
terminal, and that nothing else is holding port `8787`. In the desktop app, this
usually means the page is on an origin the bridge refuses — it accepts
`localhost:5173-5199` and `4173-4199`, and anything else must be named in
`JARVIS_ALLOWED_ORIGINS`. The error message on screen tells you which port it is.

**He hears nothing in the desktop app, but worked in the browser.** Expected
without a configured transcriber: Electron cannot use the browser's
`SpeechRecognition`. Set up VoiceStudio or an ElevenLabs key; see above. No
Windows sound setting will fix it.

**He talks over himself, or answers when you said nothing.** Your microphone is
hearing the speakers, and each phantom turn cancels the answer mid-word.
Headphones remove it entirely. `/stt` through VoiceStudio or Scribe also fixes
it properly, since that path uses an echo-cancelled stream.

**"JARVIS has no brain."** The LiteLLM proxy did not start. Usually `google-auth`
missing from the venv, or no `gcloud` sign-in.

**Replies take about four seconds.** Roughly 3.5s of that is the model and ~1.2s
the voice. On Gemini via the proxy, `jarvis-pro` is slower still — it reasons
before every reply, which is the wrong trade for speech.

---

## Security

All of this lives in `bridge/server.mjs`:

- The WebSocket accepts only local dev origins (add more with
  `JARVIS_ALLOWED_ORIGINS`).
- `/file`, `/img` and `/media` validate the scheme, confine to allowed roots,
  resolve the real path, and refuse private and loopback addresses (SSRF guard).
- The tool gate (`decideTool`) is default-deny for effectful MCP tools.
- A strict CSP in `index.html`; model-authored panel HTML is sanitised.

---

## Credits & licence

MIT.

The boot sound and any tracks in `public/audio/` ship with the project for the
demo. If you go on to monetise something built on this, clearing the rights to
that audio is your responsibility.

