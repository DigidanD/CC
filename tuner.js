(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     Constants
  ───────────────────────────────────────────── */
  const NOTE_NAMES  = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const A4_FREQ     = 440;
  const A4_MIDI     = 69;
  const MIN_FREQ    = 50;    // Hz — below this is noise
  const MAX_FREQ    = 2000;  // Hz — above this rarely needed
  const CONFIDENCE  = 0.85;  // minimum YIN confidence
  const YIN_THRESH  = 0.15;  // YIN cumulative-mean threshold
  const MEDIAN_N    = 9;     // median-filter window size
  const LOCK_CENTS  = 10;    // ±units on 0-100 scale (~±10¢) = green zone
  const LOCK_FRAMES = 12;    // frames at 60fps ≈ 200ms to confirm lock
  const FFT_SIZE    = 4096;  // analyser fftSize → time-domain buffer length

  /* ─────────────────────────────────────────────
     State
  ───────────────────────────────────────────── */
  let active    = false;
  let audioCtx  = null;
  let analyser  = null;
  let micStream = null;
  let rafId     = null;
  let pcmBuf    = null;

  // Needle spring physics
  let nPos           = 50;   // current position 0–100 (50 = centre = 0 ¢)
  let nVel           = 0;
  let nTarget        = 50;
  let smoothedTarget = 50;   // low-pass filtered target, prevents frame jitter
  let lastTs         = 0;

  // Smoothing & lock state
  const freqHistory = [];
  let frameCount    = 0;
  let lockCount     = 0;
  let isLocked      = false;
  let lastDet       = null;  // last FreqToNote result, or null

  /* ─────────────────────────────────────────────
     DOM refs
  ───────────────────────────────────────────── */
  let noteEl, octaveEl, freqEl, centsEl, lockEl,
      startBtn, needleEl, gaugeEl, displayEl;

  /* ─────────────────────────────────────────────
     YIN Pitch Detection
     Cheveigué & Kawahara, 2002
  ───────────────────────────────────────────── */
  function yin(signal, sampleRate) {
    const N = signal.length;
    const W = Math.floor(N / 2);

    // Reject silence
    let rms = 0;
    for (let i = 0; i < N; i++) rms += signal[i] * signal[i];
    if (rms / N < 1e-4) return null;

    // Steps 1 + 2: difference function + cumulative mean normalisation
    const d = new Float32Array(W);
    d[0] = 1;
    let rSum = 0;
    for (let tau = 1; tau < W; tau++) {
      let diff = 0;
      for (let i = 0; i < W; i++) {
        const delta = signal[i] - signal[i + tau];
        diff += delta * delta;
      }
      rSum += diff;
      d[tau] = rSum > 0 ? (diff * tau) / rSum : 0;
    }

    // Step 3: standard YIN — first τ below threshold, descend to local minimum.
    // Global-minimum was avoided for fear of overshoot, but it caused harmonic
    // misidentification (e.g. High E4 detected as A4 because τ≈100 < τ≈134 had
    // a lower d' value). First-minimum correctly tracks the fundamental.
    const tauMin = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
    const tauMax = Math.min(W - 1, Math.floor(sampleRate / MIN_FREQ));
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < YIN_THRESH) {
        // descend to the bottom of this dip (local minimum)
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau === -1) return null;

    // Step 4: parabolic interpolation
    const x0 = tau > tauMin ? tau - 1 : tau;
    const x2 = tau < tauMax ? tau + 1 : tau;
    let fine;
    if (x0 === tau) {
      fine = d[tau] <= d[x2] ? tau : x2;
    } else if (x2 === tau) {
      fine = d[tau] <= d[x0] ? tau : x0;
    } else {
      const s0 = d[x0], s1 = d[tau], s2 = d[x2];
      const denom = 2 * (2 * s1 - s2 - s0);
      fine = denom !== 0 ? tau + (s2 - s0) / denom : tau;
    }

    return { freq: sampleRate / fine, confidence: 1 - d[tau] };
  }

  /* ─────────────────────────────────────────────
     Median Filter
  ───────────────────────────────────────────── */
  function medianFreq(f) {
    freqHistory.push(f);
    if (freqHistory.length > MEDIAN_N) freqHistory.shift();
    const s = [...freqHistory].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /* ─────────────────────────────────────────────
     Frequency → Note
  ───────────────────────────────────────────── */
  function freqToNote(freq) {
    const midi   = 12 * Math.log2(freq / A4_FREQ) + A4_MIDI;
    const midiR  = Math.round(midi);
    const cents  = Math.round((midi - midiR) * 100);
    const name   = NOTE_NAMES[((midiR % 12) + 12) % 12];
    const octave = Math.floor(midiR / 12) - 1;
    return { name, octave, cents, freq };
  }

  /* ─────────────────────────────────────────────
     Spring Physics (needle lerp)
  ───────────────────────────────────────────── */
  function stepSpring(dt) {
    // Two-stage smoothing:
    // Stage 1 — low-pass filter on nTarget (τ≈250ms) removes frame-to-frame jitter
    smoothedTarget += (nTarget - smoothedTarget) * (1 - Math.exp(-dt * 4));
    // Stage 2 — needle follows smoothed target (τ≈167ms), feels physical, not jumpy
    nPos += (smoothedTarget - nPos) * (1 - Math.exp(-dt * 6));
    nPos  = Math.max(0, Math.min(100, nPos));
  }

  /* ─────────────────────────────────────────────
     Lock Sound — short ding on entering green zone
  ───────────────────────────────────────────── */
  function playLockSound() {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;          // A5 — clear, pleasant ding
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.3);
  }

  /* ─────────────────────────────────────────────
     RAF Loop
  ───────────────────────────────────────────── */
  function rafLoop(ts) {
    if (!active) return;
    rafId = requestAnimationFrame(rafLoop);

    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    frameCount++;

    // Run YIN every 3rd frame (~20 fps) — CPU-friendly
    if (frameCount % 3 === 0) {
      analyser.getFloatTimeDomainData(pcmBuf);

      const res = yin(pcmBuf, audioCtx.sampleRate);
      if (res && res.confidence >= CONFIDENCE
               && res.freq >= MIN_FREQ
               && res.freq <= MAX_FREQ) {
        lastDet = freqToNote(medianFreq(res.freq));
      } else {
        lastDet = null;
        freqHistory.length = 0;   // reset median on silence / low confidence
      }

      updateUI(lastDet);
    }

    // Spring physics runs every frame for smooth needle movement
    nTarget = lastDet
      ? 50 + Math.max(-50, Math.min(50, lastDet.cents))
      : 50;
    stepSpring(dt);
    needleEl.style.left = nPos.toFixed(2) + '%';
    centsEl.style.left  = nPos.toFixed(2) + '%';

    // Lock accumulator — based on smoothed needle position every frame.
    // This means: if the needle *looks* in the green zone → light up green.
    const wasLocked = isLocked;
    if (lastDet && Math.abs(nPos - 50) <= LOCK_CENTS) {
      lockCount = Math.min(lockCount + 1, LOCK_FRAMES + 4);
    } else {
      lockCount = Math.max(0, lockCount - 1);
    }
    isLocked = lockCount >= LOCK_FRAMES;

    // Update lock visuals every frame (responsive to needle position)
    lockEl.classList.toggle('visible', isLocked);
    gaugeEl.classList.toggle('locked', isLocked);
    displayEl.classList.toggle('locked', isLocked);
    centsEl.classList.toggle('locked', isLocked);
    needleEl.classList.toggle('locked', isLocked);

    // Play ding exactly once on lock entry
    if (isLocked && !wasLocked) playLockSound();
  }

  /* ─────────────────────────────────────────────
     UI Update
  ───────────────────────────────────────────── */
  // Updates note text only — lock visuals are driven by nPos in the RAF loop
  function updateUI(det) {
    if (!det) {
      noteEl.textContent   = '—';
      octaveEl.textContent = '';
      freqEl.textContent   = '— Hz';
      centsEl.textContent  = '—';
      return;
    }

    noteEl.textContent   = det.name;
    octaveEl.textContent = det.octave;
    freqEl.textContent   = det.freq.toFixed(1) + ' Hz';
    centsEl.textContent  = (det.cents >= 0 ? '+' : '') + det.cents + ' ¢';
  }

  /* ─────────────────────────────────────────────
     Start / Stop
  ───────────────────────────────────────────── */
  async function startTuner() {
    if (active) { stopTuner(); return; }

    try {
      // Use shared audio context if available, else create own
      audioCtx = window.getSharedAudioCtx
        ? window.getSharedAudioCtx()
        : new (window.AudioContext || window.webkitAudioContext)();

      if (audioCtx.state === 'suspended') await audioCtx.resume();

      // Request microphone with tuner-friendly constraints
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation:  false,
          noiseSuppression:  false,
          autoGainControl:   false,
        },
        video: false,
      });

      const source = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize               = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      // NOT connected to destination → no mic playthrough / feedback

      pcmBuf = new Float32Array(FFT_SIZE);

      active     = true;
      frameCount = 0;
      lockCount  = 0;
      isLocked   = false;
      lastDet    = null;
      nPos           = 50;
      nVel           = 0;
      smoothedTarget = 50;
      freqHistory.length = 0;
      lastTs = performance.now();

      startBtn.textContent = 'Stop Tuner';
      startBtn.classList.add('running');

      rafId = requestAnimationFrame(rafLoop);
    } catch (err) {
      console.error('[Tuner]', err);
      alert('Could not access microphone:\n' + err.message);
    }
  }

  function stopTuner() {
    active = false;
    if (rafId)     { cancelAnimationFrame(rafId); rafId = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    analyser = null;

    startBtn.textContent = 'Start Tuner';
    startBtn.classList.remove('running');

    lockCount  = 0;
    isLocked   = false;
    lastDet    = null;
    freqHistory.length = 0;
    nPos = 50; nVel = 0; smoothedTarget = 50;
    needleEl.style.left = '50%';
    updateUI(null);
    lockEl.classList.remove('visible');
    gaugeEl.classList.remove('locked');
    displayEl.classList.remove('locked');
    centsEl.classList.remove('locked');
    needleEl.classList.remove('locked');
  }

  /* ─────────────────────────────────────────────
     Init
  ───────────────────────────────────────────── */
  function init() {
    noteEl    = document.getElementById('tuner-note');
    octaveEl  = document.getElementById('tuner-octave');
    freqEl    = document.getElementById('tuner-freq');
    centsEl   = document.getElementById('tuner-cents');
    lockEl    = document.getElementById('tuner-lock');
    startBtn  = document.getElementById('tuner-start-btn');
    needleEl  = document.getElementById('tuner-needle');
    gaugeEl   = document.getElementById('tuner-gauge');
    displayEl = document.getElementById('tuner-display');

    if (!startBtn) return;

    startBtn.addEventListener('click', startTuner);

    // Stop tuner automatically when navigating away from its tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab !== 'tuner' && active) stopTuner();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
