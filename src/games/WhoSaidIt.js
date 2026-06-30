// WHO SAID IT — everyone answers a revealing prompt anonymously. Then one answer at a time
// is shown and everyone guesses WHO wrote it. Know your friends = points. Stay mysterious = points.

const PROMPTS = [
  "What's your most irrational fear?",
  "What's a weird talent you have?",
  "What's the last thing you searched on your phone?",
  "What's your go-to karaoke song?",
  "What's something you're weirdly competitive about?",
  "What's the most childish thing you still do?",
  "What's a food combo you love that others find gross?",
  "What's your most-used emoji?",
  "What's a hill you'll die on?",
  "What would your superhero name be?",
  "What's the worst gift you've ever received?",
  "What's your toxic trait?",
  "What's something everyone seems to love that you don't get?",
  "What's the pettiest reason you've disliked someone?",
  "What's your dream job as a kid?",
  "If you were a kitchen appliance, which one?",
  "What's the weirdest thing in your fridge right now?",
  "What's a small thing that instantly ruins your day?",
  "What's your most embarrassing autocorrect fail?",
  "What's a conspiracy theory you kind of believe?",
  "What's the strangest compliment you've received?",
  "What's your useless party trick?",
];

class WhoSaidIt {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'writing';
    this.answers = {};      // playerId -> text
    this.revealQueue = [];
    this.currentEntry = null;
    this.guesses = {};
  }

  start() {
    this.prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    this.answers = {};
    this.phase = 'writing';
    this.io.to(this.code).emit('who_writing', { prompt: this.prompt });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('who_write', { prompt: this.prompt, timeLimit: 50 });
    });
    this.writeTimer = setTimeout(() => this.beginReveals(), 53000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'writing' && data.type === 'answer') {
      const text = String(data.answer || '').slice(0, 120).trim();
      if (!text) return;
      this.answers[playerId] = text;
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('who_count', { count, total });
      this.io.to(playerId).emit('who_submitted', {});
      if (count >= total) { clearTimeout(this.writeTimer); setTimeout(() => this.beginReveals(), 700); }
    } else if (this.phase === 'guessing' && data.type === 'guess') {
      if (playerId === this.currentEntry.author) return; // can't guess your own
      if (this.guesses[playerId] !== undefined) return;
      if (!this.room.players[data.target]) return;
      this.guesses[playerId] = data.target;
      this.io.to(playerId).emit('who_guessed', {});
      const total = Object.keys(this.room.players).length - 1;
      const count = Object.keys(this.guesses).length;
      this.io.to(this.code).emit('who_guess_count', { count, total });
      if (count >= total) { clearTimeout(this.guessTimer); setTimeout(() => this.revealAuthor(), 700); }
    }
  }

  beginReveals() {
    this.phase = 'guessing';
    this.revealQueue = Object.keys(this.answers).sort(() => Math.random() - 0.5);
    if (this.revealQueue.length === 0) { this.showFinal(); return; }
    this.nextEntry();
  }

  nextEntry() {
    if (this.revealQueue.length === 0) { this.showFinal(); return; }
    const author = this.revealQueue.shift();
    this.currentEntry = { author, text: this.answers[author] };
    this.guesses = {};

    const playerList = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar
    }));

    this.io.to(this.code).emit('who_entry', {
      prompt: this.prompt, text: this.currentEntry.text,
      remaining: this.revealQueue.length, players: playerList
    });
    Object.keys(this.room.players).forEach(id => {
      if (id === author) {
        this.io.to(id).emit('who_watch', { text: this.currentEntry.text });
      } else {
        this.io.to(id).emit('who_guess', {
          text: this.currentEntry.text,
          options: playerList.filter(p => p.id !== id) // can't guess yourself either (you know you didn't write it)
        });
      }
    });

    this.guessTimer = setTimeout(() => this.revealAuthor(), 22000);
  }

  revealAuthor() {
    this.phase = 'reveal';
    const author = this.currentEntry.author;
    const authorName = this.room.players[author]?.nickname;

    let correctGuessers = 0;
    Object.entries(this.guesses).forEach(([guesser, target]) => {
      if (target === author) {
        correctGuessers++;
        if (this.room.players[guesser]) this.room.players[guesser].score += 200;
      }
    });
    // Author scores for staying hidden — points per person who guessed WRONG
    const wrong = Object.keys(this.guesses).length - correctGuessers;
    if (this.room.players[author]) this.room.players[author].score += wrong * 100;

    this.io.to(this.code).emit('who_reveal', {
      text: this.currentEntry.text, authorName,
      authorAvatar: this.room.players[author]?.avatar,
      correctGuessers, totalGuessers: Object.keys(this.guesses).length,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      if (id === author) {
        this.io.to(id).emit('who_reveal_player', { isAuthor: true, fooledCount: wrong });
      } else {
        this.io.to(id).emit('who_reveal_player', { isAuthor: false, correct: this.guesses[id] === author });
      }
    });

    setTimeout(() => this.nextEntry(), 5500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Who Said It' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'writing') { clearTimeout(this.writeTimer); this.beginReveals(); }
    else if (this.phase === 'guessing') { clearTimeout(this.guessTimer); this.revealAuthor(); }
  }
}

module.exports = WhoSaidIt;
