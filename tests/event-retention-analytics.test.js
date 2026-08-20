const assert=require('assert');
const analytics=require('../assets/event-retention-analytics.js');
function row(name,date,attendance,event,email){return{name:name,eventDate:date,attendance:attendance,eventName:event||'Event',email:email||name.toLowerCase()+'@example.com',contact:''};}
const rows=[
  row('A','2026-01-01','yes','Alpha'),
  row('A','2026-01-01','yes','Alpha'),
  row('A','2026-01-20','yes','Beta'),
  row('B','2026-01-01','yes','Alpha'),
  row('B','2026-01-15','','No-show event'),
  row('B','2026-03-10','yes','Gamma'),
  row('C','2026-01-01','yes','Alpha'),
  row('D','2026-08-01','yes','Late cohort'),
  row('E','2026-02-01','yes','One'),
  row('E','2026-02-01','yes','Two'),
  row('F','2026-01-10','','No show'),
  row('G','2026-01-10','yes','Attend'),
  row('H','2026-09-01','','Future event')
];
const options={today:'2026-08-15'};
const noShow=analytics.noShowSummary(rows,'2026',options);
assert.deepStrictEqual({total:noShow.total,attended:noShow.attended,noShow:noShow.noShow,rate:noShow.rate},{total:12,attended:10,noShow:2,rate:16.7});
const r30=analytics.retentionSummary(rows,'2026',30,options);
assert.deepStrictEqual({cohort:r30.cohortTotal,eligible:r30.eligible,retained:r30.retained,dropped:r30.dropped,rate:r30.rate,drop:r30.dropOffRate},{cohort:6,eligible:5,retained:2,dropped:3,rate:40,drop:60});
const r60=analytics.retentionSummary(rows,'2026',60,options);
assert.strictEqual(r60.retained,2);
const r90=analytics.retentionSummary(rows,'2026',90,options);
assert.strictEqual(r90.retained,3);
assert.strictEqual(r90.rate,60);
const january=analytics.monthlyRetention(rows,'2026',[30,60,90],options).find(function(item){return item.month==='01';});
assert.strictEqual(january.cohortTotal,4);
assert.strictEqual(january.windows[90].mature,true);
assert.strictEqual(january.windows[90].retained,2);
const august=analytics.monthlyRetention(rows,'2026',[30,60,90],options).find(function(item){return item.month==='08';});
assert.strictEqual(august.windows[30].mature,false);
assert.ok(analytics.eventNoShow(rows,'2026',options).every(function(item){return item.eventDate<='2026-08-15';}));
assert.strictEqual(analytics.latestCompletedDate(rows,options),'2026-08-01');
console.log('event-retention-analytics tests passed');
