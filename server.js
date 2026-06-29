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

app.use(express.static(path.join(__dirname, 'public')));
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
  Quiplash:       tryRequire("Quiplash"),
  Fibbage:        tryRequire("Fibbage"),
  Drawful:        tryRequire("Drawful"),
  TriviaKnockout: tryRequire("TriviaKnockout"),
  PollMine:       tryRequire("PollMine"),
  Mafia:          tryRequire("Mafia"),
  MindMeld:       tryRequire("MindMeld"),
  HotTake:        tryRequire("HotTake"),
  Voltage:        tryRequire("Voltage"),
  Mole:           tryRequire("Mole"),
  Psychic:        tryRequire("Psychic"),
  Copycat:        tryRequire("Copycat"),
};

const MIN_PLAYERS = {
  Quiplash: 2, Fibbage: 2, Drawful: 2,
  TriviaKnockout: 2, PollMine: 2, Mafia: 4,
  MindMeld: 2, HotTake: 2, Voltage: 2,
  Mole: 4, Psychic: 3, Copycat: 3,
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

  socket.on('check_room', ({ code }) => {
    const room = rooms[code];
    socket.emit('room_check_result', { exists: !!room && room.phase === 'lobby' });
  });

  socket.on('join_room', ({ code, nickname, avatar }) => {
    const room = rooms[code];
    if (!room) return socket.emit('join_error', { message: 'Room not found!' });
    if (Object.keys(room.players).length >= 10) return socket.emit('join_error', { message: 'Room is full!' });
    if (room.phase !== 'lobby') return socket.emit('join_error', { message: 'Game already started!' });
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

  socket.on('update_avatar', ({ avatar }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].avatar = avatar;
    emitRoomUpdate(code);
  });

  socket.on('start_game', ({ gameName }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
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
    // Auto-start after 12 seconds if host doesn't skip
    room.tutorialTimer = setTimeout(() => {
      if (room.phase === 'tutorial') {
        room.phase = 'playing';
        room.gameInstance = new GameClass(room, io, endGame);
        room.gameInstance.start();
      }
    }, 12000);
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
    clearTimeout(room.tutorialTimer);
    const GameClass = GAMES[room.game];
    if (!GameClass) return;
    room.phase = 'playing';
    room.gameInstance = new GameClass(room, io, endGame);
    io.to(code).emit('tutorial_done');
    room.gameInstance.start();
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

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (room.hostId === socket.id) {
      io.to(code).emit('host_disconnected');
      delete rooms[code];
      return;
    }
    delete room.players[socket.id];
    emitRoomUpdate(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 Couch Pack running on port ${PORT}\n`);
});
