// WORD CHAIN — players build a ridiculous story together, one line at a time.
// Each player adds the next line to the story. At the end, vote for the funniest line.

const STARTERS = [
  "It was a dark and stormy night when suddenly...",
  "The penguin walked into the bar and ordered...",
  "Nobody expected the wedding to go wrong, but then...",
  "Deep in the jungle, the explorer discovered...",
  "The robot uprising began the day someone...",
  "On the first day of school, the new kid...",
  "The detective knew something was off when...",
  "Legend says that whoever opens the box will...",
  "The spaceship landed and out stepped...",
  "It started as a normal Tuesday until the fridge...",
  "The wizard's spell went horribly wrong and...",
  "At exactly midnight, every cat in town began to...",
  "The treasure map led them straight to...",
  "When the lights came back on, everyone realised...",
  "The world's worst superhero finally...",
];

class WordChain {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'building';
    this.story = [];       // {playerId, name, text}
    this.turnOrder = [];
    this.turnIndex = 0;
    this.maxLines = 0;
    this.votes = {};
  }

  start() {
    this.turnOrder = Object.keys(this.room.players).sort(() => Math.random() - 0.5);
    // each player contributes ~2 lines (capped so it doesn't drag)
    this.maxLines = Math.min(12, this.turnOrder.length * 2);
    this.starter = STARTERS[Math.floor(Math.random() * STARTERS.length)];
    this.story = [{ playerId: null, name: 'Story', text: this.starter }];
    this.turnIndex = 0;
    this.phase = 'building';
    this.nextTurn();
  }

  nextTurn() {
    // Did we hit the line limit?
    if (this.story.length - 1 >= this.maxLines) { this.beginVoting(); return; }

    const currentId = this.turnOrder[this.turnIndex % this.turnOrder.length];
    this.currentWriter = currentId;
    this.turnIndex++;

    const lastLine = this.story[this.story.length - 1].text;

    // Host shows the story so far + whose turn
    this.io.to(this.code).emit('wc_turn', {
      story: this.story.map(s => ({ name: s.name, text: s.text })),
      writerName: this.room.players[currentId]?.nickname,
      lineNum: this.story.length, maxLines: this.maxLines + 1
    });

    // Active writer gets the input; others wait
    Object.keys(this.room.players).forEach(id => {
      if (id === currentId) {
        this.io.to(id).emit('wc_your_turn', {
          lastLine, timeLimit: 30
        });
      } else {
        this.io.to(id).emit('wc_wait', { writerName: this.room.players[currentId]?.nickname });
      }
    });

    this.turnTimer = setTimeout(() => {
      // auto-skip with a filler if they don't write
      this.addLine(currentId, "...and then something happened.");
    }, 33000);
  }

  addLine(playerId, text) {
    if (playerId !== this.currentWriter) return;
    clearTimeout(this.turnTimer);
    this.story.push({
      playerId, name: this.room.players[playerId]?.nickname || '?',
      text: String(text).slice(0, 120).trim() || "..."
    });
    this.nextTurn();
  }

  beginVoting() {
    this.phase = 'voting';
    this.votes = {};
    // Only player-contributed lines are votable (skip the starter)
    this.votableLines = this.story.filter(s => s.playerId !== null);

    this.io.to(this.code).emit('wc_complete', {
      story: this.story.map((s, i) => ({ idx: i, name: s.name, text: s.text, votable: s.playerId !== null }))
    });

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('wc_vote', {
        lines: this.votableLines.map((s, i) => ({
          idx: this.story.indexOf(s), name: s.name, text: s.text, ownedByMe: s.playerId === id
        }))
      });
    });

    this.voteTimer = setTimeout(() => this.showResults(), 25000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'building' && data.type === 'line') {
      this.addLine(playerId, data.text);
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId] !== undefined) return;
      const line = this.story[data.idx];
      if (!line || line.playerId === playerId) return; // can't vote own line
      this.votes[playerId] = data.idx;
      this.io.to(playerId).emit('wc_voted', {});
      const total = Object.keys(this.room.players).length;
      if (Object.keys(this.votes).length >= total) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    this.phase = 'results';
    const tally = {};
    Object.values(this.votes).forEach(idx => {
      const line = this.story[idx];
      if (line && line.playerId) tally[line.playerId] = (tally[line.playerId] || 0) + 1;
    });
    const maxVotes = Math.max(0, ...Object.values(tally));

    Object.entries(tally).forEach(([id, v]) => {
      if (this.room.players[id]) this.room.players[id].score += v * 150;
    });
    Object.keys(tally).forEach(id => {
      if (tally[id] === maxVotes && maxVotes > 0 && this.room.players[id]) this.room.players[id].score += 300;
    });

    // find the winning line
    let winningIdx = -1, winningVotes = 0;
    Object.entries(this.votes).forEach(([voter, idx]) => {});
    const lineVotes = {};
    Object.values(this.votes).forEach(idx => { lineVotes[idx] = (lineVotes[idx] || 0) + 1; });
    Object.entries(lineVotes).forEach(([idx, v]) => { if (v > winningVotes) { winningVotes = v; winningIdx = +idx; } });

    const winLine = winningIdx >= 0 ? this.story[winningIdx] : null;

    this.io.to(this.code).emit('wc_results', {
      winningLine: winLine ? { name: winLine.name, text: winLine.text, votes: winningVotes } : null,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('wc_result_player', {
        won: tally[id] === maxVotes && maxVotes > 0,
        votes: tally[id] || 0
      });
    });

    setTimeout(() => this.showFinal(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Word Chain' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'building') { clearTimeout(this.turnTimer); this.beginVoting(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = WordChain;
