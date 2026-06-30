// CATEGORIES — a category and a letter appear (e.g. "Animals" + "B"). Everyone races to
// name something that fits. Unique valid answers score; answers others also gave score less.
// Fast, frantic, and funny when people stretch the rules.

const CATEGORIES = [
  "Animals", "Foods", "Countries", "Movies", "Things in a kitchen",
  "Boys' names", "Girls' names", "Things that are cold", "Sports",
  "Things you find at school", "Jobs", "Body parts", "Cartoon characters",
  "Things in the sky", "Colours", "Fruits", "Things that are round",
  "Reasons to be late", "Things in a hospital", "Board games",
  "Things that make noise", "Things in a fridge", "Hobbies",
  "Things at the beach", "Famous people", "Things that are sticky",
  "Modes of transport", "Things you wear", "Smelly things", "Drinks",
];

const LETTERS = "ABCDEFGHIKLMNOPRSTW"; // skip the hard ones

class Categories {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 4; this.currentRound = 0;
    this.phase = 'answering';
    this.answers = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = CATEGORIES.filter(c => !this.used.includes(c));
    this.category = avail[Math.floor(Math.random() * avail.length)] || CATEGORIES[0];
    this.used.push(this.category);
    this.letter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    this.answers = {};
    this.phase = 'answering';

    this.io.to(this.code).emit('cat_round', {
      round: this.currentRound, totalRounds: this.rounds,
      category: this.category, letter: this.letter
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('cat_answer', { category: this.category, letter: this.letter, timeLimit: 20 });
    });
    this.answerTimer = setTimeout(() => this.showResults(), 23000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      const text = String(data.answer || '').slice(0, 50).trim();
      if (!text) return;
      this.answers[playerId] = text;
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('cat_count', { count, total });
      this.io.to(playerId).emit('cat_submitted', {});
      if (count >= total) { clearTimeout(this.answerTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    // Normalize answers for comparison
    const norm = {};
    Object.entries(this.answers).forEach(([id, text]) => {
      norm[id] = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    });

    // Validity: must start with the letter
    const letterLower = this.letter.toLowerCase();
    const valid = {};
    Object.entries(this.answers).forEach(([id, text]) => {
      valid[id] = text.toLowerCase().trim().startsWith(letterLower);
    });

    // Count duplicates among valid answers
    const counts = {};
    Object.entries(norm).forEach(([id, n]) => {
      if (valid[id]) counts[n] = (counts[n] || 0) + 1;
    });

    const results = Object.entries(this.answers).map(([id, text]) => {
      const isValid = valid[id];
      const dupCount = isValid ? counts[norm[id]] : 0;
      let pts = 0;
      if (isValid) pts = dupCount === 1 ? 200 : 100; // unique = 200, shared = 100
      if (this.room.players[id]) this.room.players[id].score += pts;
      return {
        id, text, nickname: this.room.players[id]?.nickname || '?',
        valid: isValid, unique: dupCount === 1, points: pts
      };
    }).sort((a, b) => b.points - a.points);

    this.io.to(this.code).emit('cat_results', {
      category: this.category, letter: this.letter, results, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const r = results.find(x => x.id === id);
      this.io.to(id).emit('cat_result_player', {
        valid: r ? r.valid : false, unique: r ? r.unique : false, points: r ? r.points : 0
      });
    });

    setTimeout(() => this.nextRound(), 6000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Categories' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'answering') { clearTimeout(this.answerTimer); this.showResults(); }
  }
}

module.exports = Categories;
