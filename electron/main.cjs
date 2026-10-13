/**
 * The desktop app.
 *
 * JARVIS is four processes, not one: this window, the bridge that holds the
 * tools, a translation proxy when a non-Anthropic model is driving, and
 * VoiceStudio for the voice. Only the first two are ours to start, so this
 * file starts those and reports on the other two rather than pretending they
 * are optional — a window that comes up mute with no explanation is the
 * failure worth designing against.
 *
 * CommonJS, not ESM, despite "type": "module" in package.json. Electron's own
 * module is CommonJS and its named exports are not statically analysable, so
 * `import { app } from 'electron'` fails at link time; importing the default
 * instead resolves to the npm shim, whose export is the path to the binary
 * rather than the runtime, and `app` comes back undefined. A .cjs entry
 * sidesteps both, and is what Electron's own tooling expects.
 */
const { app, BrowserWindow, shell, session, dialog } = require('electron')
const { spawn } = require('node:child_process')
const { createServer } = require('node:http')
const { readFile } = require('node:fs/promises')
const { existsSync, createWriteStream, openSync } = require('node:fs')
const { join, extname, normalize } = require('node:path')

/**
 * Logging that cannot take the app down.
 *
 * Launched from a shortcut there is no console attached, so process.stdout is
 * a closed pipe: every write throws EPIPE, and an uncaught EPIPE in the main
 * process is shown to the user as a crash dialog. Forwarding the bridge's
 * output — which is chatty — therefore produced a dialog per line, stacked
 * over the interface.
 *
 * So: writes are guarded, the streams have their own error handlers (an async
 * EPIPE arrives as a stream 'error' event, not as a throw at the call site),
 * and the real destination is a file that survives the window closing.
 */
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

let logFile = null
function log(line) {
  const stamped = new Date().toISOString().slice(11, 19) + ' ' + line
  try {
    if (!logFile) {
      logFile = createWriteStream(join(app.getPath('userData'), 'jarvis.log'), { flags: 'a' })
      logFile.on('error', () => { logFile = null })
    }
    logFile.write(stamped + '\n')
  } catch { /* a log that cannot be written is not worth a crash */ }
  try {
    process.stdout.write(stamped + '\n')
  } catch { /* no console attached */ }
}

/**
 * Last line of defence.
 *
 * Electron's default for an uncaught exception in the main process is the
 * dialog the user just saw. Anything that gets this far is worth recording,
 * but almost nothing is worth interrupting them for — and a broken pipe
 * certainly is not.
 */
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) return
  log('uncaught: ' + (err && err.stack ? err.stack : String(err)))
})

/**
 * The app's own directory, and it has to be a real one.
 *
 * `"asar": false` in package.json's build block is load-bearing, not an
 * oversight. The bridge is a separate Node process we spawn from here, and an
 * archive is the wrong home for it twice over: a `cwd` inside app.asar is a
 * file rather than a directory, which spawn reports as ENOENT *against the
 * executable* — so the log blames a missing JARVIS.exe that is sitting right
 * there — and server.mjs is an ES module, which Node's ESM loader cannot read
 * from inside an archive even where require() manages it. Unpacked costs some
 * install size and nothing else. Turn asar back on and the installed app comes
 * up with no brain while the dev one keeps working perfectly.
 */
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')


/** Settings the launcher script used to pass as environment variables. */
const CONFIG = {
  model: process.env.JARVIS_MODEL || 'jarvis-brain',
  effort: process.env.JARVIS_EFFORT || 'medium',
  vsVoice: process.env.JARVIS_VS_VOICE || '1a88c1f5',
  baseUrl: process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:4000',
  authToken: process.env.ANTHROPIC_AUTH_TOKEN || 'sk-jarvis-local',
  writes: process.env.JARVIS_ALLOW_WRITES || '1',
}

/** Where the translation proxy lives. Named once because two things need it:
 *  the service list that starts it, and the decision about whether to route
 *  the brain through it at all. */
const LITELLM_EXE =
  process.env.JARVIS_LITELLM_EXE ||
  join(process.env.USERPROFILE || '', '.jarvis', 'litellm-venv', 'Scripts', 'litellm.exe')

/** Named once: the service list waits on it, and startup re-checks it to
 *  decide whether the brain goes through the proxy at all. */
const PROXY_HEALTH_URL = 'http://127.0.0.1:4000/health/liveliness'

let bridge = null

/**
 * Serve dist over http rather than loading it from file://.
 *
 * On file:// the origin is "null", which fails the bridge's origin check
 * outright, and module loading carries its own restrictions. A loopback
 * server costs one function and makes the packaged app behave exactly like
 * the dev one.
 */
function serveDist() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  }
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost')
        // normalize() then a prefix check: without it a "../" in the request
        // path would read files from anywhere on the disk.
        let file = normalize(join(DIST, decodeURIComponent(url.pathname)))
        if (!file.startsWith(DIST)) return res.writeHead(403).end()
        if (url.pathname === '/' || !existsSync(file)) file = join(DIST, 'index.html')
        const body = await readFile(file)
        res.writeHead(200, {
          'content-type': types[extname(file)] || 'application/octet-stream',
          // onnxruntime's threaded WASM needs SharedArrayBuffer, which needs
          // cross-origin isolation. Without these Kokoro will not load.
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
        })
        res.end(body)
      } catch {
        res.writeHead(404).end()
      }
    })
    server.listen(0, '127.0.0.1', () =>
      resolve('http://127.0.0.1:' + server.address().port),
    )
  })
}

/**
 * The brain. A child process, so closing the window takes it down too.
 *
 * `origin` has to be passed in, which is why the static server starts first.
 * The bridge refuses any socket whose Origin it does not recognise — a
 * deliberate defence, since any page in any browser could otherwise open a
 * socket to localhost:8787 and drive every tool on this machine. Its built-in
 * allowance covers Vite's port ranges only, and this app serves on an
 * ephemeral port, so without naming it here the window loads and then cannot
 * reach the bridge at all.
 */
function startBridge(origin, proxyAlive) {
  /**
   * Both of these have to be real paths on the real filesystem.
   *
   * This is the bug that made the installed app brainless while the dev one
   * worked. `spawn` reports a bad `cwd` as ENOENT *against the executable*, so
   * the log said it could not find JARVIS.exe — which was sitting right there,
   * 246MB of it. The actual fault was `cwd` pointing inside app.asar, which is
   * a file, not a directory. The archive is off now (see package.json), so
   * these resolve; the check stays because the symptom was so misleading.
   */
  const script = join(ROOT, 'bridge', 'server.mjs')
  if (!existsSync(script)) {
    log('[bridge] NOT FOUND at ' + script + ' — the app was packaged without it.')
    return
  }

  /**
   * Only route through the proxy if the proxy can actually be run.
   *
   * These three settings point the Agent SDK at LiteLLM. Set unconditionally,
   * they are fatal when it is not installed: every request goes to a port
   * nothing is listening on and hangs with no error — measured as a 60 second
   * timeout and an empty answer, which reads as a broken app rather than as a
   * missing dependency.
   *
   * Left unset, the SDK does what it did before the proxy existed: talks to
   * Anthropic on the user's own Claude Code login. That is a working brain
   * with every local tool attached, so it is a far better floor than silence.
   * Install the proxy and this reverts to the intended path on its own.
   */
  // Installed is not the same as usable. A proxy with no credential starts,
  // binds its port, and then fails every request — which looks identical to a
  // broken brain and is harder to diagnose than one that was never there.
  //
  // Either credential satisfies litellm.yaml, and which one is in play depends
  // only on which model block is uncommented there:
  //   Vertex AI   — the gcloud ADC file, written by
  //                 `gcloud auth application-default login`. No key, which is
  //                 why checking GEMINI_API_KEY alone wrongly skipped it.
  //   API key     — GEMINI_API_KEY in the environment.
  const adcFile = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    join(
      process.env.APPDATA || join(process.env.HOME || '', '.config'),
      'gcloud',
      'application_default_credentials.json',
    )
  const haveCredential = Boolean(process.env.GEMINI_API_KEY) || existsSync(adcFile)

  // `proxyAlive` is the caller's answer to "did the proxy reply on its port",
  // and it decides this, because installed-and-credentialled is not the same
  // as running. The proxy was observed starting, printing its banner, and then
  // dying before it bound — stdio is 'ignore', so nothing was logged. Trusting
  // the file checks there left the bridge pointed at a dead port for the rest
  // of the session: every question returned silence with no error anywhere.
  const proxyUsable = Boolean(proxyAlive)
  const brainEnv = proxyUsable
    ? {
        JARVIS_MODEL: CONFIG.model,
        ANTHROPIC_BASE_URL: CONFIG.baseUrl,
        ANTHROPIC_AUTH_TOKEN: CONFIG.authToken,
      }
    : {}
  if (!proxyUsable) {
    log(
      '[jarvis] ' +
        (existsSync(LITELLM_EXE)
          ? 'LiteLLM installed but no Google credential (no gcloud ADC file, no GEMINI_API_KEY)'
          : 'LiteLLM not installed') +
        ' — using the Claude Code login directly',
    )
  }

  bridge = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      JARVIS_ALLOWED_ORIGINS: origin,
      // Makes the Electron binary behave as plain Node, so the packaged app
      // needs no separate Node install on the machine.
      ELECTRON_RUN_AS_NODE: '1',
      JARVIS_EFFORT: CONFIG.effort,
      JARVIS_VS_VOICE: CONFIG.vsVoice,
      JARVIS_ALLOW_WRITES: CONFIG.writes,
    }, brainEnv),
  })
  // Trimmed, because the bridge ends every line itself and a doubled newline
  // in a log file is just noise.
  const relay = (d) => String(d).replace(/\s+$/, '').split('\n').forEach((l) => log('[bridge] ' + l))
  bridge.stdout.on('data', relay)
  bridge.stderr.on('data', relay)
  bridge.on('error', (e) => log('[bridge] failed to start: ' + e.message))
  bridge.on('exit', (code) => log('[bridge] exited ' + code))
}

/** Wait for the bridge to answer, so the page never loads against nothing. */
async function waitForBridge(ms) {
  const until = Date.now() + (ms || 25000)
  while (Date.now() < until) {
    try {
      const r = await fetch('http://127.0.0.1:8787/health')
      if (r.ok) return await r.json()
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

/**
 * The two services this app depends on but does not contain.
 *
 * Order matters, and the proxy must come first. This loop waits for each
 * service in turn, and the bridge is already accepting clients by the time it
 * runs — pointed at the proxy's port, because brainEnv was set above. Starting
 * VoiceStudio first spends its full 90s patience before the proxy is even
 * launched, so for ~105s the bridge sends every request to a port nothing is
 * listening on and answers nothing at all, with no error logged. Measured:
 * a prompt sent in that window returned silence, and the same prompt after it
 * returned in 7s.
 *
 * Degrading the other way round is survivable: with no VoiceStudio the voice
 * falls back to the browser's own speech, which is a working assistant.
 */
const SERVICES = [
  {
    name: 'LiteLLM proxy',
    url: PROXY_HEALTH_URL,
    exe: LITELLM_EXE,
    args: ['--config', join(process.env.USERPROFILE || '', '.jarvis', 'litellm.yaml'),
           '--port', '4000', '--host', '127.0.0.1'],
    // Measured on this machine: 8.3s to bind with the Python import cache warm,
    // but over 91s from cold — a 10x spread, so there is no patience that is
    // both snappy and always sufficient.
    //
    // 90s is deliberately not raised further. The window is not shown until
    // this returns, and three minutes of blank app is worse than the fallback
    // it buys: a cold first launch answers on the Claude Code login instead,
    // which works. The proxy is spawned detached and outlives the app, so it
    // is already up and warm on every later launch, which is the common case.
    patience: 90000,
    // Worth a log of its own. This is the service whose failure means no
    // brain, and under 'ignore' it died mid-startup leaving nothing to read.
    logName: 'litellm.log',
  },
  {
    name: 'VoiceStudio',
    url: 'http://127.0.0.1:3900/.well-known/voicestudio-speech',
    // The GUI app; its backend binds 3900 a while after the window appears.
    exe: process.env.JARVIS_VOICESTUDIO_EXE ||
      join(process.env.LOCALAPPDATA || '', 'Programs', 'VoiceStudio', 'VoiceStudio.exe'),
    args: [],
    // Loading a 2.4 GB model onto the GPU is not quick.
    patience: 90000,
  },
]

const alive = async (url, ms) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms || 2500) })
    return r.ok
  } catch {
    return false
  }
}

/**
 * Start what is missing, rather than only complaining about it.
 *
 * These two were originally left to the user, and the result was an app that
 * worked until something restarted and then came up mute or brainless — the
 * dialog explained why, which is not the same as being usable. Starting them
 * here keeps them tied to the app's lifetime: they run when JARVIS runs, and
 * nothing sits in the background or in the startup folder when it does not.
 *
 * Anything already running is left alone, so launching the app twice does not
 * start a second copy of either.
 */
async function ensureServices() {
  const report = []
  for (const s of SERVICES) {
    if (await alive(s.url)) {
      report.push(s.name + ': up')
      continue
    }
    if (!existsSync(s.exe)) {
      report.push(s.name + ': NOT RUNNING (not installed at ' + s.exe + ')')
      continue
    }
    log('[jarvis] starting ' + s.name)
    try {
      // detached + unref so it is not killed with us mid-sentence, and
      // ignored stdio so it cannot block on a pipe nobody is reading.
      // A service that names a log gets its output kept; the rest keep the
      // pipe-free 'ignore' so they cannot block on one nobody reads. Opening
      // the file must not be fatal in itself, so a failure here degrades to
      // 'ignore' rather than taking the service down with it.
      let stdio = 'ignore'
      if (s.logName) {
        try {
          const fd = openSync(join(app.getPath('userData'), s.logName), 'a')
          stdio = ['ignore', fd, fd]
          log('[jarvis] ' + s.name + ' log: ' + join(app.getPath('userData'), s.logName))
        } catch {
          /* keep 'ignore' */
        }
      }
      const child = spawn(s.exe, s.args, {
        detached: true,
        stdio,
        env: Object.assign({}, process.env, {
          // The project that Vertex is enabled on and that the Cloud credits
          // are linked to. It must match vertex_project in litellm.yaml; a
          // different project here bills and rate-limits against something
          // that has no Vertex API turned on.
          GOOGLE_CLOUD_PROJECT:
            process.env.GOOGLE_CLOUD_PROJECT || 'cohesive-geode-511008-r6',
          // LiteLLM prints a banner containing characters cp1252 cannot
          // encode, and Windows gives a non-console child that codepage. The
          // write raises UnicodeEncodeError inside startup, so the proxy exits
          // 3 before binding its port — indistinguishable from not installed.
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          // Without this the logName file above is useless. Python block
          // buffers when stdout is a file rather than a pipe or a terminal, so
          // a proxy that is booting normally leaves an empty log — which reads
          // exactly like one that died on launch, and cost a wrong diagnosis.
          PYTHONUNBUFFERED: '1',
        }),
      })
      child.unref()
    } catch (e) {
      report.push(s.name + ': failed to launch (' + e.message + ')')
      continue
    }
    const until = Date.now() + s.patience
    let up = false
    while (Date.now() < until && !(up = await alive(s.url))) {
      await new Promise((r) => setTimeout(r, 1000))
    }
    report.push(s.name + (up ? ': started' : ': NOT RUNNING (started but did not answer in time)'))
  }
  return report
}

app.whenReady().then(async () => {
  // Serve first: the bridge needs to be told this origin before it will
  // accept a socket from it, and the port is not known until it is bound.
  const url = await serveDist()

  // Services before the bridge, because startBridge decides whether to route
  // the brain through the proxy and that is only answerable once the proxy has
  // actually replied. Started after, the bridge was already committed to the
  // proxy's port while the proxy was still booting — or had silently died —
  // and there is no way to change its mind afterwards short of restarting it.
  const external = await ensureServices()
  for (const line of external) log('[jarvis] ' + line)
  const proxyAlive = await alive(PROXY_HEALTH_URL)
  log('[jarvis] brain via ' + (proxyAlive ? 'LiteLLM proxy' : 'the Claude Code login'))

  startBridge(url, proxyAlive)
  const health = await waitForBridge()
  log('[jarvis] serving ' + url)
  log('[jarvis] bridge ' + (health ? JSON.stringify(health) : 'DID NOT ANSWER'))

  /**
   * The one thing worth a dialog.
   *
   * Everything else goes quietly to the log, but a service that could not be
   * started has symptoms that are baffling rather than obvious — a mute
   * assistant, or one that answers every question with a connection error.
   * Only shown when starting it actually failed: the common case is now that
   * it was missing, got launched, and came up, which is not news.
   *
   * The two are not equally bad, so they are not described alike. Without the
   * proxy there is no brain and nothing works; without VoiceStudio the voice
   * falls back to the system one and everything else is fine.
   */
  const down = external.filter((l) => l.includes('NOT RUNNING'))
  if (down.length) {
    const fatal = down.some((l) => l.startsWith('LiteLLM'))
    dialog.showMessageBox({
      type: fatal ? 'error' : 'warning',
      title: 'JARVIS',
      message: fatal
        ? 'JARVIS has no brain'
        : 'JARVIS will use the system voice',
      detail:
        down.join('\n') +
        '\n\n' +
        (fatal
          ? 'The LiteLLM proxy could not be started, so JARVIS cannot answer ' +
            'anything. Check that it is installed and that you are signed in ' +
            'with gcloud.'
          : 'VoiceStudio could not be started, so speech falls back to the ' +
            'Windows voice. Everything else works.'),
      buttons: ['Continue anyway'],
    })
  }

  /**
   * Grant the microphone and camera without prompting.
   *
   * Electron denies media by default and gives the page no way to ask, so a
   * voice assistant simply never hears anything. This is our own page, on our
   * own loopback server, in an app launched to be spoken to — but it is still
   * scoped to media rather than granted wholesale.
   */
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => {
    done(
      permission === 'media' ||
        permission === 'audioCapture' ||
        permission === 'videoCapture',
    )
  })

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#04080d', // matches the HUD, so there is no white flash
    autoHideMenuBar: true,
    title: 'JARVIS',
    webPreferences: {
      // The page is an ordinary web app and needs no Node access; keeping the
      // renderer isolated means a compromised page cannot reach the disk.
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // External links open in the real browser rather than inside the app shell.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target)
    return { action: 'deny' }
  })

  await win.loadURL(url)
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  if (bridge && !bridge.killed) {
    // The bridge spawns its own children (MCP servers); kill the whole tree.
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(bridge.pid), '/T', '/F'])
    } else {
      bridge.kill()
    }
  }
})
