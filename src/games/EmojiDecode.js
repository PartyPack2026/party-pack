// EMOJI DECODE — the host screen shows a phrase, movie, or saying spelled out in emojis.
// Players type their guess. Correct guesses score, and faster correct guesses score more.

const PUZZLES = [
  { emoji: "🦁👑", answer: "the lion king", accept: ["lion king"] },
  { emoji: "🕷️🕸️👨", answer: "spider man", accept: ["spiderman"] },
  { emoji: "❄️👸", answer: "frozen", accept: [] },
  { emoji: "🐠🔍", answer: "finding nemo", accept: ["finding dory"] },
  { emoji: "🌟⚔️", answer: "star wars", accept: ["starwars"] },
  { emoji: "🍫🏭", answer: "charlie and the chocolate factory", accept: ["chocolate factory", "willy wonka"] },
  { emoji: "🦖🏞️", answer: "jurassic park", accept: ["jurassic world"] },
  { emoji: "👻🚫", answer: "ghostbusters", accept: ["ghost busters"] },
  { emoji: "🧙‍♂️💍", answer: "lord of the rings", accept: ["the hobbit"] },
  { emoji: "🐀👨‍🍳", answer: "ratatouille", accept: [] },
  { emoji: "🦇🦸", answer: "batman", accept: ["bat man"] },
  { emoji: "🐝🎬", answer: "bee movie", accept: ["the bee movie"] },
  { emoji: "🌧️🍔🍟", answer: "cloudy with a chance of meatballs", accept: ["cloudy with a chance"] },
  { emoji: "🏠🎈", answer: "up", accept: [] },
  { emoji: "🤠🚀", answer: "toy story", accept: ["toystory"] },
  { emoji: "🐷🕵️", answer: "peppa pig", accept: [] },
  { emoji: "💎🌊🚢", answer: "titanic", accept: [] },
  { emoji: "🐠🐠🐠", answer: "school of fish", accept: ["fish"] },
  { emoji: "🍞🧈", answer: "bread and butter", accept: ["bread butter"] },
  { emoji: "🌙🚶", answer: "moonwalk", accept: ["moon walk"] },
  { emoji: "🔥🦊", answer: "firefox", accept: ["fire fox"] },
  { emoji: "🍎🥧", answer: "apple pie", accept: [] },
  { emoji: "🐱👢", answer: "puss in boots", accept: ["puss n boots"] },
  { emoji: "👨‍👨‍👦🎩", answer: "the godfather", accept: ["godfather"] },
  { emoji: "🌈🦄", answer: "rainbow unicorn", accept: ["unicorn"] },
  { emoji: "☕🐛", answer: "caterpillar", accept: [] },
  { emoji: "🎃👑", answer: "nightmare before christmas", accept: ["the nightmare before christmas"] },
  { emoji: "🕰️🍊", answer: "a clockwork orange", accept: ["clockwork orange"] },
  { emoji: "🐺🌕", answer: "werewolf", accept: ["were wolf"] },
  { emoji: "🦈🎬", answer: "jaws", accept: [] },
];

function normalize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

class EmojiDecode {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 8; this.currentRound = 0;
    this.phase = 'guessing';
    this.solved = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = PUZZLES.filter((_, i) => !this.used.includes(i));
    const puzzle = avail[Math.floor(Math.random() * avail.length)] || PUZZLES[0];
    this.used.push(PUZZLES.indexOf(puzzle));
    this.puzzle = puzzle;
    this.solved = {};
    this.solveOrder = 0;
    this.phase = 'guessing';
    this.roundStart = Date.now();

    this.io.to(this.code).emit('emoji_round', {
      round: this.currentRound, totalRounds: this.rounds,
      emoji: puzzle.emoji
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('emoji_guess', { emoji: puzzle.emoji });
    });
    this.roundTimer = setTimeout(() => this.showAnswer(), 25000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'guessing' && data.type === 'guess') {
      if (this.solved[playerId]) return;
      const guess = normalize(data.guess);
      if (!guess) return;
      const target = normalize(this.puzzle.answer);
      const accepts = (this.puzzle.accept || []).map(normalize);
      const correct = guess === target || accepts.includes(guess);
      if (correct) {
        this.solveOrder++;
        // faster = more points; first solver 500, then 400, 300, ... min 150
        const pts = Math.max(150, 600 - this.solveOrder * 100);
        this.solved[playerId] = true;
        if (this.room.players[playerId]) this.room.players[playerId].score += pts;
        this.io.to(playerId).emit('emoji_correct', { points: pts, order: this.solveOrder });
        this.io.to(this.code).emit('emoji_solved', {
          name: this.room.players[playerId]?.nickname, order: this.solveOrder
        });
        // end early if everyone solved it
        const total = Object.keys(this.room.players).length;
        if (Object.keys(this.solved).length >= total) { clearTimeout(this.roundTimer); setTimeout(() => this.showAnswer(), 800); }
      } else {
        this.io.to(playerId).emit('emoji_wrong', {});
      }
    }
  }

  showAnswer() {
    if (this.phase === 'answer') return;
    this.phase = 'answer';
    const solvers = Object.keys(this.solved).map(id => this.room.players[id]?.nickname).filter(Boolean);
    this.io.to(this.code).emit('emoji_answer', {
      emoji: this.puzzle.emoji, answer: this.puzzle.answer,
      solverCount: solvers.length, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('emoji_answer_player', {
        solved: !!this.solved[id], answer: this.puzzle.answer
      });
    });
    setTimeout(() => this.nextRound(), 4500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Emoji Decode' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'guessing') { clearTimeout(this.roundTimer); this.showAnswer(); }
  }
}

module.exports = EmojiDecode;
