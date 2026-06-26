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

app.get('/join', (req, res) => {
  const room = req.query.room ? `?room=${req.query.room}` : '';
  res.redirect(`/join.html${room}`);
});

const rooms = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const Quiplash = require('./src/games/Quiplash');
const Fibbage = require('./src/games/Fibbage');
const Drawful = require('./src/games/Drawful');
const TriviaKnockout = require('./src/games/TriviaKnockout');
const PollMine = require('./src/games/PollMine');
const GAMES = { Quiplash, Fibbage, Drawful, TriviaKnockout, PollMine };

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

function getAvatar(index) {
  const avatars = ['🦊','🐼','🦁','🐸','🦋','🐙','🦄','🐲'];
  return avatars[index % avatars.length];
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

io.on('connection', (socket) => {

  // Host creates room AND joins as a player
  socket.on('create_room', ({ nickname }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code, players: {}, hostId: socket.id,
      game: null, gameInstance: null, phase: 'lobby'
    };
    rooms[code].players[socket.id] = {
      id: socket.id, nickname: nickname || 'Host',
      score: 0, isHost: true, avatar: getAvatar(0)
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { code, player: rooms[code].players[socket.id] });
    emitRoomUpdate(code);
  });

  socket.on('join_room', ({ code, nickname }) => {
    const room = rooms[code];
    if (!room) return socket.emit('join_error', { message: 'Room not found!' });
    if (Object.keys(room.players).length >= 8) return socket.emit('join_error', { message: 'Room is full!' });
    if (room.phase !== 'lobby') return socket.emit('join_error', { message: 'Game already in progress!' });
    const count = Object.keys(room.players).length;
    room.players[socket.id] = {
      id: socket.id, nickname: nickname || `Player ${count+1}`,
      score: 0, isHost: false, avatar: getAvatar(count)
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_joined', { code, player: room.players[socket.id] });
    emitRoomUpdate(code);
  });

  socket.on('start_game', ({ gameName }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (Object.keys(room.players).length < 2) return socket.emit('join_error', { message: 'Need at least 2 players!' });
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
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0) { delete rooms[code]; return; }
    if (room.hostId === socket.id) {
      room.hostId = Object.keys(room.players)[0];
      room.players[room.hostId].isHost = true;
    }
    emitRoomUpdate(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 Party Pack running on port ${PORT}\n`);
});
