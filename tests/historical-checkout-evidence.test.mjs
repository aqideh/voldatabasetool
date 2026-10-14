import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalEffectiveSignOut, historicalSourceSignOut } from '../src/features/historical-attendance/sign-out-evidence.ts';

const feedbackTime = '2026-10-14T09:01:00Z';
const row = (overrides = {}) => ({
  source_feedback_at: feedbackTime,
  source_check_out_at: null,
  source_check_out_kind: null,
  review_flags: [],
  effective_timing_overridden: false,
  effective_sign_out_at: null,
  ...overrides,
});

test('matched feedback form submission is the sign-out timestamp', () => {
  assert.deepEqual(historicalSourceSignOut(row()), { at: feedbackTime, origin: 'feedback' });
  assert.equal(historicalEffectiveSignOut(row()), feedbackTime);
});

test('an explicit checkout takes precedence over feedback when both exist', () => {
  const captured = '2026-10-14T08:50:00Z';
  assert.deepEqual(historicalSourceSignOut(row({ source_check_out_at: captured, source_check_out_kind: 'reused_sign_in_form' })), { at: captured, origin: 'checkout' });
});

test('ambiguous or mismatched feedback must not establish checkout', () => {
  for (const flag of ['feedback_ambiguous','feedback_event_mismatch']) {
    assert.deepEqual(historicalSourceSignOut(row({ review_flags: [flag] })), { at: null, origin: null });
  }
});

test('staff-adjusted checkout, including deliberate null, overrides source evidence', () => {
  const corrected = '2026-10-14T10:00:00Z';
  assert.equal(historicalEffectiveSignOut(row({ effective_timing_overridden: true, effective_sign_out_at: corrected })), corrected);
  assert.equal(historicalEffectiveSignOut(row({ effective_timing_overridden: true, effective_sign_out_at: null })), null);
});

test('source checkout captured from feedback is displayed as feedback-derived', () => {
  assert.deepEqual(historicalSourceSignOut(row({ source_check_out_at: feedbackTime, source_check_out_kind: 'feedback_submission' })), { at: feedbackTime, origin: 'feedback' });
});
