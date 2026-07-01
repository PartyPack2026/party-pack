// PITCH BATTLE — a ridiculous product appears. Players have to write a short, convincing sales
// pitch for it. All pitches are shown anonymously and everyone votes for the one that most makes
// them want to buy. Most votes wins the round. It's persuasion, comedy, and marketing nonsense.

const PRODUCTS = [
  "A chair made entirely of jelly",
  "Shoes that squeak with every step",
  "An umbrella that only works indoors",
  "A pet rock that needs daily walks",
  "Self-stirring soup (that never stops stirring)",
  "A alarm clock that whispers instead of rings",
  "Glow-in-the-dark toothpaste",
  "A phone case made of cheese",
  "Invisible sunglasses",
  "A blanket with 400 tiny pockets",
  "A car that only turns left",
  "Water-flavoured water",
  "A hat that grows real grass",
  "Socks that are always slightly damp",
  "A calculator that guesses the answer",
  "A pillow shaped like your worst enemy",
  "Perfume that smells like a new laptop",
  "A spoon that's also a comb",
  "A doorbell that plays your own voice back",
  "Reusable bubble wrap",
  "A toaster that also gives advice",
  "Sunglasses for your pet goldfish",
  "A tent that folds itself (very slowly)",
  "Edible phone chargers",
];

class PitchBattle {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.phase = 'pitching';
    this.pitches = {};
    this.votes = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const pool = PRODUCTS.map((p, i) => i).filter(i => !this.used.includes(i));
    const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * PRODUCTS.length);
    this.used.push(idx);
    this.product = PRODUCTS[idx];
    this.pitches = {};
    this.votes = {};
    this.phase = 'pitching';

    this.io.to(this.code).emit('pitch_round', {
      round: this.currentRound, totalRounds: this.rounds, product: this.product
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('pitch_write', { product: this.product, timeLimit: 60 });
    });
    this.writeTimer = setTimeout(() => this.startVoting(), 62000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'pitching' && data.type === 'pitch') {
      const text = String(data.pitch || '').slice(0, 200).trim();
      if (!text) return;
      this.pitches[playerId] = text;
      const count = Object.keys(this.pitches).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('pitch_count', { count, total });
      this.io.to(playerId).emit('pitch_submitted', {});
      if (count >= total) { clearTimeout(this.writeTimer); setTimeout(() => this.startVoting(), 700); }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      if (playerId === data.target) return;
      if (!this.pitches[data.target]) return;
      this.votes[playerId] = data.target;
      this.io.to(playerId).emit('pitch_voted', {});
      const count = Object.keys(this.votes).length;
      this.io.to(this.code).emit('pitch_vote_count', { count });
      if (count >= Object.keys(this.room.players).length) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  startVoting() {
    if (this.phase === 'voting') return;
    this.phase = 'voting';
    this.votes = {};
    const entries = Object.entries(this.pitches).map(([id, text]) => ({ id, text }));
    if (entries.length === 0) { this.showResults(); return; }
    const shuffled = entries.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('pitch_vote_display', {
      product: this.product, pitches: shuffled.map(e => ({ id: e.id, text: e.text }))
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('pitch_vote', {
        product: this.product,
        options: shuffled.filter(e => e.id !== id).map(e => ({ id: e.id, text: e.text }))
      });
    });
    this.voteTimer = setTimeout(() => this.showResults(), 30000);
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';
    const tally = {};
    Object.values(this.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
    const maxVotes = Math.max(0, ...Object.values(tally));
    Object.entries(tally).forEach(([id, v]) => { if (this.room.players[id]) this.room.players[id].score += v * 100; });
    Object.keys(tally).forEach(id => { if (tally[id] === maxVotes && maxVotes > 0 && this.room.players[id]) this.room.players[id].score += 250; });

    const results = Object.entries(this.pitches).map(([id, text]) => ({
      id, text, nickname: this.room.players[id]?.nickname || '?',
      votes: tally[id] || 0, isWinner: (tally[id] || 0) === maxVotes && maxVotes > 0
    })).sort((a, b) => b.votes - a.votes);

    this.io.to(this.code).emit('pitch_results', { product: this.product, results, players: this.room.players });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('pitch_result_player', { won: (tally[id] || 0) === maxVotes && maxVotes > 0, votes: tally[id] || 0 });
    });
    setTimeout(() => this.nextRound(), 7000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Pitch Battle' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'pitching') { clearTimeout(this.writeTimer); this.startVoting(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = PitchBattle;
