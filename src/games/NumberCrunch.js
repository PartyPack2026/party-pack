// NUMBER CRUNCH — a target number and six number tiles appear. Players tap tiles to build a
// set that adds up to exactly the target (or as close as possible). Hitting it exactly scores
// big; closest also scores. Fully safe scoring: the server just SUMS the chosen tiles — no
// expression parsing, no eval. A genuine little maths puzzle.

function makePuzzle() {
  // Build 6 tiles, then choose a solvable target from a random subset so at least one exact
  // solution exists (players don't have to find that exact one).
  const tiles = [];
  for (let i = 0; i < 6; i++) tiles.push(Math.floor(Math.random() * 24) + 2); // 2..25
  // pick a random subset of size 2..4 to define an achievable target
  const subsetSize = Math.floor(Math.random() * 3) + 2; // 2..4
  const idxs = tiles.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, subsetSize);
  const target = idxs.reduce((s, i) => s + tiles[i], 0);
  return { tiles, target };
}

class NumberCrunch {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.phase = 'solving';
    this.answers = {};
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const p = makePuzzle();
    this.tiles = p.tiles;
    this.target = p.target;
    this.answers = {};
    this.phase = 'solving';
    this.roundStart = Date.now();

    // Send tiles with stable ids (index) and their values
    const tileData = this.tiles.map((v, i) => ({ id: i, value: v }));
    this.io.to(this.code).emit('num_round', {
      round: this.currentRound, totalRounds: this.rounds, target: this.target, tiles: tileData
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('num_solve', { target: this.target, tiles: tileData, timeLimit: 30 });
    });
    this.timer = setTimeout(() => this.showResults(), 33000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'solving' && data.type === 'submit') {
      if (this.answers[playerId] !== undefined) return;
      // data.tileIds = array of chosen tile indexes (no repeats)
      const picks = Array.isArray(data.tileIds) ? [...new Set(data.tileIds)] : [];
      // validate ids and sum their values — pure addition, totally safe
      let sum = 0; let valid = true;
      picks.forEach(i => {
        if (typeof i !== 'number' || i < 0 || i >= this.tiles.length) { valid = false; return; }
        sum += this.tiles[i];
      });
      if (!valid) return;
      const time = Date.now() - this.roundStart;
      this.answers[playerId] = { picks, sum, dist: Math.abs(sum - this.target), time };
      this.io.to(playerId).emit('num_submitted', { sum });
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('num_count', { count, total });
      if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    // Rank by distance to target, then by speed
    const ranked = Object.entries(this.answers).map(([id, a]) => ({
      id, name: this.room.players[id]?.nickname, sum: a.sum, dist: a.dist, time: a.time
    })).sort((a, b) => a.dist - b.dist || a.time - b.time);

    // Everyone who hit it EXACTLY gets 300 + speed bonus. Otherwise, closest few get scaled points.
    let anyExact = ranked.filter(r => r.dist === 0);
    if (anyExact.length > 0) {
      anyExact.forEach((r, i) => {
        const speed = Math.max(0, Math.round(150 * (1 - r.time / 33000)));
        const pts = 300 + speed;
        if (this.room.players[r.id]) this.room.players[r.id].score += pts;
        r.points = pts; r.exact = true;
      });
      // non-exact still get a little for being closest
      const nonExact = ranked.filter(r => r.dist !== 0);
      const ptsByRank = [150, 100, 60];
      nonExact.forEach((r, i) => { const pts = i < ptsByRank.length ? ptsByRank[i] : 30; if (this.room.players[r.id]) this.room.players[r.id].score += pts; r.points = pts; });
    } else {
      const ptsByRank = [250, 180, 120, 80];
      ranked.forEach((r, i) => { const pts = i < ptsByRank.length ? ptsByRank[i] : 40; if (this.room.players[r.id]) this.room.players[r.id].score += pts; r.points = pts; });
    }

    this.io.to(this.code).emit('num_results', {
      target: this.target, ranked, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const r = ranked.find(x => x.id === id);
      this.io.to(id).emit('num_result_player', {
        yourSum: r ? r.sum : null, target: this.target,
        exact: r ? r.dist === 0 : false, points: r ? r.points : 0,
        closest: ranked.length > 0 && ranked[0].id === id
      });
    });
    setTimeout(() => this.nextRound(), 6000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Number Crunch' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'solving') { clearTimeout(this.timer); this.showResults(); }
  }
}

module.exports = NumberCrunch;
