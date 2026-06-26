const PROMPTS = [
  "A dog wearing sunglasses", "Time travel gone wrong", "Pizza for breakfast",
  "An angry cloud", "A robot in love", "Monday morning",
  "A confused penguin", "The internet", "Gravity taking a day off",
  "A very small elephant", "Wifi password", "Someone who just saw a ghost",
  "A dragon ordering coffee", "The last cookie", "Two left feet",
  "A haunted toaster", "Philosophical cat", "Rain that goes upward",
  "A sandwich with feelings", "An octopus playing drums",
  "The speed of light but slow", "A door to nowhere", "Upside-down birthday",
  "A star that's stage fright", "The moon's day job",
];

class Drawful {
  constructor(room, io, endGame) {
    this.room = room;
    this.io = io;
    this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3;
    this.currentRound = 0;
    this.drawings = {}; // playerId -> { prompt, strokes }
    this.guesses = {}; // playerId -> { drawerId, guess }
    this.votes = {}; // playerId -> guessId
    this.phase = 'drawing';
    this.usedPrompts = [];
    this.currentDrawer = null;
    this.drawerQueue = [];
    this.allAnswers = [];
  }

  start() {
    this.drawerQueue = Object.keys(this.room.players).sort(() => Math.random() - 0.5);
    this.nextDrawer();
  }

  nextDrawer() {
    if (this.drawerQueue.length === 0) {
      this.currentRound++;
      if (this.currentRound >= this.rounds) {
        this.showFinalResults();
        return;
      }
      this.drawerQueue = Object.keys(this.room.players).sort(() => Math.random() - 0.5);
    }

    this.currentDrawer = this.drawerQueue.shift();
    this.guesses = {};
    this.votes = {};
    this.allAnswers = [];

    const available = PROMPTS.filter(p => !this.usedPrompts.includes(p));
    const prompt = available[Math.floor(Math.random() * available.length)];
    this.usedPrompts.push(prompt);
    this.currentPrompt = prompt;

    this.phase = 'drawing';
    this.drawings[this.currentDrawer] = { prompt, strokes: [] };

    // Tell everyone who's drawing
    this.io.to(this.code).emit('drawful_drawing', {
      drawerId: this.currentDrawer,
      drawerName: this.room.players[this.currentDrawer]?.nickname,
      drawerAvatar: this.room.players[this.currentDrawer]?.avatar,
      round: this.currentRound + 1,
      totalRounds: this.rounds,
      timeLimit: 80
    });

    // Give drawer their prompt
    this.io.to(this.currentDrawer).emit('your_drawing_prompt', { prompt });

    // Watchers get spectator mode
    Object.values(this.room.players).forEach(p => {
      if (p.id !== this.currentDrawer) {
        this.io.to(p.id).emit('watch_drawing', { drawerId: this.currentDrawer });
      }
    });

    this.drawTimer = setTimeout(() => this.startGuessing(), 85000);
  }

  handleInput(playerId, data) {
    if (data.type === 'stroke' && playerId === this.currentDrawer) {
      if (this.drawings[this.currentDrawer]) {
        this.drawings[this.currentDrawer].strokes.push(data.stroke);
      }
      // Broadcast stroke to all watchers
      this.io.to(this.code).emit('new_stroke', { stroke: data.stroke });
    }

    if (data.type === 'done_drawing' && playerId === this.currentDrawer) {
      clearTimeout(this.drawTimer);
      setTimeout(() => this.startGuessing(), 500);
    }

    if (this.phase === 'guessing' && data.type === 'guess' && playerId !== this.currentDrawer) {
      if (!this.guesses[playerId]) {
        this.guesses[playerId] = { guess: data.guess };
        this.io.to(this.code).emit('player_answered', {
          count: Object.keys(this.guesses).length
        });
        const eligible = Object.values(this.room.players).filter(p => p.id !== this.currentDrawer);
        if (Object.keys(this.guesses).length >= eligible.length) {
          clearTimeout(this.guessTimer);
          setTimeout(() => this.startVoting(), 500);
        }
      }
    }

    if (this.phase === 'voting' && data.type === 'vote' && playerId !== this.currentDrawer) {
      if (!this.votes[playerId]) {
        this.votes[playerId] = data.answerId;
        this.io.to(this.code).emit('vote_received', { count: Object.keys(this.votes).length });

        const eligible = Object.values(this.room.players).filter(p => p.id !== this.currentDrawer);
        if (Object.keys(this.votes).length >= eligible.length) {
          clearTimeout(this.voteTimer);
          setTimeout(() => this.showDrawfulResults(), 500);
        }
      }
    }
  }

  startGuessing() {
    this.phase = 'guessing';
    this.io.to(this.code).emit('drawful_guess_phase', { timeLimit: 30 });

    Object.values(this.room.players).forEach(p => {
      if (p.id !== this.currentDrawer) {
        this.io.to(p.id).emit('enter_guess', {});
      } else {
        this.io.to(p.id).emit('wait_for_guesses', {});
      }
    });

    this.guessTimer = setTimeout(() => this.startVoting(), 35000);
  }

  startVoting() {
    this.phase = 'voting';
    // Build answer list: all guesses + real answer
    this.allAnswers = [];

    Object.entries(this.guesses).forEach(([pid, g]) => {
      this.allAnswers.push({
        id: `guess_${pid}`,
        text: g.guess || '(no guess)',
        playerId: pid,
        isCorrect: false
      });
    });

    this.allAnswers.push({
      id: 'correct',
      text: this.currentPrompt,
      isCorrect: true
    });

    this.allAnswers.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('drawful_vote', {
      answers: this.allAnswers.map(a => ({ id: a.id, text: a.text }))
    });

    Object.values(this.room.players).forEach(p => {
      if (p.id !== this.currentDrawer) {
        this.io.to(p.id).emit('pick_answer', {
          answers: this.allAnswers.map(a => ({ id: a.id, text: a.text }))
        });
      }
    });

    this.voteTimer = setTimeout(() => this.showDrawfulResults(), 25000);
  }

  showDrawfulResults() {
    // Score: 1000 for correct guess, 500 for each person fooled by your fake
    Object.values(this.room.players).forEach(p => {
      const vote = this.votes[p.id];
      if (!vote) return;
      const answer = this.allAnswers.find(a => a.id === vote);
      if (answer?.isCorrect) {
        p.score += 1000;
        // Drawer also gets points when guessed
        if (this.room.players[this.currentDrawer]) {
          this.room.players[this.currentDrawer].score += 500;
        }
      } else if (answer?.playerId) {
        if (this.room.players[answer.playerId]) {
          this.room.players[answer.playerId].score += 500;
        }
      }
    });

    this.io.to(this.code).emit('drawful_results', {
      correctAnswer: this.currentPrompt,
      answers: this.allAnswers,
      votes: this.votes,
      players: this.room.players
    });

    setTimeout(() => this.nextDrawer(), 7000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score
    })).sort((a, b) => b.score - a.score);

    this.io.to(this.code).emit('round_scores', { scores, gameName: 'Drawful' });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.drawTimer);
    clearTimeout(this.guessTimer);
    clearTimeout(this.voteTimer);
    if (this.phase === 'drawing') this.startGuessing();
    else if (this.phase === 'guessing') this.startVoting();
    else if (this.phase === 'voting') this.showDrawfulResults();
  }
}

module.exports = Drawful;
