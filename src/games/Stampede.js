// STAMPEDE - real-time multiplayer racing battle
// Players tap/swipe as fast as they can to race across the screen.
// Random events (boost, trap, swap) keep it chaotic. Live positions on host screen.

const EVENTS = [
  { type: 'boost', label: 'SPEED BOOST!', desc: 'Tap power doubled!' },
  { type: 'freeze', label: 'ICE PATCH!', desc: 'Slipping backwards!' },
  { type: 'shuffle', label: 'EARTHQUAKE!', desc: 'Positions shuffled!' },
  { type: 'sprint', label: 'FINAL SPRINT!', desc: 'Everyone speeds up!' },
];

const RACE_LENGTH = 100; // progress units to win
const ROUND_COUNT = 3;

class Stampede {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'waiting';
    this.progress = {}; // playerId -> 0..100
    this.boosts = {};   // playerId -> multiplier
    this.round = 0;
    this.roundWins = {}; // playerId -> count
    this.tickTimer = null;
    this.eventTimer = null;
  }

  start() {
    Object.keys(this.room.players).forEach(id => { this.roundWins[id] = 0; });
    this.nextRound();
  }

  nextRound() {
    this.round++;
    if (this.round > ROUND_COUNT) { this.showFinalResults(); return; }

    // Reset positions
    this.progress = {};
    this.boosts = {};
    Object.keys(this.room.players).forEach(id => {
      this.progress[id] = 0;
      this.boosts[id] = 1;
    });
    this.phase = 'countdown';
    this.finished = [];

    this.io.to(this.code).emit('stampede_round', {
      round: this.round, totalRounds: ROUND_COUNT,
      raceLength: RACE_LENGTH,
      players: Object.values(this.room.players).map(p => ({
        id: p.id, nickname: p.nickname, avatar: p.avatar
      }))
    });

    // Tell players to get ready
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('stampede_get_ready', { round: this.round });
    });

    // Countdown then GO
    setTimeout(() => {
      this.phase = 'racing';
      this.io.to(this.code).emit('stampede_go');
      Object.keys(this.room.players).forEach(id => {
        this.io.to(id).emit('stampede_go');
      });
      this.startRaceLoop();
    }, 3500);
  }

  startRaceLoop() {
    // Broadcast positions ~10x/sec
    this.tickTimer = setInterval(() => {
      // Apply slight decay so you must keep tapping
      Object.keys(this.progress).forEach(id => {
        if (this.boosts[id] < 1) {
          // freeze - slip back
          this.progress[id] = Math.max(0, this.progress[id] - 0.4);
        }
      });

      this.io.to(this.code).emit('stampede_positions', {
        progress: this.progress,
        raceLength: RACE_LENGTH
      });

      // Check winner
      const winner = Object.keys(this.progress).find(id => this.progress[id] >= RACE_LENGTH);
      if (winner && this.phase === 'racing') {
        this.endRace(winner);
      }
    }, 100);

    // Random chaos events every 4-6 seconds
    this.scheduleEvent();
  }

  scheduleEvent() {
    const delay = 4000 + Math.random() * 2000;
    this.eventTimer = setTimeout(() => {
      if (this.phase !== 'racing') return;
      const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      this.applyEvent(event);
      this.scheduleEvent();
    }, delay);
  }

  applyEvent(event) {
    if (event.type === 'boost') {
      // Random player gets a boost
      const ids = Object.keys(this.room.players);
      const lucky = ids[Math.floor(Math.random() * ids.length)];
      this.boosts[lucky] = 2;
      setTimeout(() => { if (this.boosts[lucky]) this.boosts[lucky] = 1; }, 3000);
      this.io.to(lucky).emit('stampede_event', { ...event, forMe: true });
      this.io.to(this.code).emit('stampede_event_tv', { ...event, playerName: this.room.players[lucky]?.nickname });
    } else if (event.type === 'freeze') {
      // Random player (not last) gets frozen
      const sorted = Object.keys(this.progress).sort((a,b) => this.progress[b] - this.progress[a]);
      const target = sorted[0]; // freeze the leader!
      this.boosts[target] = 0.3;
      setTimeout(() => { if (this.boosts[target] < 1) this.boosts[target] = 1; }, 2500);
      this.io.to(target).emit('stampede_event', { ...event, forMe: true });
      this.io.to(this.code).emit('stampede_event_tv', { ...event, playerName: this.room.players[target]?.nickname });
    } else if (event.type === 'shuffle') {
      // Swap all progress values randomly
      const vals = Object.values(this.progress).sort(() => Math.random() - 0.5);
      Object.keys(this.progress).forEach((id, i) => { this.progress[id] = vals[i]; });
      this.io.to(this.code).emit('stampede_event_tv', { ...event });
      Object.keys(this.room.players).forEach(id => this.io.to(id).emit('stampede_event', { ...event, forMe: false }));
    } else if (event.type === 'sprint') {
      Object.keys(this.boosts).forEach(id => { this.boosts[id] = 1.5; });
      setTimeout(() => { Object.keys(this.boosts).forEach(id => { if (this.boosts[id] === 1.5) this.boosts[id] = 1; }); }, 4000);
      this.io.to(this.code).emit('stampede_event_tv', { ...event });
      Object.keys(this.room.players).forEach(id => this.io.to(id).emit('stampede_event', { ...event, forMe: true }));
    }
  }

  handleInput(playerId, data) {
    if (this.phase === 'racing' && data.type === 'tap') {
      const boost = this.boosts[playerId] || 1;
      // Each tap = ~1.2 progress, scaled by boost
      this.progress[playerId] = Math.min(RACE_LENGTH, (this.progress[playerId] || 0) + 1.2 * boost);
    }
  }

  endRace(winnerId) {
    this.phase = 'finished';
    clearInterval(this.tickTimer);
    clearTimeout(this.eventTimer);

    this.roundWins[winnerId] = (this.roundWins[winnerId] || 0) + 1;
    // Award points: 1000 for win, plus position-based
    const sorted = Object.keys(this.progress).sort((a,b) => this.progress[b] - this.progress[a]);
    sorted.forEach((id, i) => {
      const pts = i === 0 ? 1000 : Math.max(100, 600 - i * 200);
      if (this.room.players[id]) this.room.players[id].score += pts;
    });

    const winnerInfo = this.room.players[winnerId];
    this.io.to(this.code).emit('stampede_winner', {
      winnerId,
      winnerName: winnerInfo?.nickname,
      winnerAvatar: winnerInfo?.avatar,
      round: this.round,
      standings: sorted.map((id, i) => ({
        id, nickname: this.room.players[id]?.nickname,
        position: i + 1, roundWins: this.roundWins[id]
      })),
      players: this.room.players
    });

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('stampede_winner_player', {
        won: id === winnerId,
        position: sorted.indexOf(id) + 1,
        winnerName: winnerInfo?.nickname
      });
    });

    setTimeout(() => this.nextRound(), 5500);
  }

  showFinalResults() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Stampede' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    // Host skip - end current race immediately
    if (this.phase === 'racing') {
      const leader = Object.keys(this.progress).sort((a,b) => this.progress[b] - this.progress[a])[0];
      if (leader) this.endRace(leader);
    }
  }
}

module.exports = Stampede;
