import type { Phase } from './store'

/**
 * The two interface themes.
 *
 * CSS carries the 2D half (tokens on :root, swapped by data-theme in
 * index.css). The 3D half cannot read CSS, so the per-phase colours and the
 * ring's highlight live here, and the store hands them to both the scene and
 * the HUD so the orb and the rails always agree.
 *
 *   defa      Theme 1. DeFa brand: blue ground (#6297FD -> #356DC5), white
 *             instrument light, soft-blue and lavender glow. Strict blue/white.
 *   obsidian  Theme 2. Black ground, blue instrument light, white text.
 */
export type ThemeName = 'defa' | 'obsidian'

export const THEME_ORDER: ThemeName[] = ['defa', 'obsidian']

type ThemeSpec = {
  label: string
  /** Interface colour per phase; JARVIS's own accent/palette still win over it. */
  phase: Record<Phase, string>
  /** The ring's moving highlights. */
  hot: string
}

export const THEMES: Record<ThemeName, ThemeSpec> = {
  defa: {
    label: 'DeFa',
    phase: {
      offline: '#9dbeff',
      boot: '#d9e7ff',
      dormant: '#bcd3ff',
      waking: '#ffffff',
      listening: '#ffffff',
      thinking: '#e2d8ff',
      tooling: '#c4f0ff',
      speaking: '#ffffff',
    },
    hot: '#ffffff',
  },
  obsidian: {
    label: 'Obsidian',
    phase: {
      offline: '#0f2f66',
      boot: '#2e86ff',
      dormant: '#1f5fd0',
      waking: '#6cb4ff',
      listening: '#2e86ff',
      thinking: '#5d9dff',
      tooling: '#7f8cff',
      speaking: '#8cc4ff',
    },
    hot: '#dcecff',
  },
}

const KEY = 'jarvis.theme'

export function savedTheme(): ThemeName {
  try {
    const t = localStorage.getItem(KEY)
    if (t && t in THEMES) return t as ThemeName
  } catch { /* private mode: the default theme is a fine fallback */ }
  return 'defa'
}

/** Puts the theme on <html> (CSS does the rest) and remembers it. */
export function applyTheme(t: ThemeName) {
  document.documentElement.setAttribute('data-theme', t)
  try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
}
