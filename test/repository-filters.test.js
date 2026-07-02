'use strict';

// Smoke tests for the shared repository-filter validator (LIKE only on scalar
// aggregate fields). Guards the parity rule extracted from dsl-springboot-generator
// before tagging a release.
//
// Run: node test/repository-filters.test.js   (also wired into `npm test`)

const assert = require('assert');
const { validateRepositoryFilters } = require('../src');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// A bc doc with one aggregate `Product` whose `sku` is a value object and `name`
// is a plain String, plus a status enum. `repo` lets a test inject queryMethods.
function doc(repo) {
  return {
    bc: 'catalog',
    enums: [{ name: 'ProductStatus' }],
    valueObjects: [{ name: 'SKU', properties: [{ name: 'value', type: 'String(50)' }] }],
    aggregates: [
      {
        name: 'Product',
        properties: [
          { name: 'sku', type: 'SKU' },
          { name: 'name', type: 'String(200)' },
          { name: 'status', type: 'ProductStatus' },
        ],
      },
    ],
    repositories: [{ aggregate: 'Product', ...repo }],
  };
}

function query(param) {
  return { queryMethods: [{ name: 'findProductsByCriteria', returns: 'Page[Product]', params: [param] }] };
}

function codes(bcYaml) {
  return validateRepositoryFilters(bcYaml).map((d) => d.code);
}

test('LIKE_CONTAINS on a value-object field -> BC-160', () => {
  const diags = validateRepositoryFilters(
    doc(query({ name: 'search', type: 'String(200)', filterOn: ['sku'], operator: 'LIKE_CONTAINS' })),
  );
  assert.deepStrictEqual(diags.map((d) => d.code), ['BC-160']);
  assert.ok(/uses LIKE_CONTAINS on field "sku" of type "SKU"/.test(diags[0].message));
  assert.ok(/LIKE filters are supported only on scalar aggregate fields/.test(diags[0].message));
});

test('LIKE_CONTAINS mixing a scalar and a VO field -> one BC-160 (only the VO)', () => {
  const diags = validateRepositoryFilters(
    doc(query({ name: 'search', type: 'String(200)', filterOn: ['name', 'sku'], operator: 'LIKE_CONTAINS' })),
  );
  assert.deepStrictEqual(diags.map((d) => d.code), ['BC-160']);
  assert.ok(/field "sku"/.test(diags[0].message));
});

test('LIKE_CONTAINS on a scalar String field -> no error', () => {
  assert.deepStrictEqual(
    codes(doc(query({ name: 'search', type: 'String(200)', filterOn: ['name'], operator: 'LIKE_CONTAINS' }))),
    [],
  );
});

test('LIKE_STARTS on a declared enum field -> no error', () => {
  assert.deepStrictEqual(
    codes(doc(query({ name: 'search', type: 'String(200)', filterOn: ['status'], operator: 'LIKE_STARTS' }))),
    [],
  );
});

test('EQ operator on a value-object field -> no error (only LIKE_* is gated)', () => {
  assert.deepStrictEqual(
    codes(doc(query({ name: 'sku', type: 'SKU', filterOn: ['sku'], operator: 'EQ' }))),
    [],
  );
});

test('unknown filterOn field -> no error here (validated elsewhere)', () => {
  assert.deepStrictEqual(
    codes(doc(query({ name: 'search', type: 'String(200)', filterOn: ['nope'], operator: 'LIKE_CONTAINS' }))),
    [],
  );
});

test('no repositories / empty doc -> no error', () => {
  assert.deepStrictEqual(codes({ bc: 'catalog' }), []);
  assert.deepStrictEqual(codes({}), []);
});

console.log(`\n${passed} passed`);
