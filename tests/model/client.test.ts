import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat } from "../../src/model/client.ts";

const env = { baseUrl: "https://model.invalid/v1", apiKey: "test", model: "test" };
afterEach(() => vi.useRealTimers());

describe("completeChat failures", () => {
  it("reports malformed provider JSON as a response error rather than a timeout", async () => {
    const result = await completeChat(env, [], 1000, async () => new Response("{broken"));
    expect(result).toEqual({ error: "invalid response JSON", category: "provider" });
  });

  it("handles a synchronous fetch throw as a provider failure", async () => {
    vi.useFakeTimers();
    const result = await completeChat(env, [], 1000, () => { throw new Error("private provider detail"); });
    expect(result).toEqual({ error: "request failed", category: "provider" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("distinguishes a rejected request from the configured timeout", async () => {
    expect(await completeChat(env, [], 1000, async () => { throw new Error("network"); }))
      .toEqual({ error: "request failed", category: "provider" });
  });

  it("aborts a timed out request and clears the timer", async () => {
    vi.useFakeTimers();
    const pending = completeChat(env, [], 1000, async (_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ error: "timeout", category: "provider" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
