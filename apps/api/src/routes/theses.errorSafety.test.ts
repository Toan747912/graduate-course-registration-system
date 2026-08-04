import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Regression test for docs/BATCH_4_PRE_APPLY_SECURITY_REVIEW.md finding F-6:
// the "~10 spots fixed" replacement of raw error.message pass-through in
// apps/api/src/routes/theses.ts was manual and self-reported, with nothing
// guarding against it being reintroduced. This is a static, source-text
// regression test (no network, no live DB, no Admin API) -- it reads the
// actual route/error-handler source and asserts the shape that keeps raw
// Postgres/PostgREST error text away from the client, while still confirming
// legitimate RPC business-rule reasons (Vietnamese, e.g. "advisor at
// capacity") remain distinguishable per endpoint via a per-call rejectedCode.

const routesFile = fileURLToPath(new URL('./theses.ts', import.meta.url));
const errorHandlerFile = fileURLToPath(new URL('../middleware/errorHandler.ts', import.meta.url));

const routesSrc = readFileSync(routesFile, 'utf8');
const errorHandlerSrc = readFileSync(errorHandlerFile, 'utf8');

test('theses.ts never forwards error.message (or err.message) from a Supabase/RPC failure to sendError', () => {
  // Every `if (error) { ... }` branch and the shared handleRpcResult helper
  // must use the generic constant, never the raw driver error object's
  // message field, when reporting an *unexpected* error (as opposed to the
  // RPC's own jsonb {success,reason} business payload, which is safe/expected
  // Vietnamese text authored by the RPC itself).
  assert.doesNotMatch(
    routesSrc,
    /sendError\([^)]*error\.message/,
    'no sendError call may pass through error.message',
  );
  assert.doesNotMatch(
    routesSrc,
    /sendError\([^)]*err\.message/,
    'no sendError call may pass through err.message',
  );
});

test('theses.ts routes a raw Supabase/RPC error to the GENERIC_ERROR_MESSAGE constant, not a per-call-site literal', () => {
  assert.match(routesSrc, /const GENERIC_ERROR_MESSAGE = 'Có lỗi xảy ra, vui lòng thử lại sau\.';/);

  // handleRpcResult (used by every mutating RPC endpoint) must map a
  // transport/driver-level `error` to the generic constant.
  const handleRpcResult = routesSrc.slice(
    routesSrc.indexOf('function handleRpcResult'),
    routesSrc.indexOf('function handleRpcResult') + 600,
  );
  assert.match(handleRpcResult, /if \(error\) \{\s*sendError\(res, 400, 'RPC_ERROR', GENERIC_ERROR_MESSAGE\);/);

  // Every plain read-only endpoint's `if (error) { ... }` guard must also use
  // the generic constant -- count occurrences to make sure none were missed
  // (this is the regression check: it fails the moment a new endpoint is
  // added with `error.message` instead of copying this pattern).
  const rawErrorGuards = [...routesSrc.matchAll(/if \(error\) \{\s*sendError\(res, 400, '[A-Z_]+', ([^)]*)\);/g)];
  assert.ok(rawErrorGuards.length > 0, 'expected at least one raw-error guard in theses.ts');
  for (const match of rawErrorGuards) {
    assert.equal(
      (match[1] ?? '').trim(),
      'GENERIC_ERROR_MESSAGE',
      `raw error guard must send GENERIC_ERROR_MESSAGE, found: ${match[0]}`,
    );
  }
});

test('theses.ts still surfaces legitimate RPC business-rule reasons distinctly per endpoint (does not flatten to one generic code)', () => {
  // handleRpcResult forwards payload.reason (the RPC's own Vietnamese
  // business message) verbatim when success=false -- this is intentional and
  // must not regress into being replaced by the generic constant, or staff/
  // students would lose messages like "advisor at capacity" / "thesis not in
  // PENDING state".
  const handleRpcResult = routesSrc.slice(
    routesSrc.indexOf('function handleRpcResult'),
    routesSrc.indexOf('function handleRpcResult') + 600,
  );
  assert.match(handleRpcResult, /sendError\(res, 400, rejectedCode, payload\?\.reason \?\? '[^']*'\);/);

  // Each call site passes a distinct rejectedCode so the frontend can tell
  // rejection reasons apart by endpoint even though the HTTP status is
  // uniformly 400.
  const rejectedCodes = [...routesSrc.matchAll(/handleRpcResult\([^,]+,[^,]+,[^,]+,\s*'([A-Z_]+)'/g)].map((m) => m[1] ?? '');
  assert.ok(rejectedCodes.length >= 10, 'expected the full set of mutating thesis/advisor endpoints to use handleRpcResult');
  // CANCEL_THESIS_REJECTED is intentionally reused by both the student
  // self-cancel and staff-cancel endpoints (same business concept, different
  // actors) -- every other code must still be distinct per endpoint.
  const codeCounts = new Map<string, number>();
  for (const code of rejectedCodes) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  for (const [code, count] of codeCounts) {
    if (code === 'CANCEL_THESIS_REJECTED') {
      assert.equal(count, 2, 'CANCEL_THESIS_REJECTED should be used by exactly the student and staff cancel endpoints');
    } else {
      assert.equal(count, 1, `rejectedCode ${code} must be unique to one endpoint`);
    }
  }
});

test('errorHandler.ts never leaks the raw driver error message to the client in production', () => {
  assert.match(
    errorHandlerSrc,
    /process\.env\.NODE_ENV === 'production'\s*\?\s*'Đã xảy ra lỗi hệ thống\. Vui lòng thử lại sau\.'/,
  );
  // The raw `err.message` branch must be reachable only in the non-production
  // (development) arm of the ternary.
  const prodTernary = errorHandlerSrc.slice(
    errorHandlerSrc.indexOf("process.env.NODE_ENV === 'production'"),
    errorHandlerSrc.indexOf('sendError(res, 500'),
  );
  const prodBranch = prodTernary.split('?')[1]?.split(':')[0] ?? '';
  assert.doesNotMatch(prodBranch, /err\.message/, 'production branch must not reference err.message');
});
