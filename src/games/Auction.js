// AUCTION — players start with a pile of coins. Each round a mystery "lot" comes up with a
// HIDDEN value. Everyone secretly bids. Highest bidder wins the lot: they pay their bid but
// gain the lot's value. Overpay and you lose coins; snag a bargain and you profit. Richest at
// the end wins. It's all reading the room and holding your nerve.

const START_COINS = 1000;

const LOTS = [
  { name: "A Mystery Antique Vase", hint: "Could be priceless. Could be from a bargain bin.", value: 600 },
  { name: "A Sealed Cardboard Box", hint: "No label. It rattles.", value: 300 },
  { name: "A 'Genuine' Gold Watch", hint: "It's very shiny.", value: 800 },
  { name: "A Bag of Assorted Gems", hint: "Some sparkle more than others.", value: 500 },
  { name: "An Old Painting", hint: "The artist's signature is smudged.", value: 700 },
  { name: "A Vintage Comic Book", hint: "The cover is a little torn.", value: 450 },
  { name: "A Locked Treasure Chest", hint: "Heavy. No key included.", value: 900 },
  { name: "A Rare Stamp Collection", hint: "Tiny, but collectors go wild.", value: 400 },
  { name: "A Signed Football", hint: "Signature slightly faded.", value: 350 },
  { name: "A Crate of 'Fine' Wine", hint: "The labels are in another language.", value: 550 },
  { name: "A Dusty Old Lamp", hint: "Give it a rub, maybe?", value: 250 },
  { name: "A Handful of Ancient Coins", hint: "Green with age.", value: 650 },
];

class Auction {
  constructor(room, io, endGame) {
    this.room = room; this.io = io; this.endGame = endGame;
    this.code = room.code;
    this.rounds = 6; this.currentRound = 0;
    this.phase = 'bidding';
    this.bids = {};
    this.usedLots = [];
  }

  start() {
    // set coin piles (server already reset score to 0)
    Object.keys(this.room.players).forEach(id => { if (this.room.players[id]) this.room.players[id].score = START_COINS; });
    this.nextRound();
  }

  nextRound() {
    if (!this.room || Object.keys(this.room.players).length === 0) { this.ended = true; return; }
    this.currentRound++;
    if (this.currentRound > this.rounds) { this.showFinal(); return; }
    const pool = LOTS.map((l, i) => i).filter(i => !this.usedLots.includes(i));
    const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * LOTS.length);
    this.usedLots.push(idx);
    this.lot = LOTS[idx];
    this.bids = {};
    this.phase = 'bidding';

    this.io.to(this.code).emit('auc_round', {
      round: this.currentRound, totalRounds: this.rounds,
      lotName: this.lot.name, hint: this.lot.hint,
      players: Object.values(this.room.players).map(p => ({ name: p.nickname, coins: p.score }))
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('auc_bid', { lotName: this.lot.name, hint: this.lot.hint, coins: this.room.players[id]?.score || 0 });
    });
    this.bidTimer = setTimeout(() => this.resolve(), 22000);
  }

  handleInput(playerId, data) {
    if (this.phase === 'bidding' && data.type === 'bid') {
      if (this.bids[playerId] !== undefined) return;
      const coins = this.room.players[playerId]?.score || 0;
      let bid = parseInt(data.amount, 10);
      if (isNaN(bid)) bid = 0;
      bid = Math.max(0, Math.min(bid, coins));
      this.bids[playerId] = bid;
      this.io.to(playerId).emit('auc_bid_locked', { amount: bid });
      const count = Object.keys(this.bids).length;
      const total = Object.keys(this.room.players).length;
      this.io.to(this.code).emit('auc_bid_count', { count, total });
      if (count >= total) { clearTimeout(this.bidTimer); setTimeout(() => this.resolve(), 700); }
    }
  }

  resolve() {
    if (this.phase === 'resolve') return;
    this.phase = 'resolve';
    // players who didn't bid = 0
    Object.keys(this.room.players).forEach(id => { if (this.bids[id] === undefined) this.bids[id] = 0; });

    // find highest bid; ties broken randomly among top bidders
    let maxBid = Math.max(0, ...Object.values(this.bids));
    const topBidders = Object.keys(this.bids).filter(id => this.bids[id] === maxBid && maxBid > 0);
    let winner = null;
    if (topBidders.length > 0) winner = topBidders[Math.floor(Math.random() * topBidders.length)];

    let profit = 0;
    if (winner) {
      const paid = this.bids[winner];
      profit = this.lot.value - paid;
      if (this.room.players[winner]) {
        // pay the bid, receive the value => net change is (value - paid)
        this.room.players[winner].score = Math.max(0, this.room.players[winner].score - paid + this.lot.value);
      }
    }

    const bidList = Object.keys(this.room.players).map(id => ({
      name: this.room.players[id]?.nickname, bid: this.bids[id],
      isWinner: id === winner, coins: this.room.players[id]?.score
    })).sort((a, b) => b.bid - a.bid);

    this.io.to(this.code).emit('auc_resolve', {
      lotName: this.lot.name, value: this.lot.value,
      winnerName: winner ? this.room.players[winner]?.nickname : null,
      paid: winner ? this.bids[winner] : 0, profit,
      bids: bidList, players: this.room.players
    });
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('auc_resolve_player', {
        won: id === winner, value: this.lot.value,
        paid: this.bids[id], profit: id === winner ? profit : 0,
        coins: this.room.players[id]?.score
      });
    });
    setTimeout(() => this.nextRound(), 6500);
  }

  showFinal() {
    const scores = Object.values(this.room.players)
      .map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
    Object.keys(this.room.players).forEach(id => {
      this.io.to(id).emit('final_scores', { scores, gameName: 'Auction' });
    });
    this.endGame(this.code, scores);
  }

  nextPhase() {
    if (this.phase === 'bidding') { clearTimeout(this.bidTimer); this.resolve(); }
  }
}

module.exports = Auction;
