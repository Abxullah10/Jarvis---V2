# Audio credits

The two **Kevin MacLeod** tracks (incompetech.com) are licensed **Creative
Commons Attribution 4.0**. Free to use commercially — including in a monetised
YouTube video — provided the attribution below appears somewhere the audience
can see it (a description box is fine).

| File | Source | Used for |
|---|---|---|
| `boot-music.mp3` | Generated locally (VoiceStudio / OmniVoice) | One spoken line as the reactor comes up |
| `ambient.mp3` | Kevin MacLeod, *Ossuary 6 – Air* | Low bed looping under the interface |
| `work.mp3` | Kevin MacLeod, *Mechanolith* | Rises while a tool is running |

`boot-music.mp3` is no longer music and no longer Kevin MacLeod's, so it is
listed apart from the two that are. It holds four spoken words — "Systems
online, sir." — rendered on this machine in the same cloned voice the
assistant speaks with, so the start-up sound and the voice that follows it are
the same person.

It previously held a clip of film dialogue beginning "Allow me to introduce
myself", credited here as *Impact Prelude*, which it was not. That is the
exact material the note at the bottom of this file warns against, and it sat
in the one place guaranteed to play on every single run. Replacing it is why
these rows changed. The original is still in git history if it is ever wanted
back, but it should not be in a recording.

Note the ambient bed is no longer started either (see `ignite` in
`src/App.tsx`): a continuous tone under a synthesised voice reads as a fault
in the audio rather than as atmosphere. The file stays for anyone who wants it.

## Attribution to paste into a video description

```
Music by Kevin MacLeod (incompetech.com)
  "Ossuary 6 - Air"   — Licensed under Creative Commons: By Attribution 4.0
  "Mechanolith"       — Licensed under Creative Commons: By Attribution 4.0
http://creativecommons.org/licenses/by/4.0/
```

## Why not the actual Iron Man score

Disney/Marvel run one of the most aggressive Content ID operations on YouTube.
Real film score or JARVIS dialogue in an upload means a near-certain claim,
demonetisation, or a strike — on a video whose whole point is to be seen. These
tracks are in the same register and cost you a line of text instead.

## Replacing them

Drop in any MP3 with the same filename and it takes over — nothing in the code
references the track names. Other sources worth a look: incompetech.com (same
licence), Pixabay Music (CC0, no attribution at all), and the YouTube Audio
Library.

The short interface sounds — wake pips, tool ticks, the completion chime — are
not files. They're synthesised in Web Audio in `src/lib/sfx.ts`, so there's
nothing to download and nothing to credit. Drop `wake.mp3`, `listen.mp3`,
`tool.mp3`, `done.mp3` or `error.mp3` in here to override any of them.

