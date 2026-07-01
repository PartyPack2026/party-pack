// WAGER — trivia with a gambling twist. First you BET part of your bankroll on how confident
// you feel, THEN you answer. Right = win your wager, wrong = lose it. Everyone starts with the
// same bankroll; biggest pile at the end wins. Knowing what you don't know is the whole game.

const START_BANK = 1000;

const QUESTIONS = [
  { q: "What is the largest planet in our solar system?", opts: ["Saturn", "Jupiter", "Neptune", "Earth"], a: 1 },
  { q: "How many continents are there?", opts: ["5", "6", "7", "8"], a: 2 },
  { q: "What is the chemical symbol for gold?", opts: ["Gd", "Au", "Ag", "Go"], a: 1 },
  { q: "Which country hosted the first modern Olympics?", opts: ["France", "USA", "Greece", "UK"], a: 2 },
  { q: "What is the smallest prime number?", opts: ["0", "1", "2", "3"], a: 2 },
  { q: "Which planet is known as the Red Planet?", opts: ["Venus", "Mars", "Mercury", "Jupiter"], a: 1 },
  { q: "How many strings does a standard violin have?", opts: ["4", "5", "6", "7"], a: 0 },
  { q: "What gas do plants absorb from the air?", opts: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], a: 2 },
  { q: "Which ocean is the largest?", opts: ["Atlantic", "Indian", "Arctic", "Pacific"], a: 3 },
  { q: "What is the capital of Australia?", opts: ["Sydney", "Melbourne", "Canberra", "Perth"], a: 2 },
  { q: "How many sides does a hexagon have?", opts: ["5", "6", "7", "8"], a: 1 },
  { q: "Who painted the Mona Lisa?", opts: ["Van Gogh", "Da Vinci", "Picasso", "Rembrandt"], a: 1 },
  { q: "What is the hardest natural substance?", opts: ["Gold", "Iron", "Diamond", "Quartz"], a: 2 },
  { q: "Which animal is the tallest?", opts: ["Elephant", "Giraffe", "Horse", "Camel"], a: 1 },
  { q: "How many minutes are in a full day?", opts: ["1200", "1440", "1600", "2400"], a: 1 },
  { q: "What is the freezing point of water in Celsius?", opts: ["0", "32", "-10", "10"], a: 0 },
  { q: "Which planet is closest to the Sun?", opts: ["Venus", "Earth", "Mercury", "Mars"], a: 2 },
  { q: "What is the longest river in the world?", opts: ["Amazon", "Nile", "Yangtze", "Mississippi"], a: 1 },
  { q: "How many players are on a basketball team on court?", opts: ["4", "5", "6", "7"], a: 1 },
  { q: "What is the currency of Japan?", opts: ["Won", "Yuan", "Yen", "Ringgit"], a: 2 },
];

class Wager {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.phase = 'betting';
    this.bets = {};
    this.answers = {};
    this.used = [];
  }

  start() {
    // set every player's bankroll (score resets to 0 by server before start)
    Object.keys(this.room.players).forEach(id => { if (this.room.players[id]) this.room.players[id].score = START_BANK; });
    this.nextRound();
  }

  nextRound() {
    if (!this.room || Object.keys(this.room.players).length === 0) { this.ended = true; return; }
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const pool = QUESTIONS.map((q, i) => i).filter(i => !this.used.includes(i));
    const idx = pool[Math.floor(Math.random() * pool.length)];
    this.used.push(idx);
    this.question = QUESTIONS[idx];
    this.bets = {};
    this.answers = {};
    this.phase = 'betting';

    this.io.to(this.code).emit('wag_round', {
      round: this.currentRound, totalRounds: this.rounds, question: this.question.q,
      players: Object.values(this.room.players).map(p => ({ name: p.nickname, bank: p.score }))
    });
    Object.keys(this.room.players).forEach(id => {
      const bank = this.room.players[id]?.score || 0;
      this.io.to(id).emit('wag_bet', { question: this.question.q, bank });
    });
    this.betTimer = setTimeout(() => this.startAnswering(), 18000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'betting' && data.type === 'bet') {
      if (this.bets[playerId] !== undefined) return;
      const bank = this.room.players[playerId]?.score || 0;
      let bet = parseInt(data.amount, 10);
      if (isNaN(bet)) return;
      bet = Math.max(0, Math.min(bet, bank)); // can't bet more than you have
      this.bets[playerId] = bet;
      this.io.to(playerId).emit('wag_bet_locked', { amount: bet });
      const count = Object.keys(this.bets).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('wag_bet_count', { count, total });
      if (count >= total) { clearTimeout(this.betTimer); setTimeout(() => this.startAnswering(), 600); }
    } else if (this.phase === 'answering' && data.type === 'answer') {
      if (this.answers[playerId] !== undefined) return;
      if (typeof data.choice !== 'number' || data.choice < 0 || data.choice > 3) return;
      this.answers[playerId] = data.choice;
      this.io.to(playerId).emit('wag_answered', {});
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('wag_ans_count', { count, total });
      if (count >= total) { clearTimeout(this.ansTimer); setTimeout(() => this.reveal(), 600); }
    }
  }

  startAnswering() {
    if (this.phase !== 'betting') return;
    this.phase = 'answering';
    // players who didn't bet default to 0
    Object.keys(this.room.players).forEach(id => { if (this.bets[id] === undefined) this.bets[id] = 0; });
    this.io.to(this.code).emit('wag_answer_phase', { question: this.question.q, opts: this.question.opts });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('wag_choose', { question: this.question.q, opts: this.question.opts, bet: this.bets[id] });
    });
    this.ansTimer = setTimeout(() => this.reveal(), 20000);
  }

  reveal() {
    if (this.phase === 'reveal') return;
    this.phase = 'reveal';
    const correct = this.question.a;

    const outcomes = [];
    Object.keys(this.room.players).forEach(id => {
      const choice = this.answers[id];
      const bet = this.bets[id] || 0;
      let delta = 0;
      if (choice === correct) delta = bet; else if (choice !== undefined) delta = -bet;
      if (this.room.players[id]) {
        this.room.players[id].score = Math.max(0, this.room.players[id].score + delta);
      }
      outcomes.push({
        name: this.room.players[id]?.nickname, correct: choice === correct,
        bet, delta, bank: this.room.players[id]?.score, answered: choice !== undefined
      });
    });
    outcomes.sort((a, b) => b.bank - a.bank);

    this.io.to(this.code).emit('wag_reveal', {
      question: this.question.q, opts: this.question.opts, correct,
      correctText: this.question.opts[correct], outcomes, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const o = outcomes.find(x => x.name === this.room.players[id]?.nickname);
      this.io.to(id).emit('wag_reveal_player', {
        correct: this.answers[id] === correct, delta: o ? o.delta : 0,
        bank: this.room.players[id]?.score, correctText: this.question.opts[correct]
      });
    });
    setTimeout(() => this.nextRound(), 6000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Wager' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'betting') { clearTimeout(this.betTimer); this.startAnswering(); }
    else if (this.phase === 'answering') { clearTimeout(this.ansTimer); this.reveal(); }
  }
}

module.exports = Wager;
