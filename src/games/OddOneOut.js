// ODD ONE OUT — four things appear; one doesn't belong with the others. Players pick the
// odd one. Correct = points, with a speed bonus. The host reveals WHY at the end.

const PUZZLES = [
  { items: ["Dog", "Cat", "Hamster", "Wolf"], odd: 3, why: "A wolf is wild — the rest are pets." },
  { items: ["Apple", "Banana", "Carrot", "Grape"], odd: 2, why: "A carrot is a vegetable — the rest are fruit." },
  { items: ["Red", "Blue", "Green", "Square"], odd: 3, why: "Square is a shape — the rest are colours." },
  { items: ["Sun", "Moon", "Mars", "Venus"], odd: 1, why: "The Moon orbits Earth — the rest orbit the Sun (well, Mars/Venus do; the Sun is a star). The Moon is the odd one as a satellite." },
  { items: ["Guitar", "Violin", "Trumpet", "Cello"], odd: 2, why: "Trumpet is brass — the rest are string instruments." },
  { items: ["Whale", "Shark", "Dolphin", "Seal"], odd: 1, why: "A shark is a fish — the rest are mammals." },
  { items: ["January", "March", "Friday", "July"], odd: 2, why: "Friday is a day — the rest are months." },
  { items: ["Triangle", "Circle", "Square", "Cube"], odd: 3, why: "A cube is 3D — the rest are 2D shapes." },
  { items: ["Tea", "Coffee", "Juice", "Bread"], odd: 3, why: "Bread is a food — the rest are drinks." },
  { items: ["Soccer", "Tennis", "Chess", "Basketball"], odd: 2, why: "Chess isn't physical — the rest are physical sports." },
  { items: ["Eagle", "Penguin", "Sparrow", "Robin"], odd: 1, why: "A penguin can't fly — the rest can." },
  { items: ["Gold", "Silver", "Bronze", "Diamond"], odd: 3, why: "Diamond isn't a metal — the rest are." },
  { items: ["Spain", "France", "Brazil", "Italy"], odd: 2, why: "Brazil is in South America — the rest are in Europe." },
  { items: ["Rose", "Tulip", "Oak", "Daisy"], odd: 2, why: "An oak is a tree — the rest are flowers." },
  { items: ["Square", "Rectangle", "Triangle", "Pentagon"], odd: 2, why: "A triangle has 3 sides — the rest have 4+ … actually the rest don't all match; triangle is fewest-sided." },
  { items: ["Mercury", "Venus", "Earth", "Pluto"], odd: 3, why: "Pluto is a dwarf planet — the rest are planets." },
  { items: ["Hammer", "Saw", "Screwdriver", "Spoon"], odd: 3, why: "A spoon is cutlery — the rest are tools." },
  { items: ["Lion", "Tiger", "Leopard", "Bear"], odd: 3, why: "A bear isn't a big cat — the rest are." },
  { items: ["Snake", "Lizard", "Frog", "Crocodile"], odd: 2, why: "A frog is an amphibian — the rest are reptiles." },
  { items: ["Pizza", "Burger", "Salad", "Fries"], odd: 2, why: "Salad is the healthy one — the rest are fast food." },
];

class OddOneOut {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.phase = 'choosing';
    this.choices = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = PUZZLES.filter((_, i) => !this.used.includes(i));
    const puzzle = avail[Math.floor(Math.random() * avail.length)] || PUZZLES[0];
    this.used.push(PUZZLES.indexOf(puzzle));

    // shuffle the display so 'odd' isn't always the same position
    const tagged = puzzle.items.map((label, i) => ({ label, isOdd: i === puzzle.odd }));
    const shuffled = tagged.sort(() => Math.random() - 0.5);
    this.displayItems = shuffled.map((t, i) => ({ id: i, label: t.label, isOdd: t.isOdd }));
    this.oddId = this.displayItems.findIndex(d => d.isOdd);
    this.why = puzzle.why;
    this.choices = {};
    this.phase = 'choosing';
    this.roundStart = Date.now();

    this.io.to(this.code).emit('odd_round', {
      round: this.currentRound, totalRounds: this.rounds,
      items: this.displayItems.map(d => ({ id: d.id, label: d.label }))
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('odd_choose', {
        items: this.displayItems.map(d => ({ id: d.id, label: d.label })), timeLimit: 18
      });
    });
    this.timer = setTimeout(() => this.showResults(), 19000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'choosing' && data.type === 'choose') {
      if (this.choices[playerId] !== undefined) return;
      this.choices[playerId] = { id: data.id, time: Date.now() - this.roundStart };
      this.io.to(playerId).emit('odd_chosen', {});
      const count = Object.keys(this.choices).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('odd_count', { count, total });
      if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    Object.entries(this.choices).forEach(([id, c]) => {
      if (c.id === this.oddId) {
        const speedBonus = Math.max(0, Math.round(150 * (1 - c.time / 18000)));
        const pts = 200 + speedBonus;
        if (this.room.players[id]) this.room.players[id].score += pts;
      }
    });

    const oddLabel = this.displayItems[this.oddId]?.label;
    this.io.to(this.code).emit('odd_results', {
      oddId: this.oddId, oddLabel, why: this.why,
      items: this.displayItems.map(d => ({ id: d.id, label: d.label })),
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const c = this.choices[id];
      this.io.to(id).emit('odd_result_player', {
        correct: c ? c.id === this.oddId : false, didChoose: c !== undefined
      });
    });

    setTimeout(() => this.nextRound(), 5500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Odd One Out' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'choosing') { clearTimeout(this.timer); this.showResults(); }
  }
}

module.exports = OddOneOut;
