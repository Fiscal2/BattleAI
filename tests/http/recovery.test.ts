import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/http/app.ts";
import { openStore } from "../../src/store/db.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const boot = (html: string) => JSON.parse(html.match(/<script id="boot" type="application\/json">(.*?)<\/script>/s)![1]);

describe("request-triggered runner recovery", () => {
  it("resumes a stopped match once across concurrent requests without replaying committed actions", async () => {
    const store = openStore(":memory:");
    const env = { MODEL_BASE_URL: "http://not-contacted", MODEL_API_KEY: "fixture", MODEL_NAME: "fixture" };
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const app = createApp({ store, env, complete: async () => {
      calls++;
      if (calls === 1) throw new Error("sensitive provider details must remain private");
      if (calls === 2) { await gate; return { content: '{"cell":"r1c1"}' }; }
      return { error: "fixture" };
    } });
    const log = vi.spyOn(app.log, "error");
    try {
      expect(app.log.level).toBe("error");
      const a = store.createCoach({ email: "a@example.test", displayName: "A", passwordHash: "fixture" });
      const b = store.createCoach({ email: "b@example.test", displayName: "B", passwordHash: "fixture" });
      const m = store.createMatch(a.id, "tictactoe");
      const cookie = `session=${store.createSession(b.id)}`;
      await app.inject({ method: "POST", url: `/matches/${m.id}/join`, headers: { cookie } });
      await flush();
      expect(calls).toBe(1);
      expect(log).toHaveBeenCalledExactlyOnceWith({ matchId: m.id }, "Match runner stopped; refresh to retry.");
      expect(store.getMatch(m.id)?.status).toBe("active");
      const responses = await Promise.all([app.inject(`/matches/${m.id}`), app.inject(`/matches/${m.id}`)]);
      expect(calls).toBe(2);
      expect(responses.every(response => boot(response.body).runner === "running")).toBe(true);
      expect(responses.every(response => !response.body.includes("sensitive provider details"))).toBe(true);
      release(); await flush(); await flush();
      expect(store.parsedEvents(m.id).filter(event => event.type === "action").map(event => event.payload.action)).toEqual([{ cell: "r1c1" }]);
      expect(store.getMatch(m.id)?.status).toBe("finished");
    } finally { release(); await flush(); await app.close(); store.close(); }
  });

  it("keeps an unconfigured active match paused without invoking a model or forfeiting", async () => {
    const store = openStore(":memory:");
    let calls = 0;
    const app = createApp({ store, env: {}, complete: async () => { calls++; return { error: "fixture" }; } });
    try {
      const a = store.createCoach({ email: "a@example.test", displayName: "A", passwordHash: "fixture" });
      const b = store.createCoach({ email: "b@example.test", displayName: "B", passwordHash: "fixture" });
      const m = store.createMatch(a.id, "tictactoe"); store.joinMatch(m.id, b.id);
      const response = await app.inject(`/matches/${m.id}`);
      expect(boot(response.body).runner).toBe("unconfigured");
      expect(calls).toBe(0);
      expect(store.getMatch(m.id)?.status).toBe("active");
      expect(store.events(m.id).filter(event => event.type === "result")).toHaveLength(0);
    } finally { await app.close(); store.close(); }
  });
});
