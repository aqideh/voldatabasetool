import type { IntelligenceFilters, VolunteerIntelligenceRow } from '../../lib/types';

type SortableVolunteer = Pick<
  VolunteerIntelligenceRow,
  'name' | 'event_count' | 'historical_credited_minutes' | 'approved_keluarga_minutes' | 'last_event_date'
>;

export function volunteerDisplayName(name: string | null): string {
  return name?.trim() || 'Name not provided';
}

function compareNames(left: string | null, right: string | null): number {
  const a = left?.trim() || '';
  const b = right?.trim() || '';
  if (!a) return b ? 1 : 0;
  if (!b) return -1;
  return a.localeCompare(b);
}

export function compareIntelligenceRows(
  a: SortableVolunteer,
  b: SortableVolunteer,
  sort: IntelligenceFilters['sort'],
): number {
  const nameOrder = compareNames(a.name, b.name);
  switch (sort) {
    case 'events':
      return b.event_count - a.event_count || nameOrder;
    case 'historical-hours':
      return b.historical_credited_minutes - a.historical_credited_minutes || nameOrder;
    case 'approved-hours':
      return b.approved_keluarga_minutes - a.approved_keluarga_minutes || nameOrder;
    case 'last-active':
      return (b.last_event_date || '').localeCompare(a.last_event_date || '') || nameOrder;
    default:
      return nameOrder;
  }
}
