// MOST LIKELY TO — players vote which person in the room best fits a prompt.
// The most-voted player "wins" the round (and gets roasted). Pure social fun.

const PROMPTS = [
  "Most likely to survive a zombie apocalypse",
  "Most likely to become a millionaire",
  "Most likely to forget their own birthday",
  "Most likely to start a cult",
  "Most likely to cry at a wedding",
  "Most likely to get lost in their own neighbourhood",
  "Most likely to become famous",
  "Most likely to text their ex at 3am",
  "Most likely to ghost a group chat",
  "Most likely to win a Nobel Prize",
  "Most likely to get arrested for something ridiculous",
  "Most likely to fake their own death for attention",
  "Most likely to marry a celebrity",
  "Most likely to eat the last slice without asking",
  "Most likely to become a reality TV star",
  "Most likely to trip over absolutely nothing",
  "Most likely to fall asleep at a party",
  "Most likely to laugh at the wrong moment",
  "Most likely to adopt 10 cats",
  "Most likely to accidentally start a fire cooking",
  "Most likely to talk their way out of a speeding ticket",
  "Most likely to move to another country on a whim",
  "Most likely to become a meme",
  "Most likely to get scammed online",
  "Most likely to win an argument they're completely wrong about",
  "Most likely to forget where they parked",
  "Most likely to spend their last £10 on snacks",
  "Most likely to become a stand-up comedian",
  "Most likely to overshare with a stranger",
  "Most likely to survive the longest stranded on an island",
  "Most likely to be late to their own funeral",
  "Most likely to befriend a wild animal",
  "Most likely to go viral for the wrong reason",
  "Most likely to become president",
  "Most likely to cry over a TV show",
  "Most likely to have a secret talent nobody knows about",
  "Most likely to start dancing when no music is playing",
  "Most likely to get rich quick and lose it all",
  "Most likely to win a hotdog eating contest",
  "Most likely to fall for an obvious prank",
];

class MostLikely {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = Math.min(7, Math.max(5, Object.keys(room.players).length + 2));
    this.currentRound = 0;
    this.used = [];
    this.votes = {};
    this.phase = 'voting';
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }

    const available = PROMPTS.filter(p => !this.used.includes(p));
    const prompt = available[Math.floor(Math.random() * available.length)] || PROMPTS[0];
    this.used.push(prompt);
    this.currentPrompt = prompt;
    this.votes = {};
    this.phase = 'voting';

    const players = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar
    }));

    // Host shows the prompt + the grid of who you can vote for
    this.io.to(this.code).emit('ml_round', {
      round: this.currentRound, totalRounds: this.rounds,
      prompt, players
    });

    // Each player gets the voting list (can vote for anyone INCLUDING themselves — it's funnier)
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('ml_vote', {
        prompt,
        options: players
      });
    });

    this.voteTimer = setTimeout(() => this.showResults(), 22000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      if (!this.room.players[data.target]) return;
      this.votes[playerId] = data.target;
      const total = Object.keys(this.room.players).length;
      const count = Object.keys(this.votes).length;
      this.io.to(this.code).emit('ml_vote_count', { count, total });
      this.io.to(playerId).emit('ml_voted', {});
      if (count >= total) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    // Tally votes per player
    const tally = {};
    Object.values(this.votes).forEach(target => { tally[target] = (tally[target] || 0) + 1; });
    const maxVotes = Math.max(0, ...Object.values(tally));
    const winners = Object.keys(tally).filter(id => tally[id] === maxVotes && maxVotes > 0);

    // Award points: the most-voted player(s) get points (it's a badge of honour here)
    winners.forEach(id => { if (this.room.players[id]) this.room.players[id].score += 500; });
    // Bonus: anyone who voted for the winner "read the room" → small points
    if (winners.length) {
      Object.entries(this.votes).forEach(([voter, target]) => {
        if (winners.includes(target) && this.room.players[voter]) this.room.players[voter].score += 100;
      });
    }

    const results = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar,
      votes: tally[p.id] || 0, isWinner: winners.includes(p.id)
    })).sort((a, b) => b.votes - a.votes);

    this.io.to(this.code).emit('ml_results', {
      prompt: this.currentPrompt,
      results,
      winnerNames: winners.map(id => this.room.players[id]?.nickname).filter(Boolean),
      players: this.room.players
    });

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('ml_result_player', {
        wasVotedMost: winners.includes(id),
        votesGot: tally[id] || 0,
        prompt: this.currentPrompt
      });
    });

    setTimeout(() => this.nextRound(), 6000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Most Likely To' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = MostLikely;
