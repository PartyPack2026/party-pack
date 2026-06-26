const PROMPTS = [
  "The worst wifi password ever: ___",
  "My therapist told me to stop ___, so now I do it more",
  "New Olympic sport nobody asked for: ___",
  "The secret ingredient in grandma's cooking: ___",
  "A terrible name for a baby: ___",
  "What aliens discovered when they hacked our internet: ___",
  "The rejected sequel nobody wanted: ___",
  "Scientists just proved that ___ causes baldness",
  "My dating profile says I enjoy long walks and ___",
  "The world's worst superpower: ___",
  "A children's book that would definitely get banned: ___",
  "What's actually in a hot dog: ___",
  "The real reason dinosaurs went extinct: ___",
  "My cat's secret job when I'm asleep: ___",
  "The worst thing to shout in a library: ___",
  "New app idea that will definitely fail: ___",
  "What I actually do during Zoom calls: ___",
  "The rejected flavor of ice cream: ___",
  "Instructions for my funeral: first, play ___",
  "The thing nobody tells you about adulthood: ___",
  "A bad name for a restaurant: ___",
  "The most useless invention of all time: ___",
  "What's inside Area 51: ___",
  "The worst advice you could give a toddler: ___",
  "My search history that I'll never explain: ___",
];

class Quiplash {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.assignments = {}; this.votingPairs = [];
    this.currentVoteIndex = 0; this.votes = {};
    this.phase = 'answering'; this.usedPrompts = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinalResults(); return; }
    const players = Object.values(this.room.players);
    const available = PROMPTS.filter(p => !this.usedPrompts.includes(p));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    this.assignments = {}; this.votes = {};

    players.forEach((p, i) => {
      const prompt = shuffled[i % shuffled.length];
      this.usedPrompts.push(prompt);
      this.assignments[p.id] = { prompt, answer: null };
    });

    this.phase = 'answering';
    this.io.to(this.code).emit('quiplash_round', {
      round: this.currentRound, totalRounds: this.rounds, phase: 'answering'
    });

    players.forEach(p => {
      this.io.to(p.id).emit('your_prompt', { prompt: this.assignments[p.id].prompt, timeLimit: 60 });
    });

    this.answerTimer = setTimeout(() => this.startVoting(), 65000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      if (this.assignments[playerId] && !this.assignments[playerId].answer) {
        this.assignments[playerId].answer = data.answer.trim() || '(nothing)';
        const count = Object.values(this.assignments).filter(a => a.answer).length;
        this.io.to(this.code).emit('player_answered', { playerId, count, total: Object.keys(this.room.players).length });
        if (count >= Object.keys(this.room.players).length) {
          clearTimeout(this.answerTimer);
          setTimeout(() => this.startVoting(), 1500);
        }
      }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      const pair = this.votingPairs[this.currentVoteIndex];
      if (!pair || this.votes[playerId]) return;
      if (playerId === pair.p1 || playerId === pair.p2) return;
      if (data.vote !== pair.p1 && data.vote !== pair.p2) return;
      this.votes[playerId] = data.vote;
      const eligible = Object.keys(this.room.players).filter(id => id !== pair.p1 && id !== pair.p2).length;
      this.io.to(this.code).emit('vote_received', { count: Object.keys(this.votes).length, total: eligible });
      if (Object.keys(this.votes).length >= eligible) {
        clearTimeout(this.voteTimer);
        setTimeout(() => this.showVoteResults(), 800);
      }
    }
  }

  startVoting() {
    Object.values(this.assignments).forEach(a => { if (!a.answer) a.answer = '(crickets...)'; });
    const players = Object.values(this.room.players);
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    this.votingPairs = [];
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      this.votingPairs.push({ p1: shuffled[i].id, p2: shuffled[i+1].id });
    }
    this.currentVoteIndex = 0;
    this.showNextVote();
  }

  showNextVote() {
    if (this.currentVoteIndex >= this.votingPairs.length) { this.nextRound(); return; }
    this.phase = 'voting';
    this.votes = {};
    const pair = this.votingPairs[this.currentVoteIndex];
    const p1 = this.room.players[pair.p1], p2 = this.room.players[pair.p2];
    const a1 = this.assignments[pair.p1], a2 = this.assignments[pair.p2];
    const prompt = a1.prompt;

    this.io.to(this.code).emit('quiplash_vote', {
      prompt,
      options: [
        { playerId: pair.p1, nickname: p1.nickname, avatar: p1.avatar, answer: a1.answer },
        { playerId: pair.p2, nickname: p2.nickname, avatar: p2.avatar, answer: a2.answer },
      ]
    });

    Object.keys(this.room.players).forEach(id => {
      if (id !== pair.p1 && id !== pair.p2) {
        this.io.to(id).emit('vote_now', {
          prompt, timeLimit: 25,
          options: [
            { playerId: pair.p1, answer: a1.answer },
            { playerId: pair.p2, answer: a2.answer },
          ]
        });
      } else {
        this.io.to(id).emit('wait_for_votes', { message: "Your answer is being judged! 😬" });
      }
    });

    this.voteTimer = setTimeout(() => this.showVoteResults(), 28000);
  }

  showVoteResults() {
    const pair = this.votingPairs[this.currentVoteIndex];
    const tally = { [pair.p1]: 0, [pair.p2]: 0 };
    Object.values(this.votes).forEach(v => { if (tally[v] !== undefined) tally[v]++; });

    Object.entries(tally).forEach(([pid, count]) => {
      if (this.room.players[pid]) this.room.players[pid].score += count * 150;
    });

    // tv update
    this.io.to(this.code).emit('vote_results', { tally, players: this.room.players });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('vote_results_player', { tally, players: this.room.players, myId: id });
    });

    this.currentVoteIndex++;
    setTimeout(() => this.showNextVote(), 5000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    this.io.to(this.code).emit('round_scores', { scores, gameName: 'Quiplash' });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.answerTimer); clearTimeout(this.voteTimer);
    if (this.phase === 'answering') this.startVoting();
    else if (this.phase === 'voting') this.showVoteResults();
  }
}
module.exports = Quiplash;
