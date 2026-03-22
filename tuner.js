(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     Constants
  ───────────────────────────────────────────── */
  const NOTE_NAMES  = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const A4_FREQ     = 440;
  const A4_MIDI     = 69;
  const MIN_FREQ    = 65;    // Hz — E2=82Hz is lowest guitar string; 65 caps tauMax
                             //       at 678 so A2(τ≈401) sub-harmonic check cannot
                             //       reach A1(τ≈802), preventing octave-down errors.
  const MAX_FREQ    = 2000;  // Hz — above this rarely needed
  const CONFIDENCE  = 0.92;  // minimum YIN confidence (raised: rejects noise peaks)
  const YIN_THRESH  = 0.15;  // YIN cumulative-mean threshold
  const MEDIAN_N    = 7;     // median-filter window size (7 × ~50ms = 350ms history)
  const AMP_THRESH  = 0.02;  // RMS amplitude floor — below this = silence, freeze UI
  const LOCK_CENTS   = 2;    // ±2¢ — only truly in-tune position goes green
  const TRANSIENT_MS = 180;  // ms to ignore after note onset (attack harmonics settle)
  const STABILITY_N  = 8;    // all 8 consecutive ±2¢ readings (~400ms) required for green
  const FFT_SIZE     = 4096; // analyser fftSize → time-domain buffer length

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
  let lastTs         = 0;

  // Smoothing & lock state
  const freqHistory  = [];
  let frameCount     = 0;
  let isLocked       = false;
  let lastDet        = null;  // last FreqToNote result, or null
  let attackTime     = 0;     // performance.now() at note onset; transient window starts here
  const centsWindow  = [];    // rolling STABILITY_N cents readings; all must be ±LOCK_CENTS

  // Display hold — keeps note + needle visible for up to 5s after silence
  let displayedDet    = null;  // what is currently rendered (may outlive lastDet)
  let holdTimer       = null;  // setTimeout id for the 5s display hold
  let frozenLocked    = false; // lock state captured at silence onset, held during hold
  let lastInTuneBeep  = 0;     // performance.now() of last in-tune beep; 2s cooldown

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

    // Reject silence / background noise — compute true RMS and compare to AMP_THRESH
    let sumSq = 0;
    for (let i = 0; i < N; i++) sumSq += signal[i] * signal[i];
    if (Math.sqrt(sumSq / N) < AMP_THRESH) return null;

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
      if (d[tBest] < YIN_THRESH && d[tBest] < d[tau] * 0.6) {
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
    // Flush history when frequency jumps by more than ~3 semitones (factor 1.19).
    // Prevents a transient octave-detection error from contaminating the median
    // for the full 450ms window when jumping between strings.
    if (freqHistory.length > 0) {
      const prev = freqHistory[freqHistory.length - 1];
      const ratio = f / prev;
      if (ratio < 0.84 || ratio > 1.19) freqHistory.length = 0;
    }
    freqHistory.push(f);
    if (freqHistory.length > MEDIAN_N) freqHistory.shift();
    const s = [...freqHistory].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /* ─────────────────────────────────────────────
     Frequency → Note
  ───────────────────────────────────────────── */
  function freqToNote(freq) {
    const midi     = 12 * Math.log2(freq / A4_FREQ) + A4_MIDI;
    const midiR    = Math.round(midi);
    const centsRaw = (midi - midiR) * 100;       // float — used for lock & needle
    const cents    = Math.round(centsRaw);        // integer — used for display only
    const name     = NOTE_NAMES[((midiR % 12) + 12) % 12];
    const octave   = Math.floor(midiR / 12) - 1;
    return { name, octave, cents, centsRaw, freq };
  }

  /* ─────────────────────────────────────────────
     Spring Physics (needle lerp)
  ───────────────────────────────────────────── */
  function stepSpring(dt, hasSignal) {
    const target = hasSignal ? nTarget : 50;
    const alpha  = hasSignal ? 0.15 : 0.04;  // 0.15 → weighted physical-tuner feel
    nPos += (target - nPos) * alpha;
    nPos  = Math.max(0, Math.min(100, nPos));
  }

  /* ─────────────────────────────────────────────
     Lock Sound — short ding on entering green zone
  ───────────────────────────────────────────── */
  function playLockSound() {
    if (!audioCtx) return;
    // 2-second cooldown: same note may not re-beep within 2s
    const now = performance.now();
    if (now - lastInTuneBeep < 2000) return;
    lastInTuneBeep = now;

    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = 1046.5;       // C6 — bright, short confirmation tone
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.08);
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
        const prevDet = lastDet;
        lastDet = freqToNote(medianFreq(res.freq));

        // New active detection — cancel any hold timer and update display
        if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
        frozenLocked = false;
        displayedDet = lastDet;
        updateUI(displayedDet);

        // Transient rejection: reset window on note onset (silence → sound)
        if (prevDet === null) {
          attackTime = performance.now();
          centsWindow.length = 0;
        }

        // Stability gate: only accumulate readings after the 180ms attack window
        const wasLocked = isLocked;
        if (performance.now() - attackTime >= TRANSIENT_MS) {
          centsWindow.push(lastDet.centsRaw);
          if (centsWindow.length > STABILITY_N) centsWindow.shift();
        }
        // Green only when all STABILITY_N readings are within ±LOCK_CENTS
        isLocked = centsWindow.length === STABILITY_N &&
                   centsWindow.every(c => Math.abs(c) <= LOCK_CENTS);
        if (isLocked && !wasLocked) playLockSound();

      } else {
        lastDet            = null;
        freqHistory.length = 0;   // reset median on silence / low confidence
        centsWindow.length = 0;   // silence clears the stability window
        attackTime         = 0;
        isLocked           = false;

        // Silence — start 5s hold timer if not already running
        if (displayedDet !== null && holdTimer === null) {
          frozenLocked = isLocked;
          holdTimer = setTimeout(() => {
            displayedDet       = null;
            frozenLocked       = false;
            holdTimer          = null;
            centsWindow.length = 0;
            updateUI(null);
          }, 5000);
        }
      }
    }

    // Spring physics runs every frame for smooth needle movement
    // Use displayedDet (not lastDet) so needle holds position during the 5s hold
    nTarget = displayedDet
      ? 50 + Math.max(-50, Math.min(50, displayedDet.centsRaw))
      : 50;
    stepSpring(dt, displayedDet !== null);
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

      active             = true;
      frameCount         = 0;
      centsWindow.length = 0;
      attackTime         = 0;
      isLocked           = false;
      lastDet            = null;
      nPos           = 50;
      nVel           = 0;
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
    displayedDet   = null;
    frozenLocked   = false;
    lastInTuneBeep = 0;
    freqHistory.length = 0;
    nPos = 50; nVel = 0;
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
