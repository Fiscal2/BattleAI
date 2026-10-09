import { describe, expect, it } from "vitest";
import { resumeCursor } from "../../src/http/cursor.ts";

describe("SSE resume cursor", () => {
  it("resumes after the later initial or browser cursor", () => {
    expect(resumeCursor("1", "3")).toBe(3);
    expect(resumeCursor("5", "3")).toBe(5);
    expect(resumeCursor("0", undefined)).toBe(0);
    expect(resumeCursor(undefined, "8")).toBe(8);
  });

  it.each(["-1", "1.5", "NaN", "Infinity", "9007199254740992", ["2", "8"], {}])("ignores an invalid cursor %j", (invalid) => {
    expect(resumeCursor(invalid, "4")).toBe(4);
    expect(resumeCursor("4", invalid)).toBe(4);
    expect(resumeCursor(invalid, invalid)).toBe(0);
  });
});
