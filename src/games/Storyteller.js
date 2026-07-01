// STORYTELLER — a Mad Libs-style story with blanks. Each player is secretly assigned a couple
// of blanks to fill (a noun, a verb, a silly place...) WITHOUT seeing the story. Then the
// finished, absurd story is revealed and read aloud. Everyone votes for the funniest word,
// and the player who wrote it wins the round.

const STORIES = [
  { text: "Yesterday I went to the {place} and saw a {adjective} {animal}. It was {verb-ing} so loudly that everyone started to {verb}. The manager gave me a free {noun} to say sorry.",
    slots: [["place","a place"],["adjective","an adjective"],["animal","an animal"],["verb-ing","a verb ending in -ing"],["verb","a verb"],["noun","a noun"]] },
  { text: "My dream job is to be a professional {job}. Every morning I would {verb} with my trusty {noun} and shout '{exclamation}!' at the {adjective} sky. Fame at last.",
    slots: [["job","a silly job"],["verb","a verb"],["noun","a noun"],["exclamation","an exclamation"],["adjective","an adjective"]] },
  { text: "The recipe was simple: take three {plural-noun}, cover them in {liquid}, and {verb} for ten minutes. Serve to your {person} while wearing a {adjective} hat.",
    slots: [["plural-noun","a plural noun"],["liquid","a liquid"],["verb","a verb"],["person","a type of person"],["adjective","an adjective"]] },
  { text: "Breaking news: a {adjective} {animal} was spotted {verb-ing} through downtown. Witnesses say it was carrying a {noun} and looking for {plural-noun}. Authorities advise everyone to stay {adjective2}.",
    slots: [["adjective","an adjective"],["animal","an animal"],["verb-ing","a verb ending in -ing"],["noun","a noun"],["plural-noun","a plural noun"],["adjective2","another adjective"]] },
  { text: "Welcome to the future! Robots now {verb} our {plural-noun} and every house has its own {adjective} {noun}. The only rule is: never feed the {animal} after midnight.",
    slots: [["verb","a verb"],["plural-noun","a plural noun"],["adjective","an adjective"],["noun","a noun"],["animal","an animal"]] },
  { text: "On my holiday I packed a {noun}, twelve {plural-noun}, and one very {adjective} {animal}. We flew to {place} and spent the whole trip trying to {verb}. Ten out of ten.",
    slots: [["noun","a noun"],["plural-noun","a plural noun"],["adjective","an adjective"],["animal","an animal"],["place","a place"],["verb","a verb"]] },
  { text: "The wizard raised his {noun} and cast a spell that turned the {person} into a {adjective} {animal}. 'That will teach you to {verb} my {plural-noun}!' he cackled.",
    slots: [["noun","a magical object"],["person","a type of person"],["adjective","an adjective"],["animal","an animal"],["verb","a verb"],["plural-noun","a plural noun"]] },
  { text: "Step one of assembling your new {noun}: locate the {adjective} panel. Step two: {verb} it firmly. Step three: if it starts to {verb2}, immediately call a {job}.",
    slots: [["noun","a product"],["adjective","an adjective"],["verb","a verb"],["verb2","a verb"],["job","a job"]] },
];

class Storyteller {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 3; this.currentRound = 0;
    this.phase = 'filling';
    this.filled = {}; // slotKey -> {value, author}
    this.assignments = {}; // playerId -> [slotIndexes]
    this.votes = {};
    this.usedStories = [];
  }

  start() { this.nextRound(); }

  nextRound() {
    // If everyone has left, stop cycling — don't try to assign slots to nobody.
    if (!this.room || Object.keys(this.room.players).length === 0) { this.ended = true; return; }
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const pool = STORIES.map((s, i) => i).filter(i => !this.usedStories.includes(i));
    const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * STORIES.length);
    this.usedStories.push(idx);
    this.story = STORIES[idx];
    this.filled = {};
    this.votes = {};
    this.phase = 'filling';

    // Assign slots round-robin to players
    const ids = Object.keys(this.room.players).sort(() => Math.random() - 0.5);
    this.assignments = {};
    ids.forEach(id => this.assignments[id] = []);
    this.story.slots.forEach((slot, i) => {
      const pid = ids[i % ids.length];
      this.assignments[pid].push(i);
    });
    this.expectedFills = this.story.slots.length;

    this.io.to(this.code).emit('story_filling', {
      round: this.currentRound, totalRounds: this.rounds, slotCount: this.story.slots.length
    });
    ids.forEach(id => {
      const mySlots = this.assignments[id].map(i => ({ index: i, key: this.story.slots[i][0], hint: this.story.slots[i][1] }));
      this.io.to(id).emit('story_prompts', { prompts: mySlots });
    });
    this.fillTimer = setTimeout(() => this.reveal(), 50000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'filling' && data.type === 'fills') {
      // data.fills = { slotIndex: value }
      const mine = this.assignments[playerId] || [];
      let any = false;
      Object.entries(data.fills || {}).forEach(([idxStr, value]) => {
        const idx = parseInt(idxStr, 10);
        if (!mine.includes(idx)) return;
        const val = String(value || '').slice(0, 40).trim();
        if (!val) return;
        this.filled[idx] = { value: val, author: playerId };
        any = true;
      });
      if (any) this.io.to(playerId).emit('story_fills_locked', {});
      const filledCount = Object.keys(this.filled).length;
      this.io.to(this.code).emit('story_fill_count', { count: filledCount, total: this.expectedFills });
      if (filledCount >= this.expectedFills) { clearTimeout(this.fillTimer); setTimeout(() => this.reveal(), 800); }
    } else if (this.phase === 'voting' && data.type === 'vote') {
      if (this.votes[playerId]) return;
      const idx = parseInt(data.slotIndex, 10);
      if (!this.filled[idx]) return;
      if (this.filled[idx].author === playerId) return; // can't vote your own word
      this.votes[playerId] = idx;
      this.io.to(playerId).emit('story_voted', {});
      const count = Object.keys(this.votes).length;
      this.io.to(this.code).emit('story_vote_count', { count });
      if (count >= Object.keys(this.room.players).length) { clearTimeout(this.voteTimer); setTimeout(() => this.showResults(), 700); }
    }
  }

  buildStory() {
    // Replace {key} tokens in order of appearance with filled values
    let result = this.story.text;
    this.story.slots.forEach((slot, i) => {
      const token = '{' + slot[0] + '}';
      const val = this.filled[i] ? this.filled[i].value : '____';
      result = result.replace(token, '⟦' + val + '⟧');
    });
    return result;
  }

  reveal() {
    if (this.phase === 'voting' || this.phase === 'results') return;
    this.phase = 'voting';
    // fill any missing slots so the story is complete
    this.story.slots.forEach((slot, i) => { if (!this.filled[i]) this.filled[i] = { value: '(blank)', author: null }; });

    this.builtStory = this.buildStory();
    this.io.to(this.code).emit('story_reveal', { story: this.builtStory });

    // Let players vote for the funniest word (list the filled words)
    const wordOptions = this.story.slots.map((slot, i) => ({ index: i, word: this.filled[i].value, author: this.filled[i].author }));
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('story_vote', {
        options: wordOptions.filter(w => w.author !== id).map(w => ({ index: w.index, word: w.word }))
      });
    });
    this.voteTimer = setTimeout(() => this.showResults(), 25000);
  }

  showResults() {
    if (this.phase === 'results') return;
    this.phase = 'results';

    const tally = {};
    Object.values(this.votes).forEach(idx => { tally[idx] = (tally[idx] || 0) + 1; });
    // award points to authors
    Object.entries(tally).forEach(([idx, v]) => {
      const author = this.filled[idx]?.author;
      if (author && this.room.players[author]) this.room.players[author].score += v * 150;
    });
    const maxVotes = Math.max(0, ...Object.values(tally));
    let winnerIdx = null;
    Object.entries(tally).forEach(([idx, v]) => { if (v === maxVotes && maxVotes > 0) winnerIdx = parseInt(idx, 10); });
    if (winnerIdx !== null) {
      const author = this.filled[winnerIdx]?.author;
      if (author && this.room.players[author]) this.room.players[author].score += 200;
    }

    const winnerWord = winnerIdx !== null ? this.filled[winnerIdx].value : null;
    const winnerName = winnerIdx !== null && this.filled[winnerIdx].author ? this.room.players[this.filled[winnerIdx].author]?.nickname : null;

    this.io.to(this.code).emit('story_results', {
      story: this.builtStory, winnerWord, winnerName, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      const won = winnerIdx !== null && this.filled[winnerIdx].author === id;
      this.io.to(id).emit('story_result_player', { won, winnerWord });
    });
    setTimeout(() => this.nextRound(), 7000);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Storyteller' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'filling') { clearTimeout(this.fillTimer); this.reveal(); }
    else if (this.phase === 'voting') { clearTimeout(this.voteTimer); this.showResults(); }
  }
}

module.exports = Storyteller;
