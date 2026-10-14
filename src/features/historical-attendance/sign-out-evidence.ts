import type { HistoricalAttendanceImportRow } from '../../lib/types';

type EvidenceRow = Pick<HistoricalAttendanceImportRow,
  'source_check_out_at' | 'source_check_out_kind' | 'source_feedback_at' |
  'review_flags' | 'effective_timing_overridden' | 'effective_sign_out_at'
>;

export function historicalSourceSignOut(row: EvidenceRow): { at: string | null; origin: 'checkout' | 'feedback' | null } {
  if (row.source_check_out_at) {
    return {
      at: row.source_check_out_at,
      origin: row.source_check_out_kind === 'feedback_submission' ? 'feedback' : 'checkout',
    };
  }
  if (
    row.source_feedback_at &&
    !row.review_flags.some((flag) => flag === 'feedback_event_mismatch' || flag === 'feedback_ambiguous')
  ) {
    return { at: row.source_feedback_at, origin: 'feedback' };
  }
  return { at: null, origin: null };
}

export function historicalEffectiveSignOut(row: EvidenceRow): string | null {
  return row.effective_timing_overridden
    ? row.effective_sign_out_at
    : historicalSourceSignOut(row).at;
}
