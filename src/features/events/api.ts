// Public event API boundary. The data-access implementation remains unchanged.
// All callers get real Error objects (with Supabase code/details retained), not
// silent generic banners when PostgREST returns a structured error object.
import { supabase } from '../../lib/supabase';
import { ApiRequestError, retainTimestampPrecision, withApiErrors } from '../../lib/reconciliation-inputs';
import * as repository from './repository';

export type {
  EventRosterDetailRow, EventAuditEntry, EventPeopleBundle,
  StagedIdentityCandidate, CanonicalScheduleShiftInput,
} from './repository';

export const fetchEventsBundle=withApiErrors(repository.fetchEventsBundle);
export const fetchHistoricalAttendanceRowsByIds=withApiErrors(repository.fetchHistoricalAttendanceRowsByIds);
export const fetchEventPeople=withApiErrors(repository.fetchEventPeople);
export const pairStagedAttendance=withApiErrors(repository.pairStagedAttendance);
export const reviewStagedAttendance=withApiErrors(repository.reviewStagedAttendance);
export const reviewLegacyStagedAttendance=withApiErrors(repository.reviewLegacyStagedAttendance);
export const addExistingVolunteerToEventRoster=withApiErrors(repository.addExistingVolunteerToEventRoster);
export const fetchStagedIdentityCandidates=withApiErrors(repository.fetchStagedIdentityCandidates);
export const resolveStagedIdentity=withApiErrors(repository.resolveStagedIdentity);
export const preRegisterStagedIdentity=withApiErrors(repository.preRegisterStagedIdentity);
export const setRosterOperationalOverride=withApiErrors(repository.setRosterOperationalOverride);
export const fetchEventAudit=withApiErrors(repository.fetchEventAudit);
export const updateCanonicalEventDetails=withApiErrors(repository.updateCanonicalEventDetails);
export const correctDirectRosterAttendance=withApiErrors(repository.correctDirectRosterAttendance);
export const createEvent=withApiErrors(repository.createEvent);
export const updateEvent=withApiErrors(repository.updateEvent);
export const deleteEvent=withApiErrors(repository.deleteEvent);
export const createShift=withApiErrors(repository.createShift);
export const deleteShift=withApiErrors(repository.deleteShift);
export const createMetric=withApiErrors(repository.createMetric);
export const deleteMetric=withApiErrors(repository.deleteMetric);

export const correctEventAttendance=withApiErrors(async(input:Parameters<typeof repository.correctEventAttendance>[0])=>{
  // The existing editor submits minute-resolution values. Read ONLY the expected
  // version to recover unchanged precision; never substitute a newer record.
  const {data:original,error}=await supabase.from('phaseone_attendance_sessions')
    .select('checked_in_at,checked_out_at,row_version')
    .eq('id',input.sessionId).eq('row_version',input.expectedVersion).maybeSingle();
  if(error)throw error;
  if(!original)throw new ApiRequestError({code:'P1202',message:'Attendance changed or is unavailable. Reload the record before saving.'});
  const checkedInAt=retainTimestampPrecision(input.checkedInAt,original.checked_in_at);
  if(!checkedInAt)throw new Error('Check-in time is required.');
  return repository.correctEventAttendance({
    ...input,checkedInAt,
    checkedOutAt:retainTimestampPrecision(input.checkedOutAt,original.checked_out_at),
  });
});

export const saveCanonicalEventSchedule=withApiErrors(async(input:Parameters<typeof repository.saveCanonicalEventSchedule>[0])=>{
  const shifts=input.shifts.map(shift=>({
    ...shift,
    starts_at:retainTimestampPrecision(shift.starts_at,shift.expected_starts_at) as string,
    ends_at:retainTimestampPrecision(shift.ends_at,shift.expected_ends_at) as string,
  }));
  return repository.saveCanonicalEventSchedule({...input,shifts});
});
