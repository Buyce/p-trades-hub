import { describe, expect, it } from "vitest";
import {
  AppError,
  fromPostgrest,
  isAppError,
  redact,
  toAppError,
  userMessageOf,
} from "@/lib/ptrades/errors";

describe("AppError", () => {
  it("carries a code, a safe user message and structured detail", () => {
    const error = new AppError("FORBIDDEN", "row level security denied", { table: "signals" });
    expect(error.code).toBe("FORBIDDEN");
    expect(error.userMessage).toBe("You do not have access to this data.");
    expect(error.detail).toEqual({ table: "signals" });
    expect(isAppError(error)).toBe(true);
  });

  it("redacts credentials from messages", () => {
    const error = new AppError("UPSTREAM", "failed with Bearer abc.def.ghi token=xyz");
    expect(error.message).not.toContain("abc.def.ghi");
    expect(error.message).toContain("[redacted]");
    expect(redact("key sb_secret_abc123")).toBe("key [redacted]");
  });

  it("normalises unknown throws without losing the original text", () => {
    const error = toAppError(new Error("boom"), "DATA_SOURCE");
    expect(error.code).toBe("DATA_SOURCE");
    expect(error.message).toBe("boom");
    expect(toAppError("string failure").code).toBe("UNKNOWN");
  });

  it("returns the same instance when already an AppError", () => {
    const original = new AppError("NOT_FOUND", "missing");
    expect(toAppError(original)).toBe(original);
  });

  it("never leaks raw provider text to the user message", () => {
    expect(userMessageOf(new Error("PGRST: relation does not exist"))).toBe(
      "Something went wrong.",
    );
  });

  it("maps postgrest codes onto the shared shape", () => {
    expect(fromPostgrest({ message: "denied", code: "42501" }).code).toBe("FORBIDDEN");
    expect(fromPostgrest({ message: "no rows", code: "PGRST116" }).code).toBe("NOT_FOUND");
    expect(fromPostgrest({ message: "constraint", code: "23514" }).code).toBe("VALIDATION");
    expect(fromPostgrest({ message: "other", code: "08006" }).code).toBe("DATA_SOURCE");
  });
});
