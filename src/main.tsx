import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyTheme, savedTheme } from './theme'

// The store reads savedTheme() for its own state, but nothing puts the
// attribute on <html>, so on a cold load the CSS half of the theme never
// applied. Doing it here, before React paints, also avoids a frame of the
// wrong palette on reload.
applyTheme(savedTheme())

// Deliberately no StrictMode: its double-invoked effects would open the
// microphone and arm the wake-word engine twice, and the second subscription
// steals the audio stream from the first.
createRoot(document.getElementById('root')!).render(<App />)
