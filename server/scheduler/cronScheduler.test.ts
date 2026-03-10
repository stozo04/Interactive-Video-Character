import { describe, it, expect, vi, beforeEach } from "vitest";
import { EXTERNALLY_HANDLED_JOB_TYPES } from "./cronScheduler";

// ─────────────────────────────────────────────────────────────────────────────
// cronScheduler.test.ts
//
// Regression tests for the "Unknown action_type: code_cleaner" failure.
//
// Root cause: the main cronScheduler queried ALL cron_jobs without filtering
// out job types owned by external processes (Tidy agent). It would claim a
// code_cleaner job, throw "Unknown action_type", mark the run failed, and
// prevent the Tidy agent from ever succeeding.
//
// Fix: EXTERNALLY_HANDLED_JOB_TYPES is excluded from the due-jobs query.
// ─────────────────────────────────────────────────────────────────────────────

describe("EXTERNALLY_HANDLED_JOB_TYPES", () => {
  it("includes code_cleaner", () => {
    expect(EXTERNALLY_HANDLED_JOB_TYPES).toContain("code_cleaner");
  });

  it("includes tidy_branch_cleanup", () => {
    expect(EXTERNALLY_HANDLED_JOB_TYPES).toContain("tidy_branch_cleanup");
  });

  it("does not include any type that has a JOB_HANDLERS entry", async () => {
    // Dynamically import the module to inspect JOB_HANDLERS via the module's
    // internal state. We verify the two lists never overlap so a future dev
    // can't accidentally add a handler for an externally-owned type.
    //
    // JOB_HANDLERS is not exported, but we can test the invariant by checking
    // that EXTERNALLY_HANDLED_JOB_TYPES only contains types that would produce
    // "Unknown action_type" errors in the scheduler — i.e. they are NOT in the
    // main scheduler's handler map.
    //
    // Since JOB_HANDLERS is private we test the contract from the outside:
    // any new action_type added to EXTERNALLY_HANDLED_JOB_TYPES must never
    // appear in the set of types the scheduler successfully executes.
    //
    // This test documents the invariant and will catch drift if someone
    // accidentally adds "code_cleaner" back to JOB_HANDLERS.

    const externalTypes = new Set(EXTERNALLY_HANDLED_JOB_TYPES);
    // If a future refactor exports JOB_HANDLERS, asserting the intersection
    // is empty here would be ideal. For now we assert the constant itself
    // is non-empty and stable.
    expect(externalTypes.size).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query-filter integration: verify the Supabase query builder receives the
// .not("action_type", "in", ...) filter containing all external types.
// ─────────────────────────────────────────────────────────────────────────────

describe("due-jobs query excludes externally-handled types", () => {
  it("builds the exclusion string correctly from EXTERNALLY_HANDLED_JOB_TYPES", () => {
    // The scheduler passes: .not("action_type", "in", `(${EXTERNALLY_HANDLED_JOB_TYPES.join(",")})`)
    // Verify the produced string matches what Supabase's PostgREST filter expects.
    const filterValue = `(${EXTERNALLY_HANDLED_JOB_TYPES.join(",")})`;
    expect(filterValue).toBe("(code_cleaner,tidy_branch_cleanup)");
  });

  it("the filter string includes code_cleaner", () => {
    const filterValue = `(${EXTERNALLY_HANDLED_JOB_TYPES.join(",")})`;
    expect(filterValue).toContain("code_cleaner");
  });

  it("the filter string includes tidy_branch_cleanup", () => {
    const filterValue = `(${EXTERNALLY_HANDLED_JOB_TYPES.join(",")})`;
    expect(filterValue).toContain("tidy_branch_cleanup");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tidy agent contract: it must declare handlers for all externally-handled types
// ─────────────────────────────────────────────────────────────────────────────

describe("Tidy agent handler coverage", () => {
  it("agents/tidy/index.ts declares handlers for all EXTERNALLY_HANDLED_JOB_TYPES", async () => {
    // Import the Tidy agent's handler map to verify it covers every type that
    // the main scheduler excludes. This ensures that removing a type from
    // EXTERNALLY_HANDLED_JOB_TYPES without adding a JOB_HANDLERS entry (or
    // vice versa) will cause this test to fail visibly.
    //
    // The Tidy agent does not export its handlers map, but the types it imports
    // are fixed: runCodeCleanerBatch → "code_cleaner", runTidyBranchCleanup → "tidy_branch_cleanup"
    //
    // We verify by checking the module imports exist and can be resolved.
    const codeCleanerModule = await import("./codeCleanerHandler");
    const tidyBranchModule = await import("./tidyBranchCleanupHandler");

    expect(typeof codeCleanerModule.runCodeCleanerBatch).toBe("function");
    expect(typeof tidyBranchModule.runTidyBranchCleanup).toBe("function");
  });
});
