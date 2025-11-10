const argon2 = require('argon2');

const hash = '$argon2id$v=19$m=65536,t=3,p=1$zhPy2+o/tiQSqmI0kv7Qhg$xsZMbb1FMAwPcdNU+Vp8s5gsEdLPJgTuR1RwRofJTo0';
const password = 'test';

console.log('Hash:', hash);
console.log('Password:', password);

argon2.verify(hash, password)
  .then(result => {
    console.log('Verification result:', result);
  })
  .catch(err => {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);
  });
