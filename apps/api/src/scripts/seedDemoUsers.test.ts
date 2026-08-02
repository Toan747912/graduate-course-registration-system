import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideAccountAction } from './seedDemoUsers.js';

test('decideAccountAction: no existing user -> create (password set at creation)', () => {
  assert.deepEqual(decideAccountAction(null, false), { kind: 'create' });
  assert.deepEqual(decideAccountAction(null, true), { kind: 'create' });
});

test('decideAccountAction: existing user, no explicit reset -> sync-only (password untouched)', () => {
  assert.deepEqual(decideAccountAction('user-id-1', false), { kind: 'sync-only' });
});

test('decideAccountAction: existing user, explicit reset requested -> sync-and-reset-password', () => {
  assert.deepEqual(decideAccountAction('user-id-1', true), { kind: 'sync-and-reset-password' });
});
