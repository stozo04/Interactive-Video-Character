# Pull Request Template

## Summary

Describe the problem and fix in 2--5 bullets:

-   **Problem:** Plugin loading in tests needed a non-jiti path for JS
    ESM entrypoints.
-   **Why it matters:** Test reliability on newer Node runtimes and
    maintainability of plugin loader behavior.
-   **What changed:** Added `loadOpenClawPluginsAsync` (native ESM
    import for JS entrypoints) and DRY'd shared sync/async
    setup/finalization via shared helpers.
-   **What did NOT change (scope boundary):** Default sync loader
    behavior remains; no production-facing API surface changes outside
    plugin loader internals; no e2e fixture/test/doc files are included
    in this PR branch.

------------------------------------------------------------------------

## Change Type (select all)

-   [ ] Bug fix\
-   [ ] Feature\
-   [ ] Refactor

## Scope (select all touched areas)

-   [ ] Gateway / orchestration

## Linked Issue/PR

-   Closes \#\
-   Related \#

------------------------------------------------------------------------

## User-visible / Behavior Changes

-   None for end users.
-   Test/runtime internals: new async plugin loader path is available
    for test harnesses.

------------------------------------------------------------------------

## Security Impact (required)

-   New permissions/capabilities? (No)\
-   Secrets/tokens handling changed? (No)\
-   New/changed network calls? (No)\
-   Command/tool execution surface changed? (No)\
-   Data access scope changed? (No)

If any **Yes**, explain risk + mitigation:

------------------------------------------------------------------------

## Repro + Verification

### Environment

-   OS: macOS\
-   Runtime/container: Node 25.6.0 (local)\
-   Model/provider: N/A\
-   Integration/channel (if any): N/A\
-   Relevant config (redacted): N/A

### Steps

``` bash
direnv exec . pnpm vitest run src/plugins/hooks.phase-hooks.test.ts src/plugins/wired-hooks-message.test.ts
```

-   Confirm branch diff vs upstream/main touches only plugin loader
    internals.
-   Verify async loader path exists and shared DRY helpers are used by
    both loaders.

### Expected

-   Targeted plugin loader tests pass.
-   Sync and async loaders share common setup/finalization logic.
-   Async loader uses native ESM import for JS entrypoints.

### Actual

-   Matches expected.

### Evidence (attach at least one)

-   [ ] Failing test/log before + passing after\
-   [ ] Trace/log snippets

------------------------------------------------------------------------

## Human Verification (required)

**What you personally verified (not just CI), and how:**\
- Verified scenarios: targeted tests for plugin hook loading/message
flow. - Edge cases checked: async loader rejects TS entrypoints and
loads JS via native ESM import path.

**What you did not verify:**\
- Full `pnpm test` (workspace has unrelated optional extension
dependency failures/OOM outside this scope).

------------------------------------------------------------------------

## Compatibility / Migration

-   Backward compatible? (Yes)\
-   Config/env changes? (No)\
-   Migration needed? (No)

If yes, exact upgrade steps:

------------------------------------------------------------------------

## Failure Recovery (if this breaks)

-   How to disable/revert this change quickly: revert commits on
    `pr/load-openclaw-plugins-async`.
-   Files/config to restore:\
    `/Volumes/devel/openclaw-work/openclaw/codex-ikentic-plugin-test-scaffolding/src/plugins/loader.ts`
-   Known bad symptoms reviewers should watch for: plugin load
    regressions in tests relying on sync loader defaults.

------------------------------------------------------------------------

## Risks and Mitigations

-   **Risk:** Async loader path diverges from sync behavior over time.\
-   **Mitigation:** Shared helper refactor centralizes common
    setup/finalization logic used by both loaders.
