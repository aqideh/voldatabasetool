export type ParticipationStatus='attended'|'checked_in'|'no_record'|'withdrawn'|'absent';

export function attendanceStatusFromEvidence(input:{
  nonAttendanceStatus:string|null;
  sessionIn:string|null;
  sessionOut:string|null;
  directIn:string|null;
  directOut:string|null;
}):ParticipationStatus {
  // A captured check-in is evidence of participation even when the session
  // matching layer cannot connect the record to the scheduled shift.
  if((input.sessionIn&&input.sessionOut)||(input.directIn&&input.directOut))return 'attended';
  if(input.sessionIn||input.directIn)return 'checked_in';
  if(input.nonAttendanceStatus==='withdrawn')return 'withdrawn';
  if(input.nonAttendanceStatus==='absent')return 'absent';
  return 'no_record';
}

export function attendanceMinutesFromEvidence(input:{
  sessionIn:string|null;
  sessionOut:string|null;
  directIn:string|null;
  directOut:string|null;
}):number|null {
  const checkIn=input.sessionIn||input.directIn;
  const checkOut=input.sessionOut||input.directOut;
  if(!checkIn||!checkOut)return null;
  const start=Date.parse(checkIn);
  const end=Date.parse(checkOut);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
  return Math.floor((end-start)/60000);
}
