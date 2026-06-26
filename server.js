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
    hostId: room.hostId,
    customPrompts: room.customPrompts || []
  });
}

function endGame(code, scores) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'results';
  io.to(code).emit('game_over', { scores });
}

const Quiplash = require('./src/games/Quiplash');
const Fibbage = require('./src/games/Fibbage');
const Drawful = require('./src/games/Drawful');
const TriviaKnockout = require('./src/games/TriviaKnockout');
const PollMine = require('./src/games/PollMine');
const Mafia = require('./src/games/Mafia');
const GAMES = { Quiplash, Fibbage, Drawful, TriviaKnockout, PollMine, Mafia };

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

  // HOST creates room — NOT a player
  socket.on('create_room', () => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: {},       // only actual players (phones)
      hostId: socket.id, // host socket — controls game but doesn't play
      game: null,
      gameInstance: null,
      phase: 'lobby',
      customPrompts: []
    };
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;
    socket.emit('room_created', { code });
    emitRoomUpdate(code);
  });

  // PLAYER joins from phone
  socket.on('join_room', ({ code, nickname, avatar }) => {
    const room = rooms[code];
    if (!room) return socket.emit('join_error', { message: 'Room not found!' });
    if (Object.keys(room.players).length >= 10) return socket.emit('join_error', { message: 'Room is full (max 10)!' });
    if (room.phase !== 'lobby') return socket.emit('join_error', { message: 'Game already started!' });

    const idx = Object.keys(room.players).length;
    room.players[socket.id] = {
      id: socket.id,
      nickname: nickname || `Player ${idx + 1}`,
      score: 0,
      isHost: false,
      avatar: avatar || '?'
    };
    socket.join(code);
    socket.roomCode = code;
    socket.isHost = false;
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

  socket.on('add_custom_prompts', ({ prompts }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    room.customPrompts = [...(room.customPrompts || []), ...prompts.filter(p => p.trim())];
    socket.emit('prompts_added', { count: room.customPrompts.length });
  });

  socket.on('start_game', ({ gameName }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    const minPlayers = gameName === 'Mafia' ? 4 : 2;
    if (Object.keys(room.players).length < minPlayers) {
      return socket.emit('start_error', { message: `Need at least ${minPlayers} players!` });
    }
    const GameClass = GAMES[gameName];
    if (!GameClass) return;
    room.game = gameName;
    room.phase = 'playing';
    const gameInstance = new GameClass(room, io, endGame);
    room.gameInstance = gameInstance;
    gameInstance.start();
  });

  socket.on('game_input', (data) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.gameInstance) return;
    room.gameInstance.handleInput(socket.id, data);
  });

  socket.on('next_phase', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id || !room.gameInstance) return;
    room.gameInstance.nextPhase();
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

    // If host disconnects, close the room
    if (room.hostId === socket.id) {
      io.to(code).emit('host_disconnected');
      delete rooms[code];
      return;
    }

    // Player disconnects
    delete room.players[socket.id];
    emitRoomUpdate(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 Party Pack running on port ${PORT}\n`);
});
