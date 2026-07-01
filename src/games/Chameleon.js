// CHAMELEON — everyone gets the same secret word... except one player, the Chameleon, who only
// knows the category. Each player types ONE clue word about the secret. The Chameleon has to
// bluff a clue without knowing the word. Then everyone votes who the faker is. Catch the
// Chameleon = points for the group; survive = points for the Chameleon (bonus if they guess the word).

const TOPICS = [
  { cat: "Animals", words: ["Elephant", "Penguin", "Dolphin", "Kangaroo", "Octopus", "Giraffe", "Hedgehog", "Flamingo"] },
  { cat: "Food", words: ["Pizza", "Sushi", "Tacos", "Pancakes", "Spaghetti", "Burrito", "Cheeseburger", "Dumplings"] },
  { cat: "Movies", words: ["Titanic", "Frozen", "Avatar", "Jaws", "Shrek", "Gladiator", "Inception", "Up"] },
  { cat: "Jobs", words: ["Doctor", "Teacher", "Chef", "Pilot", "Firefighter", "Astronaut", "Plumber", "Lawyer"] },
  { cat: "Sports", words: ["Football", "Tennis", "Boxing", "Swimming", "Cricket", "Golf", "Surfing", "Archery"] },
  { cat: "Places", words: ["Beach", "Library", "Airport", "Hospital", "Museum", "Cinema", "Stadium", "Zoo"] },
  { cat: "Holidays", words: ["Christmas", "Halloween", "Easter", "Birthday", "New Year", "Thanksgiving", "Wedding", "Valentine"] },
  { cat: "Household Items", words: ["Toaster", "Umbrella", "Pillow", "Mirror", "Candle", "Blanket", "Kettle", "Vacuum"] },
  { cat: "Weather", words: ["Thunderstorm", "Sunshine", "Blizzard", "Rainbow", "Tornado", "Fog", "Heatwave", "Drizzle"] },
  { cat: "Music", words: ["Guitar", "Concert", "Drummer", "Karaoke", "Opera", "Playlist", "Trumpet", "Choir"] },
];

class Chameleon {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = Math.min(4, Object.keys(room.players).length);
    this.currentRound = 0;
    this.phase = 'clue';
    this.clues = {};
    this.votes = {};
  }

  start() { this.usedTopics = []; this.nextRound(); }

  nextRound() {
    if (!this.room || Object.keys(this.room.players).length === 0) { this.ended = true; return; }
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }

    const pool = TOPICS.map((t, i) => i).filter(i => !this.usedTopics.includes(i));
    const tIdx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * TOPICS.length);
    this.usedTopics.push(tIdx);
    this.topic = TOPICS[tIdx];
    this.secret = this.topic.words[Math.floor(Math.random() * this.topic.words.length)];

    // pick a random chameleon
    const ids = Object.keys(this.room.players);
    this.chameleon = ids[Math.floor(Math.random() * ids.length)];
    this.clues = {};
    this.votes = {};
    this.chameleonGuess = null;
    this.phase = 'clue';

    this.io.to(this.code).emit('cham_round', {
      round: this.currentRound, totalRounds: this.rounds,
      category: this.topic.cat, wordList: this.topic.words
    });
    ids.forEach(id => {
      if (id === this.chameleon) {
        this.io.to(id).emit('cham_role', { isChameleon: true, category: this.topic.cat, wordList: this.topic.words });
      } else {
        this.io.to(id).emit('cham_role', { isChameleon: false, category: this.topic.cat, secret: this.secret });
      }
    });
    this.clueTimer = setTimeout(() => this.startVoting(), 40000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'clue' && data.type === 'clue') {
      if (this.clues[playerId]) return;
      const word = String(data.word || '').slice(0, 24).trim();
      if (!word) return;
      this.clues[playerId] = word;
      this.io.to(playerId).emit('cham_clue_locked', {});
      const count = Object.keys(this.clues).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('cham_clue_count', { count, total });
      if (count >= total) { clearTimeout(this.clueTimer); setTimeout(() => this.startVoting(), 800); }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      if (playerId === data.target) return; // can't vote yourself
      if (!this.room.players[data.target]) return;
      this.votes[playerId] = data.target;
      this.io.to(playerId).emit('cham_voted', {});
      const count = Object.keys(this.votes).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('cham_vote_count', { count, total });
      if (count >= total) { clearTimeout(this.voteTimer); setTimeout(() => this.reveal(), 700); }
    } else if (this.phase === 'chameleon_guess' && data.type === 'word_guess') {
      if (playerId !== this.chameleon) return;
      if (this.chameleonGuess !== null) return;
      this.chameleonGuess = String(data.guess || '').trim();
      this.finishReveal();
    }
  }

  startVoting() {
    if (this.phase !== 'clue') return;
    this.phase = 'voting';
    // build clue display in the order players joined
    const clueList = Object.keys(this.room.players).map(id => ({
      id, name: this.room.players[id]?.nickname, avatar: this.room.players[id]?.avatar,
      clue: this.clues[id] || '(no clue)'
    }));
    this.io.to(this.code).emit('cham_clues', { category: this.topic.cat, clues: clueList });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('cham_vote', {
        clues: clueList.filter(c => c.id !== id).map(c => ({ id: c.id, name: c.name, clue: c.clue }))
      });
    });
    this.voteTimer = setTimeout(() => this.reveal(), 30000);
  }

  reveal() {
    if (this.phase === 'reveal' || this.phase === 'chameleon_guess') return;

    // tally votes
    const tally = {};
    Object.values(this.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
    const maxVotes = Math.max(0, ...Object.values(tally));
    const accused = Object.keys(tally).filter(id => tally[id] === maxVotes);
    this.caught = accused.length === 1 && accused[0] === this.chameleon;

    // award group points now for correct votes
    Object.entries(this.votes).forEach(([voter, target]) => {
      if (target === this.chameleon && this.room.players[voter]) this.room.players[voter].score += 200;
    });

    if (this.caught) {
      // chameleon gets a chance to steal points by guessing the secret word
      this.phase = 'chameleon_guess';
      this.io.to(this.code).emit('cham_caught', {
        chameleonName: this.room.players[this.chameleon]?.nickname
      });
      this.io.to(this.chameleon).emit('cham_guess_chance', { category: this.topic.cat, wordList: this.topic.words });
      Object.keys(this.room.players).forEach(id => {
        if (id !== this.chameleon) this.io.to(id).emit('cham_wait_guess', { chameleonName: this.room.players[this.chameleon]?.nickname });
      });
      this.guessTimer = setTimeout(() => { if (this.chameleonGuess === null) { this.chameleonGuess = ''; this.finishReveal(); } }, 15000);
    } else {
      // chameleon escaped
      if (this.room.players[this.chameleon]) this.room.players[this.chameleon].score += 400;
      this.finishReveal();
    }
  }

  finishReveal() {
    if (this.phase === 'reveal') return;
    clearTimeout(this.guessTimer);
    this.phase = 'reveal';

    let guessedRight = false;
    if (this.caught && this.chameleonGuess) {
      guessedRight = this.chameleonGuess.toLowerCase().trim() === this.secret.toLowerCase();
      if (guessedRight && this.room.players[this.chameleon]) this.room.players[this.chameleon].score += 300;
    }

    this.io.to(this.code).emit('cham_reveal', {
      chameleonName: this.room.players[this.chameleon]?.nickname,
      chameleonAvatar: this.room.players[this.chameleon]?.avatar,
      secret: this.secret, caught: this.caught,
      chameleonGuess: this.chameleonGuess, guessedRight,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const isCham = id === this.chameleon;
      this.io.to(id).emit('cham_reveal_player', {
        isChameleon: isCham, caught: this.caught,
        votedRight: this.votes[id] === this.chameleon, guessedRight, secret: this.secret
      });
    });
    setTimeout(() => this.nextRound(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Chameleon' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'clue') { clearTimeout(this.clueTimer); this.startVoting(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.reveal(); }
    else if (this.phase === 'chameleon_guess') { clearTimeout(this.guessTimer); this.chameleonGuess = this.chameleonGuess || ''; this.finishReveal(); }
  }
}

module.exports = Chameleon;
