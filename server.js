const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Game state
const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function generateRoom(code) {
  return {
    code,
    players: {},
    host: null,
    game: null,
    gameState: null,
    phase: 'lobby'
  };
}

// Game imports
const Quiplash = require('./src/games/Quiplash');
const Fibbage = require('./src/games/Fibbage');
const Drawful = require('./src/games/Drawful');
const TriviaKnockout = require('./src/games/TriviaKnockout');
const PollMine = require('./src/games/PollMine');

const GAMES = { Quiplash, Fibbage, Drawful, TriviaKnockout, PollMine };

// QR code endpoint
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
  console.log('Connected:', socket.id);

  // Host creates a room
  socket.on('create_room', ({ nickname }) => {
    const code = generateRoomCode();
    rooms[code] = generateRoom(code);
    rooms[code].host = socket.id;
    rooms[code].players[socket.id] = {
      id: socket.id,
      nickname: nickname || 'Host',
      score: 0,
      isHost: true,
      avatar: getAvatar(0)
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { code, player: rooms[code].players[socket.id] });
    emitRoomUpdate(code);
  });

  // Player joins a room
  socket.on('join_room', ({ code, nickname }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (Object.keys(room.players).length >= 8) return socket.emit('error', { message: 'Room is full' });
    if (room.phase !== 'lobby') return socket.emit('error', { message: 'Game already started' });

    const playerCount = Object.keys(room.players).length;
    room.players[socket.id] = {
      id: socket.id,
      nickname: nickname || `Player ${playerCount + 1}`,
      score: 0,
      isHost: false,
      avatar: getAvatar(playerCount)
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_joined', { code, player: room.players[socket.id] });
    emitRoomUpdate(code);
  });

  // Host starts a game
  socket.on('start_game', ({ gameName }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) return socket.emit('error', { message: 'Need at least 2 players' });

    const GameClass = GAMES[gameName];
    if (!GameClass) return socket.emit('error', { message: 'Unknown game' });

    room.game = gameName;
    room.phase = 'playing';
    const gameInstance = new GameClass(room, io, endGame);
    room.gameInstance = gameInstance;
    gameInstance.start();
  });

  // Player sends game input
  socket.on('game_input', (data) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || !room.gameInstance) return;
    room.gameInstance.handleInput(socket.id, data);
  });

  // Host advances phase
  socket.on('next_phase', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id || !room.gameInstance) return;
    room.gameInstance.nextPhase();
  });

  // Return to lobby
  socket.on('return_to_lobby', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
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
    delete room.players[socket.id];

    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
      return;
    }

    // Reassign host if needed
    if (room.host === socket.id) {
      room.host = Object.keys(room.players)[0];
      room.players[room.host].isHost = true;
    }

    emitRoomUpdate(code);
    io.to(code).emit('player_left', { id: socket.id });
  });
});

function emitRoomUpdate(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room_update', {
    code,
    players: Object.values(room.players),
    phase: room.phase,
    game: room.game
  });
}

function endGame(code, scores) {
  const room = rooms[code];
  if (!room) return;
  room.phase = 'results';
  io.to(code).emit('game_over', { scores });
}

function getAvatar(index) {
  const avatars = ['🦊', '🐼', '🦁', '🐸', '🦋', '🐙', '🦄', '🐲'];
  return avatars[index % avatars.length];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 Party Game Server running on port ${PORT}`);
  console.log(`📱 Players join at /join\n`);
});
