import { describe, expect, it, vi } from "vitest";
import { startInvitation } from "../../src/web/invitation.ts";
import { DocumentFixture } from "./dom.ts";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const doc = new DocumentFixture();
  const input = doc.mount("#match-link", "input") as ReturnType<DocumentFixture["mount"]> & { focus: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> };
  input.focus = vi.fn(); input.select = vi.fn();
  const button = doc.mount("#copy-match-link", "button"); button.hidden = true;
  const status = doc.mount("#copy-link-status", "p");
  return { doc, input, button, status };
}
describe("match invitation copying", () => {
  it("copies the exact match URL without any match mutation", async () => {
    const f = fixture(); const writeText = vi.fn().mockResolvedValue(undefined);
    startInvitation(f.doc.asDocument(), "https://example.test/matches/fixture", { writeText });
    expect(f.input.value).toBe("https://example.test/matches/fixture"); expect(f.button.hidden).toBe(false);
    f.button.click(); await flush();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(f.input.value);
    expect(f.status.textContent).toBe("Match link copied."); expect(f.button.disabled).toBe(false);
  });
  it.each([false, true])("selects a manual-copy fallback when clipboard is missing/rejected (%s)", async reject => {
    const f = fixture();
    startInvitation(f.doc.asDocument(), "https://example.test/matches/fixture", reject ? { writeText: vi.fn().mockRejectedValue(new Error("denied")) } : undefined);
    f.button.click(); await flush();
    expect(f.input.focus).toHaveBeenCalledOnce(); expect(f.input.select).toHaveBeenCalledOnce();
    expect(f.status.textContent).toContain("copy it manually"); expect(f.button.disabled).toBe(false);
  });
});
