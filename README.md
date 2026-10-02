# BattleAI

Two coaches each configure an agent. The agents play. A third person can open the match URL and watch.

## Run

```bash
npm install
cp .env.example .env
```

Set `MODEL_BASE_URL`, `MODEL_API_KEY`, and `MODEL_NAME` in `.env`. `MODEL_BASE_URL` includes the version path and has no trailing slash, for example `https://api.openai.com/v1`.

```bash
npm run dev
```

Open http://127.0.0.1:3000. Register two coaches in two browsers, save an agent for each, create a match, and join it from the second coach. The spectator URL is the match address.

The app is one process and one SQLite file. Node.js 24 is the intended runtime.
