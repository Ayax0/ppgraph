// The searchable picker, tested where it can be: the filter and the threshold.
//
// Driving a real prompt needs a terminal, which a test does not have — so the decision that
// actually matters is split out. What is left untested here is inquirer's own rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCHABLE_FROM, filterChoices } from '../dist/ui/prompt.js';

const choices = [
  { name: 'svc-automation@northwind.example', description: 'northwind.onmicrosoft.com · 44445555-6666' },
  { name: 'admin@fabrikam.example', description: 'fabrikam.onmicrosoft.com · 11111111-2222' },
  { name: 'maker@contoso.example', description: 'contoso.onmicrosoft.com · 99999999-8888' },
];

test('an empty term keeps everything', () => {
  assert.equal(filterChoices(choices, '').length, 3);
});

test('the term matches the name and the description alike', () => {
  assert.deepEqual(filterChoices(choices, 'northwind').map((c) => c.name), ['svc-automation@northwind.example']);
  // The tenant domain lives in the description, and it is what people remember.
  assert.deepEqual(filterChoices(choices, 'fabrikam').map((c) => c.name), ['admin@fabrikam.example']);
  // As does the tenant id, for the case where the domain is not what one has to hand.
  assert.deepEqual(filterChoices(choices, '99999999').map((c) => c.name), ['maker@contoso.example']);
});

test('the search is case-insensitive', () => {
  assert.equal(filterChoices(choices, 'NorthWind').length, 1);
  assert.equal(filterChoices(choices, 'ConToSo').length, 1);
});

test('a term nobody matches leaves an empty list', () => {
  // Which is exactly why "New connection …" is appended outside the filter.
  assert.deepEqual(filterChoices(choices, 'nothing-like-this'), []);
});

test('the threshold is where a page stops fitting', () => {
  assert.equal(typeof SEARCHABLE_FROM, 'number');
  assert.ok(SEARCHABLE_FROM > 3 && SEARCHABLE_FROM <= 12, 'small enough to help, large enough not to nag');
});
