// content.js
// Injected into pages to route media elements through a Web Audio pipeline.

(function () {
  if (window.__gainInjected) return;
  window.__gainInjected = true;

  const AUDIO = {
    BASS_FREQ_HZ: 200,
    BASS_GAIN_DB: 15,
    VOICE_FREQ_HZ: 2500,
    VOICE_GAIN_DB: 12,
    VOICE_Q: 1,
    COMP_THRESHOLD_DB: -24,
    COMP_KNEE_DB: 30,
    COMP_RATIO: 12,
    COMP_ATTACK_S: 0.003,
    COMP_RELEASE_S: 0.25
  };

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
        blocked = !matchesList(whitelist);
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
    const mediaSourceMap = new WeakMap();

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

    function isNeutralState(state = currentState) {
      return state.volume === 100 && !state.bass && !state.voice;
    }

    function sanitizeState(nextState) {
      if (!nextState || typeof nextState !== 'object') {
        return { ...currentState };
      }

      return {
        volume: typeof nextState.volume === 'number' && isFinite(nextState.volume)
          ? Math.max(0, Math.min(600, nextState.volume))
          : currentState.volume,
        bass: 'bass' in nextState ? !!nextState.bass : currentState.bass,
        voice: 'voice' in nextState ? !!nextState.voice : currentState.voice
      };
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
        const source = mediaSourceMap.get(el);
        if (source) callback(source);
      });
    }

    function reconnectAllMedia() {
      const useProcessingGraph = !isNeutralState();

      forEachConnectedMedia((source) => {
        try { source.disconnect(); } catch (e) {}
      });

      disconnectProcessingGraph();
      if (useProcessingGraph) {
        buildProcessingGraph();
      }

      forEachConnectedMedia((source) => {
        try {
          source.connect(useProcessingGraph ? voiceFilter : audioCtx.destination);
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

    function connectElement(el) {
      if (mediaSourceMap.has(el)) return;

      try {
        const source = audioCtx.createMediaElementSource(el);
        mediaSourceMap.set(el, source);
        if (isNeutralState()) {
          source.connect(audioCtx.destination);
        } else {
          buildProcessingGraph();
          source.connect(voiceFilter);
        }
      } catch (e) {
        // Already connected or restricted by the page/browser.
      }
    }

    if (!isNeutralState()) {
      buildProcessingGraph();
    }

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
        setCurrentState({ volume: msg.value });
      }

      if (msg.type === 'SET_BASS_BOOST') {
        setCurrentState({ bass: msg.enabled });
      }

      if (msg.type === 'SET_VOICE_BOOST') {
        setCurrentState({ voice: msg.enabled });
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
