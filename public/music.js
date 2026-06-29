// Couch Pack Music Engine - synthesized procedural music using Web Audio API
// No audio files needed. Each game gets a distinct loop.
(function(){
  let ctx = null;
  let masterGain = null;
  let currentLoop = null;
  let loopTimers = [];
  let enabled = true;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(ctx.destination);
  }

  // Note frequencies
  const N = {
    C2:65.41,D2:73.42,E2:82.41,F2:87.31,G2:98,A2:110,B2:123.47,
    C3:130.81,D3:146.83,E3:164.81,F3:174.61,G3:196,A3:220,B3:246.94,
    C4:261.63,D4:293.66,E4:329.63,F4:349.23,G4:392,A4:440,B4:493.88,
    C5:523.25,D5:587.33,E5:659.25,F5:698.46,G5:783.99,A5:880
  };

  function playNote(freq, time, dur, type, gain, glide) {
    if (!ctx || !enabled) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, time);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, time + dur);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain || 0.3, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g); g.connect(masterGain);
    osc.start(time); osc.stop(time + dur);
  }

  function playDrum(time, type) {
    if (!ctx || !enabled) return;
    if (type === 'kick') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
      g.gain.setValueAtTime(0.6, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      osc.connect(g); g.connect(masterGain);
      osc.start(time); osc.stop(time + 0.15);
    } else if (type === 'hat') {
      const bufferSize = ctx.sampleRate * 0.05;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
      noise.connect(hp); hp.connect(g); g.connect(masterGain);
      noise.start(time); noise.stop(time + 0.05);
    } else if (type === 'snare') {
      const bufferSize = ctx.sampleRate * 0.1;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      noise.connect(g); g.connect(masterGain);
      noise.start(time); noise.stop(time + 0.1);
    }
  }

  // Song definitions: each returns a function that schedules one bar
  const SONGS = {
    // Lobby - chill upbeat
    lobby: { bpm: 110, bass:[N.C2,N.C2,N.G2,N.A2], lead:[N.E4,N.G4,N.C5,N.G4,N.A4,N.G4,N.E4,0], type:'triangle' },
    // Punchline - playful, bouncy
    punchline: { bpm: 124, bass:[N.F2,N.F2,N.C3,N.A2], lead:[N.C5,0,N.A4,N.F4,N.G4,0,N.C5,N.D5], type:'square' },
    // Bluff - sneaky, mysterious
    bluff: { bpm: 100, bass:[N.D2,N.D2,N.F2,N.A2], lead:[N.A4,N.F4,N.D4,N.F4,N.A4,0,N.G4,0], type:'sawtooth' },
    // Scrawl - light, creative
    scrawl: { bpm: 116, bass:[N.G2,N.G2,N.D3,N.E3], lead:[N.G4,N.B4,N.D5,N.B4,N.A4,N.G4,0,N.E4], type:'triangle' },
    // Trivia - tense quiz show
    trivia: { bpm: 130, bass:[N.E2,N.E2,N.E2,N.B2], lead:[N.E5,N.E5,0,N.B4,N.E5,0,N.G5,0], type:'square' },
    // PollMine - groovy
    pollmine: { bpm: 112, bass:[N.A2,N.A2,N.E3,N.D3], lead:[N.A4,N.C5,N.E5,N.C5,N.D5,0,N.A4,0], type:'triangle' },
    // Mafia - dark, tense
    mafia: { bpm: 88, bass:[N.C2,N.C2,N.C2,N.G2], lead:[N.C4,0,N.E4,0,N.G4,0,N.B4,0], type:'sawtooth' },
    // MindMeld - dreamy
    mindmeld: { bpm: 104, bass:[N.F2,N.A2,N.C3,N.A2], lead:[N.C5,N.E5,N.G5,N.E5,N.F5,N.C5,0,0], type:'triangle' },
    // HotTake - punchy
    hottake: { bpm: 128, bass:[N.E2,N.E2,N.G2,N.A2], lead:[N.E5,0,N.E5,N.G5,N.A5,0,N.E5,0], type:'square' },
    // Voltage - fast electric
    voltage: { bpm: 140, bass:[N.A2,N.A2,N.A2,N.A2], lead:[N.A4,N.E5,N.A5,N.E5,N.A4,N.E5,N.A5,N.E5], type:'sawtooth' },
    // Mole - sneaky spy
    mole: { bpm: 96, bass:[N.D2,N.D2,N.A2,N.F2], lead:[N.D4,N.F4,N.A4,0,N.F4,N.D4,0,0], type:'sawtooth' },
    // Psychic - ethereal
    psychic: { bpm: 92, bass:[N.A2,N.C3,N.E3,N.C3], lead:[N.A4,N.C5,N.E5,N.A5,N.E5,N.C5,0,0], type:'sine' },
    // Copycat - quirky
    copycat: { bpm: 118, bass:[N.G2,N.G2,N.C3,N.D3], lead:[N.G4,N.A4,N.B4,N.D5,N.B4,N.G4,0,0], type:'triangle' },
    // Stampede - high energy racing
    stampede: { bpm: 150, bass:[N.C2,N.C2,N.C2,N.G2], lead:[N.C5,N.G4,N.C5,N.E5,N.G5,N.E5,N.C5,N.G4], type:'square' },
  };

  function startSong(name) {
    init();
    if (ctx.state === 'suspended') ctx.resume();
    stopSong();
    const song = SONGS[name] || SONGS.lobby;
    currentLoop = name;
    const beatDur = 60 / song.bpm;
    const barDur = beatDur * 4;
    let bar = 0;

    function scheduleBar() {
      if (currentLoop !== name) return;
      const now = ctx.currentTime;
      const start = now + 0.05;

      // Bass - one note per beat
      song.bass.forEach((freq, i) => {
        if (freq) playNote(freq, start + i * beatDur, beatDur * 0.9, 'triangle', 0.35);
      });

      // Lead - eighth notes
      song.lead.forEach((freq, i) => {
        if (freq) playNote(freq, start + i * (beatDur/2), beatDur * 0.45, song.type, 0.18);
      });

      // Drums
      for (let b = 0; b < 4; b++) {
        playDrum(start + b * beatDur, b % 2 === 0 ? 'kick' : 'snare');
        playDrum(start + b * beatDur + beatDur/2, 'hat');
      }

      bar++;
      const t = setTimeout(scheduleBar, barDur * 1000);
      loopTimers.push(t);
    }
    scheduleBar();
  }

  function stopSong() {
    currentLoop = null;
    loopTimers.forEach(t => clearTimeout(t));
    loopTimers = [];
  }

  // Sound effects
  function sfx(name) {
    init();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    if (name === 'correct') {
      playNote(N.C5, now, 0.1, 'square', 0.3);
      playNote(N.E5, now+0.08, 0.1, 'square', 0.3);
      playNote(N.G5, now+0.16, 0.2, 'square', 0.3);
    } else if (name === 'wrong') {
      playNote(N.E4, now, 0.15, 'sawtooth', 0.3, N.C4);
    } else if (name === 'tick') {
      playNote(N.A5, now, 0.05, 'square', 0.15);
    } else if (name === 'win') {
      [N.C5,N.E5,N.G5,N.C5].forEach((f,i)=>playNote(f, now+i*0.12, 0.3, 'square', 0.3));
    } else if (name === 'pop') {
      playNote(N.G5, now, 0.08, 'sine', 0.25, N.C5);
    } else if (name === 'whoosh') {
      playNote(N.C3, now, 0.2, 'sawtooth', 0.2, N.C5);
    } else if (name === 'reveal') {
      playNote(N.G4, now, 0.15, 'triangle', 0.25);
      playNote(N.C5, now+0.1, 0.25, 'triangle', 0.25);
    }
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) stopSong();
  }

  function setVolume(v) {
    if (masterGain) masterGain.gain.value = v;
  }

  // Expose globally
  window.CouchMusic = { start: startSong, stop: stopSong, sfx, setEnabled, setVolume, init };
})();
