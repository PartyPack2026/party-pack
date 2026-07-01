// DESCRIBE IT — Taboo/Catchphrase style. One player is the Describer and sees a secret word.
// They describe it OUT LOUD to the room (without saying the word itself), while everyone else
// races to type the answer. First correct guesser scores, and the Describer scores too for
// getting it across. The turn then passes to the next Describer.

const WORDS = [
  "Elephant", "Rainbow", "Guitar", "Volcano", "Pizza", "Astronaut", "Umbrella", "Dinosaur",
  "Snowman", "Telescope", "Butterfly", "Skateboard", "Lighthouse", "Cactus", "Robot", "Waterfall",
  "Pancake", "Vampire", "Mermaid", "Tornado", "Sandcastle", "Kangaroo", "Bicycle", "Wizard",
  "Igloo", "Pineapple", "Rollercoaster", "Ghost", "Trampoline", "Octopus", "Campfire", "Balloon",
  "Scarecrow", "Submarine", "Cupcake", "Fireworks", "Penguin", "Treasure", "Windmill", "Jellyfish",
];

class DescribeIt {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'describing';
    this.describerQueue = [];
    this.solved = false;
  }

  start() {
    this.describerQueue = Object.keys(this.room.players).sort(() => Math.random() - 0.5);
    // each person describes once, capped at 6 turns for time
    this.describerQueue = this.describerQueue.slice(0, Math.min(6, this.describerQueue.length));
    this.usedWords = [];
    this.nextTurn();
  }

  nextTurn() {
    if (!this.room || Object.keys(this.room.players).length === 0) { this.ended = true; return; }
    if (this.describerQueue.length === 0) { this.showFinal(); return; }
    this.describer = this.describerQueue.shift();
    const pool = WORDS.map((w, i) => i).filter(i => !this.usedWords.includes(i));
    const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * WORDS.length);
    this.usedWords.push(idx);
    this.word = WORDS[idx];
    this.answer = this.word.toLowerCase();
    this.solved = false;
    this.wrongGuessers = {};
    this.phase = 'describing';
    this.turnStart = Date.now();

    const describerName = this.room.players[this.describer]?.nickname;

    this.io.to(this.code).emit('desc_turn', {
      describerName, remaining: this.describerQueue.length
    });
    // describer sees the word; everyone else gets ready to guess
    this.io.to(this.describer).emit('desc_word', { word: this.word });
    Object.keys(this.room.players).forEach(id => {
      if (id !== this.describer) this.io.to(id).emit('desc_guess', { describerName });
    });

    this.timer = setTimeout(() => this.endTurn(false), 60000);
  }

  handleInput(playerId, data) {
    if (this.phase !== 'describing') return;
    if (playerId === this.describer && data.type === 'skip') {
      // describer can pass on a word they can't do
      this.endTurn(false, true);
      return;
    }
    if (playerId !== this.describer && data.type === 'guess') {
      if (this.solved) return;
      const guess = String(data.guess || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!guess) return;
      if (guess === this.answer) {
        this.solved = true;
        const time = Date.now() - this.turnStart;
        const speed = Math.max(0, Math.round(200 * (1 - time / 60000)));
        const guesserPts = 300 + speed;
        if (this.room.players[playerId]) this.room.players[playerId].score += guesserPts;
        if (this.room.players[this.describer]) this.room.players[this.describer].score += 200; // describer reward
        this.io.to(playerId).emit('desc_correct', { points: guesserPts, word: this.word });
        this.winnerName = this.room.players[playerId]?.nickname;
        this.endTurn(true);
      } else {
        this.io.to(playerId).emit('desc_wrong', {});
      }
    }
  }

  endTurn(solved, skipped) {
    if (this.phase === 'turnend') return;
    this.phase = 'turnend';
    clearTimeout(this.timer);

    this.io.to(this.code).emit('desc_turnend', {
      word: this.word, solved, skipped: !!skipped,
      describerName: this.room.players[this.describer]?.nickname,
      winnerName: solved ? this.winnerName : null,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      if (id === this.describer) {
        this.io.to(id).emit('desc_turnend_player', { role: 'describer', solved, word: this.word });
      } else {
        this.io.to(id).emit('desc_turnend_player', { role: 'guesser', solved, word: this.word, youWon: solved && this.room.players[id]?.nickname === this.winnerName });
      }
    });
    setTimeout(() => this.nextTurn(), 5000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Describe It' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'describing') { clearTimeout(this.timer); this.endTurn(false); }
  }
}

module.exports = DescribeIt;
