// ACRONYMS — players get 3-4 random letters and invent what they stand for.
// Everyone votes for the funniest. Best acronym wins the round.

const LETTERS = "ABCDEFGHIJKLMNOPRSTUW"; // skip Q/V/X/Y/Z — too hard to start words with

function randomAcronym(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return s;
}

class Acronyms {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.phase = 'writing';
    this.answers = {};
    this.votes = {};
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }

    // Letters get longer each round (3, then 4, then 5) for escalating difficulty
    const len = 2 + this.currentRound;
    this.acronym = randomAcronym(len);
    this.answers = {};
    this.phase = 'writing';

    this.io.to(this.code).emit('acro_round', {
      round: this.currentRound, totalRounds: this.rounds,
      acronym: this.acronym
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('acro_write', {
        acronym: this.acronym, timeLimit: 45
      });
    });

    this.writeTimer = setTimeout(() => this.startVoting(), 48000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'writing' && data.type === 'answer') {
      const text = String(data.answer || '').slice(0, 80).trim();
      if (!text) return;
      this.answers[playerId] = text;
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('acro_answered', { count, total });
      this.io.to(playerId).emit('acro_submitted', {});
      if (count >= total) { clearTimeout(this.writeTimer); setTimeout(() => this.startVoting(), 700); }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      if (playerId === data.target) return; // can't vote for your own
      if (!this.answers[data.target]) return;
      this.votes[playerId] = data.target;
      const voters = Object.keys(this.room.players).filter(id => this.answers[id] !== undefined || true).length;
      const count = Object.keys(this.votes).length;
      this.io.to(this.code).emit('acro_vote_count', { count });
      this.io.to(playerId).emit('acro_voted', {});
      // everyone who can vote has voted
      if (count >= Object.keys(this.room.players).length) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  startVoting() {
    if (this.phase === 'voting') return;
    this.phase = 'voting';
    this.votes = {};

    // Build the list of answers (shuffled, anonymous)
    const entries = Object.entries(this.answers).map(([id, text]) => ({ id, text }));
    // players who didn't answer get a filler so the round still works
    if (entries.length === 0) { this.showResults(); return; }
    const shuffled = entries.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('acro_vote_display', {
      acronym: this.acronym,
      answers: shuffled.map(e => ({ id: e.id, text: e.text }))
    });

    Object.keys(this.room.players).forEach(id => {
      // each voter sees all answers except their own
      const options = shuffled.filter(e => e.id !== id).map(e => ({ id: e.id, text: e.text }));
      this.io.to(id).emit('acro_vote', {
        acronym: this.acronym, options,
        youAnswered: this.answers[id] !== undefined
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

    // Award: votes * 100, winner bonus 300
    Object.entries(tally).forEach(([id, v]) => {
      if (this.room.players[id]) this.room.players[id].score += v * 100;
    });
    Object.keys(tally).forEach(id => {
      if (tally[id] === maxVotes && maxVotes > 0 && this.room.players[id]) this.room.players[id].score += 300;
    });

    const results = Object.entries(this.answers).map(([id, text]) => ({
      id, text,
      nickname: this.room.players[id]?.nickname || '?',
      votes: tally[id] || 0,
      isWinner: (tally[id] || 0) === maxVotes && maxVotes > 0
    })).sort((a, b) => b.votes - a.votes);

    this.io.to(this.code).emit('acro_results', {
      acronym: this.acronym, results, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('acro_result_player', {
        won: (tally[id] || 0) === maxVotes && maxVotes > 0,
        votes: tally[id] || 0
      });
    });

    setTimeout(() => this.nextRound(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Acronyms' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'writing') { clearTimeout(this.writeTimer); this.startVoting(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = Acronyms;
