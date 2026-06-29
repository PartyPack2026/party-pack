const POLLS = [
  { q: "If you had to eat one food for the rest of your life, what would it be?", o: ["Pizza","Tacos","Sushi","Pasta","Burgers"] },
  { q: "Most chaotic thing to do at someone else's wedding:", o: ["Give an unsolicited speech","Bring a plus-one nobody knows","Propose to someone","Cry the entire time","Leave before the cake"] },
  { q: "Pick your survival strategy in a zombie apocalypse:", o: ["Find a fortress","Build a team","Go solo","Find an island","Accept fate immediately"] },
  { q: "What would you do first with a million dollars?", o: ["Travel the world","Quit my job dramatically","Buy a house","Pay off family debt","Invest it and tell no one"] },
  { q: "Which group chat are you most likely to mute?", o: ["Family group chat","Work colleagues","Old school friends","The one nobody uses","The one that's too active"] },
  { q: "Most likely to become your villain origin story:", o: ["Slow internet","Someone eating your lunch","Bad parking","Being put on hold forever","A paper cut at the worst moment"] },
  { q: "If animals could talk, which would be the most insufferable?", o: ["Cats","Geese","Dolphins","Pigeons","Golden retrievers"] },
  { q: "Pick your ideal way to spend a Sunday:", o: ["Absolute silence","Brunch with friends","Watching sport all day","Countryside walk","Still in bed at 2pm"] },
  { q: "What's your go-to move when you don't know anyone at a party?", o: ["Find the dog","Go to the kitchen","Check my phone the whole time","Talk to literally everyone","Leave early"] },
  { q: "Most stressful thing on this list:", o: ["Making a phone call","Being on read","Running late","A full inbox","Small talk with strangers"] },
];

class PollMine {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.usedPolls = []; this.playerVotes = {};
    this.predictions = {}; this.phase = 'voting';
    this.currentPoll = null; this.tally = {}; this.actualRanking = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinalResults(); return; }
    const available = POLLS.filter(p => !this.usedPolls.includes(p.q));
    this.currentPoll = available[Math.floor(Math.random() * available.length)];
    this.usedPolls.push(this.currentPoll.q);
    this.playerVotes = {}; this.predictions = {}; this.phase = 'voting';

    this.io.to(this.code).emit('pollmine_round', {
      round: this.currentRound, totalRounds: this.rounds,
      question: this.currentPoll.q, options: this.currentPoll.o
    });
    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('cast_vote', { question: this.currentPoll.q, options: this.currentPoll.o, timeLimit: 25 });
    });
    this.voteTimer = setTimeout(() => this.startPredicting(), 20000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'voting' && data.type === 'vote') {
      if (!this.playerVotes[playerId]) {
        this.playerVotes[playerId] = data.option;
        const total = Object.keys(this.room.players).length;
        this.io.to(this.code).emit('player_answered', { count: Object.keys(this.playerVotes).length, total });
        if (Object.keys(this.playerVotes).length >= total) { clearTimeout(this.voteTimer); setTimeout(() => this.startPredicting(), 800); }
      }
    } else if (this.phase === 'predicting' && data.type === 'prediction') {
      if (!this.predictions[playerId]) {
        this.predictions[playerId] = data.ranking;
        const total = Object.keys(this.room.players).length;
        this.io.to(this.code).emit('player_answered', { count: Object.keys(this.predictions).length, total });
        if (Object.keys(this.predictions).length >= total) { clearTimeout(this.predictTimer); setTimeout(() => this.showPollResults(), 800); }
      }
    }
  }

  startPredicting() {
    this.phase = 'predicting';
    this.tally = {};
    this.currentPoll.o.forEach(opt => this.tally[opt] = 0);
    Object.values(this.playerVotes).forEach(v => { if (this.tally[v] !== undefined) this.tally[v]++; });
    this.actualRanking = [...this.currentPoll.o].sort((a, b) => this.tally[b] - this.tally[a]);

    this.io.to(this.code).emit('pollmine_predict', { question: this.currentPoll.q, options: this.currentPoll.o });
    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('rank_options', {
        question: this.currentPoll.q, timeLimit: 35,
        options: [...this.currentPoll.o].sort(() => Math.random() - 0.5)
      });
    });
    this.predictTimer = setTimeout(() => this.showPollResults(), 25000);
  }

  showPollResults() {
    Object.entries(this.predictions).forEach(([pid, ranking]) => {
      if (!ranking || !Array.isArray(ranking)) return;
      let pts = 0;
      ranking.forEach((option, predictedRank) => {
        const actualRank = this.actualRanking.indexOf(option);
        const diff = Math.abs(predictedRank - actualRank);
        if (diff === 0) pts += 400;
        else if (diff === 1) pts += 200;
        else if (diff === 2) pts += 75;
      });
      if (this.room.players[pid]) this.room.players[pid].score += pts;
    });

    this.io.to(this.code).emit('pollmine_results', {
      question: this.currentPoll.q, tally: this.tally,
      actualRanking: this.actualRanking, predictions: this.predictions,
      playerVotes: this.playerVotes, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('pollmine_results_player', {
        actualRanking: this.actualRanking, tally: this.tally,
        myPrediction: this.predictions[id], myVote: this.playerVotes[id],
        players: this.room.players
      });
    });
    setTimeout(() => this.nextRound(), 9000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Poll Mine' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.voteTimer); clearTimeout(this.predictTimer);
    if (this.phase === 'voting') this.startPredicting();
    else if (this.phase === 'predicting') this.showPollResults();
  }
}
module.exports = PollMine;
