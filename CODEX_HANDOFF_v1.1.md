# Gain — Volume Booster | Codex Handoff: v1.1 Corrections

## Context

Gain is a Firefox MV2 browser extension that boosts audio volume up to 600% using the Web Audio API. It has been reviewed for code quality and security. This document outlines the specific corrections required for v1.1. Do not make changes beyond what is listed here.

---

## Correction 1 — Memory leak in `content.js`: `sourceNodes` array

### Problem

`sourceNodes` is a plain array that holds strong references to `MediaElementSourceNode` objects. When a page dynamically adds and removes `<audio>`/`<video>` elements (common on SPAs like YouTube, Twitch, etc.), disconnected source nodes accumulate in the array and are never garbage collected. Over a long session this is a minor but real memory leak.

### Current code (content.js)

```js
const connectedElements = new WeakSet();
const sourceNodes = [];

function connectElement(el) {
  if (connectedElements.has(el)) return;
  try {
    const source = audioCtx.createMediaElementSource(el);
    connectedElements.add(el);
    sourceNodes.push(source);
    source.connect(voiceFilter);
  } catch (e) {}
}
```

And in `rebuildAudio`:

```js
sourceNodes.forEach((source) => {
  try { source.disconnect(); } catch (e) {}
});
```

### Required fix

Replace the parallel `WeakSet` + `Array` with a single `WeakMap<HTMLMediaElement, MediaElementSourceNode>`. This gives you:
- Membership check (replacing `WeakSet`)
- Access to the source node for disconnect (replacing the array)
- GC-friendly — when elements are removed from the DOM, the map entries are automatically eligible for collection

**Replace both `connectedElements` and `sourceNodes` with:**

```js
const mediaSourceMap = new WeakMap(); // el -> MediaElementSourceNode
```

**Update `connectElement`:**

```js
function connectElement(el) {
  if (mediaSourceMap.has(el)) return;
  try {
    const source = audioCtx.createMediaElementSource(el);
    mediaSourceMap.set(el, source);
    source.connect(voiceFilter);
  } catch (e) {
    // Already connected or cross-origin restricted
  }
}
```

**Update `rebuildAudio`** — since `WeakMap` is not iterable, you need a parallel `Set<HTMLMediaElement>` to track which elements have been connected, so you can iterate them during rebuild:

```js
const mediaSourceMap = new WeakMap(); // el -> MediaElementSourceNode (GC-friendly)
const connectedSet = new Set();       // iterable set of connected elements for rebuild

function connectElement(el) {
  if (mediaSourceMap.has(el)) return;
  try {
    const source = audioCtx.createMediaElementSource(el);
    mediaSourceMap.set(el, source);
    connectedSet.add(el);
    source.connect(voiceFilter);
  } catch (e) {}
}
```

**Update `rebuildAudio` to use `connectedSet`:**

```js
function rebuildAudio(nextState) {
  if (nextState && typeof nextState === 'object') {
    currentState = {
      volume: typeof nextState.volume === 'number' && isFinite(nextState.volume)
        ? Math.max(0, Math.min(600, nextState.volume))
        : currentState.volume,
      bass: !!nextState.bass,
      voice: !!nextState.voice
    };
  }

  // Disconnect all source nodes
  connectedSet.forEach((el) => {
    const source = mediaSourceMap.get(el);
    if (source) {
      try { source.disconnect(); } catch (e) {}
    }
  });

  // Disconnect and rebuild processing graph
  [voiceFilter, bassFilter, gainNode, compressor].forEach((node) => {
    if (!node) return;
    try { node.disconnect(); } catch (e) {}
  });

  buildProcessingGraph();

  // Reconnect all sources
  connectedSet.forEach((el) => {
    const source = mediaSourceMap.get(el);
    if (source) {
      try { source.connect(voiceFilter); } catch (e) {}
    }
  });
}
```

---

## Correction 2 — No sender validation in message listeners

### Problem

Both `background.js` and `content.js` handle `browser.runtime.onMessage` without validating the sender. Any extension or content script running in the browser can send messages to these listeners. The practical risk for this extension is low (no sensitive operations are performed), but it is a security gap that violates extension best practices.

### Required fix — `background.js`

Add a sender ID check at the top of the listener:

```js
browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id) return;
  if (msg.type !== 'SET_BADGE') return;

  const { tabId, volume } = msg;
  // ... rest of handler unchanged
});
```

### Required fix — `content.js`

Add the same sender check to the message listener inside `initAudio()`:

```js
browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id) return;

  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (msg.type === 'SET_VOLUME') { ... }
  // ... rest of handler unchanged
});
```

---

## Correction 3 — Missing `runtime.lastError` checks in `background.js`

### Problem

`browser.browserAction.setBadgeText` and `browser.browserAction.setBadgeBackgroundColor` are called without checking `browser.runtime.lastError`. If the tab has been closed between the message being sent and the badge call executing, Firefox logs an unchecked error to the console. Not visible to users, but noisy and incorrect.

### Current code (background.js)

```js
browser.browserAction.setBadgeText({ text: String(volume), tabId });
browser.browserAction.setBadgeBackgroundColor({ color, tabId });
```

### Required fix

Wrap in callbacks with `lastError` checks:

```js
browser.browserAction.setBadgeText({ text: String(volume), tabId }, () => {
  if (browser.runtime.lastError) return;
  browser.browserAction.setBadgeBackgroundColor({ color, tabId }, () => {
    if (browser.runtime.lastError) return;
  });
});
```

Apply the same pattern to the `setBadgeText` call in the `volume === 100` branch:

```js
browser.browserAction.setBadgeText({ text: '', tabId }, () => {
  if (browser.runtime.lastError) return;
});
```

And in the `onRemoved` and `onUpdated` listeners:

```js
browser.tabs.onRemoved.addListener((tabId) => {
  browser.browserAction.setBadgeText({ text: '', tabId }, () => {
    if (browser.runtime.lastError) return;
  });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    browser.browserAction.setBadgeText({ text: '', tabId }, () => {
      if (browser.runtime.lastError) return;
    });
  }
});
```

---

## Correction 4 — Remove `strict_min_version_android` from `manifest.json`

### Problem

`strict_min_version_android` is not a recognised MV2 manifest key. It causes a warning in `about:debugging` and is not spec-compliant. The extension has already been submitted to AMO as desktop-only, so this key is redundant and should be removed.

### Current manifest (browser_specific_settings section)

```json
"browser_specific_settings": {
  "gecko": {
    "id": "gain-volume-booster@hookset",
    "strict_min_version": "140.0",
    "strict_min_version_android": "142.0",
    "data_collection_permissions": {
      "required": ["none"],
      "optional": []
    }
  }
}
```

### Required fix

```json
"browser_specific_settings": {
  "gecko": {
    "id": "gain-volume-booster@hookset",
    "strict_min_version": "140.0",
    "data_collection_permissions": {
      "required": ["none"],
      "optional": []
    }
  }
}
```

---

## Correction 5 — Extract magic numbers in `content.js` to named constants

### Problem

Audio processing values are hardcoded inline throughout `content.js`. This makes future tuning difficult and the intent unclear to anyone reading the code.

### Current code (scattered throughout content.js)

```js
compressor.threshold.value = -24;
compressor.knee.value      = 30;
compressor.ratio.value     = 12;
compressor.attack.value    = 0.003;
compressor.release.value   = 0.25;

bassFilter.frequency.value = 200;
bassFilter.gain.value      = 15; // in applyState

voiceFilter.frequency.value = 2500;
voiceFilter.Q.value         = 1;
voiceFilter.gain.value      = 12; // in applyState
```

### Required fix

Add a constants block at the top of `content.js`, immediately after the IIFE opening and the guard check:

```js
const AUDIO = {
  BASS_FREQ_HZ:       200,
  BASS_GAIN_DB:       15,
  VOICE_FREQ_HZ:      2500,
  VOICE_GAIN_DB:      12,
  VOICE_Q:            1,
  COMP_THRESHOLD_DB:  -24,
  COMP_KNEE_DB:       30,
  COMP_RATIO:         12,
  COMP_ATTACK_S:      0.003,
  COMP_RELEASE_S:     0.25,
};
```

Then replace all inline values with references:

```js
compressor.threshold.value  = AUDIO.COMP_THRESHOLD_DB;
compressor.knee.value       = AUDIO.COMP_KNEE_DB;
compressor.ratio.value      = AUDIO.COMP_RATIO;
compressor.attack.value     = AUDIO.COMP_ATTACK_S;
compressor.release.value    = AUDIO.COMP_RELEASE_S;

bassFilter.frequency.value  = AUDIO.BASS_FREQ_HZ;
voiceFilter.frequency.value = AUDIO.VOICE_FREQ_HZ;
voiceFilter.Q.value         = AUDIO.VOICE_Q;

// In applyState():
bassFilter.gain.setValueAtTime(currentState.bass  ? AUDIO.BASS_GAIN_DB  : 0, audioCtx.currentTime);
voiceFilter.gain.setValueAtTime(currentState.voice ? AUDIO.VOICE_GAIN_DB : 0, audioCtx.currentTime);
```

---

## Do Not Change

- Badge update frequency — the current behaviour (updating on every slider tick) is intentional. The previous throttle caused the badge to display incorrect values (off by 2–3) and was deliberately removed.
- Icon sizes — 96px is intentional and accepted by AMO.
- Any UI, CSS, or visual behaviour.
- `options.js`, `options.html`, `popup.html` — no changes required in these files.

---

## Version bump

After applying all corrections, update `manifest.json`:

```json
"version": "1.0.1"
```

---

## Files modified by this handoff

| File | Changes |
|------|---------|
| `content.js` | Corrections 1, 5 |
| `background.js` | Corrections 2 (partial), 3 |
| `manifest.json` | Corrections 4, version bump |

`popup.js` requires Correction 2 (sender validation in content script listener) — note this listener lives inside `content.js`, not `popup.js`. `popup.js` is unchanged.
