import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app.ts";
import { openStore } from "../../src/store/db.ts";

describe("join", () => {
  it("rejects a signed-out coach and a join while the model is unset", async () => {
    const store = openStore(":memory:");
    const app = createApp({
      store,
      env: {},
      complete: async () => ({ error: "unset" }),
    });
    const ada = store.createCoach({ email: "ada@example.com", displayName: "Ada", passwordHash: "x" });
    const match = store.createMatch(ada.id, "fleet");
    const signedOut = await app.inject({ method: "POST", url: `/matches/${match.id}/join` });
    expect(signedOut.statusCode).toBe(401);
    const session = store.createSession(ada.id);
    const own = await app.inject({
      method: "POST",
      url: `/matches/${match.id}/join`,
      headers: { cookie: `session=${session}` },
    });
    expect(own.statusCode).toBe(409);
    expect(store.getMatch(match.id)?.status).toBe("waiting");
    expect(store.seats(match.id)).toHaveLength(1);
    await app.close();
    store.close();
  });
});
