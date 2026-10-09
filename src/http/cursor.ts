/** EventSource retains Last-Event-ID while the initial URL's cursor stays fixed. */
export function resumeCursor(query: unknown, header: unknown): number {
  const read = (value: unknown) => {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
    const cursor = Number(value);
    return Number.isSafeInteger(cursor) ? cursor : 0;
  };
  return Math.max(read(query), read(header));
}
