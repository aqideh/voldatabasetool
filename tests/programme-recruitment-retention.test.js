const assert=require('assert');
const analytics=require('../assets/programme-recruitment-retention.js');
const volunteers=[
  {name:'New Active',email:'new@example.com',phone:'',recruitedYear:'2026',programmesRegistered:'Community Volunteers'},
  {name:'New Inactive',email:'new2@example.com',phone:'',recruitedYear:'2026',programmesRegistered:'Community Volunteers'},
  {name:'Old Active',email:'old@example.com',phone:'',recruitedYear:'2025',programmesRegistered:'Community Volunteers'},
  {name:'Old No Show',email:'old2@example.com',phone:'',recruitedYear:'2024',programmesRegistered:'Community Volunteers'},
  {name:'Old Other Programme',email:'rsl@example.com',phone:'',recruitedYear:'2023',programmesRegistered:'RSL'},
  {name:'Multi Programme',email:'multi@example.com',phone:'',recruitedYear:'2025',programmesRegistered:'RSL, Community Volunteers'},
  {name:'Missing Year',email:'missing@example.com',phone:'',recruitedYear:'',programmesRegistered:'Community Volunteers'},
  {name:'Phone Match',email:'',phone:'+65 9123 4567',recruitedYear:'2022',programmesRegistered:'Befrienders'}
];
const rows=[
  {email:'new@example.com',contact:'',attendance:'yes',eventDate:'2026-02-01'},
  {email:'old@example.com',contact:'',attendance:'yes',eventDate:'2026-03-01'},
  {email:'old2@example.com',contact:'',attendance:'',eventDate:'2026-03-02'},
  {email:'rsl@example.com',contact:'',attendance:'yes',eventDate:'2026-04-01'},
  {email:'multi@example.com',contact:'',attendance:'yes',eventDate:'2026-05-01'},
  {email:'',contact:'91234567',attendance:'yes',eventDate:'2026-06-01'},
  {email:'old@example.com',contact:'',attendance:'yes',eventDate:'2025-12-01'}
];
const result=analytics.summary(volunteers,rows,['Community Volunteers','RSL','Befrienders'],2026);
assert.deepStrictEqual(result[0],{programme:'Community Volunteers',recruited:2,deployed:4,retained:2,missingRecruitedYear:1});
assert.deepStrictEqual(result[1],{programme:'RSL',recruited:0,deployed:2,retained:2,missingRecruitedYear:0});
assert.deepStrictEqual(result[2],{programme:'Befrienders',recruited:0,deployed:1,retained:1,missingRecruitedYear:0});
console.log('programme recruitment retention tests passed');