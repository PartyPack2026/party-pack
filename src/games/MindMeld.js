const QUESTIONS = [
  "Name something you'd find in a teenager's bedroom","Name a reason someone calls in sick","Name something people do when bored",
  "Name a word people say when nervous","Name something you'd bring to a desert island","Name a thing people lie about on their CV",
  "Name something always in someone's fridge","Name a reason to block someone","Name something people do in the shower besides wash",
  "Name a sign someone is having a bad day","Name something in a grandma's handbag","Name a thing people pretend to enjoy",
  "Name something people google at 3am","Name a word for Monday morning","Name something people do on their phone in a movie",
  "Name a thing kids do that adults secretly want to","Name something that breaks at the worst time","Name a reason to leave a party early",
  "Name something people say they'll do but never do","Name a thing in someone's car","Name a famous cartoon character",
  "Name something you'd never microwave","Name a superpower everyone wants","Name a country you'd love to visit",
  "Name something red","Name a movie everyone has seen","Name an animal at the zoo","Name a pizza topping",
  "Name something you do every morning","Name a board game","Name something you'd find on a beach","Name a type of weather",
  "Name a fast food chain","Name something cold","Name a job kids dream about","Name a holiday tradition",
  "Name something you lose constantly","Name an excuse for being late","Name a smell everyone loves","Name something in space",
  "Name a fruit","Name a sport that's hard to watch","Name something that's overpriced","Name a celebrity everyone knows",
  "Name a thing you'd save in a fire","Name a song everyone knows the words to","Name something you do when you can't sleep",
  "Name a chore everyone hates","Name an app on everyone's phone","Name something you'd find in a junk drawer"
];

class MindMeld {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 4; this.currentRound = 0;
    this.usedQs = []; this.answers = {};
    this.phase = 'answering';
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinalResults(); return; }

    const available = QUESTIONS.filter(q => !this.usedQs.includes(q));
    this.currentQ = available[Math.floor(Math.random() * available.length)];
    this.usedQs.push(this.currentQ);
    this.answers = {};
    this.phase = 'answering';

    this.io.to(this.code).emit('mindmeld_round', {
      round: this.currentRound, totalRounds: this.rounds,
      question: this.currentQ
    });

    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('mindmeld_answer', {
        question: this.currentQ, timeLimit: 30
      });
    });

    this.timer = setTimeout(() => this.showResults(), 33000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      if (!this.answers[playerId]) {
        this.answers[playerId] = data.answer.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const count = Object.keys(this.answers).length;
        const total = Object.keys(this.room.players).length;
        this.io.to(this.code).emit('player_answered', { count, total });
        if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.showResults(), 800); }
      }
    }
  }

  showResults() {
    this.phase = 'results';
    // Count how many times each answer was given
    const tally = {};
    Object.values(this.answers).forEach(a => {
      tally[a] = (tally[a] || 0) + 1;
    });

    const totalPlayers = Object.keys(this.room.players).length;
    const meldBonus = 500;
    const popularScore = 200;

    // Find the most popular answer
    const maxCount = Math.max(...Object.values(tally));

    Object.entries(this.answers).forEach(([pid, answer]) => {
      const count = tally[answer] || 0;
      const player = this.room.players[pid];
      if (!player) return;

      if (count === totalPlayers) {
        // Everyone said the same thing — massive group meld!
        player.score += meldBonus * 2;
      } else if (count > 1 && count === maxCount) {
        // Most popular answer
        player.score += popularScore + (count * 100);
      } else if (count > 1) {
        // Shared with at least one person
        player.score += popularScore;
      } else {
        // Unique answer — no points
      }
    });

    // Find mind meld pairs (exact same answer)
    const melds = {};
    Object.entries(this.answers).forEach(([pid, answer]) => {
      if (!melds[answer]) melds[answer] = [];
      melds[answer].push(pid);
    });

    const meldPairs = Object.entries(melds)
      .filter(([, pids]) => pids.length > 1)
      .map(([answer, pids]) => ({ answer, pids, names: pids.map(id => this.room.players[id]?.nickname) }));

    const answerList = Object.entries(this.answers).map(([pid, answer]) => ({
      pid, answer, count: tally[answer],
      nickname: this.room.players[pid]?.nickname,
      avatar: this.room.players[pid]?.avatar
    })).sort((a,b) => b.count - a.count);

    // Reveal one by one
    answerList.forEach((a, i) => {
      setTimeout(() => {
        this.io.to(this.code).emit('mindmeld_reveal_one', {
          answer: a, index: i, total: answerList.length,
          question: this.currentQ
        });
      }, i * 700);
    });

    setTimeout(() => {
      this.io.to(this.code).emit('mindmeld_results', {
        question: this.currentQ,
        answers: answerList,
        meldPairs, tally, players: this.room.players
      });
    }, answerList.length * 700 + 300);

    Object.entries(this.answers).forEach(([pid, answer]) => {
      const count = tally[answer];
      const isMeld = count > 1;
      this.io.to(pid).emit('mindmeld_result_player', {
        answer, count, isMeld,
        meldWith: isMeld ? Object.entries(this.answers)
          .filter(([id, a]) => a === answer && id !== pid)
          .map(([id]) => this.room.players[id]?.nickname) : [],
        players: this.room.players
      });
    });

    const delay = Object.keys(this.room.players).length * 700 + 6000;
    setTimeout(() => this.nextRound(), delay);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Mind Meld' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.timer);
    if (this.phase === 'answering') this.showResults();
  }
}
module.exports = MindMeld;
