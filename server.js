const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5e6
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
// Host screen
app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.json({ limit: '5mb' }));

app.get('/tutorial', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tutorial.html'));
});

app.get('/join', (req, res) => {
  const room = req.query.room ? `?room=${req.query.room}` : '';
  res.redirect(`/join.html${room}`);
});

app.get('/rooms-debug', (req, res) => {
  res.json({ rooms: Object.keys(rooms), count: Object.keys(rooms).length });
});

const rooms = {};

// ═══ PREMIUM CODES & BUNDLES ═══
// Each code unlocks a set of games. 'all' = everything premium.
// Keep these secret — server-side only. Codes are case-insensitive.
// To sell bundles, give customers a code that maps to the games in that bundle.
const ALL_PREMIUM = ['Bluff','Scrawl','PollMine','Copycat','Psychic','Mole','Mafia'];
const PREMIUM_GAMES = new Set(ALL_PREMIUM);

const CODE_BUNDLES = {
  // Full unlock codes — everything
  'MRCOLEISSIGMA': { name: 'Sigma Pass', games: 'all' },
  'COUCH2026':     { name: 'Full Pack', games: 'all' },
  'PARTYALL':      { name: 'Full Pack', games: 'all' },
  'VIPGAMES':      { name: 'VIP Pass', games: 'all' },

  // Example BUNDLE codes — unlock only specific games
  // (use these as templates for selling themed bundles)
  'DRAWBUNDLE':    { name: 'Artist Bundle', games: ['Scrawl','Copycat'] },
  'SOCIALBUNDLE':  { name: 'Social Deduction Bundle', games: ['Mafia','Mole','Psychic'] },
  'CLASSICBUNDLE': { name: 'Classics Bundle', games: ['Bluff','PollMine'] },
};

function gamesForCode(code) {
  const entry = CODE_BUNDLES[String(code || '').trim().toUpperCase()];
  if (!entry) return null;
  return entry.games === 'all' ? [...ALL_PREMIUM] : entry.games;
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function emitRoomUpdate(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room_update', {
    code,
    players: Object.values(room.players),
    phase: room.phase,
    game: room.game,
    hostId: room.hostId
  });
}

// Extract the avatar character id from an avatar string "av:id|<svg>".
// Custom photo avatars (data URLs) return null so they never conflict.
function avatarId(av) {
  if (typeof av !== 'string') return null;
  if (!av.startsWith('av:')) return null;
  const rest = av.slice(3);
  const bar = rest.indexOf('|');
  return bar === -1 ? rest : rest.slice(0, bar);
}

function broadcastTakenAvatars(code) {
  const room = rooms[code];
  if (!room) return;
  const taken = Object.values(room.players).map(p => avatarId(p.avatar)).filter(Boolean);
  io.to(code).emit('avatars_taken', { taken });
}


function endGame(code, scores) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'results';
  io.to(code).emit('game_over', { scores });
}

// Load game from multiple possible paths (root or src/games/)
function tryRequire(name) {
  const paths = ["./" + name, "./src/games/" + name];
  for (const p of paths) {
    try { return require(p); } catch(e) {}
  }
  throw new Error("Could not find game: " + name);
}

const GAMES = {
  Punchline:       tryRequire("Punchline"),
  Bluff:        tryRequire("Bluff"),
  Scrawl:        tryRequire("Scrawl"),
  TriviaKnockout: tryRequire("TriviaKnockout"),
  PollMine:       tryRequire("PollMine"),
  Mafia:          tryRequire("Mafia"),
  MindMeld:       tryRequire("MindMeld"),
  HotTake:        tryRequire("HotTake"),
  Voltage:        tryRequire("Voltage"),
  Mole:           tryRequire("Mole"),
  Psychic:        tryRequire("Psychic"),
  Copycat:        tryRequire("Copycat"),
  Territory:      tryRequire("Territory"),
  Blast:          tryRequire("Blast"),
  MostLikely:     tryRequire("MostLikely"),
  Acronyms:       tryRequire("Acronyms"),
};

const MIN_PLAYERS = {
  Punchline: 3, Bluff: 3, Scrawl: 3,
  TriviaKnockout: 2, PollMine: 2, Mafia: 4,
  MindMeld: 2, HotTake: 2, Voltage: 2,
  Mole: 4, Psychic: 3, Copycat: 3, Territory: 2, Blast: 2, MostLikely: 3, Acronyms: 3,
};

app.get('/qr/:code', async (req, res) => {
  const { code } = req.params;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const url = `${protocol}://${host}/join?room=${code}`;
  try {
    const qr = await QRCode.toDataURL(url, { width: 200, margin: 2 });
    res.json({ qr, url });
  } catch (e) {
    res.status(500).json({ error: 'QR failed' });
  }
});

io.on('connection', (socket) => {

  socket.on('create_room', () => {
    const code = generateRoomCode();
    rooms[code] = {
      code, players: {}, hostId: socket.id,
      game: null, gameInstance: null, phase: 'lobby'
    };
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;
    socket.emit('room_created', { code });
    emitRoomUpdate(code);
  });

  socket.on('sync_unlocks', ({ games }) => {
    // Client tells us which games it previously unlocked on this device.
    // We only trust games that are real premium games.
    if (!socket.roomCode || !rooms[socket.roomCode]) return;
    if (!Array.isArray(games)) return;
    const room = rooms[socket.roomCode];
    if (!room.unlockedGames) room.unlockedGames = new Set();
    games.forEach(g => { if (PREMIUM_GAMES.has(g)) room.unlockedGames.add(g); });
    room.premiumUnlocked = ALL_PREMIUM.every(g => room.unlockedGames.has(g));
  });

  socket.on('redeem_premium', ({ code }) => {
    const unlocked = gamesForCode(code);
    const valid = !!unlocked;
    if (valid && socket.roomCode && rooms[socket.roomCode]) {
      const room = rooms[socket.roomCode];
      if (!room.unlockedGames) room.unlockedGames = new Set();
      unlocked.forEach(g => room.unlockedGames.add(g));
      // legacy flag if everything is unlocked
      room.premiumUnlocked = ALL_PREMIUM.every(g => room.unlockedGames.has(g));
    }
    const bundleName = valid ? CODE_BUNDLES[String(code).trim().toUpperCase()].name : null;
    socket.emit('premium_result', { valid, unlocked: unlocked || [], bundleName });
  });

  socket.on('check_room', ({ code }) => {
    const room = rooms[code];
    const exists = !!room && room.phase === 'lobby';
    // Return which avatar IDs are already taken so the picker can grey them out
    let takenAvatars = [];
    if (exists) {
      takenAvatars = Object.values(room.players)
        .map(p => avatarId(p.avatar))
        .filter(Boolean);
    }
    socket.emit('room_check_result', { exists, takenAvatars });
  });

  // A player on the avatar screen claims/changes their pick (before joining)
  socket.on('claim_avatar', ({ code, avatarId: aid }) => {
    const room = rooms[code];
    if (!room) return;
    const taken = Object.values(room.players).map(p => avatarId(p.avatar)).filter(Boolean);
    const available = !taken.includes(aid);
    socket.emit('avatar_claim_result', { avatarId: aid, available });
  });

  socket.on('join_room', ({ code, nickname, avatar }) => {
    const room = rooms[code];
    if (!room) return socket.emit('join_error', { message: 'Room not found!' });
    if (Object.keys(room.players).length >= 10) return socket.emit('join_error', { message: 'Room is full!' });
    if (room.phase !== 'lobby') return socket.emit('join_error', { message: 'Game already started!' });
    // Prevent duplicate avatars (custom photo avatars always allowed)
    const myAid = avatarId(avatar);
    if (myAid) {
      const taken = Object.values(room.players).map(p => avatarId(p.avatar)).filter(Boolean);
      if (taken.includes(myAid)) {
        return socket.emit('join_error', { message: 'Someone just took that character! Pick another.', avatarTaken: true });
      }
    }
    const idx = Object.keys(room.players).length;
    room.players[socket.id] = {
      id: socket.id, nickname: nickname || `Player ${idx + 1}`,
      score: 0, isHost: false, avatar: avatar || '?'
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_joined', { code, player: room.players[socket.id] });
    emitRoomUpdate(code);
    // Tell everyone which avatars are now taken
    broadcastTakenAvatars(code);
  });

  socket.on('update_avatar', ({ avatar }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].avatar = avatar;
    emitRoomUpdate(code);
    broadcastTakenAvatars(code);
  });

  socket.on('start_game', ({ gameName }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    // Block premium games unless this room unlocked them
    if (PREMIUM_GAMES.has(gameName)) {
      const isUnlocked = room.premiumUnlocked || (room.unlockedGames && room.unlockedGames.has(gameName));
      if (!isUnlocked) {
        return socket.emit('start_error', { message: 'This is a premium game! Enter an unlock code.' });
      }
    }
    const min = MIN_PLAYERS[gameName] || 2;
    if (Object.keys(room.players).length < min) {
      return socket.emit('start_error', { message: `Need at least ${min} players for ${gameName}!` });
    }
    const GameClass = GAMES[gameName];
    if (!GameClass) return;
    room.game = gameName;
    room.phase = 'tutorial';
    // Send tutorial first, then start game when host skips or auto-starts
    io.to(code).emit('show_tutorial', { gameName });
    // Shared starter so both the timer and manual skip use the same path
    room.beginGame = () => {
      if (!rooms[code] || rooms[code].phase !== 'tutorial') return;
      clearTimeout(rooms[code].tutorialTimer);
      rooms[code].phase = 'playing';
      io.to(code).emit('tutorial_done');
      rooms[code].gameInstance = new GameClass(rooms[code], io, endGame);
      rooms[code].gameInstance.start();
    };
    // Auto-start after 14 seconds if host doesn't skip
    room.tutorialTimer = setTimeout(() => { if (room.beginGame) room.beginGame(); }, 7000);
  });

  socket.on('game_input', (data) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.gameInstance) return;
    room.gameInstance.handleInput(socket.id, data);
  });

  // Reactions — broadcast to everyone in room
  socket.on('reaction', ({ emoji }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const player = room.players[socket.id];
    if (!player) return;
    io.to(code).emit('player_reaction', {
      playerId: socket.id,
      nickname: player.nickname,
      avatar: player.avatar,
      emoji
    });
  });

  // Typing indicator
  socket.on('typing', ({ isTyping }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const player = room.players[socket.id];
    if (!player) return;
    socket.to(code).emit('player_typing', {
      playerId: socket.id,
      nickname: player.nickname,
      isTyping
    });
  });

  socket.on('next_phase', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id || !room.gameInstance) return;
    room.gameInstance.nextPhase();
  });

  socket.on('skip_tutorial', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.phase !== 'tutorial') return;
    if (room.beginGame) room.beginGame();
  });

  socket.on('return_to_lobby', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    room.phase = 'lobby';
    room.game = null;
    room.gameInstance = null;
    Object.values(room.players).forEach(p => p.score = 0);
    emitRoomUpdate(code);
    io.to(code).emit('game_ended', { returnToLobby: true });
  });

  // Player tries to rejoin an existing room (after a disconnect)
  socket.on('rejoin_room', ({ code, nickname, avatar }) => {
    const room = rooms[code];
    if (!room) return socket.emit('join_error', { message: 'Room not found!' });
    // Re-add the player
    const idx = Object.keys(room.players).length;
    room.players[socket.id] = {
      id: socket.id, nickname: nickname || `Player ${idx + 1}`,
      score: 0, isHost: false, avatar: avatar || '?'
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_joined', { code, player: room.players[socket.id] });
    emitRoomUpdate(code);
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (room.hostId === socket.id) {
      // Grace period: give the host 8 seconds to reconnect before killing the room
      room.hostGone = true;
      room.hostGoneTimer = setTimeout(() => {
        if (rooms[code] && rooms[code].hostGone) {
          io.to(code).emit('host_disconnected');
          delete rooms[code];
        }
      }, 8000);
      return;
    }
    delete room.players[socket.id];
    emitRoomUpdate(code);
    broadcastTakenAvatars(code);
  });

  // Host reconnecting reclaims the room
  socket.on('reclaim_host', ({ code }) => {
    const room = rooms[code];
    if (!room) return socket.emit('reclaim_failed');
    clearTimeout(room.hostGoneTimer);
    room.hostGone = false;
    room.hostId = socket.id;
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;
    socket.emit('host_reclaimed', { code });
    emitRoomUpdate(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 Couch Pack running on port ${PORT}\n`);
});
