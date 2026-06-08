// content.js
// Injected into pages to route media elements through a Web Audio pipeline.

(async function () {
  if (window.__gainInjected || window.__gainInjecting) return;

  // Cross-instance guard. `window.__gainInjected` only protects against
  // double-injection within the SAME extension instance (same isolated
  // world). When the extension is reloaded or auto-updated WITHOUT a page
  // refresh, the old content script's AudioContext keeps playing (Web Audio
  // outlives the extension context), and the new instance runs in a fresh
  // world where that flag is unset. Creating a second AudioContext over the
  // same media element layers the audio (echo/comb filtering). The page-DOM
  // marker below is visible across worlds and instances, so the new instance
  // detects the still-live graph and bails. The orphaned graph keeps playing
  // at its last volume; a page refresh restores full control.
  if (document.documentElement.getAttribute('data-gain-active') === '1') {
    // Register a one-time responder so the popup can distinguish this
    // "orphaned after reload" case from a page Gain genuinely can't run on,
    // and show a refresh prompt instead of a generic failure.
    if (!window.__gainOrphanResponder) {
      window.__gainOrphanResponder = true;
      try {
        browser.runtime.onMessage.addListener((msg, sender) => {
          if (sender.id !== browser.runtime.id) return;
          if (msg.type === MSG.GET_STATE) return Promise.resolve({ orphaned: true });
        });
      } catch (e) {}
    }
    return;
  }

  window.__gainInjecting = true;

  const AUDIO = {
    BASS_FREQ_HZ: 200,
    BASS_GAIN_DB: 15,
    VOICE_FREQ_HZ: 2500,
    VOICE_GAIN_DB: 12,
    VOICE_Q: 1,
    COMP_THRESHOLD_DB: -6,
    COMP_KNEE_DB: 18,
    COMP_RATIO: 4,
    COMP_ATTACK_S: 0.003,
    COMP_RELEASE_S: 0.18,
    // Per-element fade-in to mask the click that fires when
    // createMediaElementSource reroutes a playing element. Used as the
    // time constant for setTargetAtTime — ~63% of target at 1τ, ~95% at
    // 3τ. 0.003s gives ≈95% at 9ms; perceptually smoother than a linear
    // ramp of the same duration.
    INTERCEPT_FADE_S: 0.003
  };

  const hostname = location.hostname.replace(/^www\./, '');

  // Web Audio rule: createMediaElementSource on a cross-origin media element
  // whose response did not include CORS headers will produce silent output
  // — permanently — until the page reloads. We detect this case and skip
  // the intercept entirely so the element keeps playing through default
  // audio. Volume/boost cannot apply on those elements; the popup surfaces
  // this to the user instead of silently failing.
  function isCorsRestricted(el) {
    const src = el.currentSrc || el.src;
    if (!src) return false;
    // blob: (MSE) and data: URLs are same-origin by definition.
    if (src.startsWith('blob:') || src.startsWith('data:')) return false;
    try {
      const srcOrigin = new URL(src, location.href).origin;
      if (srcOrigin === location.origin) return false;
      // Cross-origin: only safe if the element opted into CORS. We can't
      // verify the server actually returned CORS headers, but if the
      // attribute isn't set the result will definitely be silent.
      return el.crossOrigin !== 'anonymous' && el.crossOrigin !== 'use-credentials';
    } catch (e) {
      return false;
    }
  }

  // True only when every media element on the page is cors-restricted, so
  // none of them can be intercepted. Mixed-content pages (some intercept,
  // some skipped) report false — controls still work for the interceptable
  // ones. Empty pages (no audio/video yet) also report false so the popup
  // doesn't pre-emptively disable.
  function allMediaCorsRestricted() {
    const els = document.querySelectorAll('audio, video');
    if (!els.length) return false;
    for (const el of els) {
      if (!isCorsRestricted(el)) return false;
    }
    return true;
  }

  let data;
  try {
    data = await browser.storage.local.get(
      ['mode', 'blacklist', 'whitelist', 'defaultVolume', 'rememberVolume', 'showBoostButtons', 'resetOnUrlChange', `site_${hostname}`]
    );
  } catch (e) {
    window.__gainInjecting = false;
    return;
  }

  const mode = data.mode || 'blacklist';
  const blacklist = data.blacklist || [];
  const whitelist = data.whitelist || [];

  let blocked = false;
  if (mode === 'blacklist') {
    blocked = matchesList(blacklist, hostname);
  } else {
    blocked = !matchesList(whitelist, hostname);
  }

  if (blocked) {
    window.__gainInjecting = false;
    return;
  }

  const remember = data.rememberVolume === true;
  const siteState = data[`site_${hostname}`];
  const tabRestore = await browser.runtime.sendMessage({
    type: MSG.GET_TAB_AUDIO_STATE,
    hostname,
    restoreAcrossUrlChange: data.resetOnUrlChange === false
  }).catch(() => ({ state: null, suppressSiteState: false }));
  const tabState = tabRestore && tabRestore.state;
  const defaultVol = data.defaultVolume ?? 100;
  const startState = tabState || (!tabRestore.suppressSiteState && remember && siteState
    ? siteState
    : { volume: defaultVol, bass: false, voice: false });

  if (data.showBoostButtons === false) {
    const hadRememberedBoost = !!(startState.bass || startState.voice);
    startState.bass = false;
    startState.voice = false;

    if (remember && siteState && hadRememberedBoost) {
      await browser.storage.local.set({ [`site_${hostname}`]: startState }).catch(() => {});
    }
  }

  window.__gainInjected = true;
  window.__gainInjecting = false;
  initAudio(startState);

  function initAudio(startState) {
    const audioCtx = new AudioContext();
    // Mark the page DOM so a later extension instance (after a reload/update
    // without a page refresh) can detect this live graph and avoid layering
    // a second AudioContext over the same media.
    document.documentElement.setAttribute('data-gain-active', '1');
    // Maps an intercepted media element to its per-element fade gain node.
    // The fade gain sits between the MediaElementAudioSourceNode and the
    // rest of the graph; rerouting on state changes touches this node, not
    // the source, so the source is created exactly once per element.
    const mediaFadeMap = new WeakMap();

    let lastUrl = location.href;
    let gainNode;
    let compressor;
    let bassFilter;
    let voiceFilter;

    let currentState = {
      volume: typeof startState.volume === 'number' && isFinite(startState.volume)
        ? Math.max(0, Math.min(VOL_MAX, startState.volume))
        : 100,
      bass: !!startState.bass,
      voice: !!startState.voice
    };

    function isNeutralState(state = currentState) {
      return state.volume === 100 && !state.bass && !state.voice;
    }

    function sanitizeState(nextState) {
      if (!nextState || typeof nextState !== 'object') {
        return { ...currentState };
      }

      return {
        volume: typeof nextState.volume === 'number' && isFinite(nextState.volume)
          ? Math.max(0, Math.min(VOL_MAX, nextState.volume))
          : currentState.volume,
        bass: 'bass' in nextState ? !!nextState.bass : currentState.bass,
        voice: 'voice' in nextState ? !!nextState.voice : currentState.voice
      };
    }

    function sendBadge(volume) {
      browser.runtime.sendMessage({ type: MSG.SET_BADGE, volume }).catch(() => {});
    }

    function saveTabAudioState(state = currentState) {
      browser.runtime.sendMessage({
        type: MSG.SET_TAB_AUDIO_STATE,
        hostname,
        url: location.href,
        state
      }).catch(() => {});
    }

    async function getDefaultReset() {
      try {
        const data = await browser.storage.local.get(['defaultVolume', 'rememberVolume', 'resetOnUrlChange']);
        const volume = typeof data.defaultVolume === 'number' && isFinite(data.defaultVolume)
          ? Math.max(0, Math.min(VOL_MAX, data.defaultVolume))
          : 100;
        return {
          enabled: data.resetOnUrlChange !== false,
          remember: data.rememberVolume === true,
          state: { volume, bass: false, voice: false }
        };
      } catch (e) {
        return {
          enabled: true,
          remember: false,
          state: { volume: 100, bass: false, voice: false }
        };
      }
    }

    async function resetForUrlChange() {
      const reset = await getDefaultReset();
      if (!reset.enabled) return;

      rebuildAudio(reset.state);

      if (reset.remember) {
        await browser.storage.local.set({ [`site_${hostname}`]: reset.state });
      }

      sendBadge(reset.state.volume);
      saveTabAudioState(reset.state);
    }

    function applyState() {
      if (!gainNode || !bassFilter || !voiceFilter) return;
      gainNode.gain.setValueAtTime(currentState.volume / 100, audioCtx.currentTime);
      bassFilter.gain.setValueAtTime(currentState.bass ? AUDIO.BASS_GAIN_DB : 0, audioCtx.currentTime);
      voiceFilter.gain.setValueAtTime(currentState.voice ? AUDIO.VOICE_GAIN_DB : 0, audioCtx.currentTime);
    }

    function buildProcessingGraph() {
      if (gainNode && compressor && bassFilter && voiceFilter) {
        applyState();
        return;
      }

      gainNode = audioCtx.createGain();
      compressor = audioCtx.createDynamicsCompressor();
      bassFilter = audioCtx.createBiquadFilter();
      voiceFilter = audioCtx.createBiquadFilter();

      compressor.threshold.value = AUDIO.COMP_THRESHOLD_DB;
      compressor.knee.value = AUDIO.COMP_KNEE_DB;
      compressor.ratio.value = AUDIO.COMP_RATIO;
      compressor.attack.value = AUDIO.COMP_ATTACK_S;
      compressor.release.value = AUDIO.COMP_RELEASE_S;

      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = AUDIO.BASS_FREQ_HZ;

      voiceFilter.type = 'peaking';
      voiceFilter.frequency.value = AUDIO.VOICE_FREQ_HZ;
      voiceFilter.Q.value = AUDIO.VOICE_Q;

      voiceFilter.connect(bassFilter);
      bassFilter.connect(gainNode);
      gainNode.connect(compressor);
      compressor.connect(audioCtx.destination);

      applyState();
    }

    function disconnectProcessingGraph() {
      [voiceFilter, bassFilter, gainNode, compressor].forEach((node) => {
        if (!node) return;
        try { node.disconnect(); } catch (e) {}
      });

      voiceFilter = null;
      bassFilter = null;
      gainNode = null;
      compressor = null;
    }

    function forEachConnectedMedia(callback) {
      document.querySelectorAll('audio, video').forEach((el) => {
        const fadeGain = mediaFadeMap.get(el);
        if (fadeGain) callback(fadeGain);
      });
    }

    function reconnectAllMedia() {
      const useProcessingGraph = !isNeutralState();

      forEachConnectedMedia((fadeGain) => {
        try { fadeGain.disconnect(); } catch (e) {}
      });

      disconnectProcessingGraph();
      if (useProcessingGraph) {
        buildProcessingGraph();
      }

      forEachConnectedMedia((fadeGain) => {
        try {
          fadeGain.connect(useProcessingGraph ? voiceFilter : audioCtx.destination);
        } catch (e) {}
      });
    }

    function setCurrentState(nextState) {
      const previousState = currentState;
      currentState = sanitizeState(nextState);

      if (isNeutralState(previousState) !== isNeutralState()) {
        reconnectAllMedia();
        return;
      }

      if (!isNeutralState()) {
        buildProcessingGraph();
        applyState();
      }
    }

    function rebuildAudio(nextState) {
      currentState = sanitizeState(nextState);
      reconnectAllMedia();
    }

    // True if any element we already intercepted has now ended up with a
    // cors-restricted current source. createMediaElementSource is one-way
    // — we can't undo the intercept — so the audio is silenced by spec and
    // there's no recovery short of a page reload. The popup surfaces this
    // to the user with a refresh prompt.
    function hasSilencedIntercept() {
      const els = document.querySelectorAll('audio, video');
      for (const el of els) {
        if (mediaFadeMap.has(el) && isCorsRestricted(el)) return true;
      }
      return false;
    }

    // Defer the intercept decision until the element knows what it will
    // load. If currentSrc/src is empty (lazy-loaded media, common on SPAs),
    // intercepting now and letting the site set a cross-origin src later
    // would silence the audio with no way to recover. Waiting for
    // 'loadstart' lets us re-check cors at the right moment.
    function safeIntercept(el) {
      if (mediaFadeMap.has(el)) return;
      if (el.currentSrc || el.src) {
        connectElement(el);
        return;
      }
      const onLoadStart = () => {
        el.removeEventListener('loadstart', onLoadStart);
        connectElement(el);
      };
      el.addEventListener('loadstart', onLoadStart);
    }

    function connectElement(el) {
      if (mediaFadeMap.has(el)) return;
      // Cross-origin media without CORS headers would be silenced by
      // createMediaElementSource. Leave it on the browser's default audio
      // routing — no boost, no mute.
      if (isCorsRestricted(el)) return;

      try {
        // createMediaElementSource detaches the element from default audio
        // output the instant it runs — that's spec, and is the source of
        // the click. A per-element fade gain starting at 0 lets the audio
        // resume from silence and ramp up, masking the transient.
        const source = audioCtx.createMediaElementSource(el);
        const fadeGain = audioCtx.createGain();
        fadeGain.gain.value = 0;
        source.connect(fadeGain);

        if (isNeutralState()) {
          fadeGain.connect(audioCtx.destination);
        } else {
          buildProcessingGraph();
          fadeGain.connect(voiceFilter);
        }

        mediaFadeMap.set(el, fadeGain);

        const now = audioCtx.currentTime;
        fadeGain.gain.setValueAtTime(0, now);
        fadeGain.gain.setTargetAtTime(1, now, AUDIO.INTERCEPT_FADE_S);

        // After the element is intercepted, watch for the site swapping its
        // src to a different origin. The intercept can't be undone, so a
        // cross-origin swap would silence audio with no recovery short of
        // a page reload. Push the silenced state to the toolbar badge so
        // the user has a visual cue even without opening the popup.
        el.addEventListener('loadstart', refreshSilencedBadge);
      } catch (e) {
        // Already connected or restricted by the page/browser.
      }
    }

    function refreshSilencedBadge() {
      // loadstart can fire repeatedly on a single element; only act when the
      // silenced state actually flips, to avoid redundant badge messages.
      const silenced = hasSilencedIntercept();
      if (silenced === silencedShown) return;
      silencedShown = silenced;

      if (silenced) {
        browser.runtime.sendMessage({ type: MSG.SET_BADGE, silenced: true }).catch(() => {});
        showSilencedToast();
      } else {
        sendBadge(currentState.volume);
        hideSilencedToast();
        silencedDismissed = false;
      }
    }

    // ── Silenced toast ───────────────────────────────────
    // In-page overlay shown when a previously-intercepted element is now
    // being silenced by Web Audio because its src moved cross-origin.
    // Stays visible (and survives fullscreen) until the user clicks Refresh
    // or Dismiss. Toolbar badge alone isn't enough — users in fullscreen
    // video can't see the badge.

    let silencedToast = null;
    let silencedDismissed = false;
    let silencedShown = false;

    function buildSilencedToast() {
      const toast = document.createElement('div');
      toast.setAttribute('role', 'alert');
      // `all: initial` + inline styles makes the toast immune to page CSS.
      toast.style.cssText = [
        'all: initial',
        'position: fixed',
        'top: 16px',
        'left: 50%',
        'transform: translateX(-50%)',
        'z-index: 2147483647',
        'padding: 10px 12px',
        'background: #ef4444',
        'color: #ffffff',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif',
        'font-size: 13px',
        'line-height: 1.4',
        'border-radius: 8px',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.35)',
        'display: flex',
        'align-items: center',
        'gap: 10px',
        'max-width: 380px'
      ].join('; ');

      const text = document.createElement('span');
      text.textContent = 'Gain: audio was muted by a media source change.';
      text.style.cssText = 'all: initial; color: #ffffff; font-family: inherit; font-size: 13px; flex: 1;';

      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = 'Refresh';
      refreshBtn.style.cssText = [
        'all: initial',
        'color: #ef4444',
        'background: #ffffff',
        'font-family: inherit',
        'font-size: 12px',
        'font-weight: 600',
        'padding: 5px 10px',
        'border-radius: 5px',
        'cursor: pointer'
      ].join('; ');
      refreshBtn.addEventListener('click', () => location.reload());

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.setAttribute('aria-label', 'Dismiss');
      closeBtn.style.cssText = [
        'all: initial',
        'color: #ffffff',
        'background: rgba(255,255,255,0.18)',
        'font-family: inherit',
        'font-size: 13px',
        'line-height: 1',
        'padding: 4px 8px',
        'border-radius: 5px',
        'cursor: pointer'
      ].join('; ');
      closeBtn.addEventListener('click', () => {
        silencedDismissed = true;
        hideSilencedToast();
      });

      toast.appendChild(text);
      toast.appendChild(refreshBtn);
      toast.appendChild(closeBtn);
      return toast;
    }

    function silencedToastParent() {
      // In fullscreen mode the browser only paints descendants of the
      // fullscreen element, so position-fixed siblings disappear. Reparent
      // the toast into the fullscreen element when one is active.
      return document.fullscreenElement || document.body || document.documentElement;
    }

    function showSilencedToast() {
      if (silencedDismissed) return;
      if (!silencedToast) silencedToast = buildSilencedToast();
      const parent = silencedToastParent();
      if (!parent) return;
      if (silencedToast.parentNode !== parent) {
        parent.appendChild(silencedToast);
      }
    }

    function hideSilencedToast() {
      if (silencedToast && silencedToast.parentNode) {
        silencedToast.parentNode.removeChild(silencedToast);
      }
    }

    document.addEventListener('fullscreenchange', () => {
      // If the toast is currently shown, move it into the new fullscreen
      // element (or back to the body when exiting fullscreen).
      if (silencedToast && silencedToast.parentNode) showSilencedToast();
    });

    if (!isNeutralState()) {
      buildProcessingGraph();
    }
    sendBadge(currentState.volume);
    saveTabAudioState();

    document.querySelectorAll('audio, video').forEach(safeIntercept);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches('audio, video')) safeIntercept(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('audio, video').forEach(safeIntercept);
          }
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    function handleUrlChange() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      resetForUrlChange().catch(() => {});
    }

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    const urlPollInterval = setInterval(handleUrlChange, 1000);

    window.addEventListener('pagehide', () => {
      observer.disconnect();
      clearInterval(urlPollInterval);
      audioCtx.close().catch(() => {});
      document.documentElement.removeAttribute('data-gain-active');
    }, { once: true });

    document.addEventListener('click', () => {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    }, { once: true });

    browser.runtime.onMessage.addListener((msg, sender) => {
      if (sender.id !== browser.runtime.id) return;
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

      if (msg.type === MSG.SET_VOLUME) {
        setCurrentState({ volume: msg.value });
        saveTabAudioState();
      }

      if (msg.type === MSG.SET_BASS_BOOST) {
        setCurrentState({ bass: msg.enabled });
        saveTabAudioState();
      }

      if (msg.type === MSG.SET_VOICE_BOOST) {
        setCurrentState({ voice: msg.enabled });
        saveTabAudioState();
      }

      if (msg.type === MSG.RESET_AUDIO) {
        observer.disconnect();
        rebuildAudio(msg.state || { volume: 100, bass: false, voice: false });
        saveTabAudioState();
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      }

      if (msg.type === MSG.GET_STATE) {
        return Promise.resolve({
          volume: currentState.volume,
          bass: currentState.bass,
          voice: currentState.voice,
          corsRestricted: allMediaCorsRestricted(),
          silenced: hasSilencedIntercept()
        });
      }
    });
  }
})();
