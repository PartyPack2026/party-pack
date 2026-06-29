const CATEGORIES = [
  { name: "Things you find in a hospital", timeLimit: 22 },
  { name: "Reasons to cancel plans", timeLimit: 22 },
  { name: "Things that are always broken", timeLimit: 20 },
  { name: "Words that sound rude but aren't", timeLimit: 25 },
  { name: "Things in a supermarket trolley at midnight", timeLimit: 22 },
  { name: "Excuses for being late", timeLimit: 20 },
  { name: "Things you'd find in a teenager's bag", timeLimit: 22 },
  { name: "Bad names for a baby", timeLimit: 22 },
  { name: "Things you whisper", timeLimit: 25 },
  { name: "Things that go 'brrr'", timeLimit: 20 },
  { name: "Red flags on a first date", timeLimit: 22 },
  { name: "Things people lie about", timeLimit: 22 },
  { name: "Animals that could beat you in a fight", timeLimit: 20 },
  { name: "Reasons to call in sick", timeLimit: 20 },
  { name: "Things that are weirdly satisfying", timeLimit: 22 },
  { name: "Things people do when nobody's watching", timeLimit: 22 },
  { name: "Items in a survival kit for Monday morning", timeLimit: 25 },
  { name: "Terrible band names", timeLimit: 22 },
  { name: "Things you'd find in a grandma's house", timeLimit: 22 },
  { name: "Signs someone has a villain arc coming", timeLimit: 22 },
  { name: "Things you shouldn't microwave", timeLimit: 20 },
  { name: "Worst things to say at a wedding", timeLimit: 22 },
  { name: "Things found in a haunted house", timeLimit: 20 },
  { name: "Overrated foods", timeLimit: 20 },
  { name: "Things that make you instantly trust someone", timeLimit: 22 },
  { name: "Worst superpowers to have", timeLimit: 22 },
  { name: "Things you'd smuggle into a cinema", timeLimit: 20 },
  { name: "Reasons the dog is barking", timeLimit: 20 },
  { name: "Things you'd find in a wizard's pocket", timeLimit: 22 },
  { name: "Worst gifts to receive", timeLimit: 20 },
  { name: "Things that smell amazing", timeLimit: 20 },
  { name: "Excuses for not texting back", timeLimit: 22 },
  { name: "Things that are scarier at night", timeLimit: 20 },
  { name: "Worst things to hear on a plane", timeLimit: 22 },
  { name: "Things you'd find at the bottom of a lake", timeLimit: 22 },
  { name: "Ways to ruin a party", timeLimit: 22 },
  { name: "Things you pretend to like", timeLimit: 20 },
  { name: "Things a pirate would complain about", timeLimit: 22 },
  { name: "Worst names for a pet fish", timeLimit: 20 },
  { name: "Things you'd find in a time capsule", timeLimit: 22 },
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

    const resultsList = Object.entries(results).map(([pid, r]) => ({
      pid, nickname: this.room.players[pid]?.nickname,
      avatar: this.room.players[pid]?.avatar, ...r
    })).sort((a,b) => b.points - a.points);

    // Reveal answers one by one for drama
    resultsList.forEach((r, i) => {
      setTimeout(() => {
        this.io.to(this.code).emit('voltage_reveal_one', {
          result: r,
          index: i,
          total: resultsList.length,
          category: this.currentCat.name,
          players: this.room.players
        });
      }, i * 600);
    });

    // Full results after all revealed
    setTimeout(() => {
      this.io.to(this.code).emit('voltage_results', {
        category: this.currentCat.name,
        results: resultsList,
        tally, players: this.room.players
      });
    }, resultsList.length * 600 + 200);

    Object.entries(results).forEach(([pid, r]) => {
      this.io.to(pid).emit('voltage_result_player', { ...r, players: this.room.players });
    });

    setTimeout(() => this.nextRound(), resultsList.length * 600 + 5000);
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
