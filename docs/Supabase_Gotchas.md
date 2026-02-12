# Supabase Gotchas

Short list of recurring pitfalls and how to avoid them.

## 1) Avoid `.single()` When Rows Might Be Missing
- `.single()` throws if zero rows are returned.
- Use `.maybeSingle()` for optional rows, or `select().limit(1)` and handle `data === null`.

## 2) RLS Can Make “Existing” Rows Look Missing
- If row-level security is enabled and policy blocks access, you’ll see empty results.
- Always confirm RLS policies if queries “randomly” return nothing.

## 3) UTC vs Local Time
- Decide on a clear convention per table.
- Date buckets should be explicit (UTC date vs local timezone).
- Write it down in the feature doc to avoid confusion later.

## 4) Upsert + Read-After-Write
- Upsert can fail silently if RLS blocks it.
- If a row is required, log the result and handle missing rows gracefully.

## 5) Indexes for Date Lookups
- Any frequent date-range query should have an index on the date column.
- Use `order()` with `gte`/`lte` for month retrievals.
