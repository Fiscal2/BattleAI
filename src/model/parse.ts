export function parseAction(content: unknown): unknown | null {
  if (typeof content !== "string") return null;
  const direct = readObject(content.trim());
  if (direct) return direct;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return readObject(content.slice(start, end + 1));
}

function readObject(text: string): unknown | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return null;
  } catch {
    return null;
  }
}
