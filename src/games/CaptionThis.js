// CAPTION THIS — players get an absurd scenario/photo description and write the funniest
// caption. Everyone votes. It's like meme captioning without needing real images.

const SCENARIOS = [
  "A cat sitting at a desk wearing a tiny business suit",
  "A dog mid-air catching a frisbee with a look of pure determination",
  "A toddler covered head to toe in spaghetti, grinning",
  "A penguin standing alone at the edge of a diving board",
  "A man in a dinosaur costume buying groceries",
  "A goat standing triumphantly on the roof of a car",
  "A grandma winning at an arcade game, fists in the air",
  "Two pigeons facing each other like they're about to duel",
  "A llama photobombing a wedding photo",
  "A squirrel holding an entire slice of pizza bigger than itself",
  "A very serious-looking frog wearing a tiny crown",
  "A person who clearly just walked into a glass door",
  "A cow looking directly into the camera at sunset, dramatically",
  "A baby with the facial expression of a disappointed CEO",
  "A raccoon caught red-handed inside a trash can",
  "A dog wearing sunglasses leaning out of a car window",
  "A cat staring at an empty food bowl with betrayal in its eyes",
  "A duck leading a line of ducklings across a busy road, stopping traffic",
  "A man flexing next to a tiny dog also trying to flex",
  "A pug burrito-wrapped in a blanket, only its face showing",
  "An owl turning its head 180 degrees to judge you",
  "A horse that appears to be smiling for its school photo",
  "A child holding a fish almost as big as them, terrified",
  "A pigeon strutting like it owns the entire city",
  "A golden retriever surrounded by stuffed animals, looking guilty",
];

class CaptionThis {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.phase = 'writing';
    this.captions = {};
    this.votes = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const available = SCENARIOS.filter(s => !this.used.includes(s));
    this.scenario = available[Math.floor(Math.random() * available.length)] || SCENARIOS[0];
    this.used.push(this.scenario);
    this.captions = {};
    this.phase = 'writing';

    this.io.to(this.code).emit('cap_round', {
      round: this.currentRound, totalRounds: this.rounds, scenario: this.scenario
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('cap_write', { scenario: this.scenario, timeLimit: 45 });
    });
    this.writeTimer = setTimeout(() => this.startVoting(), 48000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'writing' && data.type === 'caption') {
      const text = String(data.caption || '').slice(0, 100).trim();
      if (!text) return;
      this.captions[playerId] = text;
      const count = Object.keys(this.captions).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('cap_count', { count, total });
      this.io.to(playerId).emit('cap_submitted', {});
      if (count >= total) { clearTimeout(this.writeTimer); setTimeout(() => this.startVoting(), 700); }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      if (playerId === data.target) return;
      if (!this.captions[data.target]) return;
      this.votes[playerId] = data.target;
      this.io.to(playerId).emit('cap_voted', {});
      const count = Object.keys(this.votes).length;
      this.io.to(this.code).emit('cap_vote_count', { count });
      if (count >= Object.keys(this.room.players).length) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  startVoting() {
    if (this.phase === 'voting') return;
    this.phase = 'voting';
    this.votes = {};
    const entries = Object.entries(this.captions).map(([id, text]) => ({ id, text }));
    if (entries.length === 0) { this.showResults(); return; }
    const shuffled = entries.sort(() => Math.random() - 0.5);

    this.io.to(this.code).emit('cap_vote_display', {
      scenario: this.scenario,
      captions: shuffled.map(e => ({ id: e.id, text: e.text }))
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('cap_vote', {
        scenario: this.scenario,
        options: shuffled.filter(e => e.id !== id).map(e => ({ id: e.id, text: e.text }))
      });
    });
    this.voteTimer = setTimeout(() => this.showResults(), 25000);
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';
    const tally = {};
    Object.values(this.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
    const maxVotes = Math.max(0, ...Object.values(tally));
    Object.entries(tally).forEach(([id, v]) => { if (this.room.players[id]) this.room.players[id].score += v * 100; });
    Object.keys(tally).forEach(id => { if (tally[id] === maxVotes && maxVotes > 0 && this.room.players[id]) this.room.players[id].score += 250; });

    const results = Object.entries(this.captions).map(([id, text]) => ({
      id, text, nickname: this.room.players[id]?.nickname || '?',
      votes: tally[id] || 0, isWinner: (tally[id] || 0) === maxVotes && maxVotes > 0
    })).sort((a, b) => b.votes - a.votes);

    this.io.to(this.code).emit('cap_results', { scenario: this.scenario, results, players: this.room.players });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('cap_result_player', { won: (tally[id] || 0) === maxVotes && maxVotes > 0, votes: tally[id] || 0 });
    });
    setTimeout(() => this.nextRound(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Caption This' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'writing') { clearTimeout(this.writeTimer); this.startVoting(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = CaptionThis;
