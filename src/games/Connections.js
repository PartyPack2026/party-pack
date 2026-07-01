// CONNECTIONS — a board of 16 words hides four secret groups of four. Each player works the
// same board on their own phone, selecting four words and submitting a group. Correct groups
// lock in and score; wrong guesses cost a life. Find all four = big bonus. A real brain-burner.

const PUZZLES = [
  { groups: [
    { cat: "Types of Bread", words: ["Rye", "Naan", "Pita", "Sourdough"] },
    { cat: "___ Ball", words: ["Base", "Basket", "Foot", "Meat"] },
    { cat: "Planets", words: ["Mars", "Venus", "Saturn", "Neptune"] },
    { cat: "Card Games", words: ["Poker", "Rummy", "Snap", "Solitaire"] },
  ]},
  { groups: [
    { cat: "Big Cats", words: ["Lion", "Tiger", "Leopard", "Jaguar"] },
    { cat: "Board Games", words: ["Chess", "Cluedo", "Risk", "Sorry"] },
    { cat: "Shades of Blue", words: ["Navy", "Teal", "Cobalt", "Azure"] },
    { cat: "Coffee Drinks", words: ["Latte", "Mocha", "Espresso", "Americano"] },
  ]},
  { groups: [
    { cat: "Fruits", words: ["Mango", "Peach", "Kiwi", "Plum"] },
    { cat: "Dance Styles", words: ["Salsa", "Tango", "Waltz", "Swing"] },
    { cat: "Chess Pieces", words: ["Rook", "Bishop", "Knight", "Pawn"] },
    { cat: "Units of Time", words: ["Second", "Hour", "Week", "Decade"] },
  ]},
  { groups: [
    { cat: "Weather", words: ["Rain", "Fog", "Snow", "Hail"] },
    { cat: "Musical Notes", words: ["Do", "Re", "Mi", "Fa"] },
    { cat: "Body Parts", words: ["Elbow", "Shin", "Wrist", "Ankle"] },
    { cat: "Superheroes", words: ["Batman", "Flash", "Thor", "Hulk"] },
  ]},
  { groups: [
    { cat: "Ocean Animals", words: ["Whale", "Squid", "Shark", "Crab"] },
    { cat: "Pizza Toppings", words: ["Pepperoni", "Olive", "Onion", "Mushroom"] },
    { cat: "Colours", words: ["Scarlet", "Amber", "Violet", "Emerald"] },
    { cat: "Countries", words: ["Peru", "Chad", "Cuba", "Iran"] },
  ]},
  { groups: [
    { cat: "Kitchen Tools", words: ["Whisk", "Ladle", "Grater", "Peeler"] },
    { cat: "Greek Letters", words: ["Alpha", "Beta", "Delta", "Omega"] },
    { cat: "Precious Stones", words: ["Ruby", "Pearl", "Opal", "Jade"] },
    { cat: "Team Sports", words: ["Rugby", "Hockey", "Cricket", "Polo"] },
  ]},
  { groups: [
    { cat: "Breakfast Foods", words: ["Bacon", "Toast", "Waffle", "Cereal"] },
    { cat: "Types of Boat", words: ["Canoe", "Yacht", "Ferry", "Kayak"] },
    { cat: "Zodiac Signs", words: ["Aries", "Leo", "Libra", "Virgo"] },
    { cat: "Metals", words: ["Iron", "Copper", "Zinc", "Tin"] },
  ]},
  { groups: [
    { cat: "Insects", words: ["Ant", "Wasp", "Moth", "Beetle"] },
    { cat: "Instruments", words: ["Flute", "Cello", "Harp", "Drum"] },
    { cat: "Seasons & Holidays", words: ["Spring", "Easter", "Winter", "Autumn"] },
    { cat: "Nuts", words: ["Cashew", "Walnut", "Almond", "Pecan"] },
  ]},
];

class Connections {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'solving';
    this.state = {}; // per player: {found:[groupIdx], lives, done}
  }

  start() {
    this.puzzle = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
    // Build the flat board with a groupIdx tag, then shuffle
    this.board = [];
    this.puzzle.groups.forEach((g, gi) => g.words.forEach(w => this.board.push({ word: w, group: gi })));
    this.board = this.board.sort(() => Math.random() - 0.5);
    // map word -> group for quick lookup (words are unique across a puzzle)
    this.wordGroup = {};
    this.board.forEach(b => { this.wordGroup[b.word.toLowerCase()] = b.group; });

    this.state = {};
    Object.keys(this.room.players).forEach(id => { this.state[id] = { found: [], lives: 4, done: false }; });
    this.phase = 'solving';
    this.startTime = Date.now();

    const boardWords = this.board.map(b => b.word);
    this.io.to(this.code).emit('conn_start', {
      total: this.board.length, groups: this.puzzle.groups.length,
      board: boardWords
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('conn_board', { board: boardWords, lives: 4, groups: this.puzzle.groups.length });
    });

    this.timer = setTimeout(() => this.showResults(), 90000);
    this.checkTimer = setInterval(() => this.broadcastProgress(), 3000);
  }

  broadcastProgress() {
    const prog = Object.entries(this.state).map(([id, s]) => ({
      name: this.room.players[id]?.nickname, found: s.found.length, lives: s.lives, done: s.done
    }));
    this.io.to(this.code).emit('conn_progress', { progress: prog });
  }

  handleInput(playerId, data) {
    if (this.phase !== 'solving') return;
    const s = this.state[playerId];
    if (!s || s.done) return;

    if (data.type === 'submit_group') {
      const picks = Array.isArray(data.words) ? data.words.slice(0, 4) : [];
      if (picks.length !== 4) return;
      // Determine the group of each pick
      const groups = picks.map(w => this.wordGroup[String(w).toLowerCase()]);
      const allSame = groups.every(g => g !== undefined && g === groups[0]);
      const gi = groups[0];

      if (allSame && !s.found.includes(gi)) {
        // Correct new group!
        s.found.push(gi);
        const speed = Math.max(0, Math.round(120 * (1 - (Date.now() - this.startTime) / 90000)));
        const pts = 250 + speed;
        if (this.room.players[playerId]) this.room.players[playerId].score += pts;
        this.io.to(playerId).emit('conn_correct', {
          group: gi, cat: this.puzzle.groups[gi].cat, words: this.puzzle.groups[gi].words, points: pts,
          foundCount: s.found.length, totalGroups: this.puzzle.groups.length
        });
        if (s.found.length >= this.puzzle.groups.length) {
          // Solved everything — perfect bonus
          if (this.room.players[playerId]) this.room.players[playerId].score += 300;
          s.done = true;
          this.io.to(playerId).emit('conn_solved', { bonus: 300 });
          this.checkAllDone();
        }
      } else {
        // Wrong (or already-found) guess — lose a life
        s.lives--;
        // "one away" hint: if 3 of 4 share a group
        const counts = {};
        groups.forEach(g => { if (g !== undefined) counts[g] = (counts[g] || 0) + 1; });
        const oneAway = Object.values(counts).some(c => c === 3);
        this.io.to(playerId).emit('conn_wrong', { lives: s.lives, oneAway });
        if (s.lives <= 0) {
          s.done = true;
          this.io.to(playerId).emit('conn_out', {});
          this.checkAllDone();
        }
      }
      this.broadcastProgress();
    }
  }

  checkAllDone() {
    const allDone = Object.values(this.state).every(s => s.done);
    if (allDone) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 800); }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';
    clearInterval(this.checkTimer);
    clearTimeout(this.timer);

    const solution = this.puzzle.groups.map(g => ({ cat: g.cat, words: g.words }));
    const summary = Object.entries(this.state).map(([id, s]) => ({
      name: this.room.players[id]?.nickname, found: s.found.length, solved: s.found.length >= this.puzzle.groups.length
    })).sort((a, b) => b.found - a.found);

    this.io.to(this.code).emit('conn_results', { solution, summary, players: this.room.players });
    Object.keys(this.room.players).forEach(id => {
      const s = this.state[id];
      this.io.to(id).emit('conn_result_player', {
        found: s.found.length, total: this.puzzle.groups.length, solved: s.found.length >= this.puzzle.groups.length
      });
    });
    setTimeout(() => this.showFinal(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Connections' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'solving') { clearTimeout(this.timer); clearInterval(this.checkTimer); this.showResults(); }
  }
}

module.exports = Connections;
