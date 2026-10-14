import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  singaporeMinuteInput, timestampFromSingaporeInput, retainTimestampPrecision,
  ApiRequestError, asApiError, runApiRequest, withApiErrors,
} from '../src/lib/reconciliation-inputs.ts';

const original='2026-08-27T04:50:42.654321+00:00';

test('unchanged minute input preserves the exact original microsecond string',()=>{
  assert.equal(singaporeMinuteInput(original),'2026-08-27T12:50');
  assert.equal(timestampFromSingaporeInput('2026-08-27T12:50',original),original);
});
test('editing check-in leaves an unchanged checkout intact',()=>{
  assert.equal(timestampFromSingaporeInput('2026-08-27T10:15','2026-08-27T02:16:37.123456Z'),'2026-08-27T10:15:00+08:00');
  assert.equal(timestampFromSingaporeInput('2026-08-27T12:50',original),original);
});
test('explicitly clearing a timestamp does not restore it from the original',()=>{
  assert.equal(timestampFromSingaporeInput('',original),null);
  assert.equal(retainTimestampPrecision(null,original),null);
});
test('new timestamps are expressed with an explicit Singapore offset',()=>{
  assert.equal(timestampFromSingaporeInput('2026-08-28T00:05',null),'2026-08-28T00:05:00+08:00');
});
test('invalid dates, rollover dates and partial inputs are rejected',()=>{
  for(const value of ['2026-02-30T10:15','2026-13-01T10:15','2026-08-27T24:01','2026-08-27','0000-01-01T10:15']){
    assert.throws(()=>timestampFromSingaporeInput(value,null));
  }
});
test('valid leap day and end-of-year timezone rollover work',()=>{
  assert.equal(timestampFromSingaporeInput('2028-02-29T10:15',null),'2028-02-29T10:15:00+08:00');
  assert.equal(singaporeMinuteInput('2026-12-31T23:30:59Z'),'2027-01-01T07:30');
});
test('minute-only existing clients preserve precision against the versioned original',()=>{
  assert.equal(retainTimestampPrecision('2026-08-27T12:50:00+08:00',original),original);
  assert.equal(retainTimestampPrecision('2026-08-27T04:50:00.000Z',original),original);
});
test('changed minutes and explicit seconds are not replaced with old evidence',()=>{
  assert.equal(retainTimestampPrecision('2026-08-27T12:51:00+08:00',original),'2026-08-27T12:51:00+08:00');
  assert.equal(retainTimestampPrecision('2026-08-27T12:50:15+08:00',original),'2026-08-27T12:50:15+08:00');
});
test('invalid stored or submitted timestamps are not silently accepted',()=>{
  assert.throws(()=>singaporeMinuteInput('invalid'));
  assert.throws(()=>retainTimestampPrecision('invalid',original));
});
test('structured Supabase errors preserve their real message and code',()=>{
  const error=asApiError({message:'Check-out cannot be before the event-day check-in',code:'P1203',details:'Conflict',hint:'Review the existing interval'});
  assert.ok(error instanceof Error);
  assert.equal(error.message,'Check-out cannot be before the event-day check-in');
  assert.equal(error.code,'P1203');
  assert.equal(error.details,'Conflict');
  assert.equal(error.hint,'Review the existing interval');
});
test('native errors remain intact and unexpected values have a safe message',()=>{
  const native=new Error('Network failed');
  assert.equal(asApiError(native),native);
  assert.equal(asApiError('Connection failed').message,'Connection failed');
  assert.equal(asApiError(null).message,'The request could not be completed.');
});
test('request boundary normalizes one failed call without retrying',async()=>{
  let calls=0;
  await assert.rejects(runApiRequest(async()=>{calls++;throw {message:'Stale record',code:'P1202'};}),
    error=>error instanceof Error&&error.code==='P1202'&&error.message==='Stale record');
  assert.equal(calls,1);
});
test('an explicit RPC conflict envelope cannot be mistaken for a successful save',async()=>{
  await assert.rejects(runApiRequest(async()=>({ok:false,error:{code:'P1202',message:'Reload before saving'}})),
    error=>error instanceof ApiRequestError&&error.code==='P1202');
});
test('successful responses and positional arguments pass through unchanged',async()=>{
  const result={decision:'approved',row_id:'synthetic'};
  assert.equal(await runApiRequest(async()=>result),result);
  assert.equal(await withApiErrors(async(a,b)=>a+b)(2,3),5);
});
test('every exported event repository function has an error-normalizing public boundary',()=>{
  const repository=readFileSync(new URL('../src/features/events/repository.ts',import.meta.url),'utf8');
  const api=readFileSync(new URL('../src/features/events/api.ts',import.meta.url),'utf8');
  for(const match of repository.matchAll(/export async function (\w+)\(/g)){
    assert.match(api,new RegExp('export const '+match[1]+'=withApiErrors\\('));
  }
});
