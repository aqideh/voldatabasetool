const assert=require('assert');
const analytics=require('../assets/community-deployment-analytics.js');

const volunteers=[
  {name:'A',email:'a@example.com',phone:'',programmesRegistered:'Community Volunteers'},
  {name:'B',email:'b@example.com',phone:'81234567',programmesRegistered:'#amPowered, Community Volunteers'},
  {name:'C',email:'c@example.com',phone:'',programmesRegistered:'RSL'},
  {name:'D',email:'',phone:'90001111',programmesRegistered:'community volunteers'}
];

const rows=[
  {name:'A',email:'a@example.com',contact:'',attendance:'yes',eventName:'One'},
  {name:'A',email:'a@example.com',contact:'',attendance:'',eventName:'Two'},
  {name:'B',email:'',contact:'8123 4567',attendance:'yes',eventName:'Three'},
  {name:'B',email:'b@example.com',contact:'',attendance:'yes',eventName:'Four'},
  {name:'C',email:'c@example.com',contact:'',attendance:'yes',eventName:'Five'},
  {name:'D',email:'',contact:'+65 9000 1111',attendance:'',eventName:'Six'},
  {name:'Unknown',email:'unknown@example.com',contact:'',attendance:'yes',eventName:'Seven'}
];

const summary=analytics.summary(volunteers,rows);
assert.deepStrictEqual(summary,{attended:3,total:5});
assert.strictEqual(analytics.communityDeploymentRows(volunteers,rows).length,5);
assert.strictEqual(analytics.isCommunityVolunteer(volunteers[0]),true);
assert.strictEqual(analytics.isCommunityVolunteer(volunteers[2]),false);

console.log('community-deployment-analytics tests passed');
