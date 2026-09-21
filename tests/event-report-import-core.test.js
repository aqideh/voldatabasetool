import assert from 'node:assert/strict';

await import('../assets/event-report-import-core.js');
const Core=globalThis.MaklomEventReportImportCore;
assert.ok(Core,'event report import core should load');

const headers=[
  'event_title','event_venue','date','shift','shift_starts_at','shift_ends_at',
  'volunteer_name','contact_number','email','attendance_status',
  'checked_in_at','checked_out_at','attendance_session_id',
  'continuous_attendance_type','event_day_checked_in_at','event_day_checked_out_at',
  'volunteer_person_key','volunteer_id','roster_source'
];

const base={
  event_title:'RI @ Test Venue',
  event_venue:'Test Venue',
  date:'2026-09-06',
  volunteer_name:'Volunteer One',
  contact_number:'90000001',
  email:'one@example.com',
  volunteer_person_key:'email:one@example.com',
  volunteer_id:'',
  roster_source:'Imported',
  attendance_session_id:'session-1',
  event_day_checked_in_at:'2026-09-06T01:00:00+00:00',
  event_day_checked_out_at:'2026-09-06T11:00:00+00:00'
};

const rows=[
  {
    ...base,
    shift:'Sunday AM',
    shift_starts_at:'2026-09-06T00:30:00+00:00',
    shift_ends_at:'2026-09-06T06:00:00+00:00',
    attendance_status:'checked_out',
    checked_in_at:'2026-09-06T01:00:00+00:00',
    checked_out_at:'2026-09-06T11:00:00+00:00',
    continuous_attendance_type:'origin'
  },
  {
    ...base,
    shift:'Sunday PM',
    shift_starts_at:'2026-09-06T04:30:00+00:00',
    shift_ends_at:'2026-09-06T10:00:00+00:00',
    attendance_status:'checked_out',
    checked_in_at:'2026-09-06T06:00:00+00:00',
    checked_out_at:'2026-09-06T11:00:00+00:00',
    continuous_attendance_type:'extended_on_site'
  },
  {
    ...base,
    volunteer_name:'Volunteer Two',
    contact_number:'90000002',
    email:'two@example.com',
    volunteer_person_key:'email:two@example.com',
    attendance_session_id:'',
    shift:'Sunday PM',
    shift_starts_at:'2026-09-06T04:30:00+00:00',
    shift_ends_at:'2026-09-06T10:00:00+00:00',
    attendance_status:'checked_in',
    checked_in_at:'2026-09-06T05:00:00+00:00',
    checked_out_at:'',
    event_day_checked_in_at:'2026-09-06T05:00:00+00:00',
    event_day_checked_out_at:'',
    continuous_attendance_type:''
  },
  {
    ...base,
    volunteer_name:'Volunteer Three',
    contact_number:'90000003',
    email:'three@example.com',
    volunteer_person_key:'email:three@example.com',
    attendance_session_id:'',
    shift:'Sunday AM',
    shift_starts_at:'2026-09-06T00:30:00+00:00',
    shift_ends_at:'2026-09-06T06:00:00+00:00',
    attendance_status:'absent',
    checked_in_at:'',
    checked_out_at:'',
    event_day_checked_in_at:'',
    event_day_checked_out_at:'',
    continuous_attendance_type:''
  }
];

const analysis=Core.analyse(rows,headers);
assert.equal(analysis.ok,true);
assert.equal(analysis.summary.events,1);
assert.equal(analysis.summary.shifts,2);
assert.equal(analysis.summary.rows,4);
assert.equal(analysis.summary.continuousSessions,1);

const event=analysis.events[0];
assert.equal(event.start_date,'2026-09-06');
assert.equal(event.end_date,'2026-09-06');
assert.deepEqual(event.shiftList.map(s=>[s.name,s.start_time,s.end_time]),[
  ['Sunday AM','08:30','14:00'],
  ['Sunday PM','12:30','18:00']
]);

const oneAm=analysis.rows.find(r=>r.email==='one@example.com'&&r.shift==='Sunday AM');
const onePm=analysis.rows.find(r=>r.email==='one@example.com'&&r.shift==='Sunday PM');
assert.equal(oneAm._allocation.duration_minutes,210);
assert.equal(onePm._allocation.duration_minutes,330);
assert.equal(oneAm._allocation.sign_out_at,'2026-09-06T04:30:00.000Z');
assert.equal(onePm._allocation.sign_in_at,'2026-09-06T04:30:00.000Z');
assert.equal(analysis.summary.creditedMinutes,540);

const checkedIn=analysis.rows.find(r=>r.email==='two@example.com');
assert.equal(checkedIn._allocation.attended,true);
assert.equal(checkedIn._allocation.duration_minutes,0);
assert.equal(checkedIn._allocation.calculated_duration_minutes,null);

const absent=analysis.rows.find(r=>r.email==='three@example.com');
assert.equal(absent._allocation.attended,false);
assert.equal(absent._allocation.duration_minutes,0);

const sameRowDifferentSession={...rows[0],attendance_session_id:'later-session-id'};
const stable=Core.analyse([sameRowDifferentSession],headers);
assert.equal(stable.rows[0]._attendanceId,oneAm._attendanceId);

const missing=Core.analyse(rows,headers.filter(h=>h!=='shift'));
assert.equal(missing.ok,false);
assert.deepEqual(missing.missingHeaders,['shift']);

console.log('event-report-import-core tests passed');
