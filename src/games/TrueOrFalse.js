// TRUE OR FALSE — a surprising statement appears. Players quickly vote TRUE or FALSE.
// Correct answers score, and faster correct answers score a speed bonus.

const STATEMENTS = [
  { s: "A group of flamingos is called a 'flamboyance'.", t: true },
  { s: "Bananas grow on trees.", t: false }, // they grow on herbs
  { s: "The Great Wall of China is visible from space with the naked eye.", t: false },
  { s: "Honey never spoils.", t: true },
  { s: "Goldfish have a 3-second memory.", t: false },
  { s: "Octopuses have three hearts.", t: true },
  { s: "Lightning never strikes the same place twice.", t: false },
  { s: "A shrimp's heart is in its head.", t: true },
  { s: "Humans only use 10% of their brains.", t: false },
  { s: "Sharks existed before trees.", t: true },
  { s: "The dot over a lowercase 'i' is called a tittle.", t: true },
  { s: "Mount Everest is the closest point on Earth to the Moon.", t: false }, // Chimborazo
  { s: "A day on Venus is longer than its year.", t: true },
  { s: "Carrots were originally purple.", t: true },
  { s: "Glass is a slow-moving liquid.", t: false },
  { s: "Bats are blind.", t: false },
  { s: "The Eiffel Tower can grow taller in summer.", t: true }, // metal expands
  { s: "A jiffy is an actual unit of time.", t: true },
  { s: "Cracking your knuckles causes arthritis.", t: false },
  { s: "Wombat poop is cube-shaped.", t: true },
  { s: "The human body has more than 600 muscles.", t: true },
  { s: "Goldfish can't close their eyes.", t: true },
  { s: "You swallow eight spiders a year in your sleep.", t: false },
  { s: "Polar bears have black skin.", t: true },
  { s: "The shortest war in history lasted under an hour.", t: true },
  { s: "Chewing gum takes seven years to digest.", t: false },
  { s: "Bananas are berries but strawberries aren't.", t: true },
  { s: "An ostrich's eye is bigger than its brain.", t: true },
  { s: "Napoleon was extremely short.", t: false }, // average height
  { s: "Hot water can freeze faster than cold water.", t: true },
];

class TrueOrFalse {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 8; this.currentRound = 0;
    this.phase = 'voting';
    this.votes = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = STATEMENTS.filter((_, i) => !this.used.includes(i));
    const item = avail[Math.floor(Math.random() * avail.length)] || STATEMENTS[0];
    this.used.push(STATEMENTS.indexOf(item));
    this.statement = item;
    this.votes = {};
    this.phase = 'voting';
    this.roundStart = Date.now();

    this.io.to(this.code).emit('tof_round', {
      round: this.currentRound, totalRounds: this.rounds,
      statement: item.s
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('tof_vote', { statement: item.s, timeLimit: 15 });
    });
    this.timer = setTimeout(() => this.showResults(), 16000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId] !== undefined) return;
      if (typeof data.answer !== 'boolean') return;
      const elapsed = Date.now() - this.roundStart;
      this.votes[playerId] = { answer: data.answer, time: elapsed };
      this.io.to(playerId).emit('tof_voted', {});
      const count = Object.keys(this.votes).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('tof_count', { count, total });
      if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';
    const truth = this.statement.t;

    let trueCount = 0, falseCount = 0;
    Object.values(this.votes).forEach(v => { if (v.answer) trueCount++; else falseCount++; });

    Object.entries(this.votes).forEach(([id, v]) => {
      if (v.answer === truth) {
        // base 200 + speed bonus up to 150 (faster = more)
        const speedBonus = Math.max(0, Math.round(150 * (1 - v.time / 15000)));
        const pts = 200 + speedBonus;
        if (this.room.players[id]) this.room.players[id].score += pts;
      }
    });

    this.io.to(this.code).emit('tof_results', {
      statement: this.statement.s, truth, trueCount, falseCount,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const v = this.votes[id];
      this.io.to(id).emit('tof_result_player', {
        correct: v ? v.answer === truth : false, truth,
        didVote: v !== undefined
      });
    });

    setTimeout(() => this.nextRound(), 4500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'True or False' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'voting') { clearTimeout(this.timer); this.showResults(); }
  }
}

module.exports = TrueOrFalse;
