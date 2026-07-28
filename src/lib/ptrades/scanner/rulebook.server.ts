/**
 * Rulebook governance helpers.
 *
 * Every scan records the checksum of the exact rulebook it evaluated against,
 * so a stored signal can always be traced back to the rules that produced it.
 * The canonical serialisation sorts object keys so that a semantically
 * identical rulebook always hashes to the same value.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 of the canonical rulebook JSON, lowercase hex. Never throws. */
export async function rulebookChecksum(rules: unknown): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(canonicalJson(rules));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (error) {
    console.error("rulebook checksum failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
