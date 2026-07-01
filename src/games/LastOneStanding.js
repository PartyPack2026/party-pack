// LAST ONE STANDING — a survival game. Each round everyone answers a prompt, then everyone
// votes for their FAVOURITE answer. The player with the FEWEST votes is eliminated. Eliminated
// players keep voting (so they stay involved and can play kingmaker). Last player standing wins
// the crown. High drama, especially as the group shrinks.

const PROMPTS = [
  "What's the best excuse for being late?",
  "Name the worst possible superpower.",
  "What's the ultimate comfort food?",
  "Invent a terrible ice cream flavour.",
  "What's the most useless invention ever?",
  "Describe your dream pet.",
  "What would you do with a million dollars?",
  "Name a rule everyone secretly breaks.",
  "What's the best way to win an argument?",
  "Pitch a terrible theme park ride.",
  "What's the most overrated food?",
  "Name a talent you wish you had.",
  "What's the worst thing to say to your boss?",
  "Describe the perfect lazy Sunday.",
  "What's a small thing that brings you joy?",
  "Name the best fictional world to live in.",
  "What's your go-to dance move?",
  "Invent a new national holiday.",
  "What's the weirdest food combination that works?",
  "Name the most annoying sound in the world.",
];

class LastOneStanding {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'answering';
    this.alive = [];
    this.answers = {};
    this.votes = {};
    this.used = [];
    this.roundNum = 0;
  }

  start() {
    this.alive = Object.keys(this.room.players);
    this.nextRound();
  }

  nextRound() {
    if (!this.room || Object.keys(this.room.players).length === 0) { this.ended = true; return; }
    // win condition: 1 (or 0) player left
    if (this.alive.length <= 1) { this.showWinner(); return; }
    this.roundNum++;
    const pool = PROMPTS.map((p, i) => i).filter(i => !this.used.includes(i));
    const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * PROMPTS.length);
    this.used.push(idx);
    this.prompt = PROMPTS[idx];
    this.answers = {};
    this.votes = {};
    this.phase = 'answering';

    const aliveNames = this.alive.map(id => this.room.players[id]?.nickname);
    this.io.to(this.code).emit('los_round', {
      round: this.roundNum, prompt: this.prompt, aliveCount: this.alive.length, aliveNames
    });
    // alive players write; eliminated players just watch/wait for the vote
    Object.keys(this.room.players).forEach(id => {
      if (this.alive.includes(id)) this.io.to(id).emit('los_write', { prompt: this.prompt, timeLimit: 45 });
      else this.io.to(id).emit('los_spectate', { prompt: this.prompt });
    });
    this.writeTimer = setTimeout(() => this.startVoting(), 47000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      if (!this.alive.includes(playerId)) return;
      const text = String(data.answer || '').slice(0, 150).trim();
      if (!text) return;
      this.answers[playerId] = text;
      const count = Object.keys(this.answers).length;
      this.io.to(this.code).emit('los_count', { count, total: this.alive.length });
      this.io.to(playerId).emit('los_submitted', {});
      if (count >= this.alive.length) { clearTimeout(this.writeTimer); setTimeout(() => this.startVoting(), 700); }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      // EVERYONE (including eliminated) can vote, but not for their own answer
      if (playerId === data.target) return;
      if (!this.answers[data.target]) return;
      this.votes[playerId] = data.target;
      this.io.to(playerId).emit('los_voted', {});
      const count = Object.keys(this.votes).length;
      const totalVoters = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('los_vote_count', { count, total: totalVoters });
      if (count >= totalVoters) { clearTimeout(this.voteTimer); setTimeout(() => this.resolve(), 700); }
    }
  }

  startVoting() {
    if (this.phase === 'voting') return;
    this.phase = 'voting';
    this.votes = {};
    // ensure every alive player has an answer entry so they can be voted on / eliminated fairly
    this.alive.forEach(id => { if (!this.answers[id]) this.answers[id] = '(no answer)'; });
    const entries = this.alive.map(id => ({ id, text: this.answers[id], name: this.room.players[id]?.nickname }));
    const shuffled = entries.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('los_vote_display', {
      prompt: this.prompt, answers: shuffled.map(e => ({ id: e.id, text: e.text }))
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('los_vote', {
        prompt: this.prompt,
        options: shuffled.filter(e => e.id !== id).map(e => ({ id: e.id, text: e.text }))
      });
    });
    this.voteTimer = setTimeout(() => this.resolve(), 28000);
  }

  resolve() {
    if (this.phase === 'resolve') return;
    this.phase = 'resolve';

    // tally votes among alive answers
    const tally = {};
    this.alive.forEach(id => { tally[id] = 0; });
    Object.values(this.votes).forEach(t => { if (tally[t] !== undefined) tally[t]++; });

    // award survival points to everyone still alive, bonus by votes received
    this.alive.forEach(id => { if (this.room.players[id]) this.room.players[id].score += 100 + (tally[id] || 0) * 75; });

    // find the fewest votes -> eliminated (random tiebreak among the lowest)
    const minVotes = Math.min(...this.alive.map(id => tally[id]));
    const lowest = this.alive.filter(id => tally[id] === minVotes);
    const eliminated = lowest[Math.floor(Math.random() * lowest.length)];
    this.alive = this.alive.filter(id => id !== eliminated);

    // vote breakdown for display
    const breakdown = Object.keys(tally).map(id => ({
      name: this.room.players[id]?.nickname, votes: tally[id],
      answer: this.answers[id], eliminated: id === eliminated
    })).sort((a, b) => b.votes - a.votes);

    const survivorNames = this.alive.map(id => this.room.players[id]?.nickname);

    this.io.to(this.code).emit('los_resolve', {
      eliminatedName: this.room.players[eliminated]?.nickname,
      eliminatedAvatar: this.room.players[eliminated]?.avatar,
      eliminatedAnswer: this.answers[eliminated],
      breakdown, survivorNames, remaining: this.alive.length,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('los_resolve_player', {
        eliminated: id === eliminated, stillAlive: this.alive.includes(id),
        votesReceived: tally[id] || 0
      });
    });

    setTimeout(() => this.nextRound(), 6500);
  }

  showWinner() {
    this.phase = 'done';
    const winnerId = this.alive[0];
    if (winnerId && this.room.players[winnerId]) this.room.players[winnerId].score += 500; // survival crown bonus

    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);

    if (winnerId) {
      this.io.to(this.code).emit('los_winner', {
        winnerName: this.room.players[winnerId]?.nickname,
        winnerAvatar: this.room.players[winnerId]?.avatar
      });
    }
    setTimeout(() => {
      Object.keys(this.room.players).forEach(id => {
        this.io.to(id).emit('final_scores', { scores, gameName: 'Last One Standing' });
      });
      this.endGame(this.code, scores);
    }, 3500);
  }

  nextPhase() {
    if (this.phase === 'answering') { clearTimeout(this.writeTimer); this.startVoting(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.resolve(); }
  }
}

module.exports = LastOneStanding;
