export function insertAtCursor(
  value: string,
  insert: string,
  start: number,
  end: number
): { value: string; cursor: number } {
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  return { value: next, cursor: start + insert.length };
}

export function buildCommandPreview(key: string, mode: string, message: string): string {
  const safeKey = key || "<KEY>";
  const safeMode = mode || "say";
  const escaped = message.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `bind "${safeKey}" "${safeMode} \"${escaped}\""`;
}

export function normalizeSearch(input: string): string {
  return input.trim().toLowerCase();
}

