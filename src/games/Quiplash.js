const PROMPTS = [
  "The worst text to wake up to: ___",
  "My Uber rating dropped because I ___",
  "A superpower that only works at the worst possible moment: ___",
  "The real reason the WiFi is slow: ___",
  "What I actually think about during meetings: ___",
  "My villain origin story: someone ___ my ___",
  "New Olympic sport that would finally get me a gold medal: ___",
  "The most chaotic thing you could put on a work email signature: ___",
  "Scientists confirm that ___ causes you to immediately feel 40 years old",
  "A bad name for a couples massage business: ___",
  "The rejected instruction on a shampoo bottle: ___",
  "What the aliens decided after one day watching Earth: ___",
  "My 2am brain's best idea: ___",
  "The worst thing to accidentally send to your boss: ___",
  "A children's book that would get banned in week one: ___",
  "God's notes before releasing humans: 'needs more ___'",
  "My dating profile says I'm fluent in ___ and silence",
  "The update nobody asked for: ___ 2.0, now with more ___",
  "What my dog actually does all day: ___",
  "The worst thing to say during a job interview: ___",
  "I Googled ___ at 3am and now I can't sleep",
  "A terrible name for a restaurant that somehow still has 5 stars: ___",
  "What the group chat said when I left: ___",
  "The thing I'm putting on my headstone: ___",
  "My sleep paralysis demon looks exactly like ___",
  "A rejected band name that somehow still became famous: ___",
  "The most polite way to tell someone their vibe is ___",
  "My therapist's face when I told them about ___",
  "What nobody warned me about adulthood: ___",
  "New app idea: it's like Tinder but for ___",
  "The least threatening thing a villain could say: ___",
  "What's definitely in my neighbour's basement: ___",
  "The worst prize to win on a game show: ___",
  "A warning label they should put on me: ___",
  "The real reason cats stare at walls: ___",
  "What I'd do with five minutes of being invisible: ___",
  "The worst superpower to have at a funeral: ___",
  "My autobiography will be called '___'",
  "The most cursed thing to find in a hotel room: ___",
  "What the WiFi password at hell would be: ___",
  "A terrible motivational poster: ___",
  "The worst thing to hear from your surgeon: ___",
  "My toxic trait is ___",
  "What I'd ban if I ruled the world for one day: ___",
  "The most unhinged thing in my search history: ___",
  "A bad slogan for a funeral home: ___",
  "What aliens would steal first from Earth: ___",
  "The worst thing to whisper in a library: ___",
  "My final words will probably be '___'",
  "The most embarrassing reason to call an ambulance: ___",
  "What's written in my permanent record: ___",
  "A terrible theme for a wedding: ___",
  "The worst flavour of ice cream imaginable: ___",
  "What my ex would put on my wanted poster: ___",
  "The real reason the dinosaurs went extinct: ___",
  "A horrible name for a perfume: ___",
  "What I pretend to understand but absolutely don't: ___",
  "The worst thing to bring to a potluck: ___",
  "My spirit animal is a ___ having a bad day",
  "The most dramatic way to quit a job: ___",
  "What keeps me up at night (besides ___): ___",
  "A cursed combination of two foods: ___",
  "The worst advice my family ever gave me: ___",
  "What I'd put on a billboard for the whole town to see: ___",
  "The most useless thing to bring to a deserted island: ___",
  "A rejected emoji that should exist: ___",
  "What the inside of my brain sounds like: ___",
  "The worst possible name for a boat: ___",
  "My most controversial food opinion: ___",
  "What I would do for a Klondike bar (be honest): ___",
  "The reason I'm not allowed back at ___",
  "A terrible icebreaker question: ___",
  "What my pet thinks my job is: ___",
  "The worst thing to find in your takeaway: ___",
  "A conspiracy theory I just made up: ___",
  "What I'd name my evil twin: ___",
  "The most disappointing way to find out you're famous: ___",
  "A truly cursed pizza topping: ___",
  "What I scream into the void about: ___",
  "The worst thing to say on a first date: ___",
];

class Quiplash {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.assignments = {}; this.votingPairs = [];
    this.currentVoteIndex = 0; this.votes = {};
    this.phase = 'answering'; this.usedPrompts = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinalResults(); return; }
    const players = Object.values(this.room.players);
    const available = PROMPTS.filter(p => !this.usedPrompts.includes(p));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    this.assignments = {}; this.votes = {};

    players.forEach((p, i) => {
      const prompt = shuffled[i % shuffled.length];
      this.usedPrompts.push(prompt);
      this.assignments[p.id] = { prompt, answer: null };
    });

    this.phase = 'answering';
    this.io.to(this.code).emit('quiplash_round', {
      round: this.currentRound, totalRounds: this.rounds
    });

    players.forEach(p => {
      this.io.to(p.id).emit('your_prompt', { prompt: this.assignments[p.id].prompt, timeLimit: 45 });
    });

    this.answerTimer = setTimeout(() => this.startVoting(), 35000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'answering' && data.type === 'answer') {
      if (this.assignments[playerId] && !this.assignments[playerId].answer) {
        this.assignments[playerId].answer = data.answer.trim() || '(blank)';
        const count = Object.values(this.assignments).filter(a => a.answer).length;
        const total = Object.keys(this.room.players).length;
        this.io.to(this.code).emit('player_answered', { playerId, count, total });
        if (count >= total) { clearTimeout(this.answerTimer); setTimeout(() => this.startVoting(), 1500); }
      }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      const pair = this.votingPairs[this.currentVoteIndex];
      if (!pair || this.votes[playerId]) return;
      // Competitors don't vote on their own matchup at all
      if (playerId === pair.p1 || playerId === pair.p2) return;
      if (data.vote !== pair.p1 && data.vote !== pair.p2) return;
      this.votes[playerId] = data.vote;
      const expected = this.expectedVoters || 1;
      this.io.to(this.code).emit('vote_received', { count: Object.keys(this.votes).length, total: expected });
      if (Object.keys(this.votes).length >= expected) { clearTimeout(this.voteTimer); setTimeout(() => this.showVoteResults(), 800); }
    }
  }

  startVoting() {
    Object.values(this.assignments).forEach(a => { if (!a.answer) a.answer = '(nothing)'; });
    const players = Object.values(this.room.players);
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    this.votingPairs = [];
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      this.votingPairs.push({ p1: shuffled[i].id, p2: shuffled[i+1].id });
    }
    this.currentVoteIndex = 0;
    this.showNextVote();
  }

  showNextVote() {
    if (this.currentVoteIndex >= this.votingPairs.length) { this.nextRound(); return; }
    this.phase = 'voting';
    this.votes = {};
    const pair = this.votingPairs[this.currentVoteIndex];
    const p1 = this.room.players[pair.p1], p2 = this.room.players[pair.p2];
    if (!p1 || !p2) { this.currentVoteIndex++; this.showNextVote(); return; }
    const a1 = this.assignments[pair.p1], a2 = this.assignments[pair.p2];
    const allPlayers = Object.keys(this.room.players);
    // Only NON-competitors vote — this keeps it a genuine blind choice
    const voters = allPlayers.filter(id => id !== pair.p1 && id !== pair.p2);
    this.expectedVoters = voters.length;

    // Safety: if nobody can vote (tiny lobby), skip to next matchup
    if (this.expectedVoters === 0) {
      this.currentVoteIndex++;
      this.showNextVote();
      return;
    }

    this.io.to(this.code).emit('quiplash_vote', {
      prompt: a1.prompt,
      matchup: `${p1.nickname} vs ${p2.nickname}`,
      options: [
        { playerId: pair.p1, nickname: p1.nickname, avatar: p1.avatar, answer: a1.answer },
        { playerId: pair.p2, nickname: p2.nickname, avatar: p2.avatar, answer: a2.answer },
      ]
    });

    allPlayers.forEach(id => {
      const isCompetitor = id === pair.p1 || id === pair.p2;
      if (isCompetitor) {
        // Competitors watch — they can't vote on their own battle
        this.io.to(id).emit('wait_for_votes', {
          message: "Your answer is in the battle! Others are voting now..."
        });
      } else {
        this.io.to(id).emit('vote_now', {
          prompt: a1.prompt, timeLimit: 25,
          isCompetitor: false,
          options: [
            { playerId: pair.p1, answer: a1.answer },
            { playerId: pair.p2, answer: a2.answer },
          ]
        });
      }
    });

    this.voteTimer = setTimeout(() => this.showVoteResults(), 20000);
  }

  showVoteResults() {
    const pair = this.votingPairs[this.currentVoteIndex];
    const tally = { [pair.p1]: 0, [pair.p2]: 0 };
    Object.values(this.votes).forEach(v => { if (tally[v] !== undefined) tally[v]++; });
    Object.entries(tally).forEach(([pid, count]) => {
      if (this.room.players[pid]) this.room.players[pid].score += count * 150;
    });
    this.io.to(this.code).emit('vote_results', { tally, players: this.room.players });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('vote_results_player', { tally, players: this.room.players, myId: id });
    });
    this.currentVoteIndex++;
    setTimeout(() => this.showNextVote(), 5000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Quiplash' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.answerTimer); clearTimeout(this.voteTimer);
    if (this.phase === 'answering') this.startVoting();
    else if (this.phase === 'voting') this.showVoteResults();
  }
}
module.exports = Quiplash;
