# SKILL — Deploy Checklist (Docker/VM, Both Environments, App+DB Rollback)

## Purpose
Generate a clear, step-by-step deployment checklist tailored to this repo, with:
- `environment`: **both** (staging + production)
- `deploy_target`: **Docker/VM**
- `rollback_style`: **App + DB rollback**

This skill is for producing operational checklists and runbooks. It does **not** execute deployments.

## When to use
Use this skill when the user asks for:
- a deploy checklist / release runbook
- a preflight list for staging/prod
- rollback steps (application + database)
- Docker/VM deployment guidance for this app

## Defaults (chosen)
- **Environment:** both (staging + production)
- **Deploy target:** Docker/VM
- **Rollback style:** App + DB rollback

If the user specifies different values, follow the user.

## Hard rules (must follow)
- Do not run any commands with side effects unless explicitly approved.
- Read-only inspection is allowed (e.g., `rg`, `ls`, `cat`, `git diff`, `git log`).
- Do not read sensitive files (e.g., `.env*`, `*secret*`, `*token*`, `*key*`, `*credentials*`) unless explicitly approved.
- Prefer concrete, copy/pasteable commands, but label them as “proposed” unless approved to run.

## Workflow
1) **Inspect (read-only)**
   - Look for: `README.md`, `package.json`, `vite.config.*`, `docker*`, `compose*`, `nginx*`, CI config, and any `deploy*` docs.
   - Identify:
     - build command(s)
     - runtime entry (static assets vs server)
     - env vars expected at runtime
     - DB migration tool (if any) and where migrations live

2) **Clarify only if needed**
   Ask at most 3 questions if any of these are unknown and materially affect correctness:
   - Where is the Dockerfile / compose file used in prod?
   - What is the database (Postgres/Supabase/etc) and how are migrations applied?
   - What is the hosting shape: single VM, multiple VMs, or orchestration (systemd, compose, k8s)?

3) **Produce the checklist**
   Use `templates/deploy_checklist.template.md` and fill in:
   - staging checklist
   - production checklist
   - smoke tests
   - monitoring/alerts verification
   - rollback plan (app + DB) with explicit decision points

4) **Add repo-specific notes**
   - Mention exact scripts from `package.json` (e.g., `npm run build`, `npm test`).
   - Call out Vite-specific constraints (static build artifacts; runtime env injection considerations).
   - If Supabase migrations exist, include explicit migration/rollback notes.

## Output contract
Return a single Markdown document (or a sectioned response) with:
- **Preflight (common)**
- **Staging deploy**
- **Production deploy**
- **Post-deploy validation**
- **Rollback (App + DB)**
- **Appendix: commands (proposed)**

Use checkboxes (`- [ ]`) and short, unambiguous steps.

## Files in this skill
- `skills/deploy-checklist/templates/deploy_checklist.template.md`
- `skills/deploy-checklist/templates/rollback_app_db.template.md`

