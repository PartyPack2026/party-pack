const ORIGINALS = [
  "A dog chasing its tail",
  "Someone trying to parallel park",
  "A cat sitting in a box",
  "Person slipping on a banana peel",
  "A very tiny elephant",
  "Someone trying to open a jar",
  "A penguin in a business suit",
  "A ghost haunting an Ikea",
  "Someone doing yoga badly",
  "A bear eating honey",
  "A robot learning to dance",
  "Person lost in IKEA",
  "A crab doing the moonwalk",
  "Someone explaining the internet to grandma",
  "A dragon with hiccups",
  "Person pretending to understand directions",
  "A shark at a dinner party",
  "Someone parallel parking a spaceship",
  "A cowboy at the beach",
  "Monday morning as a person",
];

class Copycat {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'drawing';
    this.playerOrder = []; this.originalPrompt = null;
    this.drawings = {}; // playerId -> base64 drawing data URL
    this.currentDrawerIndex = 0;
    this.drawingTimeout = null;
  }

  start() {
    const players = Object.values(this.room.players);
    this.playerOrder = [...players].sort(() => Math.random() - 0.5).map(p => p.id);
    const prompt = ORIGINALS[Math.floor(Math.random() * ORIGINALS.length)];
    this.originalPrompt = prompt;
    this.drawings = {};
    this.currentDrawerIndex = 0;

    this.io.to(this.code).emit('copycat_start', {
      playerCount: players.length,
      prompt: '???', // keep hidden on TV until reveal
    });

    // First player gets original prompt
    this.sendToNextDrawer();
  }

  sendToNextDrawer() {
    if (this.currentDrawerIndex >= this.playerOrder.length) {
      this.showReveal(); return;
    }

    const drawerId = this.playerOrder[this.currentDrawerIndex];
    const isFirst = this.currentDrawerIndex === 0;
    const prevDrawerId = isFirst ? null : this.playerOrder[this.currentDrawerIndex - 1];
    const prevDrawing = prevDrawerId ? this.drawings[prevDrawerId] : null;

    const total = this.playerOrder.length;
    const position = this.currentDrawerIndex + 1;

    this.io.to(this.code).emit('copycat_drawing_phase', {
      drawerName: this.room.players[drawerId]?.nickname,
      drawerAvatar: this.room.players[drawerId]?.avatar,
      position, total,
      isFirst
    });

    // Tell current drawer what to draw
    this.io.to(drawerId).emit('copycat_your_turn', {
      isFirst,
      prompt: isFirst ? this.originalPrompt : null,
      previousDrawing: isFirst ? null : prevDrawing,
      instruction: isFirst
        ? `Draw: "${this.originalPrompt}"`
        : `Copy this drawing as best you can!`,
      timeLimit: 50,
      position, total
    });

    // Tell everyone else to wait
    Object.keys(this.room.players).forEach(id => {
      if (id !== drawerId) {
        this.io.to(id).emit('copycat_wait', {
          drawerName: this.room.players[drawerId]?.nickname,
          position, total
        });
      }
    });

    this.drawingTimeout = setTimeout(() => {
      // Auto-advance if they don't submit
      this.currentDrawerIndex++;
      this.sendToNextDrawer();
    }, 65000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'drawing' && data.type === 'copycat_submit' && playerId === this.playerOrder[this.currentDrawerIndex]) {
      clearTimeout(this.drawingTimeout);
      this.drawings[playerId] = data.imageData; // base64 data URL of canvas
      this.currentDrawerIndex++;
      setTimeout(() => this.sendToNextDrawer(), 500);
    }
  }

  showReveal() {
    this.phase = 'reveal';

    const chain = this.playerOrder.map(id => ({
      id,
      nickname: this.room.players[id]?.nickname,
      avatar: this.room.players[id]?.avatar,
      drawing: this.drawings[id] || null
    }));

    // Everyone votes for their favourite
    this.io.to(this.code).emit('copycat_reveal', {
      originalPrompt: this.originalPrompt,
      chain
    });

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('copycat_vote', {
        originalPrompt: this.originalPrompt,
        chain,
        timeLimit: 30
      });
    });

    this.votes = {};
    this.voteTimer = setTimeout(() => this.scoreVotes(), 33000);
  }

  handleVote(playerId, data) {
    if (data.type === 'copycat_vote' && !this.votes[playerId]) {
      this.votes[playerId] = data.votedFor;
      const count = Object.keys(this.votes).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('vote_received', { count, total });
      if (count >= total) { clearTimeout(this.voteTimer); this.scoreVotes(); }
    }
  }

  handleInput(playerId, data) {
    if (this.phase === 'drawing' && data.type === 'copycat_submit' && playerId === this.playerOrder[this.currentDrawerIndex]) {
      clearTimeout(this.drawingTimeout);
      this.drawings[playerId] = data.imageData;
      this.currentDrawerIndex++;
      setTimeout(() => this.sendToNextDrawer(), 500);
    }
    if (this.phase === 'reveal' && data.type === 'copycat_vote' && !this.votes?.[playerId]) {
      if (!this.votes) this.votes = {};
      this.votes[playerId] = data.votedFor;
      const count = Object.keys(this.votes).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('vote_received', { count, total });
      if (count >= total) { clearTimeout(this.voteTimer); this.scoreVotes(); }
    }
  }

  scoreVotes() {
    clearTimeout(this.voteTimer);
    const tally = {};
    if (this.votes) {
      Object.values(this.votes).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
    }
    Object.entries(tally).forEach(([pid, count]) => {
      if (this.room.players[pid]) this.room.players[pid].score += count * 300;
    });
    // Bonus for first drawer (original)
    const firstDrawer = this.playerOrder[0];
    if (this.room.players[firstDrawer]) this.room.players[firstDrawer].score += 200;

    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);

    this.io.to(this.code).emit('copycat_scores', { tally, players: this.room.players, scores });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Copycat' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.drawingTimeout);
    if (this.phase === 'drawing') {
      this.drawings[this.playerOrder[this.currentDrawerIndex]] = null;
      this.currentDrawerIndex++;
      this.sendToNextDrawer();
    }
  }
}
module.exports = Copycat;
