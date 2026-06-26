const PROMPTS = [
  "A dog who just found out he's a good boy",
  "Time traveller stuck in the wrong decade",
  "WiFi going out during a boss fight",
  "A penguin at a job interview",
  "Monday morning as a feeling",
  "An avocado having an existential crisis",
  "A ghost who is afraid of people",
  "The moment you realise you left the stove on",
  "A robot falling in love for the first time",
  "Pizza so good it makes you cry",
  "A very small dragon with very big dreams",
  "Someone who just stepped on a Lego",
  "A cat judging your life choices",
  "The sun having a bad day",
  "A skeleton trying to be scary but failing",
  "A cloud that's been asked to do too much",
  "A fish discovering land for the first time",
  "Someone trying to parallel park for 20 minutes",
  "A haunted toaster with regrets",
  "An octopus who forgot where it put everything",
  "The last slice of pizza being defended",
  "A tree that just became a Christmas tree involuntarily",
  "Someone using a selfie stick at a funeral",
  "A very confused time traveller at a drive-through",
  "The moon watching humans argue on the internet",
];

class Drawful {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.usedPrompts = []; this.drawings = {};
    this.guesses = {}; this.votes = {}; this.allAnswers = [];
    this.phase = 'drawing'; this.currentDrawer = null;
    this.drawerQueue = []; this.currentRound = 0; this.totalRounds = 0;
  }

  start() {
    const players = Object.keys(this.room.players);
    this.drawerQueue = [...players].sort(() => Math.random() - 0.5);
    this.totalRounds = Math.min(players.length, 6);
    this.nextDrawer();
  }

  nextDrawer() {
    if (this.currentRound >= this.totalRounds || this.drawerQueue.length === 0) {
      this.showFinalResults(); return;
    }
    this.currentRound++;
    this.currentDrawer = this.drawerQueue.shift();
    this.guesses = {}; this.votes = {}; this.allAnswers = [];

    const available = PROMPTS.filter(p => !this.usedPrompts.includes(p));
    const prompt = available[Math.floor(Math.random() * available.length)];
    this.usedPrompts.push(prompt);
    this.currentPrompt = prompt;
    this.drawings[this.currentDrawer] = { prompt, strokes: [] };

    this.io.to(this.code).emit('drawful_drawing', {
      drawerId: this.currentDrawer,
      drawerName: this.room.players[this.currentDrawer]?.nickname,
      drawerAvatar: this.room.players[this.currentDrawer]?.avatar,
      round: this.currentRound, totalRounds: this.totalRounds
    });

    this.io.to(this.currentDrawer).emit('your_drawing_prompt', { prompt, timeLimit: 80 });

    Object.keys(this.room.players).forEach(id => {
      if (id !== this.currentDrawer) {
        this.io.to(id).emit('watch_drawing', {
          drawerId: this.currentDrawer,
          drawerName: this.room.players[this.currentDrawer]?.nickname
        });
      }
    });

    this.drawTimer = setTimeout(() => this.startGuessing(), 85000);
  }

  handleInput(playerId, data) {
    if (data.type === 'stroke' && playerId === this.currentDrawer) {
      if (this.drawings[this.currentDrawer]) this.drawings[this.currentDrawer].strokes.push(data.stroke);
      this.io.to(this.code).emit('new_stroke', { stroke: data.stroke });
    }
    if (data.type === 'clear' && playerId === this.currentDrawer) {
      this.io.to(this.code).emit('canvas_cleared');
    }
    if (data.type === 'done_drawing' && playerId === this.currentDrawer) {
      clearTimeout(this.drawTimer);
      setTimeout(() => this.startGuessing(), 500);
    }
    if (this.phase === 'guessing' && data.type === 'guess' && playerId !== this.currentDrawer) {
      if (!this.guesses[playerId]) {
        this.guesses[playerId] = { guess: data.guess.trim() || '???' };
        const eligible = Object.keys(this.room.players).filter(id => id !== this.currentDrawer).length;
        this.io.to(this.code).emit('player_answered', { count: Object.keys(this.guesses).length, total: eligible });
        if (Object.keys(this.guesses).length >= eligible) { clearTimeout(this.guessTimer); setTimeout(() => this.startVoting(), 500); }
      }
    }
    if (this.phase === 'voting' && data.type === 'vote' && playerId !== this.currentDrawer) {
      if (!this.votes[playerId]) {
        this.votes[playerId] = data.answerId;
        const eligible = Object.keys(this.room.players).filter(id => id !== this.currentDrawer).length;
        this.io.to(this.code).emit('vote_received', { count: Object.keys(this.votes).length, total: eligible });
        if (Object.keys(this.votes).length >= eligible) { clearTimeout(this.voteTimer); setTimeout(() => this.showDrawfulResults(), 500); }
      }
    }
  }

  startGuessing() {
    this.phase = 'guessing';
    const eligible = Object.keys(this.room.players).filter(id => id !== this.currentDrawer).length;
    this.io.to(this.code).emit('drawful_guess_phase', { total: eligible });
    Object.keys(this.room.players).forEach(id => {
      if (id !== this.currentDrawer) this.io.to(id).emit('enter_guess', { timeLimit: 30 });
      else this.io.to(id).emit('wait_for_votes', { message: "They're guessing your masterpiece! 🎨" });
    });
    this.guessTimer = setTimeout(() => this.startVoting(), 33000);
  }

  startVoting() {
    this.phase = 'voting';
    this.allAnswers = [];
    Object.entries(this.guesses).forEach(([pid, g]) => {
      if (g.guess.toLowerCase() !== this.currentPrompt.toLowerCase()) {
        this.allAnswers.push({ id: `guess_${pid}`, text: g.guess, playerId: pid, isCorrect: false });
      }
    });
    this.allAnswers.push({ id: 'correct', text: this.currentPrompt, isCorrect: true });
    this.allAnswers.sort(() => Math.random() - 0.5);

    const displayAnswers = this.allAnswers.map(a => ({ id: a.id, text: a.text }));
    this.io.to(this.code).emit('drawful_vote', { answers: displayAnswers });
    Object.keys(this.room.players).forEach(id => {
      if (id !== this.currentDrawer) this.io.to(id).emit('pick_answer', { answers: displayAnswers, timeLimit: 20, prompt: 'What is this drawing?!' });
    });
    this.voteTimer = setTimeout(() => this.showDrawfulResults(), 23000);
  }

  showDrawfulResults() {
    Object.values(this.room.players).forEach(p => {
      const vote = this.votes[p.id];
      if (!vote) return;
      const answer = this.allAnswers.find(a => a.id === vote);
      if (answer?.isCorrect) {
        p.score += 1000;
        if (this.room.players[this.currentDrawer]) this.room.players[this.currentDrawer].score += 500;
      } else if (answer?.playerId && this.room.players[answer.playerId]) {
        this.room.players[answer.playerId].score += 500;
      }
    });

    this.io.to(this.code).emit('drawful_results', {
      correctAnswer: this.currentPrompt, answers: this.allAnswers,
      votes: this.votes, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('drawful_results_player', {
        correctAnswer: this.currentPrompt, answers: this.allAnswers,
        votes: this.votes, myId: id, players: this.room.players
      });
    });

    setTimeout(() => this.nextDrawer(), 7000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    this.io.to(this.code).emit('round_scores', { scores, gameName: 'Drawful' });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.drawTimer); clearTimeout(this.guessTimer); clearTimeout(this.voteTimer);
    if (this.phase === 'drawing') this.startGuessing();
    else if (this.phase === 'guessing') this.startVoting();
    else if (this.phase === 'voting') this.showDrawfulResults();
  }
}
module.exports = Drawful;
