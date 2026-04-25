// content.js
// Injected into pages to route media elements through a Web Audio pipeline.

(function () {
  if (window.__gainInjected) return;
  window.__gainInjected = true;

  const hostname = location.hostname.replace(/^www\./, '');

  browser.storage.local.get(
    ['mode', 'blacklist', 'whitelist', 'defaultVolume', 'rememberVolume', `site_${hostname}`],
    (data) => {
      const mode = data.mode || 'blacklist';
      const blacklist = data.blacklist || [];
      const whitelist = data.whitelist || [];

      const matchesList = (list) => list.some((d) => hostname === d || hostname.endsWith('.' + d));

      let blocked = false;
      if (mode === 'blacklist') {
        blocked = matchesList(blacklist);
      } else {
        blocked = whitelist.length > 0 && !matchesList(whitelist);
      }

      if (blocked) return;

      const remember = data.rememberVolume === true;
      const siteState = data[`site_${hostname}`];
      const defaultVol = data.defaultVolume ?? 100;
      const startState = remember && siteState
        ? siteState
        : { volume: defaultVol, bass: false, voice: false };

      initAudio(startState);
    }
  );

  function initAudio(startState) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const connectedElements = new WeakSet();
    const sourceNodes = [];

    let gainNode;
    let compressor;
    let bassFilter;
    let voiceFilter;

    let currentState = {
      volume: typeof startState.volume === 'number' && isFinite(startState.volume)
        ? Math.max(0, Math.min(600, startState.volume))
        : 100,
      bass: !!startState.bass,
      voice: !!startState.voice
    };

    function applyState() {
      gainNode.gain.setValueAtTime(currentState.volume / 100, audioCtx.currentTime);
      bassFilter.gain.setValueAtTime(currentState.bass ? 15 : 0, audioCtx.currentTime);
      voiceFilter.gain.setValueAtTime(currentState.voice ? 12 : 0, audioCtx.currentTime);
    }

    function buildProcessingGraph() {
      gainNode = audioCtx.createGain();
      compressor = audioCtx.createDynamicsCompressor();
      bassFilter = audioCtx.createBiquadFilter();
      voiceFilter = audioCtx.createBiquadFilter();

      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 200;

      voiceFilter.type = 'peaking';
      voiceFilter.frequency.value = 2500;
      voiceFilter.Q.value = 1;

      voiceFilter.connect(bassFilter);
      bassFilter.connect(gainNode);
      gainNode.connect(compressor);
      compressor.connect(audioCtx.destination);

      applyState();
    }

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

      sourceNodes.forEach((source) => {
        try { source.disconnect(); } catch (e) {}
      });

      [voiceFilter, bassFilter, gainNode, compressor].forEach((node) => {
        if (!node) return;
        try { node.disconnect(); } catch (e) {}
      });

      buildProcessingGraph();

      sourceNodes.forEach((source) => {
        try { source.connect(voiceFilter); } catch (e) {}
      });
    }

    function connectElement(el) {
      if (connectedElements.has(el)) return;

      try {
        const source = audioCtx.createMediaElementSource(el);
        connectedElements.add(el);
        sourceNodes.push(source);
        source.connect(voiceFilter);
      } catch (e) {
        // Already connected or restricted by the page/browser.
      }
    }

    buildProcessingGraph();

    document.querySelectorAll('audio, video').forEach(connectElement);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches('audio, video')) connectElement(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('audio, video').forEach(connectElement);
          }
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('click', () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

    browser.runtime.onMessage.addListener((msg) => {
      if (audioCtx.state === 'suspended') audioCtx.resume();

      if (msg.type === 'SET_VOLUME') {
        currentState.volume = Math.max(0, Math.min(600, msg.value));
        applyState();
      }

      if (msg.type === 'SET_BASS_BOOST') {
        currentState.bass = !!msg.enabled;
        applyState();
      }

      if (msg.type === 'SET_VOICE_BOOST') {
        currentState.voice = !!msg.enabled;
        applyState();
      }

      if (msg.type === 'RESET_AUDIO') {
        rebuildAudio(msg.state || { volume: 100, bass: false, voice: false });
      }

      if (msg.type === 'GET_STATE') {
        return Promise.resolve({
          volume: currentState.volume,
          bassBoost: currentState.bass,
          voiceBoost: currentState.voice
        });
      }
    });
  }
})();
