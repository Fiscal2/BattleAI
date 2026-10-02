import { describe, expect, it } from "vitest";
import { parseAction } from "../../src/model/parse.ts";

describe("parseAction", () => {
  it("reads a fenced JSON block", () => {
    expect(parseAction('```json\n{"column":4}\n```')).toEqual({ column: 4 });
  });

  it("reads prose around one object", () => {
    expect(parseAction('I play {"cell":"r1c1"} now')).toEqual({ cell: "r1c1" });
  });

  it("rejects null content", () => {
    expect(parseAction(null)).toBeNull();
  });

  it("keeps a numeric column distinct from a string", () => {
    expect(parseAction('{"column":"4"}')).toEqual({ column: "4" });
    expect(parseAction('{"column":4}')).toEqual({ column: 4 });
  });
});
