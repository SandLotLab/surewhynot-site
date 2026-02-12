# Social Studio (Integrated MVP)

This folder extends the existing surewhynot project with an implementable Social Studio module.

## What is implemented now

### Core chat + presence (Build Order #1)
- WebSocket server at `/ws`
- REST routes:
  - `POST /api/chat/send`
  - `GET /api/chat/history`
  - `GET /api/chat/presence`
- Presence heartbeat window: active within last 2 minutes
- Chat rooms (`lobby` + room names)
- Premium-gated private rooms via `private-*` naming

### XP system (Build Order #2)
- `+10` XP first login per day
- `+1` XP per message
- XP tracked as total + daily

### Daily puzzle module (Build Order #3)
- Shared puzzle by day with routes:
  - `GET /api/puzzle/today`
  - `POST /api/puzzle/submit`
  - `GET /api/puzzle/state`
- `+5` XP on solve (once/day)

### Business tools placeholders (Build Order #4)
- `POST /api/tools/pdf/merge`
- `POST /api/tools/pdf/compress`
- `POST /api/tools/invoice`
- `POST /api/tools/share`
- Free tier limits enforced for size/expiry/daily usage
- Premium limits modeled and returned

### Other requested items included
- Anonymous auth + persistent UUID + editable display name
- No email required, no tracking scripts
- Daily + global leaderboard endpoints
- Spotify embed + current track metadata helper route
- Stripe subscription placeholder route
- Theme support with premium-gated themes

## Persistence note
Current MVP persists state to local JSON (`social-studio/server/data/state.json`) so data survives server restart during development.

## Run

### Backend
```bash
cd social-studio/server
npm install
npm run dev
```

### Frontend
```bash
cd social-studio/client
npm install
npm run dev
```

If backend is not on localhost:8787, set `VITE_API_BASE`.

## API list
- `POST /api/auth/anonymous`
- `POST /api/auth/display-name`
- `POST /api/auth/theme`
- `POST /api/chat/room`
- `POST /api/chat/send`
- `GET /api/chat/history`
- `GET /api/chat/presence`
- `GET /api/leaderboard/daily`
- `GET /api/leaderboard/global`
- `GET /api/puzzle/today`
- `POST /api/puzzle/submit`
- `GET /api/puzzle/state`
- `POST /api/tools/pdf/merge`
- `POST /api/tools/pdf/compress`
- `POST /api/tools/invoice`
- `POST /api/tools/share`
- `GET /api/music/current`
- `GET /api/subscription/stripe-placeholder`
- `GET /api/health`
