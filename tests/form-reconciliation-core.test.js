const assert=require('assert');
const C=require('../assets/form-reconciliation-core.js');
const csvIn=`Expected total responses,3
Success count,3
Error count,0
Unverified response count,0
See download status column for download errors
Response ID,Timestamp,Download Status,Full Name,Email Address,Phone Number,Event Deployed For:,Number of Shirts Collected,Shirt Size
a1,29 Aug 2026 08:30:00 AM,Success,Alex Tan,alex@example.com,+65 9123 4567,Event A,1,M
a2,29 Aug 2026 08:31:00 AM,Success,Alex Tan,alex@example.com,91234567,Event A,1,L
a3,29 Aug 2026 09:00:00 AM,Success,Siti Aminah,siti@example.com,82223333,Event B,0,S
`;
const csvOut=`Expected total responses,2
Success count,2
Error count,0
Unverified response count,0
See download status column for download errors
Response ID,Timestamp,Download Status,Full Name,Email Address,Phone Number,Event Deployed For:,What is your age group?,What is your gender?,How long have you been volunteering with MENDAKI?,How frequently do you volunteer with MENDAKI?,The staff did a thorough briefing with the volunteers,The onboarding process helped me understand my volunteer role.,I am satisfied with the assigned role,MENDAKI staff are approachable and supportive,What can MENDAKI do to improve your volunteer experience?,Would you recommend volunteering with MENDAKI to your social circle, or continue volunteering with us?,Interested in volunteering or referring a friend? Drop us your email address!
b1,29 Aug 2026 01:00:00 PM,Success,Alexander Tan,ALEX@example.com,6591234567,Event A,21 - 30,Male,Less than 6 months,Monthly,5,4,5,5,More water,Yes,alex@example.com
b2,29 Aug 2026 02:00:00 PM,Success,No Sign In,nsi@example.com,81112222,Event C,31 - 40,Female,1 - 3 years,Once a year,4,4,4,4,None,No,nsi@example.com
`;
const ins=C.parseSignInCsv(csvIn,'in.csv');
const outs=C.parseSignOutCsv(csvOut,'out.csv');
assert.equal(ins.length,3);assert.equal(outs.length,2);
assert.equal(ins[0].timestamp.iso,'2026-08-29T08:30:00+08:00');
assert.equal(C.normalizePhone('+65 9123 4567'),'91234567');
assert(C.nameSimilarity('Ajith Kumar','Panner Selvam Ajith Kumar')>0.6);
const volunteers=[{id:'v1',name:'Alex Tan',email:'alex@example.com',phone:'91234567'},{id:'v2',name:'Siti Aminah',email:'siti@example.com',phone:'82223333'}];
const sessions=C.reconcile(ins,outs,volunteers);
assert.equal(sessions.length,4);
const matched=sessions.find(s=>s.signIn&&s.signOut&&s.signOut.responseId==='b1');
assert(matched);assert.equal(matched.calculatedMinutes,270);assert.equal(matched.volunteerMatch.id,'v1');assert(matched.reviewFlags.includes('possible_duplicate'));
const outOnly=sessions.find(s=>s.signOut&&s.signOut.responseId==='b2');assert.equal(outOnly.matchStatus,'missing_sign_in');
const shirts=C.shirtSummary(sessions);assert.equal(shirts.total,2);assert.equal(shirts.flaggedQuantity,2);
const feedback=C.feedbackSummary(sessions);assert.equal(feedback.count,2);assert.equal(feedback.averages.briefing,4.5);assert.equal(feedback.recommendYes,1);assert.equal(feedback.recommendNo,1);
matched.staffCreditedMinutes=300;assert.equal(C.finalMinutes(matched),300);assert(C.batchId(ins,outs).startsWith('batch_'));
console.log('form reconciliation core tests passed');
