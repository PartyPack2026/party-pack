const FACTS = [
  { fact: "A group of flamingos is called a flamboyance", category: "Animals" },
  { fact: "Honey never expires and has been found edible in ancient Egyptian tombs", category: "Food" },
  { fact: "Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid", category: "History" },
  { fact: "A day on Venus is longer than a year on Venus", category: "Space" },
  { fact: "Octopuses have three hearts and blue blood", category: "Animals" },
  { fact: "The shortest war in history lasted 38 to 45 minutes", category: "History" },
  { fact: "Bananas are technically berries, but strawberries are not", category: "Food" },
  { fact: "It rains diamonds on Neptune and Uranus", category: "Space" },
  { fact: "Sloths can hold their breath longer than dolphins", category: "Animals" },
  { fact: "The inventor of the Pringles can is buried in one", category: "Weird" },
  { fact: "A shrimp's heart is in its head", category: "Animals" },
  { fact: "Oxford University is older than the Aztec Empire", category: "History" },
  { fact: "Crows can recognize and remember human faces", category: "Animals" },
  { fact: "The average cloud weighs about 1.1 million pounds", category: "Science" },
  { fact: "There are more possible chess games than atoms in the observable universe", category: "Math" },
];

class Fibbage {
  constructor(room, io, endGame) {
    this.room = room;
    this.io = io;
    this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3;
    this.currentRound = 0;
    this.usedFacts = [];
    this.currentFact = null;
    this.lies = {}; // playerId -> lie text
    this.votes = {}; // playerId -> chosen answer id
    this.phase = 'lying';
  }

  start() {
    this.nextRound();
  }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) {
      this.showFinalResults();
      return;
    }

    // Pick a random unused fact
    const available = FACTS.filter(f => !this.usedFacts.includes(f.fact));
    this.currentFact = available[Math.floor(Math.random() * available.length)];
    this.usedFacts.push(this.currentFact.fact);

    this.lies = {};
    this.votes = {};
    this.phase = 'lying';

    // Show the prompt (with blank)
    const blankFact = this.currentFact.fact.replace(
      /\b(\w+)\b(?=[^,]*$)/, // blank out a key word at the end
      '___'
    );

    this.io.to(this.code).emit('fibbage_round', {
      round: this.currentRound,
      totalRounds: this.rounds,
      category: this.currentFact.category,
      prompt: blankFact,
      phase: 'lying',
      timeLimit: 45
    });

    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('enter_lie', { prompt: blankFact });
    });

    this.lieTimer = setTimeout(() => this.startVoting(), 50000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'lying' && data.type === 'lie') {
      this.lies[playerId] = data.lie || '(blank)';
      this.io.to(this.code).emit('player_answered', {
        playerId,
        count: Object.keys(this.lies).length
      });

      if (Object.keys(this.lies).length >= Object.values(this.room.players).length) {
        clearTimeout(this.lieTimer);
        setTimeout(() => this.startVoting(), 1000);
      }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      this.votes[playerId] = data.answerId;
      this.io.to(this.code).emit('vote_received', { count: Object.keys(this.votes).length });

      if (Object.keys(this.votes).length >= Object.values(this.room.players).length) {
        clearTimeout(this.voteTimer);
        setTimeout(() => this.showResults(), 500);
      }
    }
  }

  startVoting() {
    this.phase = 'voting';

    // Build answer list: all lies + the truth
    const players = Object.values(this.room.players);
    const answers = [];

    // Add player lies (deduplicate against truth)
    Object.entries(this.lies).forEach(([pid, lie]) => {
      const truthWord = this.currentFact.fact.split(/\b/).pop();
      if (lie.toLowerCase() !== truthWord.toLowerCase()) {
        answers.push({ id: `lie_${pid}`, text: lie, playerId: pid, isLie: true });
      }
    });

    // Add the truth
    const truthText = this.currentFact.fact.split(' ').slice(-3).join(' '); // last few words
    answers.push({ id: 'truth', text: this.currentFact.fact, isLie: false });

    // Shuffle
    answers.sort(() => Math.random() - 0.5);
    this.answers = answers;

    this.io.to(this.code).emit('fibbage_vote', {
      answers: answers.map(a => ({ id: a.id, text: a.text }))
    });

    players.forEach(p => {
      this.io.to(p.id).emit('pick_answer', {
        answers: answers.map(a => ({ id: a.id, text: a.text }))
      });
    });

    this.voteTimer = setTimeout(() => this.showResults(), 35000);
  }

  showResults() {
    const players = Object.values(this.room.players);

    // Score: 500 for finding truth, 500 for each person fooled by your lie
    players.forEach(p => {
      const chosen = this.votes[p.id];
      if (!chosen) return;
      const answer = this.answers.find(a => a.id === chosen);
      if (answer && !answer.isLie) {
        // Found the truth!
        p.score += 500;
      }
    });

    // Points for fooling others
    Object.values(this.votes).forEach(answerId => {
      const answer = this.answers.find(a => a.id === answerId);
      if (answer && answer.isLie && answer.playerId) {
        if (this.room.players[answer.playerId]) {
          this.room.players[answer.playerId].score += 500;
        }
      }
    });

    this.io.to(this.code).emit('fibbage_results', {
      truth: this.currentFact.fact,
      answers: this.answers,
      votes: this.votes,
      players: this.room.players
    });

    setTimeout(() => this.nextRound(), 8000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score
    })).sort((a, b) => b.score - a.score);

    this.io.to(this.code).emit('round_scores', { scores, gameName: 'Fibbage' });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.lieTimer);
    clearTimeout(this.voteTimer);
    if (this.phase === 'lying') this.startVoting();
    else if (this.phase === 'voting') this.showResults();
  }
}

module.exports = Fibbage;
