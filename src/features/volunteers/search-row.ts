import type { VolunteerRow } from '../../lib/types';

export interface VolunteerSearchRow extends VolunteerRow {
  attended_event_count?:number;
  registered_event_count?:number;
  first_event_date?:string|null;
  events_last_90d?:number;
  active_last_90d?:boolean;
  attended_events?:string[];
  registered_events?:string[];
}
