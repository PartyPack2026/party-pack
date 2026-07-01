// SCRAMBLE — a word appears with its letters jumbled. Players race to type the unscrambled
// word. First correct scores the most; speed matters. No dictionary needed — the server knows
// the target word, so it only ever checks against that.

const WORDS = [
  "PLANET", "GUITAR", "ROCKET", "CASTLE", "DRAGON", "JUNGLE", "PICKLE", "WIZARD",
  "PYRAMID", "VOLCANO", "PENGUIN", "DIAMOND", "MONSTER", "RAINBOW", "TREASURE", "SANDWICH",
  "ISLAND", "GARDEN", "CIRCUS", "PUZZLE", "ROBOT", "COMET", "TIGER", "PIRATE",
  "MUFFIN", "ORANGE", "PLANET", "BANJO", "CACTUS", "DONKEY", "FALCON", "GOBLIN",
  "HARBOR", "IGLOO", "JACKET", "KETTLE", "LANTERN", "MAGNET", "NOODLE", "OCTOPUS",
  "PYTHON", "QUARTZ", "ROCKET", "SPHINX", "TURTLE", "UMBRELLA", "VIOLIN", "WALNUT",
];

function scramble(word) {
  let letters = word.split('');
  let out = word;
  // ensure the scramble differs from the original
  let tries = 0;
  while (out === word && tries < 20) {
    letters = word.split('').sort(() => Math.random() - 0.5);
    out = letters.join('');
    tries++;
  }
  return out;
}

class Scramble {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 7; this.currentRound = 0;
    this.phase = 'solving';
    this.solved = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    if (!this.room || Object.keys(this.room.players).length === 0) { this.ended = true; return; }
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    // pick an unused word
    let word;
    const avail = WORDS.filter((w, i) => !this.used.includes(i));
    if (avail.length === 0) { this.used = []; }
    const pool = WORDS.map((w, i) => i).filter(i => !this.used.includes(i));
    const idx = pool[Math.floor(Math.random() * pool.length)];
    this.used.push(idx);
    word = WORDS[idx];

    this.answer = word.toLowerCase();
    this.scrambled = scramble(word);
    this.solved = {};
    this.solveOrder = 0;
    this.phase = 'solving';
    this.roundStart = Date.now();

    this.io.to(this.code).emit('scr_round', {
      round: this.currentRound, totalRounds: this.rounds,
      scrambled: this.scrambled, length: word.length
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('scr_solve', { scrambled: this.scrambled, length: word.length });
    });
    this.timer = setTimeout(() => this.reveal(), 25000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'solving' && data.type === 'guess') {
      if (this.solved[playerId]) return;
      const guess = String(data.guess || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!guess) return;
      if (guess === this.answer) {
        this.solveOrder++;
        const pts = Math.max(150, 550 - this.solveOrder * 100);
        this.solved[playerId] = true;
        if (this.room.players[playerId]) this.room.players[playerId].score += pts;
        this.io.to(playerId).emit('scr_correct', { points: pts, order: this.solveOrder, answer: this.answer });
        this.io.to(this.code).emit('scr_solved', { name: this.room.players[playerId]?.nickname, order: this.solveOrder });
        const total = Object.keys(this.room.players).length;
        if (Object.keys(this.solved).length >= total) { clearTimeout(this.timer); setTimeout(() => this.reveal(), 800); }
      } else {
        this.io.to(playerId).emit('scr_wrong', {});
      }
    }
  }

  reveal() {
    if (this.phase === 'reveal') return;
    this.phase = 'reveal';
    const solvers = Object.keys(this.solved).length;
    this.io.to(this.code).emit('scr_reveal', {
      answer: this.answer, scrambled: this.scrambled, solvers, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('scr_reveal_player', { solved: !!this.solved[id], answer: this.answer });
    });
    setTimeout(() => this.nextRound(), 4500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Scramble' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'solving') { clearTimeout(this.timer); this.reveal(); }
  }
}

module.exports = Scramble;
