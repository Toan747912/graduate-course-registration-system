# Batch 4 — Quản lý giảng viên hướng dẫn và luận văn (Thesis Advisor Management)

> Written alongside the implementation (retroactive design record, not a pre-code speculative doc) to document the schema/RPC/route decisions actually shipped in migrations 0028-0038, `apps/api/src/routes/theses.ts`, `apps/api/src/schemas/theses.ts`, and the staff/student thesis UI. Supersedes the Batch 5 sketch in `docs/ACADEMIC_MANAGEMENT_EXPANSION_DESIGN.md` section C.6/C.7/H.2 (that sketch used a simpler `NOT_STARTED/IN_PROGRESS/COMPLETED/CANCELLED` status enum and a "no login" advisor catalog with `email`/`title` columns; the actual Batch 4 status enum and advisor columns are richer, per the task's authoritative business-rule set).

## A. Status model

`theses.status`: `PENDING_APPROVAL -> APPROVED -> IN_PROGRESS -> COMPLETED`, with `REJECTED` (from `PENDING_APPROVAL`) and `CANCELLED` (from `APPROVED`/`IN_PROGRESS`) as side branches. No other transitions exist.

"Active" statuses (one per student, at most): `PENDING_APPROVAL`, `APPROVED`, `IN_PROGRESS`. Enforced twice — a partial unique index (`theses_one_active_per_student`, DB-level, race-safe) and a pre-check inside `student_create_thesis_proposal` (clear Vietnamese error message before the unique-violation fallback fires).

## B. Data model (migrations 0028-0032)

- `research_areas` (0028): `name` unique, `description`, `is_active`, `created_by`/`updated_by`. No hard delete.
- `advisors` (0029): `advisor_code` unique, `full_name`, `specialization`, `max_active_theses` (check > 0), `is_active`. No login, no FK to `auth.users`/`profiles`.
- `theses` (0030): one row is both the proposal and, once approved, the thesis. `thesis_code` (unique, `LV-YYYY-XXXX`, immutable), `research_area_id`, `advisor_id` (nullable until assignment), full status/reason/timestamp columns for every transition. `thesis_code_counters` backs atomic per-year code generation.
- `advisors_block_deactivate_when_in_progress` trigger (0031): DB-level guard, ships after `theses` exists since it needs to query it.
- `thesis_advisor_history` (0032): append-only assignment/reassignment log.

## C. Concurrency

- **thesis_code**: `insert into thesis_code_counters (year, last_seq) values (year, 1) on conflict (year) do update set last_seq = last_seq + 1 returning last_seq`. The `ON CONFLICT ... DO UPDATE` acquires a row lock on the `(year)` counter row; concurrent callers for the same year serialize on that lock, so two callers can never observe/return the same `last_seq`. No read-then-max, no client-supplied code, no retry loop needed for the counter itself (a `unique_violation` on `theses.thesis_code` would only occur from an unrelated concurrent-active-thesis race, handled by the same exception block that reports "already have an active thesis").
- **advisor capacity**: `staff_assign_advisor`/`staff_change_advisor` both `select ... from advisors where id = p_advisor_id for update` before recounting `IN_PROGRESS` theses for that advisor and comparing against `max_active_theses`. The row lock means a second concurrent assignment against the same advisor blocks until the first transaction commits/rolls back, so capacity cannot be overrun by two simultaneous requests landing on the last open slot.
- **advisor deactivation vs. in-progress theses**: enforced by the `advisors_block_deactivate_when_in_progress` trigger (0031), which fires on every `UPDATE` of `advisors.is_active` regardless of caller (RPC, service role, or a future direct write) — this is the actual enforcing layer per the task's requirement; `staff_deactivate_advisor` (0034) is a UX pre-check only, not the source of truth.

## D. Security / ACL

Every RPC: `security definer`, `set search_path = pg_catalog, public`, explicit `auth.uid()`/`is_training_staff()` check inside the body, `revoke all ... from public`, `revoke all ... from anon` (explicit, not inherited from the public revoke), `grant execute ... to authenticated` only. This is the Batch 3 lesson (`docs/BATCH_3_PRE_APPLY_SECURITY_REVIEW.md` section 8.2/8.3): Supabase's `ALTER DEFAULT PRIVILEGES` grants EXECUTE to `anon`/`authenticated` directly at function-creation time, bypassing the `PUBLIC` pseudo-role, so `revoke ... from public` alone is not sufficient. Migration 0038 re-asserts every grant as an idempotent final sweep. The one internal helper/trigger function (`advisors_block_deactivate_when_in_progress`) is revoked from `public`, `anon`, **and** `authenticated`, and never granted — matching the `_student_grades_rows`/`_student_progress` convention from Batch 3.

RLS (0033) exists for SELECT visibility and to guarantee no other write path exists; it is not the enforcement layer for business rules (that's the RPCs). Students: SELECT own theses only, SELECT ACTIVE research areas only (for the picker), no SELECT on `advisors` at all (advisor name is only ever exposed through the SECURITY DEFINER RPC responses).

## E. API surface

Mounted at `/api` via `thesesRouter` (`apps/api/src/routes/theses.ts`), sub-scoped with `requireRole('TRAINING_STAFF')` under `/staff/*` and `requireRole('STUDENT')` under `/student/*`; `/research-areas` (active list) requires only `requireAuth`. Every write proxies straight to an RPC — no direct table writes from the route layer. RPC errors and business-rule rejections are surfaced as generic or RPC-supplied Vietnamese messages only; raw Postgres/PostgREST `error.message` is never forwarded to the client (fixed during this batch's review — see the implementation report for the specific lines corrected).
