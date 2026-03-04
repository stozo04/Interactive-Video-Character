# Lessons Learned — Tidy Agent & Windows Process Spawning — 2026-03-04

## Windows Process Spawning

- **Do not spawn `.cmd` files directly without a shell on Node 18.14+.**
  CVE-2024-27980 broke direct `.cmd` spawning. `spawn("claude.cmd", args)` throws `EINVAL`.
  Fix: use the full `.exe` path or `{ shell: true }` (which routes through cmd.exe).

- **`{ shell: "bash" }` cannot run `.cmd` batch files.**
  Git Bash doesn't know about Windows batch wrappers. If you pass `shell: "bash"`,
  bash will not find `claude.cmd` and will throw exit code 127.

- **Embedded newlines in spawn args throw `EINVAL` on Windows.**
  `CreateProcess` does not support newline characters in argument strings.
  Keep all CLI boot args as single-line strings — no `\n` anywhere in the value.

- **Claude Code on this machine is a standalone `.exe`, not an npm package.**
  Path: `C:\Users\gates\AppData\Roaming\Claude\claude-code\2.1.34\claude.exe`
  Do not assume `claude.cmd` exists in the npm global bin. Verify install method first.
  For portability, prefer an env var (`CLAUDE_BIN`) over a hardcoded path.

- **The correct spawn pattern for any Claude-based agent on this machine:**
  ```typescript
  const claudeBin = process.platform === "win32"
    ? "C:\\Users\\gates\\AppData\\Roaming\\Claude\\claude-code\\2.1.34\\claude.exe"
    : "claude";

  child = spawn(claudeBin, args, {
    cwd: workPath,
    stdio: ["ignore", "pipe", "pipe"],
    // No shell option needed — .exe spawns directly via CreateProcess
  });
  ```

## VS Code Buffer Conflicts

- **When Claude edits a file that VS Code has open, VS Code may overwrite the changes.**
  VS Code shows an "externally modified" notification on the tab. If the user dismisses it
  or doesn't see it, VS Code writes its stale buffer to disk on the next Ctrl+S — wiping
  the edit entirely. This can loop indefinitely and looks like the file "keeps reverting."

- **The fix is to commit immediately after any important file edit.**
  Once a change is in git, VS Code's buffer conflict is obvious (the file shows as `M`
  in source control). The user can `git restore` to recover the committed version.
  Commit early, commit often — especially for infrastructure files like `cronScheduler.ts`.

- **Ask the user to close the tab before editing a critical file.**
  If `cronScheduler.ts` or another large config file is open in VS Code, close it before
  making edits. Reopen after the edit lands and tsx watch has restarted.

## Cron Scheduler — Handler Registration

- **New action types require two things in `cronScheduler.ts`:**
  1. Import the handler function at the top of the file.
  2. Register it in the `JOB_HANDLERS` object with the correct `action_type` key.
  If either is missing, the job runs but fails with `Unknown action_type: <type>`.

- **The `promise_mirror` entry in JOB_HANDLERS originally had no trailing comma.**
  Adding a new handler after it without adding the comma causes a TypeScript parse error.
  Always check for a missing comma when inserting into an object literal.

## Agent Design

- **New agents don't need all of Opey's complexity.**
  Tidy is a thin orchestrator (~120 lines) vs Opey's 440+. No self-healing,
  no clarification rounds, no OpenAI fallback. Match complexity to the job.

- **`processedFiles` set outperforms an integer cursor for file rotation.**
  An integer cursor drifts when files are added or deleted between runs.
  A set of relative paths filters already-processed files regardless of index shifts.
  Reset the set when all files are processed — the loop starts over naturally.

- **Separate souls prevent personality bleed between agents.**
  Tidy has his own SOUL.md. Without it, an agent inherits Opey's ambition and
  will attempt large refactors instead of mechanical transforms.
