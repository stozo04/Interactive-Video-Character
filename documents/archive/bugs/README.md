# Archived Bug Reports

This directory contains **resolved** bug reports for historical reference.

## Purpose

When a bug is:
- ✅ Fixed and tested
- ✅ Merged to main
- ✅ Documented in feature docs

...the original bug report is moved here for historical reference.

## Why Archive?

1. **Preserve history** - Track what problems existed and how they were solved
2. **Prevent confusion** - Keep active bugs separate from resolved ones
3. **Learning resource** - Reference for similar future issues
4. **Documentation** - Complete record of system evolution

## Archived Bugs

| Bug | Reported | Resolved | Resolution | Feature Doc |
|-----|----------|----------|------------|-------------|
| IDLE_THOUGHTS_NOT_TRIGGERED.md | 2025-12-29 | 2025-12-29 | Background scheduler implemented | [Idle_Thoughts_System.md](../../features/Idle_Thoughts_System.md) |
| IDLE_THOUGHTS_DATABASE_FIXES.md | 2025-12-29 | 2025-12-29 | INTEGER→NUMERIC, upsert logic | [Idle_Thoughts_System.md](../../features/Idle_Thoughts_System.md) |
| IMAGE_PROMPT_CONTRADICTION.md | 2026-01-05 | 2026-01-05 | Context-aware phone visibility | [Selfie_Generation.md](../../features/Selfie_Generation.md) |

## Archive Process

1. **Fix the bug** - Implement solution, test thoroughly
2. **Document in feature** - Add to comprehensive feature documentation
3. **Update bug report** - Mark as RESOLVED with link to feature doc
4. **Move to archive** - `mv docs/bugs/BUG.md docs/archive/bugs/`
5. **Update this README** - Add entry to table above

## Related Directories

- **`docs/bugs/`** - Active bug reports (unresolved)
- **`docs/features/`** - Complete feature documentation
- **`docs/plans/`** - Implementation plans
