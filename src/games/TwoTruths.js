// TWO TRUTHS & A LIE — each player writes two true things and one lie about themselves.
// Everyone else guesses which is the lie. Fool people = points. Spot the lie = points.

class TwoTruths {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'writing';
    this.statements = {}; // playerId -> {items:[{text,isLie}], order:[...]}
    this.guessQueue = [];
    this.currentTarget = null;
    this.guesses = {};
  }

  start() {
    this.phase = 'writing';
    this.statements = {};
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('tt_write', { timeLimit: 75 });
    });
    this.io.to(this.code).emit('tt_writing', {
      players: Object.values(this.room.players).map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar }))
    });
    this.writeTimer = setTimeout(() => this.beginGuessing(), 80000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'writing' && data.type === 'statements') {
      const truths = (data.truths || []).map(t => String(t).slice(0, 100).trim()).filter(Boolean);
      const lie = String(data.lie || '').slice(0, 100).trim();
      if (truths.length < 2 || !lie) return;
      // build shuffled item list
      const items = [
        { text: truths[0], isLie: false },
        { text: truths[1], isLie: false },
        { text: lie, isLie: true }
      ].sort(() => Math.random() - 0.5);
      this.statements[playerId] = { items };
      const count = Object.keys(this.statements).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('tt_write_count', { count, total });
      this.io.to(playerId).emit('tt_submitted', {});
      if (count >= total) { clearTimeout(this.writeTimer); setTimeout(() => this.beginGuessing(), 700); }
    } else if (this.phase === 'guessing' && data.type === 'guess') {
      if (playerId === this.currentTarget) return; // can't guess your own
      if (this.guesses[playerId] !== undefined) return;
      this.guesses[playerId] = data.index;
      const total = Object.keys(this.room.players).length - 1; // everyone except target
      const count = Object.keys(this.guesses).length;
      this.io.to(this.code).emit('tt_guess_count', { count, total });
      this.io.to(playerId).emit('tt_guessed', {});
      if (count >= total) { clearTimeout(this.guessTimer); setTimeout(() => this.revealTarget(), 700); }
    }
  }

  beginGuessing() {
    this.phase = 'guessing';
    this.guessQueue = Object.keys(this.statements);
    if (this.guessQueue.length === 0) { this.showFinal(); return; }
    this.nextTarget();
  }

  nextTarget() {
    if (this.guessQueue.length === 0) { this.showFinal(); return; }
    this.currentTarget = this.guessQueue.shift();
    this.guesses = {};
    const target = this.room.players[this.currentTarget];
    const stmt = this.statements[this.currentTarget];
    if (!target || !stmt) { this.nextTarget(); return; }

    // Host shows whose statements + the three options
    this.io.to(this.code).emit('tt_round', {
      targetName: target.nickname, targetAvatar: target.avatar,
      items: stmt.items.map((it, i) => ({ index: i, text: it.text })),
      remaining: this.guessQueue.length
    });

    // Players guess (except the target, who watches)
    Object.keys(this.room.players).forEach(id => {
      if (id === this.currentTarget) {
        this.io.to(id).emit('tt_watch', { message: "Everyone's guessing your lie..." });
      } else {
        this.io.to(id).emit('tt_guess', {
          targetName: target.nickname,
          items: stmt.items.map((it, i) => ({ index: i, text: it.text }))
        });
      }
    });

    this.guessTimer = setTimeout(() => this.revealTarget(), 25000);
  }

  revealTarget() {
    this.phase = 'reveal';
    const stmt = this.statements[this.currentTarget];
    const lieIndex = stmt.items.findIndex(it => it.isLie);
    const target = this.room.players[this.currentTarget];

    // Tally who guessed what; correct guessers get points, target gets points per person fooled
    let fooled = 0;
    Object.entries(this.guesses).forEach(([voter, idx]) => {
      if (idx === lieIndex) {
        if (this.room.players[voter]) this.room.players[voter].score += 300; // spotted the lie
      } else {
        fooled++;
        if (this.room.players[voter]) this.room.players[voter].score += 50; // consolation
      }
    });
    if (target) target.score += fooled * 200; // points for everyone you fooled

    // counts per option
    const optionVotes = [0, 0, 0];
    Object.values(this.guesses).forEach(idx => { if (idx >= 0 && idx < 3) optionVotes[idx]++; });

    this.io.to(this.code).emit('tt_reveal', {
      targetName: target?.nickname,
      lieIndex,
      items: stmt.items.map((it, i) => ({ index: i, text: it.text, isLie: it.isLie })),
      optionVotes,
      fooled,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      if (id === this.currentTarget) {
        this.io.to(id).emit('tt_reveal_player', { isTarget: true, fooled });
      } else {
        const correct = this.guesses[id] === lieIndex;
        this.io.to(id).emit('tt_reveal_player', { isTarget: false, correct });
      }
    });

    setTimeout(() => this.nextTarget(), 6000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Two Truths & a Lie' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'writing') { clearTimeout(this.writeTimer); this.beginGuessing(); }
    else if (this.phase === 'guessing') { clearTimeout(this.guessTimer); this.revealTarget(); }
  }
}

module.exports = TwoTruths;
