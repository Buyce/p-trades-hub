import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("alert pipeline architecture", () => {
  it("keeps notification delivery out of the precision request", () => {
    const precisionRoute = source("src/routes/api/public/hooks/scan-precision.ts");
    expect(precisionRoute).not.toContain("drainNotificationOutbox");
    expect(precisionRoute).not.toContain("notification-outbox.server");
    expect(precisionRoute).not.toContain("verifyNotificationChannels");
  });

  it("has an independent durable delivery endpoint", () => {
    const deliveryRoute = source("src/routes/api/public/hooks/deliver-alerts.ts");
    expect(deliveryRoute).toContain("drainNotificationOutbox");
    expect(deliveryRoute).toContain("verifyNotificationChannels");
    expect(deliveryRoute).toContain('source: "ALERT_DELIVERY"');
  });

  it("recovers stranded live alerts and schedules all four jobs", () => {
    const migration = source("supabase/migrations/20260805120000_runtime_pipeline_recovery.sql");
    expect(migration).toContain("enqueue_entry_ready_notification");
    expect(migration).toContain("CREATE TRIGGER enqueue_entry_ready_notification");
    expect(migration).toContain("signal.lifecycle_state = 'ENTRY_READY'");
    expect(migration).toContain("NOT EXISTS");
    expect(migration).toContain("ptrades-sync-market-data");
    expect(migration).toContain("ptrades-scan-context");
    expect(migration).toContain("ptrades-scan-precision");
    expect(migration).toContain("ptrades-deliver-alerts");
  });

  it("reconstructs the runtime schedule from an existing authenticated job", () => {
    const migration = source("supabase/migrations/20260805120000_runtime_pipeline_recovery.sql");
    expect(migration).toContain("template_command");
    expect(migration).toContain("job.active IS TRUE");
    expect(migration).toContain("regexp_replace");
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).not.toContain("project--");
    expect(migration).not.toContain("sb_publishable_");
  });

  it("fails context health when every symbol has stale or missing candles", () => {
    const contextScanner = source("src/lib/ptrades/scanner/run.server.ts");
    expect(contextScanner).toContain("DATA_AVAILABILITY_GATES");
    expect(contextScanner).toContain("data_unavailable_symbols");
    expect(contextScanner).toContain("fresh_symbols");
    expect(contextScanner).toContain('status: runDegraded ? "DEGRADED" : "OK"');
  });
});
