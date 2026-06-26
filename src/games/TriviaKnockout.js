const QUESTIONS = [
  { q: "What is the capital of Australia?", a: "Canberra", o: ["Sydney","Melbourne","Canberra","Brisbane"] },
  { q: "How many bones are in the adult human body?", a: "206", o: ["196","206","216","226"] },
  { q: "Who painted the Mona Lisa?", a: "Leonardo da Vinci", o: ["Michelangelo","Raphael","Leonardo da Vinci","Donatello"] },
  { q: "What is the chemical symbol for gold?", a: "Au", o: ["Go","Gd","Au","Ag"] },
  { q: "Which planet has the most moons?", a: "Saturn", o: ["Jupiter","Saturn","Uranus","Neptune"] },
  { q: "What year did the Berlin Wall fall?", a: "1989", o: ["1987","1989","1991","1993"] },
  { q: "How many sides does a heptagon have?", a: "7", o: ["5","6","7","8"] },
  { q: "What is the largest ocean?", a: "Pacific", o: ["Atlantic","Indian","Arctic","Pacific"] },
  { q: "Who wrote Romeo and Juliet?", a: "Shakespeare", o: ["Dickens","Chaucer","Shakespeare","Marlowe"] },
  { q: "What is the square root of 144?", a: "12", o: ["11","12","13","14"] },
  { q: "Which element has the symbol O?", a: "Oxygen", o: ["Osmium","Oganesson","Oxygen","Ozone"] },
  { q: "In what country was pizza invented?", a: "Italy", o: ["Greece","France","Italy","Spain"] },
  { q: "What is the fastest land animal?", a: "Cheetah", o: ["Lion","Cheetah","Greyhound","Pronghorn"] },
  { q: "How many strings does a standard guitar have?", a: "6", o: ["4","5","6","7"] },
  { q: "What is the smallest country in the world?", a: "Vatican City", o: ["Monaco","San Marino","Vatican City","Liechtenstein"] },
  { q: "Which gas makes up most of Earth's atmosphere?", a: "Nitrogen", o: ["Oxygen","Carbon Dioxide","Nitrogen","Argon"] },
  { q: "How many players are on a soccer team?", a: "11", o: ["9","10","11","12"] },
  { q: "What is the longest river in the world?", a: "Nile", o: ["Amazon","Yangtze","Mississippi","Nile"] },
  { q: "What colour is the Eiffel Tower painted?", a: "Brown", o: ["Grey","Black","Brown","Silver"] },
  { q: "How many continents are there?", a: "7", o: ["5","6","7","8"] },
  { q: "What is the hardest natural substance?", a: "Diamond", o: ["Titanium","Quartz","Diamond","Obsidian"] },
  { q: "In which city is the Colosseum?", a: "Rome", o: ["Athens","Rome","Cairo","Istanbul"] },
  { q: "How many hearts does an octopus have?", a: "3", o: ["1","2","3","4"] },
  { q: "What is the currency of Japan?", a: "Yen", o: ["Won","Yuan","Yen","Rupee"] },
  { q: "Which planet is closest to the Sun?", a: "Mercury", o: ["Venus","Earth","Mercury","Mars"] },
];

class TriviaKnockout {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'question';
    this.activePlayers = Object.keys(room.players);
    this.eliminatedPlayers = [];
    this.questionIndex = 0;
    this.shuffledQuestions = [...QUESTIONS].sort(() => Math.random() - 0.5);
    this.answers = {}; this.streaks = {};
    this.activePlayers.forEach(id => this.streaks[id] = 0);
  }

  start() {
    this.io.to(this.code).emit('trivia_start', { playerCount: this.activePlayers.length });
    setTimeout(() => this.askQuestion(), 3000);
  }

  askQuestion() {
    if (this.questionIndex >= Math.min(this.shuffledQuestions.length, 20) || this.activePlayers.length <= 1) {
      this.showFinalResults(); return;
    }
    const q = this.shuffledQuestions[this.questionIndex];
    this.currentQuestion = q;
    this.answers = {}; this.phase = 'question';
    const shuffledOptions = [...q.o].sort(() => Math.random() - 0.5);
    this.currentOptions = shuffledOptions;

    this.io.to(this.code).emit('trivia_question', {
      question: q.q, options: shuffledOptions,
      questionNum: this.questionIndex + 1,
      activePlayers: this.activePlayers, eliminatedPlayers: this.eliminatedPlayers,
      total: this.activePlayers.length, timeLimit: 20
    });

    this.activePlayers.forEach(id => {
      this.io.to(id).emit('answer_question', { question: q.q, options: shuffledOptions, timeLimit: 20 });
    });
    this.eliminatedPlayers.forEach(id => {
      this.io.to(id).emit('spectating', { question: q.q, options: shuffledOptions });
    });

    this.questionTimer = setTimeout(() => this.revealAnswers(), 22000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'question' && data.type === 'answer' && this.activePlayers.includes(playerId)) {
      if (!this.answers[playerId]) {
        this.answers[playerId] = { answer: data.answer, time: Date.now() };
        this.io.to(this.code).emit('player_answered', { playerId, count: Object.keys(this.answers).length, total: this.activePlayers.length });
        if (Object.keys(this.answers).length >= this.activePlayers.length) {
          clearTimeout(this.questionTimer);
          setTimeout(() => this.revealAnswers(), 800);
        }
      }
    }
  }

  revealAnswers() {
    this.phase = 'reveal';
    const correct = this.currentQuestion.a;
    const results = {};
    const wrongPlayers = [];

    this.activePlayers.forEach(id => {
      const pa = this.answers[id];
      const isCorrect = pa && pa.answer === correct;
      results[id] = { answer: pa?.answer || '(no answer)', correct: isCorrect };
      if (isCorrect) {
        this.streaks[id] = (this.streaks[id] || 0) + 1;
        const bonus = this.streaks[id] > 1 ? (this.streaks[id] - 1) * 100 : 0;
        this.room.players[id].score += 300 + bonus;
      } else {
        this.streaks[id] = 0;
        wrongPlayers.push(id);
      }
    });

    const correctPlayers = this.activePlayers.filter(id => results[id]?.correct);
    let eliminated = [];
    if (correctPlayers.length > 0 && wrongPlayers.length > 0 && this.activePlayers.length > 2) {
      eliminated = wrongPlayers;
      eliminated.forEach(id => {
        this.activePlayers = this.activePlayers.filter(p => p !== id);
        this.eliminatedPlayers.push(id);
      });
    }

    this.io.to(this.code).emit('trivia_reveal', {
      correctAnswer: correct, results, eliminated,
      activePlayers: this.activePlayers, players: this.room.players, streaks: this.streaks
    });
    eliminated.forEach(id => this.io.to(id).emit('you_are_eliminated', {}));
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('trivia_reveal_player', {
        correctAnswer: correct, myAnswer: this.answers[id]?.answer,
        correct: results[id]?.correct, eliminated, myId: id,
        streak: this.streaks[id] || 0
      });
    });

    this.questionIndex++;
    setTimeout(() => this.askQuestion(), 6000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    this.io.to(this.code).emit('round_scores', { scores, gameName: 'Trivia Knockout' });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.questionTimer);
    if (this.phase === 'question') this.revealAnswers();
  }
}
module.exports = TriviaKnockout;
