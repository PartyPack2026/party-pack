// MAJORITY RULES — a simple question with many possible answers (e.g. "Name a colour").
// Everyone answers privately. You ONLY score if your answer matches what most people said.
// The goal isn't to be clever — it's to think like everyone else. Hilarious tension.

const QUESTIONS = [
  "Name a colour.",
  "Name a farm animal.",
  "Name a pizza topping.",
  "Name a country in Europe.",
  "Name a fruit.",
  "Name a superhero.",
  "Name a day of the week.",
  "Name something you find in a kitchen.",
  "Name a sport.",
  "Name a body part.",
  "Name an ice cream flavour.",
  "Name a mode of transport.",
  "Name a wild animal.",
  "Name a board game.",
  "Name a fast food chain.",
  "Name a planet.",
  "Name a season.",
  "Name a school subject.",
  "Name a type of weather.",
  "Name a musical instrument.",
  "Name a breakfast food.",
  "Name a job.",
  "Name a drink.",
  "Name a holiday.",
];

function normalize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

class MajorityRules {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.phase = 'answering';
    this.answers = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = QUESTIONS.filter((_, i) => !this.used.includes(i));
    this.question = avail[Math.floor(Math.random() * avail.length)] || QUESTIONS[0];
    this.used.push(QUESTIONS.indexOf(this.question));
    this.answers = {};
    this.phase = 'answering';

    this.io.to(this.code).emit('maj_round', {
      round: this.currentRound, totalRounds: this.rounds, question: this.question
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('maj_answer', { question: this.question, timeLimit: 20 });
    });
    this.timer = setTimeout(() => this.showResults(), 23000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      const text = String(data.answer || '').slice(0, 40).trim();
      if (!text) return;
      this.answers[playerId] = text;
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('maj_count', { count, total });
      this.io.to(playerId).emit('maj_submitted', {});
      if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    // Group answers by normalized form
    const groups = {};
    Object.entries(this.answers).forEach(([id, text]) => {
      const key = normalize(text);
      if (!groups[key]) groups[key] = { display: text, ids: [] };
      groups[key].ids.push(id);
    });

    // Find the biggest group(s)
    const groupArr = Object.values(groups).sort((a, b) => b.ids.length - a.ids.length);
    const maxSize = groupArr.length ? groupArr[0].ids.length : 0;

    // Everyone in a max-size group scores. Bigger agreement = more points each.
    const winners = new Set();
    groupArr.forEach(g => {
      if (g.ids.length === maxSize && maxSize > 1) {
        g.ids.forEach(id => {
          winners.add(id);
          if (this.room.players[id]) this.room.players[id].score += 100 + maxSize * 50;
        });
      }
    });

    // Build the tally display (group -> count)
    const tallyDisplay = groupArr.map(g => ({
      answer: g.display, count: g.ids.length,
      names: g.ids.map(id => this.room.players[id]?.nickname).filter(Boolean),
      isMajority: g.ids.length === maxSize && maxSize > 1
    }));

    this.io.to(this.code).emit('maj_results', {
      question: this.question, tally: tallyDisplay, maxSize,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('maj_result_player', {
        matched: winners.has(id),
        yourAnswer: this.answers[id] || null,
        groupSize: winners.has(id) ? maxSize : (groups[normalize(this.answers[id] || '')]?.ids.length || 0)
      });
    });

    setTimeout(() => this.nextRound(), 6000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Majority Rules' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'answering') { clearTimeout(this.timer); this.showResults(); }
  }
}

module.exports = MajorityRules;
