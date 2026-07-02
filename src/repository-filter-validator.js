'use strict';

/**
 * Shared "repository filter" validator.
 *
 * Single source of truth for the rule that a LIKE filter (`LIKE_CONTAINS`,
 * `LIKE_STARTS`, `LIKE_ENDS`) declared via a repository query-method param's
 * `filterOn` may only target a *scalar* aggregate field — not a value object,
 * projection, aggregate or other composite type. LIKE builds a SQL `LIKE` over a
 * single text column downstream; a value-object-typed field (e.g. `SKU`) expands
 * to one or more columns the generator cannot deterministically pattern-match.
 *
 * Formerly this rule lived only in dsl-springboot-generator
 * (src/utils/bc-yaml-reader.js `isScalarComparableType`), so dsl-design-system
 * (Phase 1) accepted designs the generator later rejected at build time. This
 * module is the reconciled single copy both phases consume:
 *   - Phase 1 merges the diagnostics into its own array.
 *   - Phase 2 calls it and fail()s on the first `level: 'error'` diagnostic.
 *
 * It follows the @dsl/contract convention: pure function, takes a parsed
 * `<bc>.yaml` object, returns a flat Diagnostic[] (it does not throw).
 *
 * @typedef {Object} Diagnostic
 * @property {string} code      e.g. "BC-160"
 * @property {'error'|'warn'} level
 * @property {string} message
 * @property {string} location  approximate YAML pointer
 *
 * NOTE on codes: we keep BC-160 (the code Phase 1 already emits for repository
 * filter validation) so its test suite stays green. Phase 2 ignores the code and
 * surfaces only the message via fail().
 */

// Scalar canonical types a LIKE filter may target. Mirrors the generator's
// isScalarComparableType (bc-yaml-reader.js). Deliberately a strict subset —
// NOT isCanonicalType — because composite canonicals like `Money` expand to
// multiple columns and are not LIKE-comparable.
const COMPARABLE_SCALAR_TYPES = new Set([
  'Uuid', 'String', 'Text', 'Email', 'Integer', 'Long', 'Boolean', 'Decimal', 'DateTime', 'Date', 'Url',
]);

function isMapping(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

// Strip type decorations to the base type name. Mirrors bc-yaml-reader.js typeBase:
// `String(50)` → `String`, `List[Foo]` → `Foo`, `Enum<Bar>` → `Bar`.
function typeBase(type) {
  return String(type || '')
    .replace(/\(.*\)$/, '')
    .replace(/^List\[(.+)\]$/, '$1')
    .replace(/^Enum<(.+)>$/, '$1')
    .trim();
}

// name -> declared type for every field of an aggregate, plus the synthetic
// audit/id fields the generator injects. Mirrors bc-yaml-reader.js aggregateFieldMap.
function aggregateFieldTypeMap(aggregate) {
  const map = new Map();
  if (!aggregate) return map;
  for (const prop of [
    ...(Array.isArray(aggregate.properties) ? aggregate.properties : []),
    ...(Array.isArray(aggregate.attributes) ? aggregate.attributes : []),
    ...(Array.isArray(aggregate.fields) ? aggregate.fields : []),
  ]) {
    if (prop && prop.name) map.set(prop.name, prop.type || 'String');
  }
  map.set('id', 'Uuid');
  map.set('createdAt', 'DateTime');
  map.set('updatedAt', 'DateTime');
  map.set('deletedAt', 'DateTime');
  return map;
}

/**
 * Validate repository query-method LIKE filters in a parsed `<bc>.yaml`.
 * @param {object} bcYaml parsed bounded-context document (with `bc`, `enums`, `aggregates`, `repositories`)
 * @returns {Diagnostic[]}
 */
function validateRepositoryFilters(bcYaml) {
  const diagnostics = [];
  const doc = bcYaml || {};
  const bc = doc.bc || '<unknown-bc>';

  const error = (message, location) => {
    diagnostics.push({ code: 'BC-160', level: 'error', message, location: location || `arch/${bc}/${bc}.yaml` });
  };

  const enumNames = new Set((Array.isArray(doc.enums) ? doc.enums : []).map((e) => e && e.name).filter(Boolean));
  const aggregateByName = new Map(
    (Array.isArray(doc.aggregates) ? doc.aggregates : [])
      .filter((a) => a && a.name)
      .map((a) => [a.name, a]),
  );
  const voByName = new Map(
    (Array.isArray(doc.valueObjects) ? doc.valueObjects : [])
      .filter((v) => v && v.name)
      .map((v) => [v.name, v]),
  );

  // A field is LIKE-comparable if it is a scalar canonical/enum, OR a
  // single-property value object. A 1-property VO flattens to exactly one column
  // named after the field (Phase 2 jpa-entity-generator: `String sku`), so LIKE on
  // it is unambiguous — we resolve it to its inner scalar. Multi-property VOs (e.g.
  // Money → amount+currency) expand to N columns and stay non-scalar: filter those
  // via the expanded column name instead. `seen` guards against VO reference cycles.
  const isScalarComparableType = (type, seen) => {
    const base = typeBase(type);
    if (COMPARABLE_SCALAR_TYPES.has(base) || enumNames.has(base)) return true;
    const vo = voByName.get(base);
    if (vo && Array.isArray(vo.properties) && vo.properties.length === 1) {
      const guard = seen || new Set();
      if (guard.has(base)) return false;
      guard.add(base);
      return isScalarComparableType(vo.properties[0].type, guard);
    }
    return false;
  };

  const repositories = Array.isArray(doc.repositories) ? doc.repositories : [];
  for (const repo of repositories) {
    if (!isMapping(repo) || !repo.aggregate) continue;
    const aggregate = aggregateByName.get(repo.aggregate);
    if (!aggregate) continue; // aggregate existence is validated elsewhere
    const fieldMap = aggregateFieldTypeMap(aggregate);

    const allMethods = [
      ...(Array.isArray(repo.queryMethods) ? repo.queryMethods : []).map((m) => ({ m, section: 'queryMethods' })),
      ...(Array.isArray(repo.methods) ? repo.methods : []).map((m) => ({ m, section: 'methods' })),
    ];

    for (const { m, section } of allMethods) {
      if (!isMapping(m) || !Array.isArray(m.params)) continue;
      const ctx = `repositories["${repo.aggregate}"].${section}["${m.name || m.signature}"]`;
      for (const p of m.params) {
        if (!isMapping(p)) continue;
        if (!Array.isArray(p.filterOn)) continue;
        if (!p.operator || !String(p.operator).startsWith('LIKE_')) continue;
        for (const field of p.filterOn) {
          if (!fieldMap.has(field)) continue; // unknown-field is validated elsewhere
          const fieldType = fieldMap.get(field);
          if (!isScalarComparableType(fieldType)) {
            error(
              `${ctx} param "${p.name}" uses ${p.operator} on field "${field}" of type "${fieldType}". LIKE filters are supported only on scalar aggregate fields.`,
            );
          }
        }
      }
    }
  }

  return diagnostics;
}

module.exports = {
  validateRepositoryFilters,
  COMPARABLE_SCALAR_TYPES,
};
