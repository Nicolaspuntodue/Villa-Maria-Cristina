import assert from 'node:assert/strict';
import { shelter, peak } from './wind.js';

assert.deepEqual(shelter(315, 18.4), { sector: 7, name: 'Maestrale', kn: 18, beach: 'Rena di Levante' });
assert.equal(shelter(270, 12).beach, 'Rena di Levante');
assert.equal(shelter(90, 12).beach, 'Rena di Ponente');
assert.equal(shelter(45, 12).name, 'Grecale');
assert.equal(shelter(350, 12).name, 'Tramontana'); // wraps to north
assert.equal(shelter(-90, 12).name, 'Ponente');
assert.equal(shelter(300, 3).beach, null);          // calm: any beach
assert.deepEqual(peak([{ h: '14:00', kn: 9 }, { h: '15:00', kn: 18 }, { h: '16:00', kn: 18 }]), { h: '15:00', kn: 18 });
console.log('wind ok');
