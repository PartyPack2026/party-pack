const PROMPTS = [
  "The worst thing to say at a job interview: ___",
  "My superpower is ___, but only on Tuesdays",
  "The new Olympic sport nobody asked for: ___",
  "What the aliens said when they finally arrived: ___",
  "The rejected sequel to a famous movie: ___",
  "A terrible name for a baby: ___",
  "The worst pizza topping ever invented: ___",
  "What's actually inside a black hole: ___",
  "My dating profile says I'm looking for ___",
  "The world would be better if everyone had to ___",
  "A bad idea for a children's book: ___",
  "The rejected slogan for McDonald's: ___",
  "What I actually do at work all day: ___",
  "The most useless invention: ___",
  "My cat's secret job is ___",
  "The worst superhero power: ___",
  "A bad name for a restaurant: ___",
  "Scientists just discovered that ___ causes cancer",
  "My therapist told me to stop ___",
  "The rejected flavor of ice cream: ___",
];

class Quiplash {
  constructor(room, io, endGame) {
    this.room = room;
    this.io = io;
    this.endGame = endGame;
    this.code = room.code;
    this.phase = 'answering';
    this.rounds = 3;
    this.currentRound = 0;
    this.prompts = [];
    this.assignments = {}; // playerId -> { prompt, answer }
    this.votingPairs = [];
    this.currentVoteIndex = 0;
    this.votes = {};
    this.roundScores = {};
  }

  start() {
    this.nextRound();
  }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) {
      this.showFinalResults();
      return;
    }

    const players = Object.values(this.room.players);
    const shuffledPrompts = [...PROMPTS].sort(() => Math.random() - 0.5);
    this.assignments = {};
    this.votingPairs = [];
    this.votes = {};

    // Assign each player a prompt
    players.forEach((player, i) => {
      this.assignments[player.id] = {
        prompt: shuffledPrompts[i % shuffledPrompts.length],
        answer: null
      };
    });

    this.phase = 'answering';
    this.io.to(this.code).emit('quiplash_round', {
      round: this.currentRound,
      totalRounds: this.rounds,
      phase: 'answering',
      timeLimit: 60
    });

    // Send each player their prompt
    players.forEach(player => {
      this.io.to(player.id).emit('your_prompt', {
        prompt: this.assignments[player.id].prompt
      });
    });

    // Auto-advance after 70s
    this.answerTimer = setTimeout(() => this.startVoting(), 70000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      if (this.assignments[playerId]) {
        this.assignments[playerId].answer = data.answer || '(no answer)';
        this.io.to(this.code).emit('player_answered', { playerId, count: this.getAnswerCount() });

        // Check if all answered
        const players = Object.values(this.room.players);
        if (this.getAnswerCount() >= players.length) {
          clearTimeout(this.answerTimer);
          setTimeout(() => this.startVoting(), 1000);
        }
      }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      const pair = this.votingPairs[this.currentVoteIndex];
      if (!pair) return;
      if (data.vote !== pair.player1 && data.vote !== pair.player2) return;
      if (playerId === pair.player1 || playerId === pair.player2) return; // Can't vote for yourself
      if (this.votes[playerId]) return; // Already voted

      this.votes[playerId] = data.vote;
      this.io.to(this.code).emit('vote_received', { count: Object.keys(this.votes).length });

      const eligible = Object.values(this.room.players).filter(
        p => p.id !== pair.player1 && p.id !== pair.player2
      );
      if (Object.keys(this.votes).length >= eligible.length) {
        clearTimeout(this.voteTimer);
        this.showVoteResults();
      }
    }
  }

  getAnswerCount() {
    return Object.values(this.assignments).filter(a => a.answer !== null).length;
  }

  startVoting() {
    // Fill in missing answers
    Object.values(this.assignments).forEach(a => {
      if (!a.answer) a.answer = '(no answer)';
    });

    // Create pairs for head-to-head voting
    const players = Object.values(this.room.players);
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    this.votingPairs = [];

    for (let i = 0; i < shuffled.length - 1; i += 2) {
      this.votingPairs.push({
        player1: shuffled[i].id,
        player2: shuffled[i + 1].id,
      });
    }

    // If odd number, last player goes against "the audience" (skipped)
    this.currentVoteIndex = 0;
    this.showNextVote();
  }

  showNextVote() {
    if (this.currentVoteIndex >= this.votingPairs.length) {
      this.nextRound();
      return;
    }

    this.phase = 'voting';
    this.votes = {};
    const pair = this.votingPairs[this.currentVoteIndex];
    const p1 = this.room.players[pair.player1];
    const p2 = this.room.players[pair.player2];
    const a1 = this.assignments[pair.player1];
    const a2 = this.assignments[pair.player2];

    this.io.to(this.code).emit('quiplash_vote', {
      prompt: a1.prompt,
      options: [
        { playerId: pair.player1, nickname: p1.nickname, avatar: p1.avatar, answer: a1.answer },
        { playerId: pair.player2, nickname: p2.nickname, avatar: p2.avatar, answer: a2.answer },
      ]
    });

    // Send voting UI to non-competing players
    Object.values(this.room.players).forEach(p => {
      if (p.id !== pair.player1 && p.id !== pair.player2) {
        this.io.to(p.id).emit('vote_now', {
          options: [
            { playerId: pair.player1, answer: a1.answer },
            { playerId: pair.player2, answer: a2.answer },
          ]
        });
      } else {
        this.io.to(p.id).emit('wait_for_vote', {});
      }
    });

    this.voteTimer = setTimeout(() => this.showVoteResults(), 30000);
  }

  showVoteResults() {
    const pair = this.votingPairs[this.currentVoteIndex];
    const tally = { [pair.player1]: 0, [pair.player2]: 0 };
    Object.values(this.votes).forEach(v => { if (tally[v] !== undefined) tally[v]++; });

    // Award points
    const totalVotes = Object.values(this.votes).length;
    Object.entries(tally).forEach(([pid, count]) => {
      const points = count * 100;
      this.room.players[pid].score += points;
    });

    this.io.to(this.code).emit('vote_results', {
      tally,
      votes: this.votes,
      players: this.room.players
    });

    this.currentVoteIndex++;
    setTimeout(() => this.showNextVote(), 5000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score
    })).sort((a, b) => b.score - a.score);

    this.io.to(this.code).emit('round_scores', { scores, gameName: 'Quiplash' });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    // Allow host to skip timers
    clearTimeout(this.answerTimer);
    clearTimeout(this.voteTimer);
    if (this.phase === 'answering') this.startVoting();
    else if (this.phase === 'voting') this.showVoteResults();
  }
}

module.exports = Quiplash;
