## Lessons Learned

### 2026-02-20 - Match UI promises to implemented navigation
- Pattern: I discussed an in-app Agent Dashboard, but the app still only exposed `Admin Dashboard` in settings.
- Prevention Rule:
- Before claiming a UI entry exists, verify the actual component wiring in:
- `src/components/SettingsPanel.tsx`
- `src/App.tsx`
- If the entry does not exist yet, state it explicitly and patch wiring in the same change.

### 2026-02-20 - Treat persistence fallback as product policy, not implementation preference
- Pattern: I proposed Supabase persistence with an in-memory fallback, but user policy required no fallback.
- Prevention Rule:
- When user states a reliability/security policy (e.g., "no fallback"), enforce it as a hard startup requirement and fail fast with explicit env errors.

### 2026-02-20 - Integrate into existing UI structure when directed
- Pattern: I proposed replacing a changed Agent tab layout, but user requested keeping the existing tab structure and integrating within one tab.
- Prevention Rule:
- When UI structure is user-directed, preserve that structure and attach new functionality within it unless explicitly told to refactor.
