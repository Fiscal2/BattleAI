export function actionsEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.ships)) {
      const ships = record.ships.map((ship) => {
        const row = ship as { length?: unknown; cells?: unknown };
        const cells = Array.isArray(row.cells) ? [...row.cells].map(String).sort() : [];
        return { length: row.length, cells };
      });
      ships.sort((left, right) => {
        const length = Number(left.length) - Number(right.length);
        if (length !== 0) return length;
        return left.cells.join(",").localeCompare(right.cells.join(","));
      });
      return canonicalize({ ...record, ships });
    }
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
