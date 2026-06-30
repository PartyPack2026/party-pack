// RANK IT — four items appear and must be put in the correct order by some measure
// (biggest, oldest, fastest...). Players drag/tap to order them. Closer to the true order = points.

const PUZZLES = [
  { prompt: "Order these by SIZE (smallest to largest)", items: ["Ant", "Cat", "Horse", "Elephant"], order: [0,1,2,3] },
  { prompt: "Order these PLANETS from the Sun (closest first)", items: ["Mars", "Earth", "Jupiter", "Mercury"], order: [3,1,0,2] },
  { prompt: "Order by SPEED (slowest to fastest)", items: ["Snail", "Human", "Cheetah", "Jet plane"], order: [0,1,2,3] },
  { prompt: "Order these by AGE (oldest invention first)", items: ["Wheel", "Printing press", "Telephone", "Internet"], order: [0,1,2,3] },
  { prompt: "Order by HEIGHT (shortest to tallest)", items: ["Mouse", "Dog", "Human", "Giraffe"], order: [0,1,2,3] },
  { prompt: "Order these by POPULATION (smallest to largest)", items: ["A village", "A town", "A city", "A country"], order: [0,1,2,3] },
  { prompt: "Order by TEMPERATURE (coldest to hottest)", items: ["Ice", "Room temp", "Boiling water", "Lava"], order: [0,1,2,3] },
  { prompt: "Order these meals by TIME OF DAY (earliest first)", items: ["Breakfast", "Lunch", "Dinner", "Midnight snack"], order: [0,1,2,3] },
  { prompt: "Order by DISTANCE from Earth (nearest first)", items: ["The Moon", "The Sun", "Nearest star", "Edge of galaxy"], order: [0,1,2,3] },
  { prompt: "Order these by WEIGHT (lightest to heaviest)", items: ["Feather", "Apple", "Bowling ball", "Car"], order: [0,1,2,3] },
  { prompt: "Order by NUMBER OF LEGS (fewest first)", items: ["Snake", "Human", "Dog", "Spider"], order: [0,1,2,3] },
  { prompt: "Order these by LIFESPAN (shortest to longest)", items: ["Mayfly", "Dog", "Human", "Tortoise"], order: [0,1,2,3] },
  { prompt: "Order by LOUDNESS (quietest to loudest)", items: ["Whisper", "Conversation", "Concert", "Jet engine"], order: [0,1,2,3] },
  { prompt: "Order these by VALUE (cheapest to priciest)", items: ["Penny", "Coffee", "Phone", "House"], order: [0,1,2,3] },
  { prompt: "Order by HOW SPICY (mildest first)", items: ["Bell pepper", "Jalapeño", "Habanero", "Ghost pepper"], order: [0,1,2,3] },
  { prompt: "Order these by DEPTH (shallowest to deepest)", items: ["Puddle", "Pool", "Lake", "Ocean"], order: [0,1,2,3] },
  { prompt: "Order by SCREEN SIZE (smallest to largest)", items: ["Smartwatch", "Phone", "Laptop", "Cinema screen"], order: [0,1,2,3] },
  { prompt: "Order these by SUGAR (least to most)", items: ["Water", "Apple", "Soda", "Candy bar"], order: [0,1,2,3] },
];

class RankIt {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 5; this.currentRound = 0;
    this.phase = 'ranking';
    this.answers = {};
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
    this.answers = {};
    this.phase = 'ranking';

    // Present items in a SHUFFLED display order so the answer isn't given away
    const display = puzzle.items.map((label, i) => ({ id: i, label }));
    this.displayShuffled = display.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('rank_round', {
      round: this.currentRound, totalRounds: this.rounds,
      prompt: puzzle.prompt
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('rank_order', {
        prompt: puzzle.prompt,
        items: this.displayShuffled.map(d => ({ id: d.id, label: d.label }))
      });
    });
    this.timer = setTimeout(() => this.showResults(), 35000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'ranking' && data.type === 'order') {
      if (this.answers[playerId]) return;
      // data.order is an array of item ids in the player's chosen order
      if (!Array.isArray(data.order) || data.order.length !== this.puzzle.items.length) return;
      this.answers[playerId] = data.order;
      this.io.to(playerId).emit('rank_submitted', {});
      const count = Object.keys(this.answers).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('rank_count', { count, total });
      if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 700); }
    }
  }

  scoreOrder(playerOrder) {
    // correct order is puzzle.order — an array mapping position->itemId
    // Score by how many items are in the exact right position, plus partial for adjacency
    const correct = this.puzzle.order;
    let points = 0;
    for (let pos = 0; pos < correct.length; pos++) {
      if (playerOrder[pos] === correct[pos]) points += 100; // exact position
    }
    return points;
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    const results = [];
    Object.entries(this.answers).forEach(([id, order]) => {
      const pts = this.scoreOrder(order);
      if (this.room.players[id]) this.room.players[id].score += pts;
      results.push({ id, name: this.room.players[id]?.nickname, points: pts, perfect: pts === this.puzzle.order.length * 100 });
    });
    results.sort((a, b) => b.points - a.points);

    // Build the correct order for display
    const correctLabels = this.puzzle.order.map(itemId => this.puzzle.items[itemId]);

    this.io.to(this.code).emit('rank_results', {
      prompt: this.puzzle.prompt,
      correctOrder: correctLabels,
      results, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const r = results.find(x => x.id === id);
      this.io.to(id).emit('rank_result_player', {
        points: r ? r.points : 0, perfect: r ? r.perfect : false
      });
    });

    setTimeout(() => this.nextRound(), 6000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Rank It' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'ranking') { clearTimeout(this.timer); this.showResults(); }
  }
}

module.exports = RankIt;
