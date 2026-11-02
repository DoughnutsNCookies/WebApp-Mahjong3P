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
- **Timing:** a person has 40 s for a turn and 15 s for a claim; then the Normal bot moves for them
  (on a claim, it lets the tile go). Bots move after 1.15 s (turn) or 0.38 s (claim).
- **Dropping out:** after 10 s a Normal bot plays the seat; reconnecting (same browser) gives it back.
  Between rounds the table waits until everyone is back and has pressed Next round. The host can remove
  a disconnected player (their seat becomes a bot).
- **Rooms are temporary:** in memory only, closed an hour after the last person leaves, and all closed by a
  restart or a deploy.
- **Limits:** chat 200 characters, one message per 0.7 s; emoji up to 6 a second each; 500 rooms.

Code: `src/server/` (protocol, room, main), `src/ui/online/` (connection and screens).
Tests: `tests/room.test.ts` (whole games with a fake clock), `tests/seat.test.ts`.

## Running it locally

```
npm run build:server
PORT=3399 ALLOWED_ORIGINS=http://localhost:3000 npm run server
npm run dev     # then open http://localhost:3000/?server=ws://localhost:3399/ws
```

## The live server (CloudPanel)

One-time setup, in CloudPanel:

1. **Add Site > Create a Node.js Site**: domain (e.g. the game's domain with a `-live` prefix), the latest
   LTS Node.js, app port `3300`. Note the site user.
2. Add this PC's SSH key to the site user (as for the game site).
3. **DNS**: a proxied record for the domain, like the game's own. **SSL**: as for the game site.
4. On this PC, create `cloudpanel-live.json` in the repo folder (it is git-ignored):
   `{ "domain": "...", "user": "...", "appPort": 3300, "origins": "https://mahjong.schuahsolutions.com" }`
5. `bash scripts/deploy-live.sh`. It ends by fetching `https://<domain>/health`.

The game's address for the server is `LIVE_SERVER` in `src/ui/online/useRoom.ts`.

Later deploys: `bash scripts/deploy-live.sh` (closes open rooms; deploy when nobody is playing).
