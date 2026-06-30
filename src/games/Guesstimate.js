// GUESSTIMATE — a number question appears (how many X, how tall, how far). Players type a
// number. Closest to the true answer scores most. No going-over penalty — pure closeness.

const QUESTIONS = [
  { q: "How many bones are in the adult human body?", a: 206, unit: "bones" },
  { q: "How many countries are there in the world (UN members)?", a: 193, unit: "countries" },
  { q: "How many keys are on a standard piano?", a: 88, unit: "keys" },
  { q: "How many hearts does an octopus have?", a: 3, unit: "hearts" },
  { q: "At what temperature does water boil? (°C)", a: 100, unit: "°C" },
  { q: "How many minutes are in a full week?", a: 10080, unit: "minutes" },
  { q: "How many teeth does an adult human have (with wisdom teeth)?", a: 32, unit: "teeth" },
  { q: "How many strings does a standard guitar have?", a: 6, unit: "strings" },
  { q: "How tall is the Eiffel Tower? (metres)", a: 330, unit: "m" },
  { q: "How many players are on a football (soccer) team on the pitch?", a: 11, unit: "players" },
  { q: "How many days did it take to build Rome? (trick — but guess years it was founded BC)", a: 753, unit: "BC" },
  { q: "How many planets are in our solar system?", a: 8, unit: "planets" },
  { q: "How many sides does a 50p coin have?", a: 7, unit: "sides" },
  { q: "How many colours are in a rainbow?", a: 7, unit: "colours" },
  { q: "What's the boiling point of water in Fahrenheit?", a: 212, unit: "°F" },
  { q: "How many legs does a spider have?", a: 8, unit: "legs" },
  { q: "How many time zones does the world have?", a: 24, unit: "zones" },
  { q: "How many squares are on a chessboard?", a: 64, unit: "squares" },
  { q: "How many years are in a century?", a: 100, unit: "years" },
  { q: "How many wonders were there in the ancient world?", a: 7, unit: "wonders" },
  { q: "How many chambers does the human heart have?", a: 4, unit: "chambers" },
  { q: "How many Earths could fit inside the Sun? (thousands)", a: 1300000, unit: "Earths" },
  { q: "How fast does light travel? (km per second, roughly)", a: 300000, unit: "km/s" },
  { q: "How many bones does a shark have?", a: 0, unit: "bones" },
];

class Guesstimate {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.phase = 'guessing';
    this.guesses = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = QUESTIONS.filter((_, i) => !this.used.includes(i));
    const q = avail[Math.floor(Math.random() * avail.length)] || QUESTIONS[0];
    this.used.push(QUESTIONS.indexOf(q));
    this.question = q;
    this.guesses = {};
    this.phase = 'guessing';

    this.io.to(this.code).emit('guess_round', {
      round: this.currentRound, totalRounds: this.rounds,
      question: q.q
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('guess_input', { question: q.q, unit: q.unit, timeLimit: 30 });
    });
    this.timer = setTimeout(() => this.showResults(), 33000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'guessing' && data.type === 'guess') {
      if (this.guesses[playerId] !== undefined) return;
      const val = parseFloat(data.value);
      if (isNaN(val)) return;
      this.guesses[playerId] = val;
      this.io.to(playerId).emit('guess_submitted', {});
      const count = Object.keys(this.guesses).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('guess_count', { count, total });
      if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';
    const answer = this.question.a;

    // Rank by absolute distance; closest gets most points
    const ranked = Object.entries(this.guesses).map(([id, val]) => ({
      id, val, dist: Math.abs(val - answer),
      name: this.room.players[id]?.nickname
    })).sort((a, b) => a.dist - b.dist);

    // Points: 1st closest 500, 2nd 350, 3rd 250, 4th 150, rest 75; exact = +100 bonus
    const ptsByRank = [500, 350, 250, 150];
    ranked.forEach((r, i) => {
      let pts = i < ptsByRank.length ? ptsByRank[i] : 75;
      if (r.dist === 0) pts += 100;
      if (this.room.players[r.id]) this.room.players[r.id].score += pts;
      r.points = pts;
    });

    this.io.to(this.code).emit('guess_results', {
      question: this.question.q, answer, unit: this.question.unit,
      ranked, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const r = ranked.find(x => x.id === id);
      this.io.to(id).emit('guess_result_player', {
        points: r ? r.points : 0, yourGuess: r ? r.val : null, answer,
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
      this.io.to(id).emit('final_scores', { scores, gameName: 'Guesstimate' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'guessing') { clearTimeout(this.timer); this.showResults(); }
  }
}

module.exports = Guesstimate;
