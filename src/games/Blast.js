// BLAST — Bomberman-style real-time arena battle.
// Players move on a tile grid, drop bombs, blow up soft walls and each other.
// Power-ups boost bomb count, blast range, and speed. Last player standing wins the round.

const COLS = 15;          // odd numbers make the classic pillar layout work
const ROWS = 11;
const TICK_MS = 50;       // ~20fps, smoother
const BOMB_FUSE = 1800;   // shorter fuse = more tension
const FLAME_TIME = 500;   // ms the explosion flames linger
const ROUND_TIME = 75;    // punchy rounds
const MOVE_COOLDOWN = 110; // snappier movement

// tile types
const EMPTY = 0, HARD = 1, SOFT = 2;

const COLORS = ['#ff2d2d','#3b8bff','#00f076','#ffe62d','#cc2dff','#ff8c00','#00e5ff','#ff5ebc'];

const POWERUPS = ['bomb','range','speed']; // extra bomb, bigger blast, faster move

class Blast {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'waiting';
    this.grid = [];          // tile types
    this.powerups = {};      // "x,y" -> type
    this.bombs = [];         // {x,y,owner,fuseAt,range}
    this.flames = {};        // "x,y" -> expireAt
    this.players = {};       // id -> {x,y,alive,color,name,maxBombs,range,speed,lastMove,bombsOut}
    this.tickTimer = null;
  }

  key(x, y) { return x + ',' + y; }

  start() {
    this.buildMap();

    const ids = Object.keys(this.room.players);
    // 4 corners are the classic spawns; extend for more players
    const corners = [
      {x:1,y:1},{x:COLS-2,y:ROWS-2},{x:COLS-2,y:1},{x:1,y:ROWS-2},
      {x:Math.floor(COLS/2),y:1},{x:Math.floor(COLS/2),y:ROWS-2},
      {x:1,y:Math.floor(ROWS/2)},{x:COLS-2,y:Math.floor(ROWS/2)}
    ];
    ids.forEach((id, i) => {
      const sp = corners[i % corners.length];
      const p = this.room.players[id];
      this.players[id] = {
        id, x: sp.x, y: sp.y, alive: true,
        color: COLORS[i % COLORS.length], name: p.nickname,
        maxBombs: 1, range: 2, speed: MOVE_COOLDOWN, lastMove: 0, bombsOut: 0,
        dir: 'down', queuedDir: null
      };
      // clear a safe pocket around each spawn so nobody is boxed in
      this.clearSpawn(sp.x, sp.y);
    });

    this.phase = 'countdown';
    this.io.to(this.code).emit('blast_init', {
      cols: COLS, rows: ROWS,
      grid: this.grid,
      powerups: {}, // hidden under soft walls; revealed on break
      players: ids.map(id => ({
        id, x: this.players[id].x, y: this.players[id].y,
        color: this.players[id].color, name: this.players[id].name
      })),
      roundTime: ROUND_TIME
    });
    ids.forEach(id => this.io.to(id).emit('blast_you', { color: this.players[id].color, name: this.players[id].name }));

    setTimeout(() => {
      this.phase = 'playing';
      this.io.to(this.code).emit('blast_go');
      this.tickTimer = setInterval(() => this.tick(), TICK_MS);
      this.startTimer();
    }, 3200);
  }

  buildMap() {
    this.grid = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        if (x === 0 || y === 0 || x === COLS-1 || y === ROWS-1) row.push(HARD); // border
        else if (x % 2 === 0 && y % 2 === 0) row.push(HARD);                    // pillars
        else row.push(Math.random() < 0.72 ? SOFT : EMPTY);                     // destructible
      }
      this.grid.push(row);
    }
    // hide powerups under ~30% of soft walls
    this.hiddenPowerups = {};
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.grid[y][x] === SOFT && Math.random() < 0.30) {
          this.hiddenPowerups[this.key(x,y)] = POWERUPS[Math.floor(Math.random()*POWERUPS.length)];
        }
      }
    }
  }

  clearSpawn(x, y) {
    // L-shaped clearing so players can always move out
    const cells = [[x,y],[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
    cells.forEach(([cx,cy]) => {
      if (cx>0 && cx<COLS-1 && cy>0 && cy<ROWS-1 && this.grid[cy][cx]===SOFT) {
        this.grid[cy][cx] = EMPTY;
        delete this.hiddenPowerups[this.key(cx,cy)];
      }
    });
  }

  startTimer() {
    this.timeLeft = ROUND_TIME;
    this.secTimer = setInterval(() => {
      this.timeLeft--;
      this.io.to(this.code).emit('blast_time', { timeLeft: this.timeLeft });
      // Sudden death: in the last 20s, soft walls start creeping back to shrink the arena
      if (this.timeLeft <= 0) this.endRound('time');
    }, 1000);
  }

  tick() {
    if (this.phase !== 'playing') return;
    const now = Date.now();

    // Move players whose cooldown elapsed and have a queued/held direction
    Object.values(this.players).forEach(pl => {
      if (!pl.alive || !pl.queuedDir) return;
      if (now - pl.lastMove < pl.speed) return;
      const v = this.dirVec(pl.queuedDir);
      const nx = pl.x + v.x, ny = pl.y + v.y;
      if (this.canWalk(nx, ny)) {
        pl.x = nx; pl.y = ny; pl.dir = pl.queuedDir; pl.lastMove = now;
        // pick up powerup
        const pk = this.key(nx, ny);
        if (this.powerups[pk]) {
          this.applyPowerup(pl, this.powerups[pk]);
          delete this.powerups[pk];
          this.io.to(this.code).emit('blast_powerup_taken', { x:nx, y:ny, playerId: pl.id });
        }
      }
    });

    // Detonate bombs whose fuse expired
    const toExplode = this.bombs.filter(b => now >= b.fuseAt);
    if (toExplode.length) {
      toExplode.forEach(b => this.explode(b));
    }

    // Expire flames
    let flameChanged = false;
    for (const k in this.flames) {
      if (now >= this.flames[k]) { delete this.flames[k]; flameChanged = true; }
    }

    // Check players standing in flames -> dead
    Object.values(this.players).forEach(pl => {
      if (pl.alive && this.flames[this.key(pl.x, pl.y)]) {
        this.killPlayer(pl.id);
      }
    });

    this.broadcast();

    // win check
    const alive = Object.values(this.players).filter(p => p.alive);
    if (Object.keys(this.players).length > 1 && alive.length <= 1) {
      this.endRound('lastman', alive[0]);
    } else if (alive.length === 0) {
      this.endRound('draw');
    }
  }

  dirVec(d) { return { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }[d]; }

  canWalk(x, y) {
    if (x<0||x>=COLS||y<0||y>=ROWS) return false;
    if (this.grid[y][x] !== EMPTY) return false;
    if (this.bombs.some(b => b.x===x && b.y===y)) return false; // can't walk through bombs
    return true;
  }

  applyPowerup(pl, type) {
    if (type === 'bomb') pl.maxBombs = Math.min(8, pl.maxBombs + 1);
    else if (type === 'range') pl.range = Math.min(8, pl.range + 1);
    else if (type === 'speed') pl.speed = Math.max(60, pl.speed - 25);
  }

  placeBomb(pl) {
    if (!pl.alive) return;
    if (pl.bombsOut >= pl.maxBombs) return;
    if (this.bombs.some(b => b.x===pl.x && b.y===pl.y)) return; // one bomb per tile
    pl.bombsOut++;
    const bomb = { x: pl.x, y: pl.y, owner: pl.id, fuseAt: Date.now()+BOMB_FUSE, range: pl.range };
    this.bombs.push(bomb);
    this.io.to(this.code).emit('blast_bomb', { x: pl.x, y: pl.y, color: pl.color });
  }

  explode(bomb) {
    // remove bomb, free the owner's count
    this.bombs = this.bombs.filter(b => b !== bomb);
    const owner = this.players[bomb.owner];
    if (owner) owner.bombsOut = Math.max(0, owner.bombsOut - 1);

    const now = Date.now();
    const flameCells = [{x:bomb.x, y:bomb.y}];
    const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    dirs.forEach(d => {
      for (let i = 1; i <= bomb.range; i++) {
        const fx = bomb.x + d.x*i, fy = bomb.y + d.y*i;
        if (fx<0||fx>=COLS||fy<0||fy>=ROWS) break;
        if (this.grid[fy][fx] === HARD) break;           // hard wall stops flame
        if (this.grid[fy][fx] === SOFT) {
          // destroy soft wall, maybe reveal powerup, flame stops here
          this.grid[fy][fx] = EMPTY;
          const pk = this.key(fx, fy);
          if (this.hiddenPowerups[pk]) {
            this.powerups[pk] = this.hiddenPowerups[pk];
            delete this.hiddenPowerups[pk];
          }
          this.io.to(this.code).emit('blast_break', { x:fx, y:fy, powerup: this.powerups[pk]||null });
          flameCells.push({x:fx, y:fy});
          break;
        }
        flameCells.push({x:fx, y:fy});
        // chain-detonate other bombs caught in the blast
        const hitBomb = this.bombs.find(b => b.x===fx && b.y===fy);
        if (hitBomb) hitBomb.fuseAt = now; // explode next tick
      }
    });

    flameCells.forEach(c => { this.flames[this.key(c.x, c.y)] = now + FLAME_TIME; });

    // instakill any player in the flames right now
    Object.values(this.players).forEach(pl => {
      if (pl.alive && flameCells.some(c => c.x===pl.x && c.y===pl.y)) this.killPlayer(pl.id);
    });

    this.io.to(this.code).emit('blast_explode', { cells: flameCells, color: owner?owner.color:'#fff' });
  }

  killPlayer(id) {
    const pl = this.players[id];
    if (!pl || !pl.alive) return;
    pl.alive = false;
    this.io.to(id).emit('blast_dead');
    this.io.to(this.code).emit('blast_pop', { playerId: id, x: pl.x, y: pl.y, color: pl.color });
  }

  broadcast() {
    this.io.to(this.code).emit('blast_state', {
      players: Object.values(this.players).map(p => ({
        id:p.id, x:p.x, y:p.y, alive:p.alive, dir:p.dir, color:p.color
      })),
      bombs: this.bombs.map(b => ({ x:b.x, y:b.y, t: Math.max(0, b.fuseAt-Date.now()) })),
      flames: Object.keys(this.flames),
      powerups: this.powerups
    });
  }

  handleInput(playerId, data) {
    if (this.phase !== 'playing') return;
    const pl = this.players[playerId];
    if (!pl || !pl.alive) return;
    if (data.type === 'move' && ['up','down','left','right'].includes(data.dir)) {
      pl.queuedDir = data.dir;
    } else if (data.type === 'stop') {
      pl.queuedDir = null;
    } else if (data.type === 'bomb') {
      this.placeBomb(pl);
    }
  }

  endRound(reason, winner) {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    clearInterval(this.tickTimer);
    clearInterval(this.secTimer);

    // Award: winner gets big points, survivors get some, kills tracked simply by survival
    const ids = Object.keys(this.players);
    let winnerId = winner ? winner.id : null;
    if (!winnerId && reason === 'time') {
      // most-alive tiebreak: anyone still alive shares; else nobody
      const alive = ids.filter(id => this.players[id].alive);
      if (alive.length === 1) winnerId = alive[0];
    }
    ids.forEach(id => {
      const pl = this.players[id];
      let pts = 0;
      if (id === winnerId) pts = 1000;
      else if (pl.alive) pts = 400; // survived to time-out
      if (this.room.players[id]) this.room.players[id].score += pts;
    });

    const winnerInfo = winnerId ? this.players[winnerId] : null;
    this.io.to(this.code).emit('blast_results', {
      winnerName: winnerInfo ? winnerInfo.name : null,
      winnerColor: winnerInfo ? winnerInfo.color : null,
      reason,
      players: this.room.players
    });
    ids.forEach(id => {
      this.io.to(id).emit('blast_final', {
        won: id === winnerId,
        survived: this.players[id].alive
      });
    });

    setTimeout(() => this.showFinalScores(), 5500);
  }

  showFinalScores() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id:p.id, nickname:p.nickname, avatar:p.avatar, score:p.score }))
      .sort((a,b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Blast' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'playing') this.endRound('time');
  }
}

module.exports = Blast;
