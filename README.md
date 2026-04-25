# Gain — Volume Booster

A Firefox extension that boosts audio volume up to **600%** on any tab using the Web Audio API. Clean popup UI, per-site memory, EQ filters, and zero data collection.

> Available on the [Firefox Add-ons store](https://addons.mozilla.org/en-US/firefox/) · MIT License

---

## Features

- **Volume amplification from 0–600%** — far beyond Firefox's built-in limit
- **Bass Boost** — low-shelf EQ filter at 200 Hz
- **Voice Boost** — presence boost via peaking filter at 2500 Hz
- **Dynamics compressor** — reduces distortion and clipping at high gain
- **Per-site volume memory** — optionally restores your last volume when revisiting a site
- **Blacklist / Whitelist modes** — control exactly which sites Gain operates on
- **Toolbar badge** — shows current volume at a glance, colour-coded by level
- **Audio tabs list** — see all tabs currently playing audio from the popup
- **Dark mode** — synced across popup and settings page
- **Keyboard controls** — arrow keys to adjust volume (Shift for ±10 steps)
- **No data collection** — everything stays local, nothing leaves your browser

---

## Installation

### From the Firefox Add-ons store
Search for **Gain - Volume Booster** on [addons.mozilla.org](https://addons.mozilla.org).

### Load locally (for development)
1. Clone or download this repo
2. Open Firefox and navigate to `about:debugging`
3. Click **This Firefox** → **Load Temporary Add-on**
4. Select `manifest.json` from the project folder

---

## Project structure

```
gain/
├── manifest.json       # Extension manifest (MV2)
├── background.js       # Toolbar badge management
├── content.js          # Web Audio API pipeline injected into pages
├── popup.html/js       # Popup UI
├── options.html/js     # Settings page
└── icons/              # PNG icons (16, 32, 48, 96px)
```

---

## How it works

When you visit a page, `content.js` is injected and sets up a Web Audio API pipeline that intercepts all `<audio>` and `<video>` elements:

```
MediaElementSource → Voice filter → Bass filter → GainNode → Compressor → Output
```

Volume changes are sent from the popup to the content script via `browser.tabs.sendMessage`. State is persisted with `browser.storage.local`, keyed by domain.

---

## Troubleshooting

Sometimes when the extension first opens or activates, audio can briefly sound echoey, robotic, or otherwise bugged. If that happens, refresh the page or reset the extension and it should clear up.

---

## Privacy

- No analytics, no tracking, no external requests
- All settings stored locally via Firefox's built-in storage API
- Source is fully open — read it yourself

---

## Support

Gain is free, open source, and always will be. If it's useful to you, a small Bitcoin tip is appreciated but never expected.

**BTC:** `bc1qwfdml65sjj8gevakezxpeyex53q09sa2j8u2dh`

---

## License

MIT — see [LICENSE](./LICENSE)
