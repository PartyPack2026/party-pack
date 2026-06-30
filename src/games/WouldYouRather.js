// WOULD YOU RATHER — players vote between two ridiculous options. After the vote, the room
// sees the split. Points for siding with the MAJORITY (you read the room) plus a brave bonus
// if you're in a tiny minority that turns out... still you. Pure debate fuel.

const DILEMMAS = [
  ["Have fingers as long as your legs", "Have legs as short as your fingers"],
  ["Always be 10 minutes late", "Always be 20 minutes early"],
  ["Fight 100 duck-sized horses", "Fight one horse-sized duck"],
  ["Be able to fly but only 2 feet off the ground", "Be invisible but only when no one's looking"],
  ["Never use a touchscreen again", "Never use a keyboard again"],
  ["Have unlimited money but no friends", "Have amazing friends but always be broke"],
  ["Know how you die", "Know when you die"],
  ["Be the funniest person alive but unattractive", "Be gorgeous but have zero sense of humour"],
  ["Sweat maple syrup", "Cry glitter"],
  ["Always have to sing instead of speak", "Always have to dance everywhere you walk"],
  ["Have a permanent unicorn horn", "Have a permanent clown nose"],
  ["Be able to teleport but only to places you've been", "Read minds but can't turn it off"],
  ["Eat only pizza forever", "Never eat pizza again"],
  ["Have hiccups for the rest of your life", "Feel like you need to sneeze but never do"],
  ["Be famous for something embarrassing", "Be talented but completely unknown"],
  ["Always know when someone's lying", "Always get away with lying yourself"],
  ["Have to say everything on your mind", "Never speak again"],
  ["Live without music", "Live without movies and TV"],
  ["Be stuck in a perpetual summer", "Be stuck in a perpetual winter"],
  ["Have a rewind button for your life", "Have a pause button for your life"],
  ["Fight a bear with your fists", "Give a presentation to 10,000 people naked"],
  ["Have everything you eat be too salty", "Have everything you eat be too sweet"],
  ["Speak every language but never read", "Read every language but never speak"],
  ["Be a genius in a world of idiots", "Be average in a world of geniuses"],
  ["Have your search history made public", "Have your texts read aloud at family dinner"],
];

class WouldYouRather {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.phase = 'voting';
    this.votes = {};
    this.used = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const avail = DILEMMAS.filter((_, i) => !this.used.includes(i));
    const pickIdx = DILEMMAS.indexOf(avail[Math.floor(Math.random() * avail.length)]);
    this.used.push(pickIdx);
    this.dilemma = DILEMMAS[pickIdx] || DILEMMAS[0];
    this.votes = {};
    this.phase = 'voting';

    this.io.to(this.code).emit('wyr_round', {
      round: this.currentRound, totalRounds: this.rounds,
      optionA: this.dilemma[0], optionB: this.dilemma[1]
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('wyr_vote', { optionA: this.dilemma[0], optionB: this.dilemma[1] });
    });
    this.voteTimer = setTimeout(() => this.showResults(), 20000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId] !== undefined) return;
      if (data.choice !== 0 && data.choice !== 1) return;
      this.votes[playerId] = data.choice;
      this.io.to(playerId).emit('wyr_voted', {});
      const count = Object.keys(this.votes).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('wyr_count', { count, total });
      if (count >= total) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    let countA = 0, countB = 0;
    Object.values(this.votes).forEach(c => { if (c === 0) countA++; else countB++; });
    const total = countA + countB;
    const majority = countA >= countB ? 0 : 1;
    const tie = countA === countB;

    // Score: siding with majority = 200. Being in a non-empty minority still gets 100 (you committed).
    Object.entries(this.votes).forEach(([id, choice]) => {
      if (!this.room.players[id]) return;
      if (tie) this.room.players[id].score += 150;
      else if (choice === majority) this.room.players[id].score += 200;
      else this.room.players[id].score += 100;
    });

    this.io.to(this.code).emit('wyr_results', {
      optionA: this.dilemma[0], optionB: this.dilemma[1],
      countA, countB, total, tie, majority,
      pctA: total ? Math.round(countA / total * 100) : 50,
      pctB: total ? Math.round(countB / total * 100) : 50,
      players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const choice = this.votes[id];
      this.io.to(id).emit('wyr_result_player', {
        votedWithMajority: !tie && choice === majority,
        tie, didVote: choice !== undefined
      });
    });

    setTimeout(() => this.nextRound(), 5500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Would You Rather' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = WouldYouRather;
