import { readFileSync } from "node:fs";
import { completeChat, modelEnv } from "./model/client.js";
import { createApp } from "./http/app.js";
import { openStore } from "./store/db.js";

loadEnv(".env");

const env = process.env;
const store = openStore(env.DATABASE_PATH || "data/battleai.sqlite");
const app = createApp({
  store,
  env,
  complete: (messages) => {
    const model = modelEnv(env);
    if (!model) return Promise.resolve({ error: "model is not configured" });
    return completeChat(model, messages);
  },
});

const port = Number(env.PORT || 3000);
await app.listen({ port, host: "127.0.0.1" });

function loadEnv(path: string) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index);
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(index + 1);
  }
}
