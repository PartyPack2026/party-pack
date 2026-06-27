const CATEGORIES = [
  { name: "Things you find in a hospital", timeLimit: 25 },
  { name: "Reasons to cancel plans", timeLimit: 25 },
  { name: "Things that are always broken", timeLimit: 20 },
  { name: "Words that sound rude but aren't", timeLimit: 30 },
  { name: "Things in a supermarket trolley at midnight", timeLimit: 25 },
  { name: "Excuses for being late", timeLimit: 20 },
  { name: "Things you'd find in a teenager's bag", timeLimit: 25 },
  { name: "Bad names for a baby", timeLimit: 25 },
  { name: "Things you whisper", timeLimit: 30 },
  { name: "Things that go brrr", timeLimit: 20 },
  { name: "Red flags on a first date", timeLimit: 25 },
  { name: "Things people lie about", timeLimit: 25 },
  { name: "Animals that could beat you in a fight", timeLimit: 20 },
  { name: "Reasons to call in sick", timeLimit: 20 },
  { name: "Things that are weirdly satisfying", timeLimit: 25 },
  { name: "Things people do when nobody's watching", timeLimit: 25 },
  { name: "Items in a survival kit for a Monday morning", timeLimit: 30 },
  { name: "Terrible band names", timeLimit: 25 },
  { name: "Things you'd find in a grandma's house", timeLimit: 25 },
  { name: "Signs someone has a villain arc coming", timeLimit: 25 },
];

class Voltage {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 5; this.currentRound = 0;
    this.usedCats = []; this.answers = {};
    this.phase = 'answering';
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinalResults(); return; }

    const available = CATEGORIES.filter(c => !this.usedCats.includes(c.name));
    this.currentCat = available[Math.floor(Math.random() * available.length)];
    this.usedCats.push(this.currentCat.name);
    this.answers = {};
    this.phase = 'answering';

    this.io.to(this.code).emit('voltage_round', {
      round: this.currentRound, totalRounds: this.rounds,
      category: this.currentCat.name, timeLimit: this.currentCat.timeLimit
    });

    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('voltage_answer', {
        category: this.currentCat.name, timeLimit: this.currentCat.timeLimit
      });
    });

    this.timer = setTimeout(() => this.scoreRound(), (this.currentCat.timeLimit + 3) * 1000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      if (!this.answers[playerId]) {
        this.answers[playerId] = data.answer.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 40);
      }
    }
  }

  scoreRound() {
    this.phase = 'scoring';
    clearTimeout(this.timer);

    // Tally answers
    const tally = {};
    Object.values(this.answers).forEach(a => {
      if (a) tally[a] = (tally[a] || 0) + 1;
    });

    const results = {};
    Object.entries(this.answers).forEach(([pid, answer]) => {
      const player = this.room.players[pid];
      if (!player) return;
      if (!answer) {
        results[pid] = { answer: '(nothing)', points: 0, reason: 'No answer' };
        return;
      }
      const count = tally[answer] || 0;
      let points = 0;
      let reason = '';
      if (count === 1) {
        points = 300; reason = 'Unique! +300';
      } else if (count === Object.keys(this.room.players).length) {
        points = 50; reason = 'Everyone said it +50';
      } else {
        points = 150; reason = `${count} people said it +150`;
      }
      player.score += points;
      results[pid] = { answer, points, reason, count };
    });

    // Handle no-answers
    Object.keys(this.room.players).forEach(pid => {
      if (!results[pid]) results[pid] = { answer: '(nothing)', points: 0, reason: 'No answer' };
    });

    this.io.to(this.code).emit('voltage_results', {
      category: this.currentCat.name,
      results: Object.entries(results).map(([pid, r]) => ({
        pid, nickname: this.room.players[pid]?.nickname,
        avatar: this.room.players[pid]?.avatar, ...r
      })),
      tally, players: this.room.players
    });

    Object.entries(results).forEach(([pid, r]) => {
      this.io.to(pid).emit('voltage_result_player', { ...r, players: this.room.players });
    });

    setTimeout(() => this.nextRound(), 7000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Voltage' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.timer);
    if (this.phase === 'answering') this.scoreRound();
  }
}
module.exports = Voltage;
