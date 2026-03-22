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
  const LOCK_CENTS  = 2;     // ±2¢ — only truly in-tune position goes green
  const LOCK_FRAMES = 5;     // 5 YIN frames × ~50ms = 250ms to confirm ±2¢
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

  // Display hold — keeps note + needle visible for up to 5s after silence
  let displayedDet  = null;  // what is currently rendered (may outlive lastDet)
  let holdTimer     = null;  // setTimeout id for the 5s display hold
  let frozenLocked  = false; // lock state captured at silence onset, held during hold

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
    if (rms / N < 5e-4) return null;  // raised: reject fan noise / room hum

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

    // Sub-harmonic check — prevents octave-up errors on D3/G3/B3.
    // For any clean periodic signal, d[2τ] is ALWAYS below threshold (it is a
    // valid period multiple), so checking `d[2τ] < threshold` alone would push
    // every string one octave down. We only switch when the sub-harmonic dip is
    // MEANINGFULLY deeper than the detected dip (≥25% lower d value), which only
    // happens when τ really is a harmonic, not the true fundamental.
    const sh2lo = Math.round(tau * 1.85);
    const sh2hi = Math.min(tauMax, Math.round(tau * 2.15));
    if (sh2lo <= tauMax) {
      let tBest = sh2lo;
      for (let t = sh2lo + 1; t <= sh2hi; t++) {
        if (d[t] < d[tBest]) tBest = t;
      }
      if (d[tBest] < YIN_THRESH && d[tBest] < d[tau] * 0.75) {
        // Sub-harmonic is substantially better — descend to its local minimum
        while (tBest + 1 <= tauMax && d[tBest + 1] < d[tBest]) tBest++;
        tau = tBest;
      }
    }

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
    // Stage 1 — low-pass filter on nTarget (τ≈333ms) removes frame-to-frame jitter
    smoothedTarget += (nTarget - smoothedTarget) * (1 - Math.exp(-dt * 3));
    // Stage 2 — needle follows smoothed target (τ≈250ms), stable but visible
    nPos += (smoothedTarget - nPos) * (1 - Math.exp(-dt * 4));
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

        // New active detection — cancel any hold timer and update display
        if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
        frozenLocked = false;
        displayedDet = lastDet;
        updateUI(displayedDet);

        // Lock accumulator — based on accurate pitch cents (not spring position).
        // Runs at YIN rate (~20fps / 50ms per frame) for fast, accurate response.
        const wasLocked = isLocked;
        if (Math.abs(lastDet.cents) <= LOCK_CENTS) {
          lockCount = Math.min(lockCount + 1, LOCK_FRAMES + 4);
        } else {
          lockCount = Math.max(0, lockCount - 2);  // fast exit when out of tune
        }
        isLocked = lockCount >= LOCK_FRAMES;
        if (isLocked && !wasLocked) playLockSound();

      } else {
        lastDet = null;
        freqHistory.length = 0;   // reset median on silence / low confidence
        lockCount = Math.max(0, lockCount - 1);  // gradual release on silence
        isLocked  = lockCount >= LOCK_FRAMES;

        // Silence — start 5s hold timer if not already running
        if (displayedDet !== null && holdTimer === null) {
          frozenLocked = isLocked;
          holdTimer = setTimeout(() => {
            displayedDet = null;
            frozenLocked = false;
            holdTimer    = null;
            lockCount    = 0;
            updateUI(null);
          }, 5000);
        }
      }
    }

    // Spring physics runs every frame for smooth needle movement
    // Use displayedDet (not lastDet) so needle holds position during the 5s hold
    nTarget = displayedDet
      ? 50 + Math.max(-50, Math.min(50, displayedDet.cents))
      : 50;
    stepSpring(dt);
    needleEl.style.left = nPos.toFixed(2) + '%';
    centsEl.style.left  = nPos.toFixed(2) + '%';

    // Visual lock state: live lock OR frozen lock from hold period
    const showLocked = isLocked || frozenLocked;
    lockEl.classList.toggle('visible', showLocked);
    gaugeEl.classList.toggle('locked', showLocked);
    displayEl.classList.toggle('locked', showLocked);
    centsEl.classList.toggle('locked', showLocked);
    needleEl.classList.toggle('locked', showLocked);
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
    if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    displayedDet = null;
    frozenLocked = false;
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
