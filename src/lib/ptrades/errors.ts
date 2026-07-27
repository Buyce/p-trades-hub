/**
 * One error shape for the whole application.
 *
 * Every failure that crosses a boundary (database read, server function,
 * market-data adapter) is normalised into an AppError so screens can render a
 * safe message and logs keep the machine-readable code. Raw provider errors are
 * never shown to the user and never carry credentials.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "DATA_SOURCE"
  | "UPSTREAM"
  | "CONFIG"
  | "UNKNOWN";

const USER_MESSAGE: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: "You are signed out. Sign in again to continue.",
  FORBIDDEN: "You do not have access to this data.",
  NOT_FOUND: "That record is not available.",
  VALIDATION: "That input is not valid.",
  DATA_SOURCE: "The database could not be reached.",
  UPSTREAM: "The market data provider could not be reached.",
  CONFIG: "The service is not configured correctly.",
  UNKNOWN: "Something went wrong.",
};

/** Tokens that must never appear in a message surfaced to the browser. */
const REDACT = /(sb_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]{20,}|Bearer\s+\S+|token=\S+)/gi;

export function redact(message: string): string {
  return message.replace(REDACT, "[redacted]");
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail: Record<string, unknown>;
  readonly userMessage: string;

  constructor(
    code: AppErrorCode,
    message: string,
    detail: Record<string, unknown> = {},
    options: { userMessage?: string; cause?: unknown } = {},
  ) {
    super(redact(message), { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
    this.userMessage = options.userMessage ?? USER_MESSAGE[code];
  }

  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Normalises anything thrown into an AppError without losing the original text. */
export function toAppError(
  error: unknown,
  fallbackCode: AppErrorCode = "UNKNOWN",
  detail: Record<string, unknown> = {},
): AppError {
  if (isAppError(error)) return error;
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  return new AppError(fallbackCode, message, detail, { cause: error });
}

/** The string a screen may render. Never the raw provider text. */
export function userMessageOf(error: unknown): string {
  return isAppError(error) ? error.userMessage : USER_MESSAGE.UNKNOWN;
}

/** Maps a PostgREST/Supabase error onto the shared shape. */
export function fromPostgrest(
  error: { message: string; code?: string | null; details?: string | null },
  detail: Record<string, unknown> = {},
): AppError {
  const pgCode = error.code ?? "";
  let code: AppErrorCode = "DATA_SOURCE";
  if (pgCode === "42501" || pgCode === "PGRST301") code = "FORBIDDEN";
  else if (pgCode === "PGRST116") code = "NOT_FOUND";
  else if (pgCode.startsWith("23")) code = "VALIDATION";
  return new AppError(code, error.message, { pg_code: pgCode || null, ...detail });
}
