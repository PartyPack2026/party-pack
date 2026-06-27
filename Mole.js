// Each player gets a secret mission to get other players to say a target word
// naturally in conversation. One player is the Mole — their mission is to catch others.

const MISSIONS = [
  { word: "banana", hints: ["yellow fruit", "goes in smoothies", "monkeys love it"] },
  { word: "hospital", hints: ["place with doctors", "where you go if hurt", "has A&E"] },
  { word: "umbrella", hints: ["keeps you dry", "Mary Poppins item", "brolly"] },
  { word: "silence", hints: ["no sound", "library vibe", "what you want on Monday"] },
  { word: "spider", hints: ["8 legs", "web maker", "kills flies"] },
  { word: "ocean", hints: ["big water", "has sharks", "salty"] },
  { word: "candle", hints: ["makes light", "romantic dinner", "blows out on birthday"] },
  { word: "ladder", hints: ["for climbing", "bad luck to walk under", "snakes and ___"] },
  { word: "mirror", hints: ["reflective", "show white used one", "7 years bad luck if broken"] },
  { word: "thunder", hints: ["storm sound", "before lightning", "loud from the sky"] },
  { word: "pillow", hints: ["sleep on it", "soft thing on bed", "used in fights at sleepovers"] },
  { word: "penguin", hints: ["black and white bird", "cant fly", "lives in cold places"] },
  { word: "chimney", hints: ["on a roof", "Santa uses it", "smoke comes out"] },
  { word: "balloon", hints: ["floats with helium", "party decoration", "pops easily"] },
  { word: "carpet", hints: ["floor covering", "vacuumed", "can get stained"] },
];

function assignMissions(playerIds) {
  const shuffledMissions = [...MISSIONS].sort(() => Math.random() - 0.5);
  const assignments = {};
  const moleId = playerIds[Math.floor(Math.random() * playerIds.length)];

  playerIds.forEach((id, i) => {
    if (id === moleId) {
      assignments[id] = { isMole: true, word: null };
    } else {
      assignments[id] = { isMole: false, ...shuffledMissions[i % shuffledMissions.length] };
    }
  });
  return { assignments, moleId };
}

class Mole {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'discussion';
    this.assignments = {}; this.moleId = null;
    this.completedMissions = {}; // pid -> bool
    this.moleVotes = {}; // pid -> suspected mole id
    this.catchAttempts = {}; // pid -> target word they think someone is using
    this.discussionTime = 90; // seconds for discussion
  }

  start() {
    const playerIds = Object.keys(this.room.players);
    const { assignments, moleId } = assignMissions(playerIds);
    this.assignments = assignments;
    this.moleId = moleId;
    this.completedMissions = {};
    this.moleVotes = {};

    // Tell each player their role
    playerIds.forEach(id => {
      const a = assignments[id];
      if (a.isMole) {
        this.io.to(id).emit('mole_role', {
          isMole: true,
          instruction: "You are THE MOLE. Stop others from completing their missions. Watch for suspicious phrases and CATCH them!",
          timeLimit: this.discussionTime
        });
      } else {
        this.io.to(id).emit('mole_role', {
          isMole: false,
          word: a.word,
          hints: a.hints,
          instruction: `Get someone to say the word "${a.word.toUpperCase()}" naturally in conversation. Don't be obvious!`,
          timeLimit: this.discussionTime
        });
      }
    });

    // Show TV: game has started, discussion phase
    this.io.to(this.code).emit('mole_start', {
      discussionTime: this.discussionTime,
      playerCount: playerIds.length
    });

    // Discussion timer
    this.phase = 'discussion';
    this.timer = setTimeout(() => this.startVoting(), this.discussionTime * 1000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'discussion' && data.type === 'mission_complete') {
      // A player says they completed their mission
      if (!this.completedMissions[playerId]) {
        this.completedMissions[playerId] = { targetWord: data.word, victim: data.victim };
        const victimPlayer = this.room.players[data.victim];
        if (victimPlayer) {
          this.io.to(this.code).emit('mole_mission_claimed', {
            nickname: this.room.players[playerId]?.nickname,
            victim: victimPlayer.nickname
          });
        }
      }
    }

    if (this.phase === 'discussion' && data.type === 'catch_attempt') {
      // Mole tries to catch a player
      if (playerId === this.moleId && !this.catchAttempts[data.target]) {
        const targetAssignment = this.assignments[data.target];
        const caught = targetAssignment && !targetAssignment.isMole && data.word.toLowerCase() === targetAssignment.word.toLowerCase();
        this.catchAttempts[data.target] = { word: data.word, caught };
        this.io.to(playerId).emit('mole_catch_result', {
          caught,
          targetName: this.room.players[data.target]?.nickname,
          correctWord: targetAssignment?.word
        });
        if (caught) {
          this.io.to(data.target).emit('mole_caught', { moleNickname: this.room.players[this.moleId]?.nickname });
          this.io.to(this.code).emit('mole_catch_announced', {
            moleName: this.room.players[this.moleId]?.nickname,
            caughtName: this.room.players[data.target]?.nickname,
            caught
          });
        }
      }
    }

    if (this.phase === 'voting' && data.type === 'mole_vote') {
      if (!this.moleVotes[playerId]) {
        this.moleVotes[playerId] = data.suspectId;
        const count = Object.keys(this.moleVotes).length;
        const total = Object.keys(this.room.players).length;
        this.io.to(this.code).emit('player_answered', { count, total });
        if (count >= total) { clearTimeout(this.voteTimer); setTimeout(() => this.revealMole(), 500); }
      }
    }
  }

  startVoting() {
    this.phase = 'voting';
    clearTimeout(this.timer);

    const players = Object.values(this.room.players).map(p => ({
      id: p.id, nickname: p.nickname, avatar: p.avatar
    }));

    this.io.to(this.code).emit('mole_voting_start', { players });

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('mole_vote_prompt', {
        players: players.filter(p => p.id !== id),
        timeLimit: 30
      });
    });

    this.voteTimer = setTimeout(() => this.revealMole(), 33000);
  }

  revealMole() {
    this.phase = 'reveal';
    const tally = {};
    Object.values(this.moleVotes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });

    // Score: complete your mission = 500. Correctly vote mole = 400.
    // Mole: each incomplete mission = 300. Caught = -300 each.
    let molePoints = 0;
    const totalPlayers = Object.keys(this.room.players).length;
    const completedCount = Object.keys(this.completedMissions).length;
    const incompleteCount = totalPlayers - 1 - completedCount; // -1 for mole
    molePoints += incompleteCount * 300;

    // Deduct for catches
    const caughtCount = Object.values(this.catchAttempts).filter(c => c.caught).length;
    molePoints -= caughtCount * 300;

    if (this.room.players[this.moleId]) {
      this.room.players[this.moleId].score += Math.max(0, molePoints);
    }

    // Non-moles: mission complete + voted correctly
    Object.keys(this.room.players).forEach(id => {
      if (id === this.moleId) return;
      const player = this.room.players[id];
      if (this.completedMissions[id]) player.score += 500;
      if (this.moleVotes[id] === this.moleId) player.score += 400;
    });

    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);

    this.io.to(this.code).emit('mole_reveal', {
      moleId: this.moleId,
      moleName: this.room.players[this.moleId]?.nickname,
      moleAvatar: this.room.players[this.moleId]?.avatar,
      assignments: Object.entries(this.assignments).map(([id, a]) => ({
        id, nickname: this.room.players[id]?.nickname,
        avatar: this.room.players[id]?.avatar,
        isMole: a.isMole, word: a.word,
        completed: !!this.completedMissions[id]
      })),
      completedMissions: this.completedMissions,
      tally, players: this.room.players
    });

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('mole_reveal_player', {
        moleId: this.moleId,
        moleName: this.room.players[this.moleId]?.nickname,
        myVote: this.moleVotes[id],
        votedCorrectly: this.moleVotes[id] === this.moleId,
        isMole: id === this.moleId,
        assignments: Object.entries(this.assignments).map(([pid, a]) => ({
          id: pid, nickname: this.room.players[pid]?.nickname, isMole: a.isMole, word: a.word,
          completed: !!this.completedMissions[pid]
        })),
        players: this.room.players
      });
    });

    setTimeout(() => {
      Object.keys(this.room.players).forEach(id => {
        this.io.to(id).emit('final_scores', { scores, gameName: 'The Mole' });
      });
      this.endGame(this.code, scores);
    }, 8000);
  }

  nextPhase() {
    clearTimeout(this.timer); clearTimeout(this.voteTimer);
    if (this.phase === 'discussion') this.startVoting();
    else if (this.phase === 'voting') this.revealMole();
  }
}
module.exports = Mole;
