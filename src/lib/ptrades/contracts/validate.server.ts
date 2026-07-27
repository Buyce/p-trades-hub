/**
 * Contract validation.
 *
 * The JSON Schemas under `contracts/` are the single source of truth shared
 * with the Python reference engine. This module is the only place that
 * compiles them, so TypeScript and Python can never drift silently.
 *
 * Validation is fail-closed: an invalid payload throws rather than being
 * coerced, trimmed or partially accepted.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import candleSchema from "../../../../contracts/candle.schema.json";
import marketSnapshotSchema from "../../../../contracts/market-snapshot.schema.json";
import rulebookSchema from "../../../../contracts/rulebook.schema.json";
import macroEventSchema from "../../../../contracts/macro-event.schema.json";
import candidateSchema from "../../../../contracts/candidate.schema.json";
import signalSchema from "../../../../contracts/signal.schema.json";
import scannerResultSchema from "../../../../contracts/scanner-result.schema.json";
import tradeSchema from "../../../../contracts/trade.schema.json";

export const CONTRACT_SCHEMAS = {
  candle: candleSchema,
  marketSnapshot: marketSnapshotSchema,
  rulebook: rulebookSchema,
  macroEvent: macroEventSchema,
  candidate: candidateSchema,
  signal: signalSchema,
  scannerResult: scannerResultSchema,
  trade: tradeSchema,
} as const;

export type ContractName = keyof typeof CONTRACT_SCHEMAS;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const schema of Object.values(CONTRACT_SCHEMAS)) {
  ajv.addSchema(schema as object);
}

const compiled = new Map<ContractName, ValidateFunction>();

function validator(name: ContractName): ValidateFunction {
  const existing = compiled.get(name);
  if (existing) return existing;
  const fn = ajv.compile(CONTRACT_SCHEMAS[name] as object);
  compiled.set(name, fn);
  return fn;
}

export type ContractIssue = { path: string; message: string };

function toIssues(errors: ErrorObject[] | null | undefined): ContractIssue[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "invalid",
  }));
}

/** Non-throwing check. Returns the issues so a caller can record them. */
export function checkContract(
  name: ContractName,
  payload: unknown,
): { valid: boolean; issues: ContractIssue[] } {
  const validate = validator(name);
  const valid = validate(payload) as boolean;
  return { valid, issues: valid ? [] : toIssues(validate.errors) };
}

export class ContractViolationError extends Error {
  readonly contract: ContractName;
  readonly issues: ContractIssue[];

  constructor(contract: ContractName, issues: ContractIssue[]) {
    super(
      `Contract "${contract}" violated: ` +
        issues.map((i) => `${i.path} ${i.message}`).join("; "),
    );
    this.name = "ContractViolationError";
    this.contract = contract;
    this.issues = issues;
  }
}

/** Fail-closed check. Returns the payload typed on success, throws otherwise. */
export function assertContract<T>(name: ContractName, payload: unknown): T {
  const { valid, issues } = checkContract(name, payload);
  if (!valid) throw new ContractViolationError(name, issues);
  return payload as T;
}
