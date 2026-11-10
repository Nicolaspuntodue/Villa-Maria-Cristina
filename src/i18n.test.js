import assert from 'node:assert/strict';
import { LANGS, T, pickLang, fill } from './i18n.js';

assert.equal(pickLang(['de-CH', 'en']), 'de');
assert.equal(pickLang(['pt-BR', 'es-419']), 'es');
assert.equal(pickLang(['ja']), 'en');
assert.equal(pickLang([]), 'en');
assert.equal(pickLang(['IT']), 'it');

// every language has exactly the Italian keys, none empty
const keys = Object.keys(T.it).sort();
for (const l of LANGS) {
  assert.deepEqual(Object.keys(T[l]).sort(), keys, `keys differ in ${l}`);
  for (const k of keys) assert.ok(T[l][k].length > 0, `${l}.${k} empty`);
  assert.equal(T[l]['sea.dirs'].length, 8);
}
assert.equal(fill('a {x} b {y}', { x: 1, y: 'z' }), 'a 1 b z');
console.log('i18n ok');
