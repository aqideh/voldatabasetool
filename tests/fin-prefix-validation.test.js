const assert=require('assert');
const validation=require('../assets/fin-prefix-validation.js');

['S1234567A','T1234567B','F1234567C','G1234567D','M1234567E'].forEach(function(value){
  assert.strictEqual(validation.isValid(value),true,value+' should be accepted');
});

assert.strictEqual(validation.isValid(''),true,'blank identity should remain optional');
assert.strictEqual(validation.isValid('G 1234567 D'),true,'spaces should be normalised');
['A1234567A','G123456A','G12345678','G1234567AA'].forEach(function(value){
  assert.strictEqual(validation.isValid(value),false,value+' should be rejected');
});

console.log('FIN prefix validation tests passed');