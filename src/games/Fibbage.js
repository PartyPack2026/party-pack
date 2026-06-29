const FACTS = [
  { prompt: "A flamingo can only eat when its head is ___", truth: "upside down", category: "Animals" },
  { prompt: "It is illegal to own just one guinea pig in ___", truth: "Switzerland", category: "Law" },
  { prompt: "The inventor of the Pringles can is buried in ___", truth: "a Pringles can", category: "Weird" },
  { prompt: "Cleopatra lived closer in time to the Moon landing than to ___", truth: "the pyramids being built", category: "History" },
  { prompt: "A day on Venus is longer than ___", truth: "a year on Venus", category: "Space" },
  { prompt: "Bananas are technically ___, but strawberries are not", truth: "berries", category: "Food" },
  { prompt: "Crows can recognise human faces and hold ___ against people", truth: "grudges", category: "Animals" },
  { prompt: "Oxford University is older than ___", truth: "the Aztec Empire", category: "History" },
  { prompt: "It rains ___ on Neptune", truth: "diamonds", category: "Space" },
  { prompt: "A shrimp's heart is located in its ___", truth: "head", category: "Animals" },
  { prompt: "Nintendo was founded in ___, originally making playing cards", truth: "1889", category: "Gaming" },
  { prompt: "Humans share 60% of their DNA with ___", truth: "bananas", category: "Science" },
  { prompt: "Scotland's national animal is the ___", truth: "unicorn", category: "Weird" },
  { prompt: "A group of flamingos is called a ___", truth: "flamboyance", category: "Animals" },
  { prompt: "Honey found in ancient Egyptian tombs is still ___ today", truth: "edible", category: "Food" },
  { prompt: "Sloths can hold their breath longer than ___", truth: "dolphins", category: "Animals" },
  { prompt: "The world's oldest piece of chewing gum is ___ years old", truth: "9000", category: "Weird" },
  { prompt: "There are more possible chess games than ___ in the universe", truth: "atoms", category: "Math" },
  { prompt: "The average cloud weighs about the same as ___ elephants", truth: "100", category: "Science" },
  { prompt: "Wombat poo is shaped like ___", truth: "cubes", category: "Animals" },
  { prompt: "Octopuses have ___ hearts", truth: "three", category: "Animals" },
  { prompt: "The shortest war in history lasted around ___ minutes", truth: "38", category: "History" },
  { prompt: "A bolt of lightning is ___ times hotter than the sun's surface", truth: "five", category: "Science" },
  { prompt: "The unicorn is the official national animal of ___", truth: "Scotland", category: "Weird" },
  { prompt: "Sharks existed before ___ did", truth: "trees", category: "Nature" },
  { prompt: "A hummingbird's heart beats up to ___ times per minute", truth: "1260", category: "Animals" },
  { prompt: "The first oranges weren't orange, they were ___", truth: "green", category: "Food" },
  { prompt: "Hot water can freeze faster than ___ water", truth: "cold", category: "Science" },
  { prompt: "The Eiffel Tower can grow ___ cm taller in summer", truth: "15", category: "Science" },
  { prompt: "A snail can sleep for up to ___ years", truth: "three", category: "Animals" },
  { prompt: "Venus is the only planet that spins ___", truth: "clockwise", category: "Space" },
  { prompt: "There are more ___ than people on Earth", truth: "chickens", category: "Animals" },
  { prompt: "The dot over a lowercase 'i' is called a ___", truth: "tittle", category: "Language" },
  { prompt: "A jiffy is an actual unit of ___", truth: "time", category: "Science" },
  { prompt: "Bubble wrap was originally invented as ___", truth: "wallpaper", category: "Weird" }
];

class Fibbage {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.usedFacts = []; this.currentFact = null;
    this.lies = {}; this.votes = {}; this.answers = [];
    this.phase = 'lying';
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinalResults(); return; }
    const available = FACTS.filter(f => !this.usedFacts.includes(f.prompt));
    this.currentFact = available[Math.floor(Math.random() * available.length)];
    this.usedFacts.push(this.currentFact.prompt);
    this.lies = {}; this.votes = {}; this.phase = 'lying';

    this.io.to(this.code).emit('fibbage_round', {
      round: this.currentRound, totalRounds: this.rounds,
      category: this.currentFact.category, prompt: this.currentFact.prompt
    });

    const hint = `Starts with "${this.currentFact.truth[0].toUpperCase()}"`;
    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('enter_lie', {
        prompt: this.currentFact.prompt, timeLimit: 35, hint
      });
    });

    this.lieTimer = setTimeout(() => this.startVoting(), 45000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'lying' && data.type === 'lie') {
      if (!this.lies[playerId]) {
        this.lies[playerId] = data.lie.trim() || '(blank)';
        const count = Object.keys(this.lies).length;
        const total = Object.keys(this.room.players).length;
        this.io.to(this.code).emit('player_answered', { playerId, count, total });
        if (count >= total) { clearTimeout(this.lieTimer); setTimeout(() => this.startVoting(), 1000); }
      }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      // Can't vote for your own lie
      const myAnswer = this.answers.find(a => a.playerId === playerId);
      if (myAnswer && myAnswer.id === data.answerId) return;
      this.votes[playerId] = data.answerId;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('vote_received', { count: Object.keys(this.votes).length, total });
      if (Object.keys(this.votes).length >= total) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 500); }
    }
  }

  startVoting() {
    this.phase = 'voting';
    Object.values(this.room.players).forEach(p => { if (!this.lies[p.id]) this.lies[p.id] = '(blank)'; });
    this.answers = [];
    Object.entries(this.lies).forEach(([pid, lie]) => {
      if (lie.toLowerCase() !== this.currentFact.truth.toLowerCase()) {
        this.answers.push({ id: `lie_${pid}`, text: lie, playerId: pid, isLie: true });
      }
    });
    this.answers.push({ id: 'truth', text: this.currentFact.truth, isLie: false });
    this.answers.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('fibbage_vote', {
      prompt: this.currentFact.prompt,
      answers: this.answers.map(a => ({ id: a.id, text: a.text }))
    });
    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('pick_answer', {
        prompt: this.currentFact.prompt, timeLimit: 25,
        answers: this.answers.map(a => ({ id: a.id, text: a.text }))
      });
    });
    this.voteTimer = setTimeout(() => this.showResults(), 20000);
  }

  showResults() {
    Object.values(this.room.players).forEach(p => {
      const chosen = this.votes[p.id];
      if (!chosen) return;
      const answer = this.answers.find(a => a.id === chosen);
      if (answer && !answer.isLie) p.score += 500;
    });
    Object.values(this.votes).forEach(answerId => {
      const answer = this.answers.find(a => a.id === answerId);
      if (answer && answer.isLie && answer.playerId && this.room.players[answer.playerId]) {
        this.room.players[answer.playerId].score += 400;
      }
    });
    this.io.to(this.code).emit('fibbage_results', {
      truth: this.currentFact.truth, prompt: this.currentFact.prompt,
      answers: this.answers, votes: this.votes, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('fibbage_results_player', {
        truth: this.currentFact.truth, answers: this.answers,
        votes: this.votes, myId: id, players: this.room.players
      });
    });
    setTimeout(() => this.nextRound(), 8000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Fibbage' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.lieTimer); clearTimeout(this.voteTimer);
    if (this.phase === 'lying') this.startVoting();
    else if (this.phase === 'voting') this.showResults();
  }
}
module.exports = Fibbage;
