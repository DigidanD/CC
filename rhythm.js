'use strict';

(function () {

  /* ─────────────────────────────────────────────
     Swing Feel Tables
     Ratios within a beat for each 16th-note step
  ───────────────────────────────────────────── */
  const FEEL_TABLE = {
    straight: [0,     0.25,  0.5,   0.75],
    shuffle:  [0,     0.167, 0.667, 0.833],
    swing:    [0,     0.208, 0.583, 0.792],
  };

  // Duration from step s to next step (as fraction of beatDuration)
  function stepDurationRatio(step, totalSteps, feel) {
    const s    = step % 4;
    const next = (step + 1) % totalSteps;
    const ns   = next % 4;
    const tbl  = FEEL_TABLE[feel] || FEEL_TABLE.straight;
    if (ns === 0) return 1 - tbl[s];      // last step in beat → to beat boundary
    return tbl[ns] - tbl[s];
  }

  /* ─────────────────────────────────────────────
     Pattern Definitions  (16 steps = 1 bar 4/4)
  ───────────────────────────────────────────── */
  const P = (name, cat, bpm, kick, snare, hh, feel) =>
    ({ name, cat, bpm, kick, snare, hh, feel: feel || 'straight', steps: kick.length });

  const PATTERNS = [
    // ── Rock ──
    P('Rock Basic',    'Rock',  120,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]),

    P('Rock Shuffle',  'Rock',  120,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], 'shuffle'),

    P('Hard Rock',     'Rock',  130,
      [1,0,1,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]),

    P('70s Rock',      'Rock',  110,
      [1,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]),

    P('Power Ballad',  'Rock',   70,
      [1,0,1,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]),

    // ── Blues ──
    P('Blues Shuffle', 'Blues',  90,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], 'shuffle'),

    P('Slow Blues',    'Blues',  60,
      [1,0,0,1, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], 'shuffle'),

    P('Blues Boogie',  'Blues', 120,
      [1,0,1,0, 1,0,0,0, 1,0,1,0, 1,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], 'shuffle'),

    P('12-Bar Blues',  'Blues', 100,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,1,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]),

    // ── Jazz ──
    P('Jazz Swing',    'Jazz',  140,
      [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,1,1, 0,0,1,0, 1,0,1,1, 0,0,1,0], 'swing'),

    P('Jazz Waltz',    'Jazz',  160,
      [1,0,0, 0,0,0, 0,0,0, 0,0,0].slice(0,12),
      [0,0,0, 1,0,0, 0,0,0, 1,0,0].slice(0,12),
      [1,0,1, 0,1,0, 1,0,1, 0,1,0].slice(0,12), 'swing'),

    P('Bebop',         'Jazz',  180,
      [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,1, 1,0,0,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], 'swing'),

    P('Cool Jazz',     'Jazz',  120,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0], 'swing'),

    // ── Funk ──
    P('Funk Basic',    'Funk',  100,
      [1,0,0,1, 0,0,0,0, 1,0,0,0, 0,1,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]),

    P('Funk 16th',     'Funk',  110,
      [1,0,1,0, 0,1,0,0, 1,0,0,1, 0,0,1,0],
      [0,0,0,0, 1,0,1,0, 0,0,0,0, 1,0,1,0],
      [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]),

    P('Groove Funk',   'Funk',   95,
      [1,0,0,0, 1,0,1,0, 0,0,0,0, 0,1,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]),

    // ── Latin ──
    P('Bossa Nova',    'Latin', 130,
      [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
      [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]),

    P('Samba',         'Latin', 145,
      [1,0,0,0, 0,1,0,0, 1,0,0,0, 0,1,0,0],
      [0,0,1,0, 1,0,0,1, 0,0,1,0, 1,0,0,1],
      [1,1,0,1, 1,1,0,1, 1,1,0,1, 1,1,0,1]),

    P('Cha-Cha',       'Latin', 120,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 1,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,1,0,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]),

    P('Mambo',         'Latin', 150,
      [1,0,0,1, 0,0,1,0, 0,1,0,0, 0,0,1,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]),

    P('Rumba',         'Latin', 100,
      [1,0,0,1, 0,0,0,0, 0,1,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]),

    // ── Other ──
    P('Reggae',        'Other',  80,
      [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0]),

    P('Country',       'Other', 120,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]),

    P('R&B',           'Other',  90,
      [1,0,0,1, 0,0,0,0, 1,0,0,0, 0,1,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]),

    P('Pop Ballad',    'Other',  75,
      [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]),
  ];

  /* ─────────────────────────────────────────────
     State
  ───────────────────────────────────────────── */
  const rb = {
    isPlaying:         false,
    currentStep:       0,
    nextStepTime:      0,
    timerID:           null,
    pattern:           PATTERNS[0],
    feel:              'straight',
    volume:            0.8,
    bpm:               120,
    countInRemaining:  0,
    countInBeat:       4,
    pendingFlashes:    [],
    rafRunning:        false,
    barCount:          0,
    currentFill:       null,
  };

  /* ─────────────────────────────────────────────
     Audio Context
  ───────────────────────────────────────────── */
  let rbNoiseBuffer = null;

  function getCtx() {
    return window.getSharedAudioCtx ? window.getSharedAudioCtx() :
      new (window.AudioContext || window.webkitAudioContext)();
  }

  function getNoiseBuffer() {
    if (!rbNoiseBuffer) {
      const ctx = getCtx();
      const len = Math.ceil(ctx.sampleRate * 0.5);
      rbNoiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = rbNoiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return rbNoiseBuffer;
  }

  /* ─────────────────────────────────────────────
     Humanization helper  (±amt seconds/amplitude)
  ───────────────────────────────────────────── */
  function humanize(amt) {
    return (Math.random() - 0.5) * 2 * amt;
  }

  /* ─────────────────────────────────────────────
     Fill Patterns
     Each fill applies from step `from` to end of bar.
     Arrays cover the steps from `from` to 15.
  ───────────────────────────────────────────── */
  const FILLS = [
    // Classic snare roll (beats 3–4)
    { from: 8,
      kick:  [0,0,0,0, 0,0,0,1],
      snare: [1,0,1,1, 1,1,1,0],
      hh:    [0,0,0,0, 0,0,0,0] },
    // Crash fill – descending snare over two beats
    { from: 8,
      kick:  [0,0,1,0, 0,0,0,0],
      snare: [1,1,0,1, 1,1,1,1],
      hh:    [0,0,0,0, 0,0,0,0] },
    // Quick punch – last beat only
    { from: 12,
      kick:  [0,0,1,0],
      snare: [1,1,0,1],
      hh:    [0,0,0,0] },
    // Snare flutter with kick accent
    { from: 8,
      kick:  [0,0,0,0, 0,0,0,0],
      snare: [0,1,1,0, 1,1,0,1],
      hh:    [0,0,0,0, 0,0,0,0] },
  ];

  /* ─────────────────────────────────────────────
     Drum Sounds
  ───────────────────────────────────────────── */
  function playKick(ctx, time, vol) {
    // Body: sine sweep for deep thump
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(185, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.15);
    gain.gain.setValueAtTime(vol * 1.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(time); osc.stop(time + 0.36);

    // Click transient: short noise burst for beater attack
    const click = ctx.createBufferSource();
    click.buffer = getNoiseBuffer();
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 3500 + Math.random() * 1200;
    bpf.Q.value = 0.5;
    const cGain = ctx.createGain();
    cGain.gain.setValueAtTime(vol * 0.85, time);
    cGain.gain.exponentialRampToValueAtTime(0.001, time + 0.013);
    click.connect(bpf); bpf.connect(cGain); cGain.connect(ctx.destination);
    click.start(time); click.stop(time + 0.016);
  }

  function playSnare(ctx, time, vol) {
    // Body: low pitched oscillator for snare "crack" body
    const body = ctx.createOscillator();
    body.type  = 'triangle';
    const bodyGain = ctx.createGain();
    body.frequency.setValueAtTime(200, time);
    body.frequency.exponentialRampToValueAtTime(130, time + 0.05);
    bodyGain.gain.setValueAtTime(vol * 0.75, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.065);
    body.connect(bodyGain); bodyGain.connect(ctx.destination);
    body.start(time); body.stop(time + 0.07);

    // Snare rattle: bandpass noise (snare wires)
    const src  = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const bpf  = ctx.createBiquadFilter();
    bpf.type   = 'bandpass';
    bpf.frequency.value = 2200;
    bpf.Q.value = 0.65;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vol * 1.55, time);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    src.connect(bpf); bpf.connect(nGain); nGain.connect(ctx.destination);
    src.start(time); src.stop(time + 0.14);

    // High crack: highpass transient for snap
    const crack = ctx.createBufferSource();
    crack.buffer = getNoiseBuffer();
    const hpf   = ctx.createBiquadFilter();
    hpf.type    = 'highpass';
    hpf.frequency.value = 5500 + Math.random() * 1000;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(vol * 0.55, time);
    crackGain.gain.exponentialRampToValueAtTime(0.001, time + 0.032);
    crack.connect(hpf); hpf.connect(crackGain); crackGain.connect(ctx.destination);
    crack.start(time); crack.stop(time + 0.038);
  }

  function playGhostSnare(ctx, time, vol) {
    // Whisper-soft snare hit — adds groove without drawing attention
    const src  = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const bpf  = ctx.createBiquadFilter();
    bpf.type   = 'bandpass';
    bpf.frequency.value = 2000;
    bpf.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.13, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.038);
    src.connect(bpf); bpf.connect(g); g.connect(ctx.destination);
    src.start(time); src.stop(time + 0.045);
  }

  function playHH(ctx, time, vol, open) {
    // Multi-resonance metallic character (real cymbals have multiple resonant modes)
    const src  = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();

    const bands = open
      ? [[3000, 5], [5500, 8], [8500, 10], [11500, 7]]
      : [[4200, 7], [6800, 10], [10000, 13], [13500, 8]];
    const baseDecay = open ? 0.26 : 0.044;

    bands.forEach(([freq, Q], i) => {
      const bpf = ctx.createBiquadFilter();
      bpf.type  = 'bandpass';
      bpf.frequency.value = freq + humanize(freq * 0.015); // slight pitch variation
      bpf.Q.value = Q;
      const amp = vol * (0.55 - i * 0.09);
      if (amp <= 0) return;
      const decay = Math.max(0.01, baseDecay * (1 - i * 0.06));
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + decay);
      src.connect(bpf); bpf.connect(g); g.connect(ctx.destination);
    });

    src.start(time);
    src.stop(time + (open ? 0.32 : 0.08));
  }

  /* ─────────────────────────────────────────────
     Scheduler
  ───────────────────────────────────────────── */
  const SCHED_AHEAD  = 0.1;
  const SCHED_INTVAL = 25;

  function scheduler() {
    const ctx = getCtx();
    while (rb.nextStepTime < ctx.currentTime + SCHED_AHEAD) {
      if (rb.countInRemaining > 0) {
        scheduleCountInBeat(rb.nextStepTime);
        advanceCountIn();
      } else {
        scheduleStep(rb.currentStep, rb.nextStepTime);
        advanceStep();
      }
    }
  }

  function scheduleCountInBeat(time) {
    const beatNum = rb.countInBeat - rb.countInRemaining + 1;
    // Click sound for count-in (use shared metronome sounds via shared ctx)
    playHH(getCtx(), time, rb.volume * 0.7, false);
    rb.pendingFlashes.push({ time, isCountIn: true, countNum: beatNum });
  }

  function advanceCountIn() {
    const beatDur = 60.0 / rb.bpm;
    rb.nextStepTime += beatDur;
    rb.countInRemaining--;
  }

  // Timing jitter (±ms) and velocity jitter (± fraction)
  const TIMING_JITTER = 0.007;
  const VEL_JITTER    = 0.12;

  function scheduleStep(step, time) {
    const ctx = getCtx();
    const pat = rb.pattern;
    const vol = rb.volume;

    // Resolve whether this step uses a fill override
    const fill     = rb.currentFill;
    const useFill  = fill && step >= fill.from;
    const fi       = useFill ? step - fill.from : 0;
    const kickOn   = useFill ? fill.kick[fi]  : pat.kick[step];
    const snareOn  = useFill ? fill.snare[fi] : pat.snare[step];
    const hhOn     = useFill ? fill.hh[fi]    : pat.hh[step];

    if (kickOn) {
      const t = time + humanize(TIMING_JITTER * 0.5);
      const v = Math.max(0.25, vol * (1 + humanize(VEL_JITTER * 0.5)));
      playKick(ctx, t, v);
    }

    if (snareOn) {
      const t = time + humanize(TIMING_JITTER);
      const v = Math.max(0.2, vol * 0.9 * (1 + humanize(VEL_JITTER)));
      playSnare(ctx, t, v);
    }

    if (hhOn) {
      // Beat-position accent: on-beat louder, off-beats quieter — like a real drummer
      const beatPos     = step % 4;
      const accentFactor = beatPos === 0 ? 1.0 : (beatPos === 2 ? 0.78 : 0.58);
      const t = time + humanize(TIMING_JITTER * 1.5);
      const v = Math.max(0.08, vol * 0.65 * accentFactor * (1 + humanize(VEL_JITTER * 1.5)));
      playHH(ctx, t, v, false);
    }

    // Ghost snare: ~13% chance on empty 16th positions (not during fills)
    if (!useFill && !snareOn && !kickOn && Math.random() < 0.13) {
      const t = time + humanize(TIMING_JITTER * 2);
      playGhostSnare(ctx, t, vol);
    }

    rb.pendingFlashes.push({
      time,
      step,
      kick:  !!kickOn,
      snare: !!snareOn,
      hh:    !!hhOn,
    });
  }

  function advanceStep() {
    const total   = rb.pattern.steps;
    const beatDur = 60.0 / rb.bpm;
    const ratio   = stepDurationRatio(rb.currentStep, total, rb.feel);
    rb.nextStepTime += ratio * beatDur;
    rb.currentStep   = (rb.currentStep + 1) % total;

    // At bar wrap: count bars and arm fill for every 4th bar
    if (rb.currentStep === 0) {
      rb.barCount++;
      rb.currentFill = (rb.barCount % 4 === 3)
        ? FILLS[Math.floor(Math.random() * FILLS.length)]
        : null;
    }
  }

  /* ─────────────────────────────────────────────
     Playback Control
  ───────────────────────────────────────────── */
  function startRhythm() {
    const ctx = getCtx();
    ctx.resume();
    rb.isPlaying        = true;
    rb.currentStep      = 0;
    rb.nextStepTime     = ctx.currentTime + 0.05;
    rb.pendingFlashes   = [];
    rb.countInBeat      = 4;
    rb.countInRemaining = 4;
    rb.barCount         = 0;
    rb.currentFill      = null;

    rb.timerID = setInterval(scheduler, SCHED_INTVAL);
    if (!rb.rafRunning) { rb.rafRunning = true; requestAnimationFrame(rafLoop); }
  }

  function stopRhythm() {
    rb.isPlaying        = false;
    rb.countInRemaining = 0;
    clearInterval(rb.timerID);
    rb.timerID        = null;
    rb.pendingFlashes  = [];
    clearStepVisuals();
    updatePlayBtn(false);
    hideCountIn();
  }

  /* ─────────────────────────────────────────────
     RAF Visual Loop
  ───────────────────────────────────────────── */
  function rafLoop() {
    if (!window.getSharedAudioCtx) { rb.rafRunning = false; return; }
    const ctx = getCtx();
    const now = ctx.currentTime;

    rb.pendingFlashes = rb.pendingFlashes.filter(flash => {
      if (flash.time <= now) {
        if (flash.isCountIn) {
          showCountIn(flash.countNum);
        } else {
          updateStepVisuals(flash.step, flash.kick, flash.snare, flash.hh);
        }
        return false;
      }
      return true;
    });

    if (rb.isPlaying || rb.pendingFlashes.length > 0) {
      requestAnimationFrame(rafLoop);
    } else {
      rb.rafRunning = false;
      hideCountIn();
    }
  }

  /* ─────────────────────────────────────────────
     Count-In Visual
  ───────────────────────────────────────────── */
  const rbCountInDisplay = document.getElementById('rb-count-in-display');
  const rbCountInNum     = document.getElementById('rb-count-in-num');

  function showCountIn(num) {
    const beatMs = 60000 / rb.bpm;
    document.documentElement.style.setProperty('--count-beat-dur', Math.min(beatMs * 0.88, 700) + 'ms');
    rbCountInDisplay.classList.add('active');
    rbCountInNum.textContent = num;
    rbCountInNum.classList.remove('popping');
    void rbCountInNum.offsetWidth;
    rbCountInNum.classList.add('popping');
  }

  function hideCountIn() {
    rbCountInDisplay.classList.remove('active');
  }

  /* ─────────────────────────────────────────────
     Step Visuals
  ───────────────────────────────────────────── */
  let stepEls    = [];   // rb-step dots
  let kickEls    = [];
  let snareEls   = [];
  let hhEls      = [];
  let kickLabel, snareLabel, hhLabel;
  let lastStep   = -1;

  function buildVisualizer() {
    const pat   = rb.pattern;
    const total = pat.steps;

    // Step track
    const track = document.getElementById('rb-step-track');
    track.innerHTML = '';
    stepEls = [];
    for (let i = 0; i < total; i++) {
      const el = document.createElement('div');
      el.className = 'rb-step' + (i % 4 === 0 ? ' beat-start' : '');
      track.appendChild(el);
      stepEls.push(el);
    }

    // Instrument rows
    const rows = document.getElementById('rb-instr-rows');
    rows.innerHTML = '';
    kickEls = []; snareEls = []; hhEls = [];

    [['KICK', pat.kick, kickEls], ['SNARE', pat.snare, snareEls], ['HH', pat.hh, hhEls]]
      .forEach(([name, arr, els]) => {
        const row   = document.createElement('div');
        row.className = 'rb-instr-row';
        const label = document.createElement('span');
        label.className = 'rb-instr-label';
        label.textContent = name;
        if (name === 'KICK')  kickLabel  = label;
        if (name === 'SNARE') snareLabel = label;
        if (name === 'HH')    hhLabel    = label;
        const steps = document.createElement('div');
        steps.className = 'rb-instr-steps';
        for (let i = 0; i < total; i++) {
          const s = document.createElement('div');
          s.className = 'rb-instr-step' + (arr[i] ? ' on' : '');
          steps.appendChild(s);
          els.push(s);
        }
        row.appendChild(label);
        row.appendChild(steps);
        rows.appendChild(row);
      });
  }

  function updateStepVisuals(step, kick, snare, hh) {
    // Clear previous
    if (lastStep >= 0 && lastStep < stepEls.length) {
      stepEls[lastStep].classList.remove('current');
      if (kickEls[lastStep])  kickEls[lastStep].classList.remove('current');
      if (snareEls[lastStep]) snareEls[lastStep].classList.remove('current');
      if (hhEls[lastStep])    hhEls[lastStep].classList.remove('current');
    }
    lastStep = step;

    // Set current step
    if (stepEls[step]) stepEls[step].classList.add('current');
    if (kickEls[step] && kickEls[step].classList.contains('on'))
      kickEls[step].classList.add('current');
    if (snareEls[step] && snareEls[step].classList.contains('on'))
      snareEls[step].classList.add('current');
    if (hhEls[step] && hhEls[step].classList.contains('on'))
      hhEls[step].classList.add('current');

    // Flash instrument labels
    flashLabel(kickLabel,  kick);
    flashLabel(snareLabel, snare);
    flashLabel(hhLabel,    hh);
  }

  function flashLabel(el, hit) {
    if (!el) return;
    el.classList.remove('hit');
    if (hit) { void el.offsetWidth; el.classList.add('hit'); }
  }

  function clearStepVisuals() {
    stepEls.forEach(e => e.classList.remove('current'));
    kickEls.forEach(e => e.classList.remove('current'));
    snareEls.forEach(e => e.classList.remove('current'));
    hhEls.forEach(e => e.classList.remove('current'));
    if (kickLabel)  kickLabel.classList.remove('hit');
    if (snareLabel) snareLabel.classList.remove('hit');
    if (hhLabel)    hhLabel.classList.remove('hit');
    lastStep = -1;
  }

  /* ─────────────────────────────────────────────
     Pattern Grid
  ───────────────────────────────────────────── */
  function buildPatternGrid(cat) {
    const grid = document.getElementById('pattern-grid');
    grid.innerHTML = '';
    const filtered = cat === 'all' ? PATTERNS : PATTERNS.filter(p => p.cat === cat);
    filtered.forEach(pat => {
      const card = document.createElement('div');
      card.className = 'pattern-card' + (pat === rb.pattern ? ' active' : '');
      card.innerHTML =
        `<div class="pattern-card-name">${pat.name}</div>` +
        `<div class="pattern-card-bpm">${pat.bpm} BPM · ${pat.feel}</div>`;
      card.addEventListener('click', () => selectPattern(pat));
      grid.appendChild(card);
    });
  }

  function selectPattern(pat) {
    rb.pattern = pat;
    rb.feel    = pat.feel;
    // Update feel buttons
    document.querySelectorAll('#feel-group .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.feel === pat.feel);
    });
    // Update header
    document.getElementById('rhythm-pattern-name').textContent = pat.name;
    document.getElementById('rhythm-pattern-cat').textContent  = pat.cat;
    // Rebuild visualizer
    buildVisualizer();
    // Update BPM display from pattern suggestion
    syncBpmFromPattern(pat.bpm);
    // Update active card
    document.querySelectorAll('.pattern-card').forEach(c => {
      c.classList.toggle('active', c.querySelector('.pattern-card-name').textContent === pat.name);
    });
    if (rb.isPlaying) {
      rb.currentStep  = 0;
      rb.pendingFlashes = [];
      rb.barCount     = 0;
      rb.currentFill  = null;
    }
  }

  function syncBpmFromPattern(bpm) {
    const bpmInput = document.getElementById('bpm-input');
    if (bpmInput) {
      bpmInput.value = bpm;
      bpmInput.dispatchEvent(new Event('change'));
    }
    rb.bpm = bpm;
  }

  /* ─────────────────────────────────────────────
     Play Button
  ───────────────────────────────────────────── */
  function updatePlayBtn(playing) {
    const btn = document.getElementById('rb-play-btn');
    if (!btn) return;
    btn.classList.toggle('running', playing);
    btn.querySelector('.btn-label').textContent  = playing ? 'STOP' : 'START';
    btn.querySelector('.play-icon').style.display  = playing ? 'none' : '';
    btn.querySelector('.pause-icon').style.display = playing ? '' : 'none';
  }

  /* ─────────────────────────────────────────────
     Event Listeners
  ───────────────────────────────────────────── */
  // BPM sync from metronome tab
  document.addEventListener('bpm-change', e => {
    rb.bpm = e.detail.bpm;
  });

  // Play button
  document.getElementById('rb-play-btn').addEventListener('click', () => {
    if (rb.isPlaying) {
      stopRhythm();
    } else {
      rb.bpm = Number(document.getElementById('bpm-input').value) || 120;
      startRhythm();
      updatePlayBtn(true);
    }
  });

  // Category filter
  document.getElementById('cat-filter').addEventListener('click', e => {
    const btn = e.target.closest('.cat-btn');
    if (!btn) return;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    buildPatternGrid(btn.dataset.cat);
  });

  // Tempo feel
  document.getElementById('feel-group').addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    document.querySelectorAll('#feel-group .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    rb.feel = btn.dataset.feel;
  });

  // Volume
  document.getElementById('rb-volume').addEventListener('input', e => {
    rb.volume = Number(e.target.value) / 100;
    const pct = e.target.value + '%';
    e.target.style.setProperty('--slider-pct', pct);
  });

  /* ─────────────────────────────────────────────
     Init
  ───────────────────────────────────────────── */
  buildPatternGrid('all');
  buildVisualizer();
  rb.bpm = Number(document.getElementById('bpm-input').value) || 120;

})();
