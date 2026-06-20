# Gain - Volume Booster

A Firefox extension that boosts audio volume up to **600%** on supported tabs. Clean popup UI, configurable behavior and appearance, sound and per-site memory, EQ filters, and zero data collection.

> Available on the [Firefox Add-ons store](https://addons.mozilla.org/en-US/firefox/addon/gain-volume-booster/) - GPL v3 License

---

## Features

- **Volume amplification from 0-600%** - far beyond Firefox's built-in limit on supported media tabs
- **Bass Boost** - low-shelf EQ filter at 200 Hz
- **Voice Boost** - presence boost via peaking filter at 2500 Hz
- **Dark mode** - synced across popup and settings page
- **Blacklist / Whitelist modes** - control exactly which sites Gain operates on
- **Audio tabs list** - see and jump to tabs currently playing audio from the popup
- Intricate **settings control**, including **behavior and interface customization**
- **Per-site sound memory** - optionally restores volume, Voice Boost, and Bass Boost when revisiting a site
- **Click-to-use activation** - use Gain on the current tab without granting blanket all-sites access
- **URL-change reset** - resets volume and boosts when a site switches videos or streams, with a playlist-friendly toggle to keep settings instead
- **Dynamics compressor** - reduces distortion and clipping at high gain
- **Default volume setting** - choose the starting volume for newly activated tabs
- **Per-site persistent access** - optionally allow Gain to auto-start on specific sites in whitelist mode
- **Toolbar badge** - shows current volume at a glance, colour-coded by level
- **Keyboard controls** - arrow keys to adjust volume (Shift + Arrow Key for +/-10 steps)
- **Direct number entry** - type exact volume values in the popup and settings page
- **No data collection** - everything stays local, nothing leaves your browser

---

## Installation

### From the Firefox Add-ons store
Search for **Gain - Volume Booster** on [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/gain-volume-booster/).

### Load locally (for development)
1. Clone or download this repo
2. Open Firefox and navigate to `about:debugging`
3. Click **This Firefox** -> **Load Temporary Add-on**
4. Select `manifest.json` from the project folder

---

## Project structure

```text
gain/
|-- manifest.json       # Extension manifest (MV2)
|-- background.js       # Badge updates, tab resets, and permission-aware auto-injection
|-- content.js          # Web Audio API pipeline injected into approved pages
|-- site-utils.js       # Shared hostname, domain, and site-permission helpers
|-- popup.html/js       # Popup UI and click-to-use controls
|-- popup-theme.js      # Popup dark-mode preload
|-- options.html/js     # Settings page and list management
|-- options-theme.js    # Settings dark-mode preload
`-- icons/              # PNG icons (16, 32, 48, 96px)
```

---

## How it works

Gain uses a permission model built around **click-to-use** plus optional **per-site persistent access**:

- In normal use, opening the popup can activate Gain on the current tab through `activeTab`
- In **blacklist mode**, Gain can be activated on any supported site except those explicitly blocked
- In **whitelist mode**, Gain only operates on sites added to the whitelist
- If you choose **Add to Whitelist**, Firefox asks for permission for that site only, records it locally, and Gain can auto-start there on future visits

When Gain is active on a page, `content.js` sets up a Web Audio API pipeline for page media:

```text
MediaElementSource -> Fade gain -> Voice filter -> Bass filter -> GainNode -> Compressor -> Output
```

The per-element fade gain ramps in briefly when a media element is first routed through the pipeline, masking the click that the Web Audio API produces at the moment of interception.

Volume changes are sent from the popup to the content script via `browser.tabs.sendMessage`. Live tab state is cached locally so reinjection can restore the current tab without relying on per-site memory, while deliberate full page reloads clear the live tab state. State is also keyed by domain when per-site sound memory is enabled. Same-tab URL changes can reset audio back to the configured default volume with Bass Boost and Voice Boost off, unless that reset is disabled in settings. Hiding the boost buttons also clears stored Bass Boost and Voice Boost state while preserving remembered volume.

**Cross-origin media:** some sites stream audio/video from a third-party server that does not send the CORS headers the Web Audio API requires. Gain cannot boost those streams without silencing them, so on such sites it leaves the audio untouched, disables the popup controls, and shows a short notice instead of failing silently.

---

## Privacy

- No analytics, no tracking, no external requests
- No blanket all-sites access is required for normal use
- Persistent site access is only requested when you explicitly allow a site
- All settings, site lists, and optional per-site sound preferences are stored locally via Firefox's built-in storage API
- Source is fully open - read it yourself

---

## Troubleshooting

Sometimes when the extension first opens or activates, audio can sound echoey, robotic, or otherwise bugged. If that happens, refresh the page or reset the extension - this should clear it up.

If you switch filter modes or add the current site to a block/allow list while audio is boosted, Gain resets that tab back to a neutral 100% state automatically. A site newly allowed by a mode or list change starts at your configured default volume.

If you reload or update the extension while a tab is boosted, that tab keeps playing at its last volume but can no longer be controlled until you refresh the page. Gain detects this, shows a "recently reloaded - please refresh" notice in the popup, and avoids layering a second audio graph over the page.

If a site sounds boosted but the controls do nothing, it is likely a cross-origin media stream without CORS headers (see *How it works*) - Gain cannot process those.

---

## Support

Gain is free, open source, and always will be. If it's useful to you, a small Bitcoin tip is appreciated but never expected.

**BTC:** `bc1qwfdml65sjj8gevakezxpeyex53q09sa2j8u2dh`

---

## License

GPL v3 - see [LICENSE](./LICENSE)
