const ROLES = {
  mafia: { name: 'Mafia', emoji: '🔪', team: 'mafia', desc: 'Kill a villager each night. Stay hidden.' },
  detective: { name: 'Detective', emoji: '🔍', team: 'village', desc: 'Each night, investigate one player to learn their role.' },
  doctor: { name: 'Doctor', emoji: '💊', team: 'village', desc: 'Each night, protect one player from being killed.' },
  villager: { name: 'Villager', emoji: '👤', team: 'village', desc: 'Find and vote out the Mafia before they take over.' },
};

function assignRoles(playerIds) {
  const n = playerIds.length;
  const roles = [];
  const mafiaCount = n <= 5 ? 1 : n <= 8 ? 2 : 3;
  for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
  roles.push('detective');
  roles.push('doctor');
  while (roles.length < n) roles.push('villager');
  roles.sort(() => Math.random() - 0.5);
  const assigned = {};
  playerIds.forEach((id, i) => assigned[id] = roles[i]);
  return assigned;
}

class Mafia {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'night'; this.round = 0;
    this.roles = {}; this.alive = [];
    this.mafiaKill = null; this.doctorSave = null; this.detectiveCheck = null;
    this.dayVotes = {}; this.eliminated = [];
    this.nightActions = {};
    this.lastKilled = null; this.lastSaved = false;
  }

  start() {
    const playerIds = Object.keys(this.room.players);
    this.roles = assignRoles(playerIds);
    this.alive = [...playerIds];

    // Tell each player their role privately
    playerIds.forEach(id => {
      const role = this.roles[id];
      const roleInfo = ROLES[role];
      const mafiaTeam = role === 'mafia'
        ? Object.entries(this.roles).filter(([,r]) => r === 'mafia').map(([pid]) => this.room.players[pid]?.nickname)
        : null;
      this.io.to(id).emit('mafia_role', {
        role, roleInfo, mafiaTeam,
        players: Object.values(this.room.players).map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar }))
      });
    });

    this.io.to(this.code).emit('mafia_start', {
      players: Object.values(this.room.players).map(p=>({id:p.id,nickname:p.nickname,avatar:p.avatar,alive:true}))
    });

    setTimeout(() => this.startNight(), 8000);
  }

  startNight() {
    this.io.to(this.code).emit('mafia_night', { round: this.round + 1 });
    this.round++;
    this.phase = 'night';
    this.mafiaKill = null; this.doctorSave = null; this.detectiveCheck = null;
    this.nightActions = {};

    const alivePlayers = this.alive.map(id => ({
      id, nickname: this.room.players[id]?.nickname, avatar: this.room.players[id]?.avatar
    }));

    this.alive.forEach(id => {
      const role = this.roles[id];
      if (role === 'mafia') {
        const targets = alivePlayers.filter(p => this.roles[p.id] !== 'mafia');
        this.io.to(id).emit('mafia_night_action', {
          role: 'mafia', action: 'kill',
          instruction: 'Choose someone to eliminate tonight',
          targets, round: this.round, timeLimit: 30
        });
      } else if (role === 'detective') {
        this.io.to(id).emit('mafia_night_action', {
          role: 'detective', action: 'investigate',
          instruction: 'Investigate someone — you\'ll learn their role',
          targets: alivePlayers.filter(p => p.id !== id), round: this.round, timeLimit: 30
        });
      } else if (role === 'doctor') {
        this.io.to(id).emit('mafia_night_action', {
          role: 'doctor', action: 'protect',
          instruction: 'Choose someone to protect tonight',
          targets: alivePlayers, round: this.round, timeLimit: 30
        });
      } else {
        this.io.to(id).emit('mafia_night_sleep', {
          round: this.round,
          message: 'The village sleeps... The Mafia is making their move.',
          timeLimit: 30
        });
      }
    });

    // Dead players spectate
    this.eliminated.forEach(id => {
      this.io.to(id).emit('mafia_spectate', { round: this.round, phase: 'night' });
    });

    this.nightTimer = setTimeout(() => this.resolveNight(), 35000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'night') {
      if (data.type === 'night_action' && this.alive.includes(playerId)) {
        const role = this.roles[playerId];
        if (role === 'mafia' && !this.mafiaKill) {
          this.mafiaKill = data.target;
          this.io.to(playerId).emit('mafia_action_confirmed', { message: 'Target locked in 🔪' });
        } else if (role === 'doctor' && !this.doctorSave) {
          this.doctorSave = data.target;
          this.io.to(playerId).emit('mafia_action_confirmed', { message: 'Protection placed 💊' });
        } else if (role === 'detective' && !this.detectiveCheck) {
          this.detectiveCheck = data.target;
          const targetRole = this.roles[data.target];
          const isEvil = targetRole === 'mafia';
          this.io.to(playerId).emit('mafia_detective_result', {
            targetName: this.room.players[data.target]?.nickname,
            isEvil,
            message: isEvil ? '🚨 They are MAFIA!' : '✅ They are innocent.'
          });
        }

        this.nightActions[playerId] = true;
        const specialRoles = this.alive.filter(id => ['mafia','doctor','detective'].includes(this.roles[id]));
        if (specialRoles.every(id => this.nightActions[id])) {
          clearTimeout(this.nightTimer);
          setTimeout(() => this.resolveNight(), 1000);
        }
      }
    } else if (this.phase === 'day') {
      if (data.type === 'day_vote' && this.alive.includes(playerId) && !this.dayVotes[playerId]) {
        this.dayVotes[playerId] = data.target;
        const count = Object.keys(this.dayVotes).length;
        this.alive.forEach(id => {
          this.io.to(id).emit('vote_count', { count, total: this.alive.length });
        });
        if (count >= this.alive.length) {
          clearTimeout(this.dayTimer);
          setTimeout(() => this.resolveDay(), 500);
        }
      }
    }
  }

  resolveNight() {
    const killed = this.mafiaKill;
    const saved = killed && killed === this.doctorSave;
    this.lastKilled = killed && !saved ? killed : null;
    this.lastSaved = saved;

    if (this.lastKilled) {
      this.alive = this.alive.filter(id => id !== this.lastKilled);
      this.eliminated.push(this.lastKilled);
    }

    const killedName = this.lastKilled ? this.room.players[this.lastKilled]?.nickname : null;
    const killedAvatar = this.lastKilled ? this.room.players[this.lastKilled]?.avatar : null;

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('mafia_dawn', {
        killed: this.lastKilled,
        killedName, killedAvatar,
        saved: this.lastSaved,
        round: this.round,
        alivePlayers: this.alive.map(aid => ({
          id: aid,
          nickname: this.room.players[aid]?.nickname,
          avatar: this.room.players[aid]?.avatar
        }))
      });
    });

    if (this.lastKilled) {
      this.io.to(this.lastKilled).emit('mafia_you_died', { killedBy: 'the Mafia' });
    }

    if (this.checkWin()) return;
    this.io.to(this.code).emit('mafia_day', {
      round: this.round,
      killed: this.lastKilled ? this.room.players[this.lastKilled]?.nickname : null,
      players: Object.values(this.room.players).map(p=>({id:p.id,nickname:p.nickname,avatar:p.avatar,alive:this.alive.includes(p.id)}))
    });

    setTimeout(() => this.startDay(), 7000);
  }

  startDay() {
    this.phase = 'day';
    this.dayVotes = {};

    const alivePlayers = this.alive.map(id => ({
      id, nickname: this.room.players[id]?.nickname, avatar: this.room.players[id]?.avatar
    }));

    this.alive.forEach(id => {
      this.io.to(id).emit('mafia_day_vote', {
        instruction: 'Vote to eliminate someone you think is Mafia!',
        targets: alivePlayers.filter(p => p.id !== id),
        round: this.round, timeLimit: 45,
        alivePlayers
      });
    });

    this.eliminated.forEach(id => {
      this.io.to(id).emit('mafia_spectate', { round: this.round, phase: 'day', alivePlayers });
    });

    this.dayTimer = setTimeout(() => this.resolveDay(), 35000);
  }

  resolveDay() {
    // Tally votes
    const tally = {};
    this.alive.forEach(id => tally[id] = 0);
    Object.values(this.dayVotes).forEach(t => { if (tally[t] !== undefined) tally[t]++; });

    const maxVotes = Math.max(...Object.values(tally));
    const eliminated = maxVotes > 0
      ? Object.keys(tally).filter(id => tally[id] === maxVotes)
      : [];

    let eliminatedId = null;
    if (eliminated.length === 1) {
      eliminatedId = eliminated[0];
      this.alive = this.alive.filter(id => id !== eliminatedId);
      this.eliminated.push(eliminatedId);
    }

    const eliminatedRole = eliminatedId ? this.roles[eliminatedId] : null;
    const eliminatedName = eliminatedId ? this.room.players[eliminatedId]?.nickname : null;

    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('mafia_vote_result', {
        eliminatedId, eliminatedName,
        eliminatedRole, eliminatedRoleInfo: eliminatedRole ? ROLES[eliminatedRole] : null,
        tally, votes: this.dayVotes,
        tied: eliminated.length !== 1,
        alivePlayers: this.alive.map(aid => ({
          id: aid, nickname: this.room.players[aid]?.nickname, avatar: this.room.players[aid]?.avatar
        }))
      });
    });

    if (eliminatedId) this.io.to(eliminatedId).emit('mafia_you_died', { killedBy: 'the village vote' });

    // Host screen: who got voted out and their role
    this.io.to(this.code).emit('mafia_voted_out', {
      name: eliminatedName || 'Nobody',
      role: eliminatedRole ? ROLES[eliminatedRole].name : '',
      players: Object.values(this.room.players).map(p => ({
        id: p.id, nickname: p.nickname, avatar: p.avatar, alive: this.alive.includes(p.id)
      }))
    });

    if (this.checkWin()) return;
    setTimeout(() => this.startNight(), 8000);
  }

  checkWin() {
    const mafiaAlive = this.alive.filter(id => this.roles[id] === 'mafia');
    const villageAlive = this.alive.filter(id => this.roles[id] !== 'mafia');

    if (mafiaAlive.length === 0) {
      this.endRound('village');
      return true;
    }
    if (mafiaAlive.length >= villageAlive.length) {
      this.endRound('mafia');
      return true;
    }
    return false;
  }

  endRound(winner) {
    const allRoles = Object.entries(this.roles).map(([id, role]) => ({
      id, role, roleInfo: ROLES[role],
      nickname: this.room.players[id]?.nickname,
      avatar: this.room.players[id]?.avatar
    }));

    // Award points
    Object.keys(this.room.players).forEach(id => {
      const role = this.roles[id];
      const onWinningTeam = (winner === 'village' && role !== 'mafia') || (winner === 'mafia' && role === 'mafia');
      if (onWinningTeam) this.room.players[id].score += 1000;
      if (role === 'detective') this.room.players[id].score += 200;
    });

    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);

    Object.keys(this.room.players).forEach(id => {
      const myRole = this.roles[id];
      const won = (winner === 'village' && myRole !== 'mafia') || (winner === 'mafia' && myRole === 'mafia');
      this.io.to(id).emit('mafia_game_over', { winner, won, allRoles, scores });
    });

    setTimeout(() => {
      Object.keys(this.room.players).forEach(id => {
        this.io.to(id).emit('final_scores', { scores, gameName: 'Mafia' });
      });
      this.endGame(this.code, scores);
    }, 6000);
  }

  nextPhase() {
    clearTimeout(this.nightTimer); clearTimeout(this.dayTimer);
    if (this.phase === 'night') this.resolveNight();
    else if (this.phase === 'day') this.resolveDay();
  }
}
module.exports = Mafia;
