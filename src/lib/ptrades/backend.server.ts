/**
 * Server-only bridge to the external P-Trades FastAPI backend.
 * The base URL and token are read here and NEVER reach the browser.
 */

export type BackendResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_configured" | "unreachable" | "error"; message: string };

function config() {
  const baseUrl = process.env.P_TRADES_API_BASE_URL;
  const token = process.env.P_TRADES_API_TOKEN;
  return { baseUrl, token };
}

export async function callBackend<T>(path: string, init?: RequestInit): Promise<BackendResult<T>> {
  const { baseUrl, token } = config();
  if (!baseUrl) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Backend API base URL is not configured.",
    };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        reason: "error",
        message: `Backend responded ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return {
      ok: false,
      reason: "unreachable",
      message: error instanceof Error ? error.message : "Backend unreachable",
    };
  }
}
