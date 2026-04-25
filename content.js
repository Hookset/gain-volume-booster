// content.js - Injected into every page
// Intercepts all HTMLMediaElement (audio/video) and routes through a GainNode

(function () {
  if (window.__volumeMasterInjected) return;
  window.__volumeMasterInjected = true;

  const hostname = location.hostname.replace(/^www\./, '');

  // Check blacklist/whitelist, then load saved volume before initialising audio
  browser.storage.local.get(
    ['mode', 'blacklist', 'whitelist', 'defaultVolume', 'rememberVolume', `site_${hostname}`],
    (data) => {
      const mode      = data.mode      || 'blacklist';
      const blacklist = data.blacklist || [];
      const whitelist = data.whitelist || [];

      const matchesList = (list) => list.some(d => hostname === d || hostname.endsWith('.' + d));

      let blocked = false;
      if (mode === 'blacklist') {
        blocked = matchesList(blacklist);
      } else {
        blocked = whitelist.length > 0 && !matchesList(whitelist);
      }

      if (blocked) return;

      // Determine starting volume
      const remember   = data.rememberVolume === true;
      const siteState  = data[`site_${hostname}`];
      const defaultVol = data.defaultVolume ?? 100;
      const startState = (remember && siteState) ? siteState : { volume: defaultVol, bass: false, voice: false };

      initAudio(startState);
    }
  );

  function initAudio(startState) {
    const audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
    const gainNode    = audioCtx.createGain();
    const compressor  = audioCtx.createDynamicsCompressor();
    const bassFilter  = audioCtx.createBiquadFilter();
    const voiceFilter = audioCtx.createBiquadFilter();

    // Compressor — prevents clipping/distortion at high volumes
    compressor.threshold.value = -24;
    compressor.knee.value      = 30;
    compressor.ratio.value     = 12;
    compressor.attack.value    = 0.003;
    compressor.release.value   = 0.25;

    // Bass boost filter
    bassFilter.type            = 'lowshelf';
    bassFilter.frequency.value = 200;
    bassFilter.gain.value      = 0;

    // Voice boost filter (presence boost)
    voiceFilter.type            = 'peaking';
    voiceFilter.frequency.value = 2500;
    voiceFilter.Q.value         = 1;
    voiceFilter.gain.value      = 0;

    // Chain: source -> voiceFilter -> bassFilter -> gainNode -> compressor -> output
    voiceFilter.connect(bassFilter);
    bassFilter.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(audioCtx.destination);

    // Apply starting state immediately — clamp volume defensively
    const safeVol = (typeof startState.volume === 'number' && isFinite(startState.volume))
      ? Math.max(0, Math.min(600, startState.volume))
      : 100;
    gainNode.gain.value    = safeVol / 100;
    bassFilter.gain.value  = startState.bass  ? 15 : 0;
    voiceFilter.gain.value = startState.voice ? 12 : 0;

    const connectedElements = new WeakSet();

    function connectElement(el) {
      if (connectedElements.has(el)) return;
      connectedElements.add(el);
      try {
        const source = audioCtx.createMediaElementSource(el);
        source.connect(voiceFilter);
      } catch (e) {
        // Already connected or cross-origin restricted
      }
    }

    document.querySelectorAll('audio, video').forEach(connectElement);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches('audio, video')) connectElement(node);
          node.querySelectorAll && node.querySelectorAll('audio, video').forEach(connectElement);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('click', () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

    browser.runtime.onMessage.addListener((msg) => {
      if (audioCtx.state === 'suspended') audioCtx.resume();

      if (msg.type === 'SET_VOLUME') {
        gainNode.gain.value = msg.value / 100;
      }
      if (msg.type === 'SET_BASS_BOOST') {
        bassFilter.gain.value = msg.enabled ? 15 : 0;
      }
      if (msg.type === 'SET_VOICE_BOOST') {
        voiceFilter.gain.value = msg.enabled ? 12 : 0;
      }
      if (msg.type === 'GET_STATE') {
        return Promise.resolve({
          volume: Math.round(gainNode.gain.value * 100),
          bassBoost: bassFilter.gain.value > 0,
          voiceBoost: voiceFilter.gain.value > 0
        });
      }
    });
  }
})();
