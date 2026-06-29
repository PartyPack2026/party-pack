const DEFAULT_PROMPTS = [
  "A dog who just found out he's a good boy","WiFi going out during a boss fight","A penguin at a job interview",
  "Monday morning as a feeling","A vampire at the dentist","Two robots in love","A pineapple riding a skateboard",
  "A ghost trying to use a phone","A cat plotting world domination","A dinosaur at a job interview","An octopus playing drums",
  "A snowman on holiday in the desert","A wizard stuck in traffic","A shark eating spaghetti","A penguin DJ",
  "A grandma breakdancing","An alien tasting pizza for the first time","A pirate afraid of water","A unicorn at the gym",
  "A frog wearing a tiny hat","A spider knitting a sweater","A cow trying to fly","A robot walking a dog in the rain",
  "A banana slipping on a person","A cactus giving a hug","A dragon making toast","A bear stuck in a chimney",
  "A sloth running late","A jellyfish doing yoga","A giraffe in a turtleneck","A worm lifting weights",
  "A duck driving a tank","A snail winning a race","A chicken crossing a busy road","A monkey writing poetry",
  "A potato on a rollercoaster","A llama at a fancy restaurant","A bee filing taxes","A whale in a bathtub",
  "An owl who can't see in the dark","A hamster running a marathon","A crab playing the violin","A turtle escaping prison",
  "A pigeon ruling a kingdom","A koala doing taxes","A flamingo standing on the wrong leg","A moth attacking a lamp",
  "A hedgehog hugging a balloon","A toad knighting a frog","A T-rex trying to clap"
];

class Scrawl {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.usedPrompts = [];
    this.guesses = {}; this.votes = {}; this.allAnswers = [];
    this.phase = 'drawing'; this.currentDrawer = null;
    this.drawerQueue = []; this.currentRound = 0; this.totalRounds = 0;
    this.strokes = []; // full canvas state for late joiners
    this.allPrompts = [...DEFAULT_PROMPTS, ...(room.customPrompts || [])];
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
    this.strokes = [];

    const available = this.allPrompts.filter(p => !this.usedPrompts.includes(p));
    const pool = available.length > 0 ? available : this.allPrompts;
    const prompt = pool[Math.floor(Math.random() * pool.length)];
    this.usedPrompts.push(prompt);
    this.currentPrompt = prompt;

    const drawerInfo = this.room.players[this.currentDrawer];

    // Everyone gets notified a new round started
    Object.keys(this.room.players).forEach(id => {
      if (id === this.currentDrawer) {
        // Drawer gets their prompt and drawing canvas
        this.io.to(id).emit('scrawl_you_draw', {
          prompt, round: this.currentRound, totalRounds: this.totalRounds,
          timeLimit: 60
        });
      } else {
        // Everyone else watches the canvas live
        this.io.to(id).emit('scrawl_watch', {
          drawerId: this.currentDrawer,
          drawerName: drawerInfo?.nickname,
          drawerAvatar: drawerInfo?.avatar,
          round: this.currentRound, totalRounds: this.totalRounds
        });
      }
    });

    // Tell the HOST screen to show the live canvas
    this.io.to(this.code).emit('scrawl_drawing_started', {
      drawerName: drawerInfo?.nickname,
      round: this.currentRound, totalRounds: this.totalRounds
    });

    this.drawTimer = setTimeout(() => this.startGuessing(), 85000);
  }

  handleInput(playerId, data) {
    if (data.type === 'stroke' && playerId === this.currentDrawer) {
      this.strokes.push(data.stroke);
      // broadcast to other players AND the host screen
      this.io.to(this.code).except(playerId).emit('draw_stroke', { stroke: data.stroke });
    }

    if (data.type === 'clear' && playerId === this.currentDrawer) {
      this.strokes = [];
      this.io.to(this.code).except(playerId).emit('draw_cleared');
    }

    if (data.type === 'request_strokes') {
      // Late joiner requesting full canvas state
      this.io.to(playerId).emit('draw_full_state', { strokes: this.strokes });
    }

    if (data.type === 'done_drawing' && playerId === this.currentDrawer) {
      clearTimeout(this.drawTimer);
      setTimeout(() => this.startGuessing(), 500);
    }

    if (this.phase === 'guessing' && data.type === 'guess' && playerId !== this.currentDrawer) {
      if (!this.guesses[playerId]) {
        this.guesses[playerId] = data.guess.trim() || '???';
        const eligible = Object.keys(this.room.players).filter(id => id !== this.currentDrawer).length;
        const count = Object.keys(this.guesses).length;
        Object.keys(this.room.players).forEach(id => {
          this.io.to(id).emit('guess_count', { count, total: eligible });
        });
        if (count >= eligible) { clearTimeout(this.guessTimer); setTimeout(() => this.startVoting(), 500); }
      }
    }

    if (this.phase === 'voting' && data.type === 'vote' && playerId !== this.currentDrawer) {
      if (!this.votes[playerId]) {
        this.votes[playerId] = data.answerId;
        const eligible = Object.keys(this.room.players).filter(id => id !== this.currentDrawer).length;
        const count = Object.keys(this.votes).length;
        Object.keys(this.room.players).forEach(id => {
          this.io.to(id).emit('vote_count', { count, total: eligible });
        });
        if (count >= eligible) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 500); }
      }
    }
  }

  startGuessing() {
    this.phase = 'guessing';
    const eligible = Object.keys(this.room.players).filter(id => id !== this.currentDrawer).length;
    const drawerInfo = this.room.players[this.currentDrawer];

    Object.keys(this.room.players).forEach(id => {
      if (id !== this.currentDrawer) {
        this.io.to(id).emit('scrawl_guess', {
          timeLimit: 30,
          drawerName: drawerInfo?.nickname,
          strokes: this.strokes
        });
      } else {
        this.io.to(id).emit('scrawl_drawer_wait', {
          message: "They're guessing your masterpiece! 🎨"
        });
      }
    });

    // Update host screen
    this.io.to(this.code).emit('scrawl_guessing', { drawerName: drawerInfo?.nickname });

    this.guessTimer = setTimeout(() => this.startVoting(), 33000);
  }

  startVoting() {
    this.phase = 'voting';
    this.allAnswers = [];

    Object.entries(this.guesses).forEach(([pid, guess]) => {
      if (guess.toLowerCase() !== this.currentPrompt.toLowerCase()) {
        this.allAnswers.push({ id: `g_${pid}`, text: guess, playerId: pid, isCorrect: false });
      }
    });
    this.allAnswers.push({ id: 'correct', text: this.currentPrompt, isCorrect: true });
    this.allAnswers.sort(() => Math.random() - 0.5);

    const displayAnswers = this.allAnswers.map(a => ({ id: a.id, text: a.text }));
    const drawerInfo = this.room.players[this.currentDrawer];

    Object.keys(this.room.players).forEach(id => {
      if (id !== this.currentDrawer) {
        this.io.to(id).emit('scrawl_vote', {
          answers: displayAnswers,
          strokes: this.strokes,
          timeLimit: 20,
          drawerName: drawerInfo?.nickname
        });
      } else {
        this.io.to(id).emit('scrawl_drawer_wait', { message: "They're voting! 🗳️" });
      }
    });

    // Show voting options on host screen
    this.io.to(this.code).emit('scrawl_vote_display', { answers: displayAnswers });

    this.voteTimer = setTimeout(() => this.showResults(), 23000);
  }

  showResults() {
    // Score
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

    const drawerInfo = this.room.players[this.currentDrawer];

    Object.keys(this.room.players).forEach(id => {
      const myVote = this.votes[id];
      const myAnswer = this.allAnswers.find(a => a.id === myVote);
      const gotIt = myAnswer?.isCorrect;
      const fooledCount = myAnswer ? 0 : Object.values(this.votes).filter(v => {
        const a = this.allAnswers.find(x => x.id === v);
        return a?.playerId === id;
      }).length;

      this.io.to(id).emit('scrawl_results', {
        correctAnswer: this.currentPrompt,
        answers: this.allAnswers,
        votes: this.votes,
        players: this.room.players,
        strokes: this.strokes,
        drawerId: this.currentDrawer,
        drawerName: drawerInfo?.nickname,
        myId: id,
        gotIt,
        fooledCount
      });
    });

    // Reveal answer on host screen
    this.io.to(this.code).emit('scrawl_reveal', {
      prompt: this.currentPrompt, players: this.room.players
    });

    setTimeout(() => this.nextDrawer(), 8000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Scrawl' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.drawTimer); clearTimeout(this.guessTimer); clearTimeout(this.voteTimer);
    if (this.phase === 'drawing') this.startGuessing();
    else if (this.phase === 'guessing') this.startVoting();
    else if (this.phase === 'voting') this.showResults();
  }
}
module.exports = Scrawl;
