# Multiplayer

Private rooms: the host creates a room and shares its 4-digit code or link; friends join; the host fills
empty seats with bots (Easy, Normal or AI v2) and starts. Chat and emoji at the table.

## How it works

- **The server is the only place the real round exists** (`src/server/room.ts`). Each person is sent
  `seatView()` of it (`src/engine/seat.ts`): the round relabelled so they are player 0, with the other hands,
  the wall, the seed, the others' claim options and passes, and their draws removed. Once a round ends,
  everything is shown and the seed is shared, so the review, replay and saved hand work as in Quick play.
  Tested: a seat's view never changes when hidden tiles change (`tests/seat.test.ts`).
- **Moves** arrive as the player sees the table (player 0) and are checked against the real round.
- **Bots** run on the server; AI v2 uses the same weights as the web game.
- **Timing:** a person has 40 s for a turn and 15 s for a claim, starting again after every move anyone makes; then the Normal bot moves for them
  (on a claim, it lets the tile go). Bots move after 1.15 s (turn) or 0.38 s (claim).
- **Dropping out:** after 10 s a Normal bot plays the seat; reconnecting (same browser) gives it back.
  Between rounds the table waits until everyone is back and has pressed Next round. The host can remove
  a disconnected player (their seat becomes a bot).
- **Rooms are temporary:** in memory only, and all closed by a restart or a deploy. A room closes as soon as
  its last person leaves. If everyone is disconnected instead, play stops (the bots never play on alone) and
  the room closes after 1 minute unless someone comes back; anyone returning later is told it closed.
- **Limits:** chat 200 characters, one message per 0.7 s; emoji up to 6 a second each; 500 rooms.

Code: `src/server/` (protocol, room, main), `src/ui/online/` (connection and screens).
Tests: `tests/room.test.ts` (whole games with a fake clock), `tests/seat.test.ts`.

## One server for the game and the rooms

`mahjong.schuahsolutions.com` is a CloudPanel **Node.js site**: one Node process (`src/server/main.ts`) serves
the game's pages (the `out/` folder of `npm run build`, deployed as `site/`) and runs the rooms at `/ws`.
Next's fingerprinted files and the AI's weights are cached for a year; pages are checked every time, so a
deploy shows at once. Paths can't leave the site folder.

## Running it locally

```
npm run build && npm run build:server
PORT=3399 STATIC_DIR=out ALLOWED_ORIGINS=http://localhost:3399 npm run server   # then open http://localhost:3399/
node scripts/multiplayer-check.mjs <screenshot folder>                         # two browsers, one room
```

## Deploying

`bash scripts/deploy-live.sh` (Git Bash) builds the game and the server, uploads both, swaps the game's files in
at once, and restarts the server only if its code changed (rooms are in memory, so a server change closes
open rooms; a game-only update doesn't). It reads `cloudpanel-live.json`, which is git-ignored:
`{ "domain": "mahjong.schuahsolutions.com", "user": "<site SSH user>", "appPort": 3500 }`.

One-time setup in CloudPanel: a Node.js site for the domain with app port 3500, this PC's SSH key on the site
user, SSL as for any site. The address the game uses for rooms is its own (`wss://<domain>/ws`).