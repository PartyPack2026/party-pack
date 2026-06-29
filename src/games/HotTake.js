const PROMPTS = [
  "Pineapple on pizza is actually good","Cats are better pets than dogs","The cinema is overrated",
  "Breakfast is the best meal of the day","Holidays are more stressful than they're worth","Sharing your location with a partner is fine",
  "Pubs are better than clubs","Cereal is a soup","A hotdog is a sandwich","Reply-all emails should be banned",
  "Mondays aren't that bad","Cold showers are genuinely enjoyable","Astrology says something real about your personality",
  "Social media has made people less connected","Silence on a first date is a red flag","Texting is better than calling",
  "Office jobs should be 4 days a week","The book is always better than the film","Paying for priority boarding is worth it",
  "Crying at films is a good thing","You can judge someone by their music taste","Wearing the same outfit twice a week is fine",
  "Group chats do more harm than good","Icebreakers at work are actually fun","People who don't drink are more fun",
  "Tipping culture has gotten out of hand","Everyone should travel solo once","Phone-down at dinner is rude not polite",
  "Sandwiches taste better cut diagonally","Morning people are smug","Voice notes should be illegal",
  "New Year's Eve is always a let-down","Working from home makes you lazy","Putting milk before cereal is acceptable",
  "Audiobooks count as reading","Christmas music in November is fine","Small talk is a vital social skill",
  "Birthdays stop being fun after 25","Hawaiian shirts are elite","Reality TV is the peak of art",
  "Salads are not a real meal","Adults should still have bedtimes","Open-plan offices are a crime",
  "Most movies are 30 minutes too long","Karaoke is better sober","Brunch is overrated and overpriced",
  "Everyone secretly likes their own smell","Socks with sandals should be allowed","Tea is better than coffee"
];

class HotTake {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.usedPrompts = []; this.votes = {};
    this.phase = 'voting';
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinalResults(); return; }

    const available = PROMPTS.filter(p => !this.usedPrompts.includes(p));
    this.currentPrompt = available[Math.floor(Math.random() * available.length)];
    this.usedPrompts.push(this.currentPrompt);
    this.votes = {};
    this.phase = 'voting';

    this.io.to(this.code).emit('hottake_round', {
      round: this.currentRound, totalRounds: this.rounds,
      statement: this.currentPrompt
    });

    Object.values(this.room.players).forEach(p => {
      this.io.to(p.id).emit('hottake_vote', {
        statement: this.currentPrompt, timeLimit: 20
      });
    });

    this.timer = setTimeout(() => this.revealResults(), 23000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'voting' && data.type === 'vote') {
      if (!this.votes[playerId]) {
        this.votes[playerId] = data.vote;
        const count = Object.keys(this.votes).length;
        const total = Object.keys(this.room.players).length;
        const hotSoFar = Object.values(this.votes).filter(v=>v==='hot').length;
        const normSoFar = count - hotSoFar;
        this.io.to(this.code).emit('hottake_live', { count, total, hotSoFar, normSoFar });
        if (count >= total) { clearTimeout(this.timer); setTimeout(() => this.revealResults(), 800); }
      }
    }
  }

  revealResults() {
    this.phase = 'results';
    const total = Object.keys(this.room.players).length;
    const hotCount = Object.values(this.votes).filter(v => v === 'hot').length;
    const normalCount = total - hotCount;
    const majority = hotCount > normalCount ? 'hot' : hotCount < normalCount ? 'normal' : 'tie';

    // Scoring: be the LONE dissenter = lose 100. Be in minority = gain 150. Be in majority = gain 50.
    // Twist: if it's a perfect split, everyone gets 200 (chaos!)
    Object.entries(this.votes).forEach(([pid, vote]) => {
      const player = this.room.players[pid];
      if (!player) return;
      if (majority === 'tie') {
        player.score += 200; // pure chaos points
      } else if (vote === majority) {
        player.score += 50; // safe majority
      } else {
        const minorityCount = vote === 'hot' ? hotCount : normalCount;
        if (minorityCount === 1) {
          player.score -= 100; // lone dissenter penalty
        } else {
          player.score += 150; // bold minority
        }
      }
    });

    this.io.to(this.code).emit('hottake_reveal', {
      statement: this.currentPrompt,
      hotCount, normalCount, majority, total,
      votes: this.votes, players: this.room.players
    });

    Object.entries(this.votes).forEach(([pid, vote]) => {
      const minorityCount = vote === 'hot' ? hotCount : normalCount;
      const isLone = minorityCount === 1;
      const inMajority = vote === majority;
      this.io.to(pid).emit('hottake_result_player', {
        myVote: vote, majority, hotCount, normalCount,
        isLone, inMajority, isTie: majority === 'tie',
        pts: majority === 'tie' ? 200 : inMajority ? 50 : isLone ? -100 : 150
      });
    });

    setTimeout(() => this.nextRound(), 6000);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Hot Take' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    clearTimeout(this.timer);
    if (this.phase === 'voting') this.revealResults();
  }
}
module.exports = HotTake;
