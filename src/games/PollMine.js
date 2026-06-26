const POLLS = [
  { q: "What would you do with a million dollars?", options: ["Travel the world", "Buy a house", "Invest it", "Give it away", "Spend it all immediately"] },
  { q: "What's your spirit animal?", options: ["Dog", "Cat", "Eagle", "Dolphin", "Bear"] },
  { q: "Pick your dream weekend:", options: ["Beach holiday", "City adventure", "Mountain hiking", "Stay home gaming", "Road trip"] },
  { q: "Your go-to pizza topping?", options: ["Pepperoni", "Cheese only", "Vegetables", "BBQ chicken", "Pineapple (yes really)"] },
  { q: "What superpower would you choose?", options: ["Flight", "Invisibility", "Time travel", "Mind reading", "Super strength"] },
  { q: "How do you handle stress?", options: ["Exercise", "Watch TV/movies", "Eat food", "Talk to someone", "Sleep"] },
  { q: "Pick your ideal vacation:", options: ["5-star hotel", "Camping", "Backpacking hostel", "Airbnb local", "Cruise ship"] },
  { q: "Your go-to late night snack?", options: ["Chips/crisps", "Ice cream", "Leftovers", "Cereal", "Nothing, I'm asleep"] },
  { q: "Which job sounds most fun?", options: ["Astronaut", "Chef", "Video game tester", "Travel blogger", "Dolphin trainer"] },
  { q: "How do you take your coffee?", options: ["Black", "With milk", "Lots of sugar", "Fancy (latte/cappuccino)", "I don't drink coffee"] },
];

class PollMine {
  constructor(room, io, endGame) {
    this.room = room;
    this.io = io;
    this.endGame = endGame;
    this.code = room.code;
    this.rounds = 4;
    this.currentRound = 0;
    this.usedPolls = [];
    this.playerVotes = {}; // playerId -> chosen option
    this.predictions = {}; // playerId -> array of predicted rankings
    this.phase = 'voting';
    this.currentPoll = null;
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

    const available = POLLS.filter(p => !this.usedPolls.includes(p.q));
    this.currentPoll = available[Math.floor(Math.random() * available.length)];
    this.usedPolls.push(this.currentPoll.q);
    this.playerVotes = {};
    this.predictions = {};
    this.phase = 'voting';

    this.io.to(this.code).emit('pollmine_round', {
      round: this.currentRound,
      totalRounds: this.rounds,
      question: this.currentPoll.q,
      options: this.currentPoll.options,
      phase: 'voting',
      timeLimit: 30
    });

    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('cast_vote', {
        question: this.currentPoll.q,
        options: this.currentPoll.options
      });
    });

    this.voteTimer = setTimeout(() => this.startPredicting(), 33000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'voting' && data.type === 'vote') {
      if (!this.playerVotes[playerId]) {
        this.playerVotes[playerId] = data.option;
        this.io.to(this.code).emit('player_answered', {
          count: Object.keys(this.playerVotes).length
        });

        if (Object.keys(this.playerVotes).length >= Object.values(this.room.players).length) {
          clearTimeout(this.voteTimer);
          setTimeout(() => this.startPredicting(), 500);
        }
      }
    } else if (this.phase === 'predicting' && data.type === 'prediction') {
      if (!this.predictions[playerId]) {
        this.predictions[playerId] = data.ranking; // Array of options in predicted order
        this.io.to(this.code).emit('player_answered', {
          count: Object.keys(this.predictions).length
        });

        if (Object.keys(this.predictions).length >= Object.values(this.room.players).length) {
          clearTimeout(this.predictTimer);
          setTimeout(() => this.showPollResults(), 500);
        }
      }
    }
  }

  startPredicting() {
    this.phase = 'predicting';

    // Calculate actual results
    const tally = {};
    this.currentPoll.options.forEach(opt => tally[opt] = 0);
    Object.values(this.playerVotes).forEach(v => {
      if (tally[v] !== undefined) tally[v]++;
    });

    // Store actual ranking
    this.actualRanking = [...this.currentPoll.options].sort((a, b) => tally[b] - tally[a]);
    this.tally = tally;

    this.io.to(this.code).emit('pollmine_predict', {
      question: this.currentPoll.q,
      options: this.currentPoll.options,
      phase: 'predicting',
      timeLimit: 40
    });

    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('rank_options', {
        question: this.currentPoll.q,
        options: [...this.currentPoll.options].sort(() => Math.random() - 0.5)
      });
    });

    this.predictTimer = setTimeout(() => this.showPollResults(), 45000);
  }

  showPollResults() {
    // Score based on accuracy of prediction
    Object.entries(this.predictions).forEach(([pid, ranking]) => {
      if (!ranking) return;
      let score = 0;

      ranking.forEach((option, predictedRank) => {
        const actualRank = this.actualRanking.indexOf(option);
        const diff = Math.abs(predictedRank - actualRank);
        if (diff === 0) score += 300;
        else if (diff === 1) score += 150;
        else if (diff === 2) score += 50;
      });

      if (this.room.players[pid]) {
        this.room.players[pid].score += score;
      }
    });

    this.io.to(this.code).emit('pollmine_results', {
      question: this.currentPoll.q,
      tally: this.tally,
      actualRanking: this.actualRanking,
      predictions: this.predictions,
      playerVotes: this.playerVotes,
      players: this.room.players
    });

    setTimeout(() => this.nextRound(), 8000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score
    })).sort((a, b) => b.score - a.score);

    this.io.to(this.code).emit('round_scores', { scores, gameName: 'Poll Mine' });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.voteTimer);
    clearTimeout(this.predictTimer);
    if (this.phase === 'voting') this.startPredicting();
    else if (this.phase === 'predicting') this.showPollResults();
  }
}

module.exports = PollMine;
