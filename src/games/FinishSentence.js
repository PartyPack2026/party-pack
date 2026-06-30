// FINISH THE SENTENCE — a sentence stub appears with a blank. Players fill it in to be
// funniest. All answers shown anonymously, everyone votes. Most votes wins the round.

const STUBS = [
  "The worst thing to say on a first date is ___.",
  "My life would be complete if I just had ___.",
  "You know it's going to be a bad day when ___.",
  "I would do anything for love, except ___.",
  "The secret ingredient is always ___.",
  "Never trust someone who ___.",
  "The fastest way to ruin a party is ___.",
  "In my next life I want to come back as ___.",
  "My therapist told me to stop ___.",
  "The real reason dinosaurs went extinct is ___.",
  "I'm not saying it was aliens, but ___.",
  "Behind every great person is ___.",
  "My autobiography would be titled ___.",
  "The most overrated thing in the world is ___.",
  "If I ruled the world, the first law would be ___.",
  "You can tell a lot about a person by their ___.",
  "The worst superpower would be ___.",
  "My toxic trait is ___.",
  "Nothing brings people together like ___.",
  "The true sign of adulthood is ___.",
  "I'd be rich if I had a dollar for every ___.",
  "The most dangerous thing in my house is ___.",
  "I knew we'd be friends when you ___.",
  "The group chat exists purely for ___.",
];

class FinishSentence {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.phase = 'writing';
    this.answers = {};
    this.votes = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = STUBS.filter((_, i) => !this.used.includes(i));
    this.stub = avail[Math.floor(Math.random() * avail.length)] || STUBS[0];
    this.used.push(STUBS.indexOf(this.stub));
    this.answers = {};
    this.phase = 'writing';

    this.io.to(this.code).emit('fin_round', {
      round: this.currentRound, totalRounds: this.rounds, stub: this.stub
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('fin_write', { stub: this.stub, timeLimit: 45 });
    });
    this.writeTimer = setTimeout(() => this.startVoting(), 48000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'writing' && data.type === 'answer') {
      const text = String(data.answer || '').slice(0, 100).trim();
      if (!text) return;
      this.answers[playerId] = text;
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('fin_count', { count, total });
      this.io.to(playerId).emit('fin_submitted', {});
      if (count >= total) { clearTimeout(this.writeTimer); setTimeout(() => this.startVoting(), 700); }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      if (playerId === data.target) return;
      if (!this.answers[data.target]) return;
      this.votes[playerId] = data.target;
      this.io.to(playerId).emit('fin_voted', {});
      const count = Object.keys(this.votes).length;
      this.io.to(this.code).emit('fin_vote_count', { count });
      if (count >= Object.keys(this.room.players).length) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  startVoting() {
    if (this.phase === 'voting') return;
    this.phase = 'voting';
    this.votes = {};
    const entries = Object.entries(this.answers).map(([id, text]) => ({ id, text }));
    if (entries.length === 0) { this.showResults(); return; }
    const shuffled = entries.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('fin_vote_display', {
      stub: this.stub,
      answers: shuffled.map(e => ({ id: e.id, text: e.text }))
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('fin_vote', {
        stub: this.stub,
        options: shuffled.filter(e => e.id !== id).map(e => ({ id: e.id, text: e.text }))
      });
    });
    this.voteTimer = setTimeout(() => this.showResults(), 25000);
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';
    const tally = {};
    Object.values(this.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
    const maxVotes = Math.max(0, ...Object.values(tally));
    Object.entries(tally).forEach(([id, v]) => { if (this.room.players[id]) this.room.players[id].score += v * 100; });
    Object.keys(tally).forEach(id => { if (tally[id] === maxVotes && maxVotes > 0 && this.room.players[id]) this.room.players[id].score += 250; });

    const results = Object.entries(this.answers).map(([id, text]) => ({
      id, text, nickname: this.room.players[id]?.nickname || '?',
      votes: tally[id] || 0, isWinner: (tally[id] || 0) === maxVotes && maxVotes > 0
    })).sort((a, b) => b.votes - a.votes);

    this.io.to(this.code).emit('fin_results', { stub: this.stub, results, players: this.room.players });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('fin_result_player', { won: (tally[id] || 0) === maxVotes && maxVotes > 0, votes: tally[id] || 0 });
    });
    setTimeout(() => this.nextRound(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Finish the Sentence' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'writing') { clearTimeout(this.writeTimer); this.startVoting(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = FinishSentence;
