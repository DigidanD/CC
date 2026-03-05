'use strict';

(function () {

  /* ─────────────────────────────────────────────
     Constants
  ───────────────────────────────────────────── */
  const SCHEDULE_AHEAD_TIME = 0.1;   // seconds to look ahead
  const SCHEDULER_INTERVAL  = 25;    // ms between scheduler ticks
  const TAP_TIMEOUT         = 2000;  // ms: reset taps after silence
  const TAP_MAX_KEEP        = 8;     // rolling average window

  /* ─────────────────────────────────────────────
     State
  ───────────────────────────────────────────── */
  const state = {
    isPlaying:           false,
    bpm:                 120,
    subdivision:         1,      // 1=quarter, 2=eighth, 4=sixteenth
    timeSigUpper:        4,
    timeSigLower:        4,
    soundType:           'click',
    accentEnabled:       true,

    currentBeat:         0,      // sub-beat index (0-based)
    nextNoteTime:        0.0,
    timerID:             null,

    tapTimes:            [],
    tapTimeout:          null,

    rampEnabled:         false,
    rampStartBpm:        80,
    rampEndBpm:          140,
    rampMeasures:        8,
    rampCurrentMeasure:  0,
    rampActive:          false,

    pendingFlashes:      [],
    rafRunning:          false,
  };

  /* ─────────────────────────────────────────────
     Audio Context (lazy)
  ───────────────────────────────────────────── */
  let audioCtx   = null;
  let noiseBuffer = null;

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuffer = createNoiseBuffer(audioCtx);
    }
    return audioCtx;
  }

  function createNoiseBuffer(ctx) {
    const len    = Math.ceil(ctx.sampleRate * 0.5);
    const buf    = ctx.createBuffer(1, len, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ─────────────────────────────────────────────
     Sound Synthesis
  ───────────────────────────────────────────── */
  function playSound(type, time, isAccent) {
    const ctx    = getAudioCtx();
    const volume = isAccent ? 1.0 : 0.55;

    switch (type) {
      case 'click': playClick(ctx, time, volume, isAccent); break;
      case 'wood':  playWood(ctx, time, volume, isAccent);  break;
      case 'beep':  playBeep(ctx, time, volume, isAccent);  break;
      case 'hihat': playHihat(ctx, time, volume);           break;
    }
  }

  function makeGain(ctx, volume, time, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    g.connect(ctx.destination);
    return g;
  }

  function playClick(ctx, time, volume, isAccent) {
    // Short noise burst through bandpass — classic click
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = isAccent ? 1800 : 1200;
    bpf.Q.value = 1.5;
    const g = makeGain(ctx, volume * 3, time, isAccent ? 0.03 : 0.02);
    src.connect(bpf);
    bpf.connect(g);
    src.start(time);
    src.stop(time + 0.05);
  }

  function playWood(ctx, time, volume, isAccent) {
    // Two triangle oscillators, slightly detuned
    const freqA = isAccent ? 900  : 700;
    const freqB = isAccent ? 750  : 580;
    const decay = isAccent ? 0.07 : 0.05;

    [freqA, freqB].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = makeGain(ctx, volume, time, decay);
      osc.connect(g);
      osc.start(time);
      osc.stop(time + decay + 0.01);
    });
  }

  function playBeep(ctx, time, volume, isAccent) {
    const osc  = ctx.createOscillator();
    osc.type   = 'sine';
    osc.frequency.value = isAccent ? 1000 : 800;
    const g    = makeGain(ctx, volume, time, isAccent ? 0.09 : 0.06);
    osc.connect(g);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  function playHihat(ctx, time, volume) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 7000;
    hpf.Q.value = 0.8;
    const g = makeGain(ctx, volume * 1.5, time, 0.04);
    src.connect(hpf);
    hpf.connect(g);
    src.start(time);
    src.stop(time + 0.06);
  }

  /* ─────────────────────────────────────────────
     Lookahead Scheduler
  ───────────────────────────────────────────── */
  function scheduler() {
    const ctx = getAudioCtx();
    while (state.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_TIME) {
      scheduleNote(state.currentBeat, state.nextNoteTime);
      advanceBeat();
    }
  }

  function scheduleNote(beatIndex, time) {
    const totalSubs  = state.timeSigUpper * state.subdivision;
    const isFirstSub = beatIndex === 0;
    const isAccent   = isFirstSub && state.accentEnabled;

    state.pendingFlashes.push({
      beatIndex,
      totalSubs,
      time,
      isAccent,
    });

    playSound(state.soundType, time, isAccent);
  }

  function advanceBeat() {
    const beatDuration = (60.0 / state.bpm) * (4 / state.timeSigLower);
    const subDuration  = beatDuration / state.subdivision;
    state.nextNoteTime += subDuration;

    const totalSubs = state.timeSigUpper * state.subdivision;
    state.currentBeat = (state.currentBeat + 1) % totalSubs;

    // Ramp: update BPM at measure boundary
    if (state.rampActive && state.currentBeat === 0) {
      advanceRamp();
    }
  }

  function startPlayback() {
    const ctx = getAudioCtx();
    ctx.resume();
    state.isPlaying       = true;
    state.currentBeat     = 0;
    state.nextNoteTime    = ctx.currentTime + 0.05;
    state.pendingFlashes  = [];

    if (state.rampEnabled) initRamp();

    state.timerID = setInterval(scheduler, SCHEDULER_INTERVAL);

    if (!state.rafRunning) {
      state.rafRunning = true;
      requestAnimationFrame(rafLoop);
    }
  }

  function stopPlayback() {
    state.isPlaying  = false;
    state.rampActive = false;
    clearInterval(state.timerID);
    state.timerID       = null;
    state.pendingFlashes = [];
    beatDots.forEach(d => d.classList.remove('active', 'accent'));
    updatePlayButton(false);
    updateRampProgress(0);
  }

  /* ─────────────────────────────────────────────
     RAF Visual Loop
  ───────────────────────────────────────────── */
  function rafLoop() {
    if (!audioCtx) { state.rafRunning = false; return; }
    const now = audioCtx.currentTime;

    state.pendingFlashes = state.pendingFlashes.filter(flash => {
      if (flash.time <= now) {
        const dotIndex = Math.floor(flash.beatIndex / state.subdivision);
        triggerDotFlash(dotIndex, flash.isAccent);
        return false;
      }
      return true;
    });

    if (state.isPlaying || state.pendingFlashes.length > 0) {
      requestAnimationFrame(rafLoop);
    } else {
      state.rafRunning = false;
    }
  }

  /* ─────────────────────────────────────────────
     Tap Tempo
  ───────────────────────────────────────────── */
  function onTapTempo() {
    const now = performance.now();

    if (state.tapTimes.length > 0) {
      const elapsed = now - state.tapTimes[state.tapTimes.length - 1];
      if (elapsed > TAP_TIMEOUT) state.tapTimes = [];
    }

    state.tapTimes.push(now);
    if (state.tapTimes.length > TAP_MAX_KEEP) {
      state.tapTimes = state.tapTimes.slice(-TAP_MAX_KEEP);
    }

    if (state.tapTimes.length < 2) return;

    let total = 0;
    for (let i = 1; i < state.tapTimes.length; i++) {
      total += state.tapTimes[i] - state.tapTimes[i - 1];
    }
    const avg     = total / (state.tapTimes.length - 1);
    const tapped  = Math.round(60000 / avg);
    setBpm(tapped);

    clearTimeout(state.tapTimeout);
    state.tapTimeout = setTimeout(() => { state.tapTimes = []; }, TAP_TIMEOUT);

    // Tap button flash feedback
    tapBtn.classList.add('tapped');
    setTimeout(() => tapBtn.classList.remove('tapped'), 120);
  }

  /* ─────────────────────────────────────────────
     Ramp
  ───────────────────────────────────────────── */
  function initRamp() {
    state.rampActive         = true;
    state.rampCurrentMeasure = 0;
    state.bpm                = state.rampStartBpm;
    updateBpmUI(state.bpm);
  }

  function advanceRamp() {
    state.rampCurrentMeasure++;
    const t = state.rampCurrentMeasure / state.rampMeasures;

    if (t >= 1) {
      state.bpm        = state.rampEndBpm;
      state.rampActive = false;
      updateBpmUI(state.bpm);
      updateRampProgress(1);
      return;
    }

    state.bpm = Math.round(
      state.rampStartBpm + (state.rampEndBpm - state.rampStartBpm) * t
    );
    updateBpmUI(state.bpm);
    updateRampProgress(t);
  }

  function updateRampProgress(t) {
    if (rampProgressFill) {
      rampProgressFill.style.width = (t * 100).toFixed(1) + '%';
    }
  }

  /* ─────────────────────────────────────────────
     setBpm — single source of truth
  ───────────────────────────────────────────── */
  function setBpm(newBpm) {
    const clamped    = Math.max(40, Math.min(160, Math.round(newBpm)));
    state.bpm        = clamped;
    updateBpmUI(clamped);
  }

  function updateBpmUI(bpm) {
    bpmInput.value = bpm;
    bpmSlider.value = bpm;
    const pct = ((bpm - 40) / 120 * 100).toFixed(1) + '%';
    bpmSlider.style.setProperty('--slider-pct', pct);

    const beatMs = 60000 / bpm;
    document.documentElement.style.setProperty(
      '--beat-flash-duration',
      Math.min(beatMs * 0.7, 260) + 'ms'
    );
  }

  /* ─────────────────────────────────────────────
     Beat Dots
  ───────────────────────────────────────────── */
  let beatDots = [];

  function rebuildBeatDots() {
    beatVisualizer.innerHTML = '';
    beatDots = [];
    for (let i = 0; i < state.timeSigUpper; i++) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot' + (i === 0 ? ' beat-dot--first' : '');
      beatVisualizer.appendChild(dot);
      beatDots.push(dot);
    }
  }

  function triggerDotFlash(dotIndex, isAccent) {
    beatDots.forEach(d => d.classList.remove('active', 'accent'));
    const dot = beatDots[dotIndex];
    if (!dot) return;
    dot.classList.remove('active', 'accent');
    void dot.offsetWidth; // force reflow to restart animation
    dot.classList.add('active');
    if (isAccent) dot.classList.add('accent');
  }

  /* ─────────────────────────────────────────────
     Play Button
  ───────────────────────────────────────────── */
  function updatePlayButton(playing) {
    playPauseBtn.classList.toggle('running', playing);
    playPauseBtn.querySelector('.btn-label').textContent = playing ? 'STOP' : 'START';
    playPauseBtn.querySelector('.play-icon').style.display  = playing ? 'none' : '';
    playPauseBtn.querySelector('.pause-icon').style.display = playing ? '' : 'none';
  }

  function togglePlayPause() {
    if (state.isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
      updatePlayButton(true);
    }
  }

  /* ─────────────────────────────────────────────
     Segmented Buttons Helper
  ───────────────────────────────────────────── */
  function activateSeg(group, btn) {
    group.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  /* ─────────────────────────────────────────────
     BPM nudge hold-to-repeat
  ───────────────────────────────────────────── */
  function setupNudge(btn, delta) {
    let intervalId = null;
    let timeoutId  = null;

    function fire() { setBpm(state.bpm + delta); }

    btn.addEventListener('mousedown', () => {
      fire();
      timeoutId = setTimeout(() => {
        intervalId = setInterval(fire, 60);
      }, 400);
    });

    function cancel() {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    }

    btn.addEventListener('mouseup', cancel);
    btn.addEventListener('mouseleave', cancel);

    // Touch support
    btn.addEventListener('touchstart', e => { e.preventDefault(); fire(); });
  }

  /* ─────────────────────────────────────────────
     DOM References
  ───────────────────────────────────────────── */
  const beatVisualizer  = document.getElementById('beat-visualizer');
  const bpmInput        = document.getElementById('bpm-input');
  const bpmSlider       = document.getElementById('bpm-slider');
  const bpmUpBtn        = document.getElementById('bpm-up');
  const bpmDownBtn      = document.getElementById('bpm-down');
  const playPauseBtn    = document.getElementById('play-pause-btn');
  const tapBtn          = document.getElementById('tap-tempo-btn');
  const noteGroup       = document.getElementById('note-group');
  const timeSigGroup    = document.getElementById('timesig-group');
  const soundGroup      = document.getElementById('sound-group');
  const accentToggle    = document.getElementById('accent-enabled');
  const rampEnabledChk  = document.getElementById('ramp-enabled');
  const rampControls    = document.getElementById('ramp-controls');
  const rampStartInput  = document.getElementById('ramp-start-bpm');
  const rampEndInput    = document.getElementById('ramp-end-bpm');
  const rampMeasuresIn  = document.getElementById('ramp-measures');
  const rampProgressFill = document.getElementById('ramp-progress-fill');

  /* ─────────────────────────────────────────────
     Event Listeners
  ───────────────────────────────────────────── */
  playPauseBtn.addEventListener('click', togglePlayPause);
  tapBtn.addEventListener('click', onTapTempo);

  bpmSlider.addEventListener('input', () => setBpm(Number(bpmSlider.value)));
  bpmInput.addEventListener('change', () => setBpm(Number(bpmInput.value)));
  bpmInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') setBpm(Number(bpmInput.value));
  });

  setupNudge(bpmUpBtn, 1);
  setupNudge(bpmDownBtn, -1);

  // Note value (subdivision)
  noteGroup.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const sub = Number(btn.dataset.subdivision);
    state.subdivision = sub;
    activateSeg(noteGroup, btn);
    if (state.isPlaying) {
      state.currentBeat = 0;
      state.pendingFlashes = [];
    }
  });

  // Time Signature
  timeSigGroup.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.timeSigUpper = Number(btn.dataset.upper);
    state.timeSigLower = Number(btn.dataset.lower);
    activateSeg(timeSigGroup, btn);
    state.currentBeat    = 0;
    state.pendingFlashes = [];
    rebuildBeatDots();
  });

  // Sound
  soundGroup.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.soundType = btn.dataset.sound;
    activateSeg(soundGroup, btn);
  });

  // Accent
  accentToggle.addEventListener('change', () => {
    state.accentEnabled = accentToggle.checked;
  });

  // Ramp toggle
  rampEnabledChk.addEventListener('change', () => {
    state.rampEnabled = rampEnabledChk.checked;
    rampControls.classList.toggle('expanded', state.rampEnabled);
    if (!state.rampEnabled && state.rampActive) {
      state.rampActive = false;
    }
  });

  rampStartInput.addEventListener('change', () => {
    state.rampStartBpm = Math.max(40, Math.min(160, Number(rampStartInput.value)));
    rampStartInput.value = state.rampStartBpm;
  });
  rampEndInput.addEventListener('change', () => {
    state.rampEndBpm = Math.max(40, Math.min(160, Number(rampEndInput.value)));
    rampEndInput.value = state.rampEndBpm;
  });
  rampMeasuresIn.addEventListener('change', () => {
    state.rampMeasures = Math.max(1, Math.min(64, Number(rampMeasuresIn.value)));
    rampMeasuresIn.value = state.rampMeasures;
  });

  // Keyboard shortcut: Space = play/stop
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      togglePlayPause();
    }
  });

  // iOS Safari audio unlock
  document.addEventListener('touchstart', function unlock() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    document.removeEventListener('touchstart', unlock);
  }, { once: true });

  /* ─────────────────────────────────────────────
     Init
  ───────────────────────────────────────────── */
  rebuildBeatDots();
  setBpm(state.bpm);

})();
