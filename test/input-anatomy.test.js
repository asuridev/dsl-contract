'use strict';

// Smoke tests for the shared input-anatomy validator. The package historically
// had no tests of its own (exercised by both consumers); this guards the one
// piece of non-trivial centralized logic before tagging a release.
//
// Run: node test/input-anatomy.test.js   (also wired into `npm test`)

const assert = require('assert');
const { validateUseCaseInputAnatomy } = require('../src');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function codes(bcYaml) {
  return validateUseCaseInputAnatomy(bcYaml).map((d) => d.code);
}
function uc(input) {
  return { id: 'UC-1', name: 'Do', type: 'command', input };
}

test('maxSize as a raw byte integer -> BC-024', () => {
  const diags = validateUseCaseInputAnatomy({
    bc: 'catalog',
    useCases: [uc([{ name: 'image', type: 'File', source: 'multipart', partName: 'image', maxSize: 5242880 }])],
  });
  assert.ok(diags.some((d) => d.code === 'BC-024' && /maxSize must be a size string/.test(d.message)));
});

test('maxSize as a unit string -> no error', () => {
  assert.deepStrictEqual(
    codes({ bc: 'catalog', useCases: [uc([{ name: 'image', type: 'File', source: 'multipart', partName: 'image', maxSize: '5MB' }])] }),
    []
  );
});

test('multipart part with non-File/non-scalar/non-enum type -> BC-024 (superset)', () => {
  assert.deepStrictEqual(
    codes({ bc: 'c', useCases: [uc([{ name: 'x', type: 'SomeVo', source: 'multipart' }])] }),
    ['BC-024']
  );
});

test('multipart part typed as a declared enum -> no error', () => {
  assert.deepStrictEqual(
    codes({ bc: 'c', enums: [{ name: 'ImageType' }], useCases: [uc([{ name: 'it', type: 'ImageType', source: 'multipart' }])] }),
    []
  );
});

test('max on a Decimal input -> no error (superset includes Decimal)', () => {
  assert.deepStrictEqual(
    codes({ bc: 'c', useCases: [uc([{ name: 'qty', type: 'Decimal', source: 'query', max: 10 }])] }),
    []
  );
});

test('unsupported source -> BC-022', () => {
  assert.ok(codes({ bc: 'c', useCases: [uc([{ name: 'x', type: 'String', source: 'cookie' }])] }).includes('BC-022'));
});

test('source: header without headerName -> BC-023', () => {
  assert.ok(codes({ bc: 'c', useCases: [uc([{ name: 'x', type: 'String', source: 'header' }])] }).includes('BC-023'));
});

test('contentTypes with an invalid MIME entry -> BC-024', () => {
  assert.ok(codes({ bc: 'c', useCases: [uc([{ name: 'f', type: 'File', source: 'multipart', contentTypes: ['not-a-mime'] }])] }).includes('BC-024'));
});

test('Range[Boolean] (non-orderable) -> BC-090', () => {
  assert.ok(codes({ bc: 'c', useCases: [uc([{ name: 'r', type: 'Range[Boolean]', source: 'query' }])] }).includes('BC-090'));
});

test('mixing multipart with body -> BC-024', () => {
  assert.ok(codes({
    bc: 'c',
    useCases: [uc([
      { name: 'f', type: 'File', source: 'multipart', partName: 'f' },
      { name: 'b', type: 'String', source: 'body' },
    ])],
  }).includes('BC-024'));
});

console.log(`\n${passed} passed`);
