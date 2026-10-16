import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat, type ChatMessage } from "../../src/model/client.ts";
import { playTurn } from "../../src/match/runner.ts";
import { games } from "../../src/rules/index.ts";
import { openStore } from "../../src/store/db.ts";

const env = { baseUrl: "https://model.invalid/v1", apiKey: "test", model: "test" };
const stores: ReturnType<typeof openStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.useRealTimers();
});

function activeMatch() {
  const store = openStore(":memory:");
  stores.push(store);
  const ada = store.createCoach({ email: "ada@example.com", displayName: "Ada", passwordHash: "x" });
  const bea = store.createCoach({ email: "bea@example.com", displayName: "Bea", passwordHash: "x" });
  const match = store.createMatch(ada.id, "tictactoe");
  store.joinMatch(match.id, bea.id);
  return { store, matchId: match.id, game: games.tictactoe };
}

describe("model client to turn runner", () => {
  it.each([null, 42, {}, [], undefined].map((content) => ({ content })))("forfeits on the third unreadable content: $content", async ({ content }) => {
    const input = activeMatch();
    let calls = 0;
    const complete = (messages: ChatMessage[]) => completeChat(env, messages, 1000, async () => {
      calls += 1;
      return Response.json({ choices: [{ message: { content } }] });
    });

    expect(await playTurn({ ...input, complete })).toBe("finished");
    expect(calls).toBe(3);
    expect(input.store.getMatch(input.matchId)).toMatchObject({
      result: "forfeit", forfeit_cause: "invalid_action",
    });
    expect(input.store.parsedEvents(input.matchId).filter((event) => event.type === "action")).toHaveLength(0);
  });

  it.each(["HTTP", "network", "sync throw", "malformed JSON", "timeout"])("forfeits on the second provider failure: %s", async (failure) => {
    vi.useFakeTimers();
    const input = activeMatch();
    let calls = 0;
    const fetchImpl: typeof fetch = (_url, options) => {
      calls += 1;
      if (failure === "sync throw") throw new Error("fetch failed");
      if (failure === "network") return Promise.reject(new Error("network"));
      if (failure === "HTTP") return Promise.resolve(new Response("unavailable", { status: 503 }));
      if (failure === "malformed JSON") return Promise.resolve(new Response("{"));
      return new Promise((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(new Error("abort")), { once: true });
      });
    };
    const pending = playTurn({ ...input, complete: (messages) => completeChat(env, messages, 1000, fetchImpl) });
    await vi.runAllTimersAsync();
    expect(await pending).toBe("finished");
    expect(calls).toBe(2);
    expect(input.store.getMatch(input.matchId)).toMatchObject({ result: "forfeit", forfeit_cause: "model_error" });
    expect(input.store.parsedEvents(input.matchId).filter((event) => event.type === "action")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { replies: [null, 503, "not JSON", null], cause: "invalid_action" },
    { replies: [null, 503, '{"cell":"r9c9"}', 503], cause: "model_error" },
  ])("keeps mixed failure budgets independent: $cause", async ({ replies, cause }) => {
    const input = activeMatch();
    let calls = 0;
    const complete = (messages: ChatMessage[]) => completeChat(env, messages, 1000, async () => {
      const content = replies[calls++];
      return content === 503 ? new Response(null, { status: 503 }) : Response.json({ choices: [{ message: { content } }] });
    });
    expect(await playTurn({ ...input, complete })).toBe("finished");
    expect(calls).toBe(4);
    expect(input.store.getMatch(input.matchId)?.forfeit_cause).toBe(cause);
  });

  it("accepts a legal reply after both allowed retry budgets and resets both on the next turn", async () => {
    const input = activeMatch();
    const replies = [null, 503, '{"cell":"r9c9"}', '{"cell":"r1c1"}', null, 503, "not JSON", '{"cell":"r2c1"}'];
    const requests: ChatMessage[][] = [];
    const complete = (messages: ChatMessage[]) => completeChat(env, messages, 1000, async (_url, options) => {
      requests.push(JSON.parse(options!.body as string).messages);
      const content = replies[requests.length - 1];
      return content === 503 ? new Response(null, { status: 503 }) : Response.json({ choices: [{ message: { content } }] });
    });

    expect(await playTurn({ ...input, complete })).toBe("continue");
    expect(await playTurn({ ...input, complete })).toBe("continue");
    expect(requests).toHaveLength(8);
    expect(requests.map((messages) => messages.length)).toEqual([2, 4, 4, 6, 2, 4, 4, 6]);
    expect(requests.flat().every((message) => typeof message.content === "string")).toBe(true);
    expect(input.store.getMatch(input.matchId)?.status).toBe("active");
    expect(input.store.parsedEvents(input.matchId).filter((event) => event.type === "action").map((event) => event.payload.action))
      .toEqual([{ cell: "r1c1" }, { cell: "r2c1" }]);
  });
});
