import { describe, expect, it } from "vitest";
import { checkExecutionStall } from "../watchdog.server";

/**
 * The watchdog exists because a silent execution stall is indistinguishable
 * from a quiet market. These tests pin the three states that matter.
 */

type Row = { armed_at: string; entry_ready_at: string | null; symbol: string; state: string };

function fakeAdmin(watches: Row[], recentAlerts: number) {
  const inserted: Array<{ table: string; payload: unknown }> = [];
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        gte: () => builder,
        limit: () => {
          if (table === "precision_watches") return Promise.resolve({ data: watches });
          if (table === "audit_log")
            return Promise.resolve({ data: Array.from({ length: recentAlerts }, () => ({ id: "x" })) });
          return Promise.resolve({ data: [] });
        },
        insert: (payload: unknown) => {
          inserted.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
        },
      };
      // user_roles is read without .limit()
      if (table === "user_roles") {
        return {
          select: () => ({ in: () => Promise.resolve({ data: [{ user_id: "u1", role: "owner" }] }) }),
        } as never;
      }
      return builder as never;
    },
  };
  return { admin: admin as never, inserted };
}

const now = new Date("2026-07-28T18:00:00Z");
const long = "2026-07-28T09:00:00Z"; // 9 hours armed
const short = "2026-07-28T17:30:00Z";

describe("execution watchdog", () => {
  it("stays quiet when nothing has been armed", async () => {
    const { admin, inserted } = fakeAdmin([], 0);
    const result = await checkExecutionStall(admin, { now });
    expect(result).toMatchObject({ armed: 0, stalled: false, alerted: false });
    expect(inserted).toHaveLength(0);
  });

  it("stays quiet while an armed setup is still young", async () => {
    const { admin } = fakeAdmin(
      [{ armed_at: short, entry_ready_at: null, symbol: "EURUSD", state: "ARMED" }],
      0,
    );
    expect((await checkExecutionStall(admin, { now })).stalled).toBe(false);
  });

  it("stays quiet when at least one setup reached entry-ready", async () => {
    const { admin } = fakeAdmin(
      [{ armed_at: long, entry_ready_at: "2026-07-28T10:00:00Z", symbol: "EURUSD", state: "ARMED" }],
      0,
    );
    const result = await checkExecutionStall(admin, { now });
    expect(result.entryReady).toBe(1);
    expect(result.stalled).toBe(false);
  });

  it("alerts once when setups arm all day and none becomes tradable", async () => {
    const { admin, inserted } = fakeAdmin(
      [{ armed_at: long, entry_ready_at: null, symbol: "EURUSD", state: "ARMED" }],
      0,
    );
    const result = await checkExecutionStall(admin, { now });
    expect(result).toMatchObject({ stalled: true, alerted: true });
    expect(inserted.map((i) => i.table)).toEqual(["audit_log", "notifications"]);
  });

  it("respects the cooldown and does not alert twice", async () => {
    const { admin, inserted } = fakeAdmin(
      [{ armed_at: long, entry_ready_at: null, symbol: "EURUSD", state: "ARMED" }],
      1,
    );
    const result = await checkExecutionStall(admin, { now });
    expect(result).toMatchObject({ stalled: true, alerted: false });
    expect(inserted).toHaveLength(0);
  });
});
