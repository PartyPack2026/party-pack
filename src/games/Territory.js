// TERRITORY — real-time Paper.io style game
// Players steer a blob around a shared grid. Moving outside your land leaves a trail.
// Close a loop back to your land to claim everything inside. Hit a trail (yours or theirs
// while they're out) and they pop. Biggest territory when the timer ends wins.

const GRID_W = 60;   // grid columns
const GRID_H = 40;   // grid rows
const TICK_MS = 90;  // simulation step (~11 fps, smooth enough, light on bandwidth)
const ROUND_SECONDS = 90;
const START_SIZE = 3; // starting territory is a START_SIZE x START_SIZE block

const COLORS = ['#ff2d2d','#3b8bff','#00f076','#ffe62d','#cc2dff','#ff8c00','#00e5ff','#ff5ebc','#a0ff2d','#ff9d2d'];

class Territory {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.phase = 'waiting';
    this.grid = null;        // Int8Array: which player owns each cell (-1 = empty)
    this.trailGrid = null;   // which player has a trail on each cell (-1 = none)
    this.players = {};       // id -> {x,y,dir,nextDir,color,colorIndex,alive,trail:[],name,score}
    this.tickTimer = null;
    this.timeLeft = ROUND_SECONDS;
  }

  idx(x, y) { return y * GRID_W + x; }

  start() {
    this.grid = new Int16Array(GRID_W * GRID_H).fill(-1);
    this.trailGrid = new Int16Array(GRID_W * GRID_H).fill(-1);

    // Spawn each player in a spread-out spot with a small home territory
    const ids = Object.keys(this.room.players);
    const spots = this.spawnSpots(ids.length);
    ids.forEach((id, i) => {
      const p = this.room.players[id];
      const spot = spots[i];
      const colorIndex = i % COLORS.length;
      this.players[id] = {
        id, x: spot.x, y: spot.y, dir: spot.dir || 'down', nextDir: spot.dir || 'down',
        color: COLORS[colorIndex], colorIndex,
        alive: true, trail: [], name: p.nickname, claimed: 0
      };
      // paint home block
      for (let dy = -START_SIZE; dy <= START_SIZE; dy++) {
        for (let dx = -START_SIZE; dx <= START_SIZE; dx++) {
          const nx = spot.x + dx, ny = spot.y + dy;
          if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
            this.grid[this.idx(nx, ny)] = i;
          }
        }
      }
    });

    this.phase = 'countdown';
    this.playerColorMap = {};
    ids.forEach((id, i) => { this.playerColorMap[i] = this.players[id].color; });

    // Send initial state + colors to host and players
    this.io.to(this.code).emit('territory_init', {
      gridW: GRID_W, gridH: GRID_H,
      players: ids.map((id, i) => ({
        id, name: this.players[id].name, color: this.players[id].color,
        x: this.players[id].x, y: this.players[id].y
      })),
      grid: this.serializeGrid(),
      roundSeconds: ROUND_SECONDS
    });
    ids.forEach((id) => {
      this.io.to(id).emit('territory_you', {
        color: this.players[id].color, name: this.players[id].name
      });
    });

    // 3-2-1 countdown then go
    setTimeout(() => {
      this.phase = 'playing';
      this.io.to(this.code).emit('territory_go');
      this.loop();
      this.startTimer();
    }, 3200);
  }

  spawnSpots(n) {
    // Spread spawn points around the interior, each with a safe direction (away from nearest wall)
    const m = START_SIZE + 4;
    const cx = Math.floor(GRID_W/2), cy = Math.floor(GRID_H/2);
    const positions = [
      {x: m, y: m, dir:'down'},
      {x: GRID_W-m, y: GRID_H-m, dir:'up'},
      {x: GRID_W-m, y: m, dir:'down'},
      {x: m, y: GRID_H-m, dir:'up'},
      {x: cx, y: m, dir:'down'},
      {x: cx, y: GRID_H-m, dir:'up'},
      {x: m, y: cy, dir:'right'},
      {x: GRID_W-m, y: cy, dir:'left'},
      {x: Math.floor(GRID_W/3), y: cy, dir:'down'},
      {x: Math.floor(2*GRID_W/3), y: cy, dir:'up'},
    ];
    const spots = [];
    for (let i = 0; i < n; i++) spots.push(positions[i % positions.length]);
    return spots;
  }

  serializeGrid() {
    // Send a compact array of owner indices
    return Array.from(this.grid);
  }

  startTimer() {
    this.timeLeft = ROUND_SECONDS;
    this.secTimer = setInterval(() => {
      this.timeLeft--;
      this.io.to(this.code).emit('territory_time', { timeLeft: this.timeLeft });
      if (this.timeLeft <= 0) { this.endRound(); }
    }, 1000);
  }

  loop() {
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  dirToVec(dir) {
    return { up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} }[dir];
  }

  tick() {
    if (this.phase !== 'playing') return;
    const ids = Object.keys(this.players);
    const moves = [];

    // Move every alive player one cell
    ids.forEach((id) => {
      const pl = this.players[id];
      if (!pl.alive) return;
      if (!pl.moving) return; // idle until first steer — gives players a moment to orient
      // apply queued direction (no instant 180 reversal)
      const opposite = { up:'down', down:'up', left:'right', right:'left' };
      if (pl.nextDir && pl.nextDir !== opposite[pl.dir]) pl.dir = pl.nextDir;
      const v = this.dirToVec(pl.dir);
      let nx = pl.x + v.x, ny = pl.y + v.y;

      // Wall = death (keeps it tense). Clamp-bounce would be too forgiving.
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) {
        this.killPlayer(id, 'wall');
        return;
      }
      pl.x = nx; pl.y = ny;
      moves.push({ id, x: nx, y: ny });
    });

    // Collision + trail logic (after everyone moved)
    ids.forEach((id) => {
      const pl = this.players[id];
      if (!pl.alive) return;
      const myIndex = this.indexOf(id);
      const cell = this.idx(pl.x, pl.y);
      const owner = this.grid[cell];

      // Did I hit a trail? (anyone's trail, including my own)
      const trailOwner = this.trailGrid[cell];
      if (trailOwner !== -1) {
        if (trailOwner === myIndex) {
          // ran into my own trail -> die
          this.killPlayer(id, 'self');
          return;
        } else {
          // hit someone else's trail -> THEY die (you cut them off)
          const victimId = ids[trailOwner] || Object.keys(this.players).find(k => this.indexOf(k) === trailOwner);
          const victim = Object.values(this.players).find(p => this.indexOf(p.id) === trailOwner);
          if (victim) this.killPlayer(victim.id, 'cut');
        }
      }

      // Am I on my own land?
      if (owner === myIndex) {
        // Returned home — if I had a trail, claim the enclosed area
        if (pl.trail.length > 0) {
          this.claimTerritory(id, myIndex);
          pl.trail = [];
        }
      } else {
        // Out in the open — leave a trail
        pl.trail.push({ x: pl.x, y: pl.y });
        this.trailGrid[cell] = myIndex;
      }
    });

    // Check for head-to-head collisions (two players on same cell)
    const cellMap = {};
    ids.forEach((id) => {
      const pl = this.players[id];
      if (!pl.alive) return;
      const key = pl.x + ',' + pl.y;
      if (cellMap[key]) {
        // both die (rare, but fair)
        this.killPlayer(id, 'crash');
        this.killPlayer(cellMap[key], 'crash');
      } else cellMap[key] = id;
    });

    // Broadcast compact state
    this.broadcastState();

    // Win check: everyone dead or one left
    const alive = ids.filter(id => this.players[id].alive);
    if (alive.length <= 1 && ids.length > 1) {
      this.endRound();
    } else if (alive.length === 0) {
      this.endRound();
    }
  }

  indexOf(id) {
    // stable per-player index used for grid ownership
    return Object.keys(this.players).indexOf(id);
  }

  claimTerritory(id, myIndex) {
    // 1) Turn the trail itself into owned land
    const pl = this.players[id];
    pl.trail.forEach(t => {
      this.grid[this.idx(t.x, t.y)] = myIndex;
      this.trailGrid[this.idx(t.x, t.y)] = -1;
    });

    // 2) Flood-fill from the borders. Any empty/other cell NOT reachable from the
    //    border without crossing my land is enclosed -> becomes mine.
    const reachable = new Uint8Array(GRID_W * GRID_H);
    const stack = [];
    // seed all border cells that are not mine
    for (let x = 0; x < GRID_W; x++) {
      [0, GRID_H - 1].forEach(y => {
        const c = this.idx(x, y);
        if (this.grid[c] !== myIndex && !reachable[c]) { reachable[c] = 1; stack.push(c); }
      });
    }
    for (let y = 0; y < GRID_H; y++) {
      [0, GRID_W - 1].forEach(x => {
        const c = this.idx(x, y);
        if (this.grid[c] !== myIndex && !reachable[c]) { reachable[c] = 1; stack.push(c); }
      });
    }
    while (stack.length) {
      const c = stack.pop();
      const cx = c % GRID_W, cy = Math.floor(c / GRID_W);
      const neighbors = [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
      neighbors.forEach(([nx, ny]) => {
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) return;
        const nc = this.idx(nx, ny);
        if (!reachable[nc] && this.grid[nc] !== myIndex) { reachable[nc] = 1; stack.push(nc); }
      });
    }
    // Any cell not reachable and not already mine = enclosed -> claim it
    let gained = 0;
    for (let c = 0; c < this.grid.length; c++) {
      if (!reachable[c] && this.grid[c] !== myIndex) {
        // stealing from someone else is allowed (that's the aggression)
        this.grid[c] = myIndex;
        // clear any trail sitting there
        if (this.trailGrid[c] !== -1) {
          const victimIdx = this.trailGrid[c];
          this.trailGrid[c] = -1;
        }
        gained++;
      }
    }

    if (gained > 0) {
      this.io.to(this.code).emit('territory_claim', {
        playerId: id, color: pl.color, gained
      });
    }
  }

  killPlayer(id, cause) {
    const pl = this.players[id];
    if (!pl || !pl.alive) return;
    pl.alive = false;
    const myIndex = this.indexOf(id);
    // Wipe their trail (territory stays — that's the reward for surviving long)
    for (let c = 0; c < this.trailGrid.length; c++) {
      if (this.trailGrid[c] === myIndex) this.trailGrid[c] = -1;
    }
    pl.trail = [];
    this.io.to(id).emit('territory_dead', { cause });
    this.io.to(this.code).emit('territory_pop', { playerId: id, x: pl.x, y: pl.y, color: pl.color });
  }

  countCells() {
    // count owned cells per index
    const counts = {};
    for (let c = 0; c < this.grid.length; c++) {
      const o = this.grid[c];
      if (o !== -1) counts[o] = (counts[o] || 0) + 1;
    }
    return counts;
  }

  broadcastState() {
    const ids = Object.keys(this.players);
    // Compact: positions + alive + trails. Grid sent as full snapshot every few ticks.
    this._tickCount = (this._tickCount || 0) + 1;
    const sendFullGrid = this._tickCount % 3 === 0; // grid every 3rd tick (~270ms)

    const total = GRID_W * GRID_H;
    const counts = this.countCells();

    const payload = {
      players: ids.map(id => {
        const pl = this.players[id];
        return {
          id, x: pl.x, y: pl.y, alive: pl.alive, color: pl.color,
          trail: pl.trail, pct: Math.round(((counts[this.indexOf(id)] || 0) / total) * 100)
        };
      })
    };
    if (sendFullGrid) payload.grid = this.serializeGrid();
    this.io.to(this.code).emit('territory_state', payload);
  }

  handleInput(playerId, data) {
    if (this.phase !== 'playing') return;
    const pl = this.players[playerId];
    if (!pl || !pl.alive) return;
    if (data.type === 'steer' && ['up','down','left','right'].includes(data.dir)) {
      pl.nextDir = data.dir;
      pl.moving = true; // first steer starts them moving
    }
  }

  endRound() {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    clearInterval(this.tickTimer);
    clearInterval(this.secTimer);

    const total = GRID_W * GRID_H;
    const counts = this.countCells();
    const ids = Object.keys(this.players);

    // Score = territory percentage * 100 (so ~big numbers, satisfying)
    ids.forEach(id => {
      const pct = ((counts[this.indexOf(id)] || 0) / total) * 100;
      const pts = Math.round(pct * 100);
      if (this.room.players[id]) this.room.players[id].score += pts;
      this.players[id].finalPct = Math.round(pct * 10) / 10;
    });

    const standings = ids.map(id => ({
      id, name: this.players[id].name, color: this.players[id].color,
      pct: this.players[id].finalPct, alive: this.players[id].alive
    })).sort((a, b) => b.pct - a.pct);

    this.io.to(this.code).emit('territory_results', {
      standings, grid: this.serializeGrid()
    });

    ids.forEach(id => {
      const place = standings.findIndex(s => s.id === id) + 1;
      this.io.to(id).emit('territory_final', {
        place, total: ids.length, pct: this.players[id].finalPct,
        won: place === 1
      });
    });

    // Move to overall final scores after a beat
    setTimeout(() => this.showFinalScores(), 6000);
  }

  showFinalScores() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Territory' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    // Host skip ends the round now
    if (this.phase === 'playing') this.endRound();
  }
}

module.exports = Territory;
