// WAVELENGTH — one player (the Psychic) sees a hidden target on a 0-100 spectrum between
// two opposites (e.g. "Cold ↔ Hot"). They give a clue word. Everyone else guesses where on
// the dial the target sits. Closer guesses = more points. The Psychic scores if people land near.

const SPECTRUMS = [
  ["Cold", "Hot"], ["Cheap", "Expensive"], ["Boring", "Exciting"],
  ["Useless", "Useful"], ["Quiet", "Loud"], ["Weird", "Normal"],
  ["Underrated", "Overrated"], ["Scary", "Cute"], ["Old-fashioned", "Modern"],
  ["Unhealthy", "Healthy"], ["Casual", "Formal"], ["Forgettable", "Iconic"],
  ["Tiny", "Huge"], ["Calm", "Chaotic"], ["Cheap thrill", "Sophisticated"],
  ["Guilty pleasure", "Respected"], ["Villain", "Hero"], ["Ugly", "Beautiful"],
  ["Worthless", "Priceless"], ["Lazy", "Hardworking"], ["Dangerous", "Safe"],
  ["Childish", "Mature"], ["Common", "Rare"], ["Awkward", "Smooth"],
];

class Wavelength {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = Math.min(6, Object.keys(room.players).length + 1);
    this.currentRound = 0;
    this.psychicQueue = [];
    this.phase = 'clue';
    this.guesses = {};
  }

  start() {
    this.psychicQueue = Object.keys(this.room.players).sort(() => Math.random() - 0.5);
    this.usedSpectrums = [];
    this.nextRound();
  }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }

    this.psychic = this.psychicQueue[(this.currentRound - 1) % this.psychicQueue.length];
    const avail = SPECTRUMS.filter(s => !this.usedSpectrums.includes(s[0]));
    this.spectrum = avail[Math.floor(Math.random() * avail.length)] || SPECTRUMS[0];
    this.usedSpectrums.push(this.spectrum[0]);
    this.target = Math.floor(Math.random() * 81) + 10; // 10-90, avoid extremes
    this.guesses = {};
    this.phase = 'clue';
    this.clue = null;

    const psychicName = this.room.players[this.psychic]?.nickname;

    // Host: show the spectrum but NOT the target yet
    this.io.to(this.code).emit('wl_round', {
      round: this.currentRound, totalRounds: this.rounds,
      left: this.spectrum[0], right: this.spectrum[1],
      psychicName
    });

    // Psychic sees the target and gives a clue
    this.io.to(this.psychic).emit('wl_psychic', {
      left: this.spectrum[0], right: this.spectrum[1],
      target: this.target, timeLimit: 40
    });
    // Others wait for the clue
    Object.keys(this.room.players).forEach(id => {
      if (id !== this.psychic) this.io.to(id).emit('wl_wait_clue', { psychicName });
    });

    this.clueTimer = setTimeout(() => {
      if (!this.clue) { this.setClue(this.psychic, "(no clue given)"); }
    }, 43000);
  }

  setClue(playerId, clue) {
    if (playerId !== this.psychic || this.clue) return;
    clearTimeout(this.clueTimer);
    this.clue = String(clue).slice(0, 60).trim() || "...";
    this.phase = 'guessing';

    // Host shows the clue + the dial for guessing
    this.io.to(this.code).emit('wl_clue', {
      clue: this.clue, left: this.spectrum[0], right: this.spectrum[1]
    });
    // Everyone except psychic guesses on the dial
    Object.keys(this.room.players).forEach(id => {
      if (id !== this.psychic) {
        this.io.to(id).emit('wl_guess', {
          clue: this.clue, left: this.spectrum[0], right: this.spectrum[1], timeLimit: 30
        });
      } else {
        this.io.to(id).emit('wl_watch', { message: "They're guessing your wavelength..." });
      }
    });
    this.guessTimer = setTimeout(() => this.reveal(), 33000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'clue' && data.type === 'clue') {
      this.setClue(playerId, data.clue);
    } else if (this.phase === 'guessing' && data.type === 'guess') {
      if (playerId === this.psychic) return;
      if (this.guesses[playerId] !== undefined) return;
      const val = Math.max(0, Math.min(100, parseInt(data.value) || 50));
      this.guesses[playerId] = val;
      this.io.to(playerId).emit('wl_guessed', {});
      const total = Object.keys(this.room.players).length - 1;
      const count = Object.keys(this.guesses).length;
      this.io.to(this.code).emit('wl_guess_count', { count, total });
      if (count >= total) { clearTimeout(this.guessTimer); setTimeout(() => this.reveal(), 700); }
    }
  }

  reveal() {
    this.phase = 'reveal';
    let psychicBonus = 0;
    const guessResults = [];
    Object.entries(this.guesses).forEach(([id, val]) => {
      const dist = Math.abs(val - this.target);
      // closer = more points; within 5 = bullseye
      let pts = 0;
      if (dist <= 4) pts = 400;
      else if (dist <= 10) pts = 250;
      else if (dist <= 18) pts = 150;
      else if (dist <= 28) pts = 75;
      if (this.room.players[id]) this.room.players[id].score += pts;
      if (dist <= 12) psychicBonus += 100; // psychic rewarded for good clues
      guessResults.push({ id, name: this.room.players[id]?.nickname, value: val, points: pts });
    });
    if (this.room.players[this.psychic]) this.room.players[this.psychic].score += psychicBonus;

    this.io.to(this.code).emit('wl_reveal', {
      target: this.target, clue: this.clue,
      left: this.spectrum[0], right: this.spectrum[1],
      guesses: guessResults,
      psychicName: this.room.players[this.psychic]?.nickname,
      psychicBonus,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      if (id === this.psychic) {
        this.io.to(id).emit('wl_reveal_player', { isPsychic: true, bonus: psychicBonus });
      } else {
        const gr = guessResults.find(g => g.id === id);
        this.io.to(id).emit('wl_reveal_player', { isPsychic: false, points: gr ? gr.points : 0, dist: gr ? Math.abs(gr.value - this.target) : null });
      }
    });

    setTimeout(() => this.nextRound(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Wavelength' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'clue') { clearTimeout(this.clueTimer); if (!this.clue) this.setClue(this.psychic, "(skipped)"); }
    else if (this.phase === 'guessing') { clearTimeout(this.guessTimer); this.reveal(); }
  }
}

module.exports = Wavelength;
