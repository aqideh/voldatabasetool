import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceStatusFromEvidence,attendanceMinutesFromEvidence} from '../src/features/contributions/attendance-state.ts';

const empty={nonAttendanceStatus:null,sessionIn:null,sessionOut:null,directIn:null,directOut:null};

test('Tashvee: linked attendance outside scheduled shift remains attended',()=>{
  const input={...empty,sessionIn:'2026-08-22T02:20:00Z',sessionOut:'2026-08-22T04:10:00Z'};
  assert.equal(attendanceStatusFromEvidence(input),'attended');
  assert.equal(attendanceMinutesFromEvidence(input),110);
});

test('Vaddi: six-second direct historical attendance is not absent',()=>{
  const input={...empty,directIn:'2026-08-23T03:45:50.158079Z',directOut:'2026-08-23T03:45:56.132196Z'};
  assert.equal(attendanceStatusFromEvidence(input),'attended');
  assert.equal(attendanceMinutesFromEvidence(input),0);
});

test('Vales: direct check-in/out even after shift is attended',()=>{
  const input={...empty,directIn:'2026-08-22T06:51:14Z',directOut:'2026-08-22T13:22:37Z'};
  assert.equal(attendanceStatusFromEvidence(input),'attended');
  assert.equal(attendanceMinutesFromEvidence(input),391);
});

test('no evidence is unresolved, not automatically absent',()=>{
  assert.equal(attendanceStatusFromEvidence(empty),'no_record');
  assert.equal(attendanceStatusFromEvidence({...empty,nonAttendanceStatus:'absent'}),'absent');
  assert.equal(attendanceStatusFromEvidence({...empty,nonAttendanceStatus:'withdrawn'}),'withdrawn');
});

test('captured check-in takes precedence over contradictory stale status',()=>{
  assert.equal(attendanceStatusFromEvidence({...empty,nonAttendanceStatus:'absent',directIn:'2026-08-22T06:00:00Z'}),'checked_in');
  assert.equal(attendanceStatusFromEvidence({...empty,nonAttendanceStatus:'absent',directIn:'2026-08-22T06:00:00Z',directOut:'2026-08-22T08:00:00Z'}),'attended');
});

test('duration cannot combine unrelated session and direct timestamps',()=>{
  const input={...empty,sessionIn:'2026-08-22T05:00:00Z',directOut:'2026-08-22T10:00:00Z'};
  assert.equal(attendanceMinutesFromEvidence(input),null);
  assert.equal(attendanceMinutesFromEvidence({...empty,directIn:'2026-08-22T10:00:00Z',directOut:'2026-08-22T09:00:00Z'}),null);
});
