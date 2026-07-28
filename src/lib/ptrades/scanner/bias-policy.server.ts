import type { Bias, GateResult, Rulebook } from "./types";
import type { SetupResult } from "./setups.server";
import { gate } from "./gates.server";

/**
 * Bias policy.
 *
 * The old behaviour was a single hard equality: higher-timeframe bias must equal
 * the setup direction, or the setup is dead. That rejected the entire reversal
 * half of the rulebook — a liquidity sweep reversal is BY DEFINITION taken
 * against the prevailing higher-timeframe bias, and so is a change of
 * character. In production this gate alone rejected every candidate that
 * reached it.
 *
 * The replacement is explicit and stored:
 *   ALIGNED            — direction matches the H4 bias.
 *   NEUTRAL_BIAS       — no H4 bias; nothing to conflict with.
 *   REVERSAL_ALLOWED   — counter-bias, but the family is a recognised reversal
 *                        (liquidity sweep, or a change of character break).
 *   COUNTER_TREND_BLOCKED — counter-bias continuation. Still rejected.
 */

export type BiasPolicyName =
  | "ALIGNED"
  | "NEUTRAL_BIAS"
  | "REVERSAL_ALLOWED"
  | "COUNTER_TREND_BLOCKED";

export type BiasDecision = {
  policy: BiasPolicyName;
  passed: boolean;
  reason: string;
  /** Whether the direction agrees with the H4 bias — the scoring input. */
  aligned: boolean;
  bias: Bias;
  d1: Bias;
  direction: "LONG" | "SHORT" | null;
};

/** Families whose whole premise is trading against the prevailing bias. */
export function isReversalSetup(setup: {
  setupType: string;
  sweepFound: boolean;
  structureType: "BOS" | "CHOCH" | null;
}): boolean {
  if (setup.setupType === "SWEEP_DISPLACEMENT_RETEST" && setup.sweepFound) return true;
  return setup.structureType === "CHOCH";
}

export function evaluateBiasPolicy(args: {
  setup: Pick<SetupResult, "setupType" | "sweepFound" | "structureType" | "direction">;
  direction: "LONG" | "SHORT" | null;
  bias: Bias;
  d1: Bias;
  rulebook?: Rulebook;
}): BiasDecision {
  const { setup, direction, bias, d1 } = args;
  const allowReversals = args.rulebook?.bias_policy?.allow_reversals ?? true;
  const allowNeutral = args.rulebook?.bias_policy?.allow_neutral ?? true;
  const aligned = direction !== null && bias === direction;

  if (direction === null) {
    return {
      policy: "COUNTER_TREND_BLOCKED",
      passed: false,
      reason: "No setup direction, so bias eligibility cannot be assessed.",
      aligned: false,
      bias,
      d1,
      direction,
    };
  }

  if (aligned) {
    return {
      policy: "ALIGNED",
      passed: true,
      reason: `Higher-timeframe bias (${bias}) agrees with the ${direction} setup.`,
      aligned: true,
      bias,
      d1,
      direction,
    };
  }

  if (bias === "NEUTRAL") {
    return {
      policy: "NEUTRAL_BIAS",
      passed: allowNeutral,
      reason: allowNeutral
        ? `Higher timeframe has no directional bias, so a ${direction} setup is judged on structure alone.`
        : "Higher timeframe has no directional bias and neutral trading is disabled.",
      aligned: false,
      bias,
      d1,
      direction,
    };
  }

  if (allowReversals && isReversalSetup(setup)) {
    return {
      policy: "REVERSAL_ALLOWED",
      passed: true,
      reason: `Counter-bias ${direction} allowed: ${
        setup.structureType === "CHOCH"
          ? "a change of character broke the prevailing structure"
          : "a liquidity sweep reversal is a counter-bias setup by definition"
      } (H4 bias ${bias}).`,
      aligned: false,
      bias,
      d1,
      direction,
    };
  }

  return {
    policy: "COUNTER_TREND_BLOCKED",
    passed: false,
    reason: `Higher-timeframe bias is ${bias} and a ${direction} ${setup.setupType} is a continuation setup against it.`,
    aligned: false,
    bias,
    d1,
    direction,
  };
}

/** The stored gate row for a bias decision. */
export function biasPolicyGate(decision: BiasDecision): GateResult {
  return gate("BIAS_CONFLICT", decision.passed, decision.reason, {
    policy: decision.policy,
    bias: decision.bias,
    d1_bias: decision.d1,
    direction: decision.direction,
    aligned: decision.aligned,
  });
}
