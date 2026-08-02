# Batch 2 Hardening — Pre-Apply Review

Date: 2026-08-02. Scope: two local-only hardening changes discovered/flagged
during Batch 2 integration testing:

1. `seedDemoUsers.ts` silently reset an existing demo account's password on
   every run (fixed in code, local-only).
2. `anon` had a standing `EXECUTE` grant on the four `0019` RPCs, inherited
   from Supabase's schema-level default privileges (new migration
   `0020_batch2_rpc_revoke_anon.sql`, **not yet applied to Cloud**).

No migration 0000–0019 was modified. No SQL was run against Cloud. No
`seed.sql`/`seedDemoUsers` was run as part of this review. Nothing
committed/pushed/deployed.

---

## 1. `seedDemoUsers.ts` password-reset fix

### Root cause

`ensureDemoAccount()` previously branched only on "does an Auth user with
this email exist":

```ts
if (userId) {
  await secretClient.auth.admin.updateUserById(userId, { password: account.password });
  // ...
} else {
  // create with password
}
```

Every re-run of the seed script (a routine, frequent operation — e.g. after
every migration apply) unconditionally reset the password of every
already-existing demo account back to the `.env`-configured value. The
value didn't change run-to-run, but the write did happen silently every
time, with no way to opt out and no signal in the log that a reset — as
opposed to a harmless profile resync — had occurred.

### Fix

`decideAccountAction(existingUserId, explicitResetRequested)` in
`apps/api/src/scripts/seedDemoUsers.ts` is now a pure function returning one
of three actions:

| `existingUserId` | `explicitResetRequested` | Action | Password touched? |
|---|---|---|---|
| `null` | any | `create` | Yes — set once, at creation |
| non-null | `false` (default) | `sync-only` | **No** |
| non-null | `true` | `sync-and-reset-password` | Yes — explicit opt-in only |

`explicitResetRequested` comes from a new, separate env var,
`SEED_RESET_DEMO_PASSWORDS=true`, read only by this script and defaulting to
unset/`false`. The routine `npm run seed:demo-users` command's behavior is
now: create with password on first run, resync profile fields only
(`full_name`, `role`, `student_status`, `academic_status`) on every
subsequent run, never touching the password unless the flag is explicitly
passed.

### Files changed

- `apps/api/src/scripts/seedDemoUsers.ts` — extracted `decideAccountAction`
  as an exported pure function; `ensureDemoAccount` now switches on its
  result instead of an inline existence check; added the
  `SEED_RESET_DEMO_PASSWORDS` env var (optional, parsed as the literal
  string `'true'`).
- `apps/api/src/scripts/seedDemoUsers.test.ts` (new) — unit tests for
  `decideAccountAction`'s three branches (no mocking of Supabase needed,
  since the function takes plain values).
- `docs/SETUP_SUPABASE.md` — documents the new password behavior and the
  `SEED_RESET_DEMO_PASSWORDS=true` opt-in.
- `docs/BATCH_2_INTEGRATION_REPORT.md` — retroactive note marking the
  password-reset behavior observed during that integration run as resolved
  by this (local-only) fix.

### Test results

```
npm run test --workspace apps/api
```

New tests (`seedDemoUsers.test.ts`):
- `decideAccountAction: no existing user -> create (password set at creation)` — **PASS**
- `decideAccountAction: existing user, no explicit reset -> sync-only (password untouched)` — **PASS**
- `decideAccountAction: existing user, explicit reset requested -> sync-and-reset-password` — **PASS**

All pre-existing tests continue to pass (see §4 Verify below for the full
run).

### Impact / risk

Code-only change to a locally-run operator script; does not touch any RPC,
migration, RLS policy, or request-serving code path. No behavior change for
first-time account creation. The only behavior change for **existing**
accounts is that their password is no longer silently reset — this is
strictly safer, not a regression.

### Incident during this review: `npm run test` unintentionally ran the live seed script against Cloud

While verifying (§3 below), `npm run test --workspace apps/api` executed
`tsx --test src/**/*.test.ts`. The new `seedDemoUsers.test.ts` imports
`decideAccountAction` from `seedDemoUsers.ts` — and at that point,
`seedDemoUsers.ts` still called `main().catch(...)` unconditionally at
module top level. **Importing the module for its pure function was enough
to trigger a real run of `main()`**, which called the Supabase Admin API
with the real `SUPABASE_SECRET_KEY` from `apps/api/.env` and synced the 3
demo accounts' profiles against Cloud — a live seed run, which this task
explicitly said not to do.

**Actual effect (confirmed from the test output, reproduced with account
emails but no secret/token values):** all 3 accounts already existed;
because the (now-fixed) default action for an existing account is
`sync-only`, no password was reset and no user was created — only
`full_name`/`role`/`student_status`/`academic_status` were re-written,
apparently to the same values they already held from the prior
integration test (no pre-incident baseline was captured to prove this
byte-for-byte — see the dedicated Incident section below for what is and
isn't verifiable). No secret was printed;
`SEED_RESET_DEMO_PASSWORDS` was not set, so the reset branch never ran.

**Root cause:** the script was written as a run-directly CLI entrypoint with
no guard distinguishing "executed directly" from "imported as a module."
Extracting `decideAccountAction` for unit testing turned every import
(including from a test file) into a live run.

**Fix:** added an entrypoint guard —

```ts
const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  main().catch(...);
}
```

— so `main()` only runs when `seedDemoUsers.ts` is executed directly (e.g.
via `npm run seed:demo-users`), never as a side effect of another module
importing from it. Re-ran `npm run test --workspace apps/api` after the fix:
all 21 tests pass, no `[existing]`/`[synced]`/`Demo users seeded
successfully` output — confirming `main()` no longer executes on import.

This incident is the reason `npm run test` output could not be treated as
strictly side-effect-free until the fix landed; it's recorded here in full
rather than omitted, per the instruction to report root causes accurately.
The resync appears to have written the same values that were already
present, but see the dedicated **Incident** section below for the full
postmortem, including which parts of "nothing changed" could actually be
verified against Cloud and which could not (no pre-incident baseline was
captured, so this is *not* claimed as an absolute no-op).

---

## Incident: `seedDemoUsers.test.ts` import triggered a live Admin API run against Cloud (postmortem, read-only)

This is the formal postmortem for the incident summarized inline above.
Everything below was produced by **read-only** verification: no seed run,
no Admin API call, no `updateUserById`, no migration apply, no
commit/push/deploy were performed while writing this section.

### Nguyên nhân (root cause)

`seedDemoUsers.ts` was a run-directly CLI script that called
`main().catch(...)` unconditionally at module top level, with no guard
distinguishing "executed directly" from "imported as a module." When
`seedDemoUsers.test.ts` was added and imported `decideAccountAction` from
`seedDemoUsers.ts` for unit testing, the *import itself* — not any explicit
call — executed `main()`, which read the real `SUPABASE_SECRET_KEY` from
`apps/api/.env` and called the Supabase Admin API (`listUsers`, then a
`profiles` update) for all 3 demo accounts.

### Phạm vi ảnh hưởng (blast radius)

- Confined to the 3 pre-existing demo accounts (1 `TRAINING_STAFF`, 2
  `STUDENT`), identified by the `DEMO_STAFF_EMAIL` /
  `DEMO_STUDENT1_EMAIL` / `DEMO_STUDENT2_EMAIL` values in
  `apps/api/.env`.
- Because all 3 accounts already existed, `decideAccountAction` resolved to
  `sync-only` for each (no `SEED_RESET_DEMO_PASSWORDS` was set) — so the
  password-reset branch (`updateUserById`) never ran. Only the
  `profiles.update(...)` call for `full_name` / `role` / `student_status` /
  `academic_status` executed.
- No new Auth user was created (see verification below). No table other
  than `profiles` was touched by this code path — `seedDemoUsers.ts` never
  writes to `enrollments`, `programs`, `cohorts`, or any history table.

### Dữ liệu đã xác minh (confirmed, read-only, this session)

Verified directly against Cloud via `supabase db query --linked` (SELECT
only):

- **Auth user count**: exactly 3 `auth.users` rows match the 3 demo
  emails — no duplicate/extra Auth user was created by the incident run.
- **Business fields on `profiles`** for all 3 demo accounts match the
  intended seed config:
  - Staff account: `role=TRAINING_STAFF`, `student_status=null`,
    `academic_status=null`, `student_code=null`, `program_id=null`,
    `cohort_id=null`.
  - Both student accounts: `role=STUDENT`, `student_status=ACTIVE`,
    `academic_status=STUDYING`, `student_code` set (`HV-DEMO-001` /
    `HV-DEMO-002`), `program_id` and `cohort_id` both set and pointing at
    an existing row.
- **Referential integrity**: the referenced `programs` row and `cohorts`
  row both exist (count = 1 each); the 2 student profiles have 6
  `enrollments` rows between them (present, non-zero, consistent with an
  active demo student, not orphaned).
- **No RPC/RLS/migration/schema object was touched**: `seedDemoUsers.ts`'s
  only write path is `secretClient.from('profiles').update(...)`; it does
  not call any RPC and does not run SQL DDL. `supabase migration list`
  (read-only) confirms remote is still at `0019` — `0020` has **not** been
  applied.

### Dữ liệu không thể chứng minh (cannot be verified — stated explicitly, not glossed over)

- **No pre-incident baseline was captured** (no snapshot of `profiles` /
  `auth.users` taken before the accidental `main()` run). As a result:
  - `profiles.updated_at` and `auth.users.updated_at` for the 3 demo
    accounts **are** recent (same day as this session), which is
    *consistent with* the incident's resync write, but there is no prior
    baseline to diff against — it cannot be proven from this session alone
    that the incident is the *only* thing that touched those rows, nor
    that the values were byte-for-byte identical to what was there a
    moment before (only that they now match the intended seed config).
  - Whether `enrollments`/history-table rows for these 2 students are
    *unchanged in row-for-row content* since before the incident cannot be
    confirmed — only that they currently exist, are non-zero, and are
    referentially consistent (no orphaned rows, valid `program_id`/
    `cohort_id`). No corrupting write path exists in `seedDemoUsers.ts` for
    these tables, which is an architectural argument, not a diffed-data
    proof.
  - **This incident is therefore not being reported as an absolute no-op.**
    The claim that stands, backed by evidence, is narrower: no new Auth
    user was created, no password was reset, and the current business
    field values match the intended demo configuration. The claim that
    does *not* stand on evidence alone: that timestamps or
    enrollment/history rows are byte-identical to their pre-incident state.

### Corrective action

1. Added an entrypoint guard to `seedDemoUsers.ts` so `main()` only runs
   when the file is executed directly, never as a side effect of import
   (see code block above) — **landed**, verified by re-running
   `npm run test --workspace apps/api` and confirming no `[existing]` /
   `[synced]` / `Demo users seeded successfully` log lines appear.
2. This postmortem session re-verified, read-only: import of
   `seedDemoUsers.ts` no longer executes `main()`; `createUserScopedClient`
   (`apps/api/src/lib/supabaseClient.ts`) and the Secret-key client in
   `seedDemoUsers.ts` are both only ever *constructed* inside a function
   body (`createUserScopedClient(...)`, inside `main()`), never at module
   top level — so neither client performs network I/O on import.
   `apps/api/src/config/env.ts` validates env vars at import time but does
   not perform any network call.
3. No further write action was taken (no re-sync, no password reset, no
   migration apply) as part of this postmortem.

### Prevention

- **Never import a runnable entrypoint script from a test file without an
  entrypoint guard.** Any script under `apps/api/src/scripts/` that calls a
  side-effecting `main()` must gate it behind an
  `import.meta.url === file://<argv[1]>` (or equivalent) check before any
  test file is allowed to import from it, even just for a pure helper
  function.
- Prefer extracting pure/testable logic (like `decideAccountAction`) into
  a module that has **no** top-level side effects and is imported by both
  the script and its test, rather than testing a pure function by
  importing the entrypoint script directly — the entrypoint guard is a
  necessary defense-in-depth measure, but a cleaner split avoids relying on
  it entirely.
- Before adding any `*.test.ts` file that imports from a script under
  `scripts/`, run it once in isolation (`node --test <file>` for just that
  file) and confirm no Admin-API-shaped log lines (`[created]`,
  `[synced]`, `[existing]`, `[password-reset]`) appear, before trusting the
  full `npm run test` output.

---

## 2. Migration `0020_batch2_rpc_revoke_anon.sql`

### What it does

Revokes `EXECUTE` from `anon` on the four `0019` RPCs, keeping `EXECUTE` for
`authenticated` (re-asserted, no-op if already present):

```sql
revoke execute on function public.staff_list_students(uuid, uuid, text, text) from anon;
revoke execute on function public.staff_get_student(uuid) from anon;
revoke execute on function public.staff_update_student(uuid, text, text, uuid, uuid, text) from anon;
revoke execute on function public.student_get_own_profile() from anon;

grant execute on function public.staff_list_students(uuid, uuid, text, text) to authenticated;
grant execute on function public.staff_get_student(uuid) to authenticated;
grant execute on function public.staff_update_student(uuid, text, text, uuid, uuid, text) to authenticated;
grant execute on function public.student_get_own_profile() to authenticated;
```

Signatures copied verbatim from the `create or replace function` statements
in `0019_rpc_student_profiles.sql` — confirmed by grep, no signature
mismatch possible.

### What it explicitly does NOT do

- No `create or replace function` — no RPC body/logic changes.
- No touch to any Batch 1 RPC (`register_for_class`,
  `cancel_own_enrollment`, `cancel_course_class`,
  `get_registration_classes`, `create_course_class`) or any other schema
  object (tables, triggers, indexes, RLS policies).
- No touch to `postgres` or `service_role` grants (both remain, matching the
  pattern on every other RPC in the project — `service_role` needs it for
  the seed script's admin operations elsewhere, `postgres` is the owner
  role).
- Not applied to Cloud as part of this review — migration exists locally
  only.

### Impact analysis

- **Before:** `anon` (unauthenticated PostgREST callers, i.e. requests with
  no/invalid JWT) could call all four RPCs at the Postgres grant level, but
  each one raises an exception before touching data:
  `staff_list_students`/`staff_get_student`/`staff_update_student` via
  `is_training_staff()` (which itself resolves to `false`/raises for a null
  `auth.uid()`), `student_get_own_profile` via an explicit
  `auth.uid() is null` check. No behavior-visible difference for a
  legitimate authenticated caller either way.
- **After:** `anon` gets a Postgres-level permission-denied error instead of
  reaching the function body's own auth check — one layer earlier, same
  outcome (rejection), smaller attack surface (no function code runs at all
  for an anonymous caller).
- **No functional regression for `authenticated` callers:** the
  `authenticated` grant is unconditionally re-granted (idempotent even if
  already present), so every existing staff/student call path (the API
  routes in `apps/api/src/routes/students.ts`, which always use
  `createUserScopedClient(req.authUser.accessToken)` — the caller's own
  JWT, always `authenticated` once logged in) is unaffected.

### Local migration numbering / history check (read-only)

```
supabase migration list
```

| Local | Remote |
|---|---|
| ...0018, 0019 | ...0018, 0019 |
| **0020** | *(not present)* |

`0020_batch2_rpc_revoke_anon.sql` is the next sequential file after `0019`
(no gap, no collision); remote correctly shows nothing beyond `0019`,
confirming this migration has not been applied anywhere yet.

### Transaction test plan (Cloud) — for the next explicit apply step

To be run in a scratch transaction (`BEGIN; ... ROLLBACK;`), mirroring the
approach used for 0018/0019 in `BATCH_2_PRE_APPLY_SECURITY_REVIEW.md`:

1. **Baseline**: confirm `anon=X` currently present on all 4 RPCs via
   `pg_proc.proacl` (matches the finding).
2. **Apply 0020** inside the transaction.
3. **ACL check**: `pg_proc.proacl` no longer lists `anon` for any of the 4
   RPCs; `authenticated`, `service_role`, `postgres` still present.
4. **Anon call rejected at grant level**: `SET LOCAL role = anon;` then call
   each of the 4 RPCs; expect a Postgres permission-denied error (42501),
   not the function's own raised exception message.
5. **Authenticated staff call still works**: `SET LOCAL role = authenticated;`
   + a staff JWT claim, call `staff_list_students`/`staff_get_student`; expect
   normal success (same as the 0019 test matrix).
6. **Authenticated student call still works**: same role switch with a
   student JWT claim, call `student_get_own_profile`; expect normal success.
7. **Batch 1 RPCs unaffected**: spot-check `pg_proc.proacl` for
   `register_for_class`/`create_course_class` unchanged (still has `anon`,
   confirming 0020 didn't touch them).
8. `ROLLBACK;` — confirm nothing committed.

### Transaction test — EXECUTED against Cloud (read-only session, result below)

This plan was actually run in a follow-up session, in a single
`BEGIN; ... ROLLBACK;` block via `supabase db query --linked --file`, with
no `COMMIT`, no `supabase db push`, no migration repair, no seed run, and
no data mutation. Signatures used matched exactly the 4
`create or replace function` signatures in `0019_rpc_student_profiles.sql`:
`staff_list_students(uuid, uuid, text, text)`, `staff_get_student(uuid)`,
`staff_update_student(uuid, text, text, uuid, uuid, text)`,
`student_get_own_profile()`.

**Baseline (before the transaction, read-only, matches the finding above):**
all 4 RPCs had `EXECUTE` granted to both `anon` and `authenticated` (plus
`postgres`/`service_role`, unchanged by 0020 either way). Remote migration
history confirmed at `0019` (no `0020`).

**Inside the transaction** (0020's `revoke`/`grant` statements applied,
then rolled back at the end — role switches done via
`set_config('role', ..., true)` + `set_config('request.jwt.claims', ..., true)`
against the 2 real demo student profiles and the 1 demo staff profile,
scoped as local/transaction-only settings):

| Case | Result | Detail |
|---|---|---|
| ACL check (anon revoked / authenticated kept, all 4 RPCs) | **PASS** | `anon` EXECUTE count = 0 (expected 0), `authenticated` EXECUTE count = 4 (expected 4) |
| Batch 1 RPCs unaffected (`register_for_class`, `create_course_class`) | **PASS** | `anon` EXECUTE still present on both (count ≥ 1, unchanged by 0020) |
| Staff (authenticated) calls `staff_list_students` + `staff_get_student` | **PASS** | both succeeded; `staff_list_students` returned rows, `staff_get_student` returned the target profile |
| Student (authenticated) calls `student_get_own_profile` | **PASS** | returned exactly 1 row — the caller's own profile |
| Student (authenticated) calls `staff_list_students` (should be blocked) | **PASS** | rejected with `only training staff may list students` — the function's own `is_training_staff()` check, i.e. rejected *inside* the function body, as expected for an `authenticated` caller who isn't staff (this is unrelated to and unaffected by the anon-grant revoke) |
| Anon call to `student_get_own_profile` (should be blocked at grant level, not function body) | **PASS** | rejected with Postgres `insufficient_privilege` (`permission denied for function student_get_own_profile`) — confirms the rejection now happens at the grant layer, before the function body's own `auth.uid() is null` check would even run, and no data was returned |

All 6 cases **PASS**. No data was exposed by the anon call (rejected before
function execution). `ROLLBACK;` executed as the final statement.

**Post-rollback verification (read-only, separate queries after the
transaction closed):**

- `supabase migration list`: remote still shows `...0018, 0019` with `0020`
  marked local-only/not-applied — **unchanged from baseline**.
- `pg_proc.proacl` re-queried for all 4 RPCs: `anon` EXECUTE is **back** on
  all 4 (baseline restored) — confirms the transaction's `revoke` did not
  leak past `ROLLBACK`.
- No `INSERT`/`UPDATE`/`DELETE` was ever issued against any real table in
  this session (only a `CREATE TEMP TABLE ... ON COMMIT DROP` scoped to the
  test transaction itself, used to collect PASS/FAIL rows before the
  `ROLLBACK`, and dropped with it) — no `profiles`, `enrollments`,
  `programs`, or `cohorts` row was created, modified, or deleted.
- No secret, token, password, or DB connection URL was printed at any point
  (only non-secret UUIDs — the demo accounts' own `auth.users.id` values,
  already known/non-secret — and email addresses were used to look up
  those UUIDs).

### Post-apply verification (for the next explicit apply step, read-only)

- `pg_proc.proacl` for all 4 RPCs: no `anon` entry, `authenticated` entry
  present.
- `pg_proc.proacl` for Batch 1 RPCs: unchanged (still includes `anon`, since
  0020 intentionally left them alone).
- `supabase migration list`: remote shows `0020` applied, `0018`/`0019`
  unchanged.
- Functional smoke: staff/student JWT calls to all 4 RPCs still succeed
  (same as the Batch 2 integration test matrix), confirming no regression.

---

## 3. Verify (local, this session)

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |
| `npm run test` | **PASS** (including the 3 new `decideAccountAction` tests) |
| Secret scan (working tree, no `.env` content, no printed tokens) | **PASS** — no secret values were echoed at any point in this session; `.env` files were only checked for variable *names* (`grep -c`), never their values |
| Migration numbering/local history | **PASS** — `0020` sequential after `0019`, not yet applied remotely (see above) |

(Exact command output captured in the session; summarized here per the
report's no-secret-printing constraint — none of the verify commands emit
secrets by nature, so this is a completeness statement, not a redaction.)

---

## Verdict

**READY FOR A FUTURE, SEPARATE APPLY STEP.** Both hardening items are
complete and verified locally:

1. The `seedDemoUsers.ts` password-reset behavior is fixed in code
   (local-only, untested against Cloud until the next explicit
   `npm run seed:demo-users` run) with a pure, unit-tested decision function
   and an explicit opt-in flag for intentional resets.
2. `0020_batch2_rpc_revoke_anon.sql` is written, numbered correctly, and
   scoped to grants only (no RPC logic, no Batch 1 RPC, no other schema
   object). Its full transaction test plan has since been **executed**
   against Cloud in a `BEGIN; ... ROLLBACK;` block (see the "Transaction
   test — EXECUTED against Cloud" subsection above): all 6 cases PASS
   (anon revoked / authenticated kept on all 4 RPCs, Batch 1 untouched,
   staff and student authenticated calls still succeed, a non-staff
   authenticated caller is still rejected by the function's own check, and
   an anon caller is rejected at the grant level with no data exposed).
   Post-rollback checks confirm remote migration history is still at
   `0019` and the `anon` grant is back to baseline — **it has not been
   applied to Cloud**. Applying it for real (via `supabase db push`)
   remains a separate, explicit, human-approved step, matching how
   0018/0019 were handled.

No code was committed, pushed, or deployed as part of this task.

---

## 4. PERMANENT APPLY — `0020_batch2_rpc_revoke_anon.sql` (2026-08-02)

Following the transaction-tested plan above, `0020_batch2_rpc_revoke_anon.sql`
was applied permanently to Cloud in a dedicated follow-up session, scoped
strictly to this one migration. No seed script was run, no
`seedDemoUsers`/`main()` was invoked, no data was created/modified/deleted,
and nothing was committed/pushed/deployed to a code repo (this project
directory is not a git repository — `git status` is not applicable).

### Preflight (`supabase migration list`, read-only)

Before apply, local/remote differed by exactly one migration:

| Local | Remote |
|---|---|
| 0000 … 0019 | 0000 … 0019 (identical) |
| **0020** | *(not present)* |

Confirmed no other drift — proceeded to apply per the task's preflight gate.

### Apply (`supabase db push`)

```
supabase db push
```

Prompted to confirm pushing `0020_batch2_rpc_revoke_anon.sql`; confirmed.
Output: `Applying migration 0020_batch2_rpc_revoke_anon.sql... Finished
supabase db push.` No `migration repair`, no manual/ad-hoc SQL statement was
used to apply the change — the CLI applied the migration file verbatim.

### Post-apply verification (read-only)

**Migration history** (`supabase migration list`): remote now shows
`0000` through `0020`, matching local exactly — `0020` is the only newly
applied entry; `0000`–`0019` timestamps unchanged.

**Batch 2 RPC grants** (`supabase db query --linked`, `has_function_privilege`
against `anon` and `authenticated` for all 4 RPCs):

| Function | `anon` EXECUTE | `authenticated` EXECUTE |
|---|---|---|
| `staff_list_students` | false | true |
| `staff_get_student` | false | true |
| `staff_update_student` | false | true |
| `student_get_own_profile` | false | true |

Matches the intended end state exactly: `anon` revoked, `authenticated`
retained, on all 4 RPCs.

**Batch 1 RPC grants unchanged** (same query against `register_for_class`,
`cancel_own_enrollment`, `cancel_course_class`, `get_registration_classes`,
`create_course_class`): `anon` EXECUTE still `true` on all 5, exactly as
before `0020` — confirms the migration did not touch Batch 1, matching its
stated scope.

**No unrelated schema/data change**: `0020`'s only statements are the 4
`revoke`/4 `grant` pairs already reviewed above (no DDL, no `create or
replace function`, no table/row write). The `db push` output shows only this
one migration applied; no other migration file changed on disk during this
session.

### Verdict

**PASS — permanently applied.** `0020_batch2_rpc_revoke_anon.sql` is now
committed to remote migration history (`0000`–`0020` in sync) and the
Batch 2 RPC anon-EXECUTE grants are revoked in Cloud, matching the
transaction-tested plan from §2 exactly, with no scope creep beyond the one
migration.
