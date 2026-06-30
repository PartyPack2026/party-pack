// HOT SEAT — one player is in the hot seat. A question about them appears. Everyone else
// predicts how that player will answer, while the hot-seat player gives their real answer.
// Match their answer = points. It's a "how well do you know them" game.

const QUESTIONS = [
  { q: "On a Friday night, they'd rather...", a: "Go out & party", b: "Stay in & chill" },
  { q: "They prefer...", a: "Sweet", b: "Savoury" },
  { q: "They'd be more likely to be...", a: "Early", b: "Late" },
  { q: "They're more of a...", a: "Cat person", b: "Dog person" },
  { q: "They'd rather be...", a: "Rich", b: "Famous" },
  { q: "For a holiday, they'd pick...", a: "Beach", b: "City break" },
  { q: "Faced with danger, they'd...", a: "Fight", b: "Run" },
  { q: "Their drink of choice...", a: "Tea", b: "Coffee" },
  { q: "They're a...", a: "Morning person", b: "Night owl" },
  { q: "In public they'd rather...", a: "Sing", b: "Dance" },
  { q: "At a sad film, they'd...", a: "Cry", b: "Stay dry-eyed" },
  { q: "Pineapple on pizza?", a: "Yes!", b: "Never" },
  { q: "They'd rather travel to the...", a: "Past", b: "Future" },
  { q: "They prefer...", a: "Sci-fi", b: "Fantasy" },
  { q: "They'd rather...", a: "Win the lottery", b: "Find their soulmate" },
  { q: "In the friend group they're the...", a: "Funny one", b: "Responsible one" },
  { q: "They'd rather be too...", a: "Hot", b: "Cold" },
  { q: "They prefer...", a: "Books", b: "Movies" },
  { q: "Spicy food — they...", a: "Love it", b: "Hate it" },
  { q: "They'd rather...", a: "Text", b: "Call" },
  { q: "They'd rather be stranded in a...", a: "Desert", b: "Jungle" },
  { q: "They'd rather give up...", a: "Sleep", b: "Food (magically fine)" },
];

class HotSeat {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.seatQueue = [];
    this.phase = 'answering';
    this.predictions = {};
    this.seatAnswer = null;
  }

  start() {
    this.seatQueue = Object.keys(this.room.players).sort(() => Math.random() - 0.5);
    // each person sits once (capped at 6 for time)
    this.seatQueue = this.seatQueue.slice(0, Math.min(6, this.seatQueue.length));
    this.usedQ = [];
    this.nextSeat();
  }

  nextSeat() {
    if (this.seatQueue.length === 0) { this.showFinal(); return; }
    this.hotSeat = this.seatQueue.shift();
    const avail = QUESTIONS.filter((_, i) => !this.usedQ.includes(i));
    const q = avail[Math.floor(Math.random() * avail.length)] || QUESTIONS[0];
    this.usedQ.push(QUESTIONS.indexOf(q));
    this.question = q.q;
    this.optA = q.a; this.optB = q.b;
    this.predictions = {};
    this.seatAnswer = null;
    this.phase = 'answering';

    const seatName = this.room.players[this.hotSeat]?.nickname;

    this.io.to(this.code).emit('hs_round', {
      seatName, question: q.q, optionA: q.a, optionB: q.b, remaining: this.seatQueue.length
    });

    this.io.to(this.hotSeat).emit('hs_seat', {
      question: q.q, optionA: q.a, optionB: q.b
    });
    Object.keys(this.room.players).forEach(id => {
      if (id !== this.hotSeat) {
        this.io.to(id).emit('hs_predict', {
          seatName, question: q.q, optionA: q.a, optionB: q.b
        });
      }
    });

    this.timer = setTimeout(() => this.reveal(), 25000);
  }

  handleInput(playerId, data) {
    if (this.phase !== 'answering') return;
    if (playerId === this.hotSeat && data.type === 'seat_answer') {
      if (this.seatAnswer !== null) return;
      this.seatAnswer = data.choice;
      this.io.to(playerId).emit('hs_seat_locked', {});
      this.checkDone();
    } else if (playerId !== this.hotSeat && data.type === 'predict') {
      if (this.predictions[playerId] !== undefined) return;
      this.predictions[playerId] = data.choice;
      this.io.to(playerId).emit('hs_predicted', {});
      const count = Object.keys(this.predictions).length;
      const total = Object.keys(this.room.players).length - 1;
      this.io.to(this.code).emit('hs_count', { count, total, seatAnswered: this.seatAnswer !== null });
      this.checkDone();
    }
  }

  checkDone() {
    const total = Object.keys(this.room.players).length - 1;
    if (this.seatAnswer !== null && Object.keys(this.predictions).length >= total) {
      clearTimeout(this.timer);
      setTimeout(() => this.reveal(), 700);
    }
  }

  reveal() {
    if (this.phase === 'reveal') return;
    this.phase = 'reveal';
    const seatName = this.room.players[this.hotSeat]?.nickname;
    // If hot seat never answered, pick randomly so the round resolves
    if (this.seatAnswer === null) this.seatAnswer = Math.random() < 0.5 ? 0 : 1;

    let correct = 0;
    Object.entries(this.predictions).forEach(([id, choice]) => {
      if (choice === this.seatAnswer) {
        correct++;
        if (this.room.players[id]) this.room.players[id].score += 250;
      }
    });
    // hot seat gets points for each person who "got" them (rewards being known / consistent)
    if (this.room.players[this.hotSeat]) this.room.players[this.hotSeat].score += correct * 100;

    this.io.to(this.code).emit('hs_reveal', {
      seatName, question: this.question,
      optionA: this.optA, optionB: this.optB,
      seatAnswer: this.seatAnswer, correct,
      totalPredictors: Object.keys(this.predictions).length,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      if (id === this.hotSeat) {
        this.io.to(id).emit('hs_reveal_player', { isSeat: true, correct });
      } else {
        this.io.to(id).emit('hs_reveal_player', { isSeat: false, gotIt: this.predictions[id] === this.seatAnswer });
      }
    });

    setTimeout(() => this.nextSeat(), 5500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Hot Seat' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'answering') { clearTimeout(this.timer); this.reveal(); }
  }
}

module.exports = HotSeat;
