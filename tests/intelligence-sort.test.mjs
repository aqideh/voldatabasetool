import test from 'node:test';
import assert from 'node:assert/strict';
import { compareIntelligenceRows, volunteerDisplayName } from '../src/features/intelligence/row-format.ts';

const row = (name, overrides = {}) => ({
  name,
  event_count: 0,
  historical_credited_minutes: 0,
  approved_keluarga_minutes: 0,
  last_event_date: null,
  ...overrides,
});

test('missing volunteer names are labelled only for display', () => {
  assert.equal(volunteerDisplayName(null), 'Name not provided');
  assert.equal(volunteerDisplayName('   '), 'Name not provided');
  assert.equal(volunteerDisplayName('  Aisha  '), 'Aisha');
});

test('all dashboard sort modes accept null and blank names without crashing', () => {
  for (const mode of ['events', 'historical-hours', 'approved-hours', 'last-active', 'name']) {
    const rows = [row(null), row('Zara'), row('   '), row('Aisha')];
    assert.doesNotThrow(() => rows.sort((a, b) => compareIntelligenceRows(a, b, mode)));
    assert.deepEqual(rows.map((r) => r.name), ['Aisha', 'Zara', null, '   '], mode);
  }
});

test('metric sort priority is preserved regardless of a missing name', () => {
  for (const [sort, field, higher] of [
    ['events', 'event_count', 2],
    ['historical-hours', 'historical_credited_minutes', 90],
    ['approved-hours', 'approved_keluarga_minutes', 60],
  ]) {
    const rows = [row('Aisha'), row(null, { [field]: higher })];
    rows.sort((a, b) => compareIntelligenceRows(a, b, sort));
    assert.equal(rows[0].name, null, sort);
  }
  const rows = [row('Aisha', { last_event_date: '2026-01-01' }), row(null, { last_event_date: '2026-10-14' })];
  rows.sort((a, b) => compareIntelligenceRows(a, b, 'last-active'));
  assert.equal(rows[0].name, null);
});
