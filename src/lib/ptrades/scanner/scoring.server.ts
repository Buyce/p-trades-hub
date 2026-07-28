/**
 * Server-side entry point for scoring. The implementation lives in the
 * client-safe `scoring.ts` so governance diagnostics (tier reachability) can
 * reuse the exact same weights the scanner runs on, with no duplication.
 */
export * from "./scoring";
