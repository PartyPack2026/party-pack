const WORDS = [
  { word: "Volcano", category: "Nature" },
  { word: "Elevator", category: "Objects" },
  { word: "Kangaroo", category: "Animals" },
  { word: "Microwave", category: "Objects" },
  { word: "Quicksand", category: "Nature" },
  { word: "Submarine", category: "Vehicles" },
  { word: "Cactus", category: "Nature" },
  { word: "Escalator", category: "Objects" },
  { word: "Flamingo", category: "Animals" },
  { word: "Thunderstorm", category: "Nature" },
  { word: "Trampoline", category: "Objects" },
  { word: "Chameleon", category: "Animals" },
  { word: "Avalanche", category: "Nature" },
  { word: "Periscope", category: "Objects" },
  { word: "Platypus", category: "Animals" },
  { word: "Quicksilver", category: "Concepts" },
  { word: "Kaleidoscope", category: "Objects" },
  { word: "Archipelago", category: "Nature" },
  { word: "Boomerang", category: "Objects" },
  { word: "Chrysalis", category: "Nature" },
  { word: "Labyrinth", category: "Concepts" },
  { word: "Pendulum", category: "Objects" },
  { word: "Tornado", category: "Nature" },
  { word: "Telescope", category: "Objects" },
  { word: "Mongoose", category: "Animals" },
];

// Nonsense words the psychic must use as answers
const NONSENSE = [
  "Blorbix","Wumple","Fazzle","Snorkel","Blibble",
  "Wazzock","Plonk","Skrumble","Flibberty","Zumwop",
  "Grumblefiz","Snazzle","Blumph","Wizzle","Frobnicate",
  "Sploosh","Quibble","Flumble","Grizzwop","Snurble"
];

class Psychic {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.psychicQueue = []; this.currentPsychic = null;
    this.currentWord = null; this.currentRound = 0;
    this.totalRounds = 0; this.usedWords = [];
    this.questions = []; this.guesses = {};
    this.phase = 'questioning'; this.nonsenseWords = [];
    this.questionIndex = 0; this.maxQuestions = 8;
  }

  start() {
    const players = Object.keys(this.room.players);
    this.psychicQueue = [...players].sort(() => Math.random() - 0.5);
    this.totalRounds = Math.min(players.length, 4);
    this.nextRound();
  }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.totalRounds || this.psychicQueue.length === 0) {
      this.showFinalResults(); return;
    }

    this.currentPsychic = this.psychicQueue.shift();
    const available = WORDS.filter(w => !this.usedWords.includes(w.word));
    const wordObj = available[Math.floor(Math.random() * available.length)];
    this.currentWord = wordObj.word;
    this.usedWords.push(this.currentWord);
    this.questions = [];
    this.guesses = {};
    this.phase = 'questioning';
    this.questionIndex = 0;

    // Give psychic random nonsense words to use
    const shuffled = [...NONSENSE].sort(() => Math.random() - 0.5);
    this.nonsenseWords = shuffled.slice(0, 5);

    const psychicInfo = this.room.players[this.currentPsychic];

    this.io.to(this.code).emit('psychic_round', {
      round: this.currentRound, totalRounds: this.totalRounds,
      psychicName: psychicInfo?.nickname,
      psychicAvatar: psychicInfo?.avatar,
      category: wordObj.category,
      maxQuestions: this.maxQuestions
    });

    // Psychic gets the word + nonsense dictionary
    this.io.to(this.currentPsychic).emit('psychic_you_are_psychic', {
      word: this.currentWord,
      category: wordObj.category,
      nonsenseWords: this.nonsenseWords,
      instruction: `Your word is "${this.currentWord}". Others will ask yes/no questions. You can ONLY answer using these nonsense words: ${this.nonsenseWords.join(', ')}. Pick the one that feels most right!`
    });

    // Guessers
    Object.keys(this.room.players).forEach(id => {
      if (id !== this.currentPsychic) {
        this.io.to(id).emit('psychic_you_are_guesser', {
          category: wordObj.category,
          psychicName: psychicInfo?.nickname,
          nonsenseWords: this.nonsenseWords,
          instruction: `Ask yes/no questions. The Psychic can only answer with nonsense words. First to guess wins!`
        });
      }
    });

    this.startQuestionRound();
  }

  startQuestionRound() {
    if (this.questionIndex >= this.maxQuestions) {
      this.endRound(null); return;
    }

    // Pick next questioner (rotate through non-psychic players)
    const guessers = Object.keys(this.room.players).filter(id => id !== this.currentPsychic);
    const questioner = guessers[this.questionIndex % guessers.length];

    this.io.to(this.code).emit('psychic_question_turn', {
      questionerName: this.room.players[questioner]?.nickname,
      questionIndex: this.questionIndex + 1,
      maxQuestions: this.maxQuestions,
      questions: this.questions
    });

    this.io.to(questioner).emit('psychic_ask_question', {
      timeLimit: 20,
      questions: this.questions,
      canGuess: true
    });

    // Others wait or can buzz in with a guess
    Object.keys(this.room.players).forEach(id => {
      if (id !== questioner && id !== this.currentPsychic) {
        this.io.to(id).emit('psychic_wait_or_guess', {
          questions: this.questions,
          questionerName: this.room.players[questioner]?.nickname
        });
      } else if (id === this.currentPsychic) {
        this.io.to(id).emit('psychic_prepare_answer', {
          nonsenseWords: this.nonsenseWords,
          questions: this.questions
        });
      }
    });

    this.questionTimer = setTimeout(() => this.startQuestionRound(), 25000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'questioning') {

      if (data.type === 'question') {
        clearTimeout(this.questionTimer);
        this.questions.push({ question: data.question, questioner: this.room.players[playerId]?.nickname });
        // Psychic answers
        this.io.to(this.currentPsychic).emit('psychic_answer_this', {
          question: data.question,
          nonsenseWords: this.nonsenseWords,
          timeLimit: 15
        });
        this.io.to(this.code).emit('psychic_question_asked', {
          question: data.question,
          questioner: this.room.players[playerId]?.nickname
        });
        this.answerTimer = setTimeout(() => {
          this.questionIndex++;
          this.startQuestionRound();
        }, 18000);
      }

      if (data.type === 'psychic_answer' && playerId === this.currentPsychic) {
        clearTimeout(this.answerTimer);
        const lastQ = this.questions[this.questions.length - 1];
        if (lastQ) lastQ.answer = data.answer;
        this.io.to(this.code).emit('psychic_answered', {
          answer: data.answer,
          questions: this.questions
        });
        Object.keys(this.room.players).forEach(id => {
          if (id !== this.currentPsychic) {
            this.io.to(id).emit('psychic_got_answer', { answer: data.answer, questions: this.questions });
          }
        });
        this.questionIndex++;
        setTimeout(() => this.startQuestionRound(), 2000);
      }

      if (data.type === 'guess' && playerId !== this.currentPsychic) {
        clearTimeout(this.questionTimer);
        clearTimeout(this.answerTimer);
        const correct = data.guess.trim().toLowerCase() === this.currentWord.toLowerCase();
        if (correct) {
          this.endRound(playerId);
        } else {
          // Wrong guess — penalty and continue
          if (this.room.players[playerId]) this.room.players[playerId].score -= 100;
          this.io.to(playerId).emit('psychic_wrong_guess', { guess: data.guess });
          this.io.to(this.code).emit('psychic_wrong_guess_tv', {
            guesserName: this.room.players[playerId]?.nickname,
            guess: data.guess
          });
          this.questionIndex++;
          setTimeout(() => this.startQuestionRound(), 2000);
        }
      }
    }
  }

  endRound(winnerId) {
    this.phase = 'reveal';
    clearTimeout(this.questionTimer);
    clearTimeout(this.answerTimer);

    if (winnerId && this.room.players[winnerId]) {
      const questionsUsed = this.questionIndex;
      const speedBonus = Math.max(0, (this.maxQuestions - questionsUsed) * 50);
      this.room.players[winnerId].score += 500 + speedBonus;
      // Psychic also gets points when someone guesses correctly
      if (this.room.players[this.currentPsychic]) {
        this.room.players[this.currentPsychic].score += 300;
      }
    }

    const psychicInfo = this.room.players[this.currentPsychic];
    this.io.to(this.code).emit('psychic_round_end', {
      word: this.currentWord,
      winnerId,
      winnerName: winnerId ? this.room.players[winnerId]?.nickname : null,
      psychicName: psychicInfo?.nickname,
      questions: this.questions,
      players: this.room.players
    });

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('psychic_round_end_player', {
        word: this.currentWord,
        winnerId, won: id === winnerId,
        wasPsychic: id === this.currentPsychic,
        players: this.room.players
      });
    });

    setTimeout(() => this.nextRound(), 7000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Psychic' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.questionTimer); clearTimeout(this.answerTimer);
    this.questionIndex++;
    this.startQuestionRound();
  }
}
module.exports = Psychic;
