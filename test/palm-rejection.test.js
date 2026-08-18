const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuard } = require('../palm-rejection.js');

function event(pointerId, pointerType = 'touch') {
  return { pointerId, pointerType };
}

test('a one-finger pointer stream remains available to reveal', () => {
  const block = createGuard();
  assert.equal(block('pointerdown', event(1)), false);
  assert.equal(block('pointermove', event(1)), false);
  assert.equal(block('pointerup', event(1)), false);
});

test('all contacts are quarantined after a second finger or palm contact', () => {
  const block = createGuard();
  assert.equal(block('pointerdown', event(1)), false);
  assert.equal(block('pointerdown', event(2)), true);
  assert.equal(block('pointermove', event(1)), true);
  assert.equal(block('pointermove', event(2)), true);
  assert.equal(block('pointerup', event(2)), true);
  assert.equal(block('pointerup', event(1)), true);

  // Rejection ends only after every contact has lifted.
  assert.equal(block('pointerdown', event(3)), false);
});

test('pen and mouse pointers do not count as palm contacts', () => {
  const block = createGuard();
  assert.equal(block('pointerdown', event(1, 'pen')), false);
  assert.equal(block('pointerdown', event(2, 'touch')), false);
  assert.equal(block('pointermove', event(2, 'touch')), false);
});
