'use strict';

/**
 * Shared "input anatomy" validator for use-case inputs.
 *
 * Single source of truth for the per-input shape rules that previously lived as
 * drifting copies in both consumers (GAP-3):
 *   - dsl-design-system   src/utils/bc-yaml-validator.js  (class BcYamlValidator, BC-* codes)
 *   - dsl-springboot-generator src/utils/bc-yaml-reader.js (fail() throw-on-first-error)
 *
 * This module is the reconciled SUPERSET of both. It follows the @dsl/contract
 * convention: pure function, takes a parsed `<bc>.yaml` object, returns a flat
 * Diagnostic[] (it does not throw). Consumers adapt:
 *   - Phase 1 merges the diagnostics into its own array.
 *   - Phase 2 calls it and fail()s on the first `level: 'error'` diagnostic.
 *
 * @typedef {Object} Diagnostic
 * @property {string} code      e.g. "BC-024"
 * @property {'error'|'warn'} level
 * @property {string} message
 * @property {string} location  approximate YAML pointer
 *
 * NOTE on codes: we keep the BC-* codes that Phase 1 already emits so its test
 * suite (which asserts on specific codes/messages) stays green. Phase 2 ignores
 * the codes and only surfaces the message via fail().
 */

// Whitelists/constants formerly duplicated as literals in both consumers.
const ALLOWED_UC_INPUT_KEYS = new Set([
  'name', 'type', 'required', 'source', 'loadAggregate',
  // header source
  'headerName',
  // defaults + numeric max
  'default', 'max',
  // multipart source
  'partName', 'maxSize', 'contentTypes',
  // SearchText fields[] (which aggregate properties to search)
  'fields',
]);
const ALLOWED_UC_INPUT_SOURCES = new Set(['body', 'path', 'query', 'authContext', 'header', 'multipart']);
// Non-File parts of a multipart request must be scalar form-data types (or a
// declared enum). Mirrors dsl-springboot-generator MULTIPART_FORM_SCALARS.
const MULTIPART_FORM_SCALARS = new Set(['String', 'Integer', 'Long', 'Boolean', 'Decimal']);
// Range[T] builds a between() filter downstream and needs an order-comparable scalar.
const RANGE_ORDERABLE_TYPES = new Set(['Integer', 'Long', 'Decimal', 'Date', 'DateTime', 'Duration', 'String', 'Uuid']);

const MAXSIZE_RE = /^\d+(B|KB|MB|GB)$/;
const SAFE_PART_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;
const NUMERIC_MAX_TYPE_RE = /^(Integer|Long|int|long|BigDecimal|Decimal)$/;

function isMapping(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Validate the input anatomy of every use case in a parsed `<bc>.yaml`.
 * @param {object} bcYaml parsed bounded-context document (with `bc`, `enums`, `useCases`)
 * @returns {Diagnostic[]}
 */
function validateUseCaseInputAnatomy(bcYaml) {
  const diagnostics = [];
  const doc = bcYaml || {};
  const bc = doc.bc || '<unknown-bc>';
  const enumNames = new Set((Array.isArray(doc.enums) ? doc.enums : []).map((e) => e && e.name).filter(Boolean));
  const useCases = Array.isArray(doc.useCases) ? doc.useCases : [];

  const error = (code, message, location) => {
    diagnostics.push({ code, level: 'error', message, location: location || `arch/${bc}/${bc}.yaml` });
  };

  for (let i = 0; i < useCases.length; i++) {
    const uc = useCases[i];
    if (!isMapping(uc)) continue; // non-mapping use cases are reported by the caller's UC-core checks
    const baseLoc = `arch/${bc}/${bc}.yaml#/useCases/${i}`;
    if (uc.input == null) continue;
    if (!Array.isArray(uc.input)) {
      error('BC-020', `Use case "${uc.id}" input must be a list.`, `${baseLoc}/input`);
      continue;
    }

    for (let j = 0; j < uc.input.length; j++) {
      const input = uc.input[j];
      const loc = `${baseLoc}/input/${j}`;
      if (!isMapping(input)) {
        error('BC-020', `Use case "${uc.id}" input[] contains a non-mapping entry.`, loc);
        continue;
      }

      // Unknown keys (whitelist).
      for (const key of Object.keys(input)) {
        if (key === '_section') continue;
        if (!ALLOWED_UC_INPUT_KEYS.has(key)) {
          error('BC-012', `Use case "${uc.id}" input "${input.name || '<unnamed>'}" declares unsupported attribute "${key}". Allowed keys: ${[...ALLOWED_UC_INPUT_KEYS].join(', ')}.`, `${loc}/${key}`);
        }
      }

      // Required fields.
      if (!input.name) error('BC-021', `Use case "${uc.id}" has an input without name.`, `${loc}/name`);
      if (!input.type) error('BC-021', `Use case "${uc.id}" input "${input.name || '<unnamed>'}" is missing required field type.`, `${loc}/type`);
      if (!input.source) error('BC-021', `Use case "${uc.id}" input "${input.name || '<unnamed>'}" is missing required field source.`, `${loc}/source`);
      if (input.source && !ALLOWED_UC_INPUT_SOURCES.has(input.source)) error('BC-022', `Use case "${uc.id}" input "${input.name}" has unsupported source "${input.source}".`, `${loc}/source`);

      // header source <-> headerName coupling.
      if (input.source === 'header' && (!input.headerName || typeof input.headerName !== 'string')) error('BC-023', `Use case "${uc.id}" input "${input.name}" declares source: header but is missing headerName.`, `${loc}/headerName`);
      if (input.headerName != null && input.source !== 'header') error('BC-023', `Use case "${uc.id}" input "${input.name}" declares headerName but source is not header.`, `${loc}/headerName`);

      // multipart parts must be a File, a scalar form-data type, or a declared enum.
      if (input.source === 'multipart') {
        const baseType = String(input.type || '').replace(/\(.*\)/, '').trim();
        if (baseType !== 'File' && !MULTIPART_FORM_SCALARS.has(baseType) && !enumNames.has(baseType)) {
          error('BC-024', `Use case "${uc.id}" input "${input.name}" declares source: multipart but type is "${input.type}". Multipart parts must be a File or a scalar form-data type (${[...MULTIPART_FORM_SCALARS].join(', ')}, or a declared enum).`, `${loc}/type`);
        }
      }

      // A multipart UC may carry a File part plus scalar/enum form-field parts.
      // Only File parts accept the binary qualifiers maxSize/contentTypes.
      if (input.type === 'File' && input.source !== 'multipart') error('BC-024', `Use case "${uc.id}" input "${input.name}" has type File but source is not multipart.`, `${loc}/source`);
      for (const key of ['partName', 'maxSize', 'contentTypes']) {
        if (input[key] != null && input.source !== 'multipart') error('BC-024', `Use case "${uc.id}" input "${input.name}" declares ${key} but source is not multipart.`, `${loc}/${key}`);
      }
      for (const key of ['maxSize', 'contentTypes']) {
        if (input[key] != null && input.type !== 'File') error('BC-024', `Use case "${uc.id}" input "${input.name}" declares ${key} but type is not File.`, `${loc}/${key}`);
      }

      // partName must be a string and a safe identifier (interpolated into Java literals).
      if (input.partName != null && typeof input.partName !== 'string') error('BC-024', `Use case "${uc.id}" input "${input.name}" partName must be a string (the multipart form-data part identifier).`, `${loc}/partName`);
      if (typeof input.partName === 'string' && !SAFE_PART_NAME_RE.test(input.partName)) error('BC-024', `Use case "${uc.id}" input "${input.name}" partName "${input.partName}" must be a safe identifier (letters, digits, underscore and hyphen; not starting with a digit or hyphen).`, `${loc}/partName`);

      // maxSize is a size string with unit (e.g. "10MB"), NOT a raw byte integer.
      if (input.maxSize != null && (typeof input.maxSize !== 'string' || !MAXSIZE_RE.test(input.maxSize))) error('BC-024', `Use case "${uc.id}" input "${input.name}" maxSize must be a size string like "10MB" (units: B, KB, MB, GB), not a raw byte number.`, `${loc}/maxSize`);

      // contentTypes is a non-empty array of valid MIME-type strings.
      if (input.contentTypes != null) {
        if (!Array.isArray(input.contentTypes) || input.contentTypes.length === 0 || input.contentTypes.some((c) => typeof c !== 'string')) {
          error('BC-024', `Use case "${uc.id}" input "${input.name}" contentTypes must be a non-empty array of MIME-type strings (e.g. ["image/png", "image/jpeg"]).`, `${loc}/contentTypes`);
        }
        for (const c of input.contentTypes) {
          if (typeof c === 'string' && !MIME_RE.test(c)) error('BC-024', `Use case "${uc.id}" input "${input.name}" contentTypes entry "${c}" is not a valid MIME type (expected "type/subtype", e.g. "image/png").`, `${loc}/contentTypes`);
        }
      }

      // max only on numeric inputs.
      if (input.max != null) {
        if (typeof input.max !== 'number' || !Number.isInteger(input.max)) error('BC-025', `Use case "${uc.id}" input "${input.name}" max must be an integer.`, `${loc}/max`);
        if (!NUMERIC_MAX_TYPE_RE.test(String(input.type))) error('BC-025', `Use case "${uc.id}" input "${input.name}" declares max but type is not numeric.`, `${loc}/max`);
      }

      // SearchText requires a non-empty fields[].
      if (input.type === 'SearchText' && (!Array.isArray(input.fields) || input.fields.length === 0 || input.fields.some((f) => typeof f !== 'string' || !f.trim()))) {
        error('BC-026', `Use case "${uc.id}" input "${input.name}" type SearchText requires a non-empty fields list.`, `${loc}/fields`);
      }
      if (input.fields != null && input.type !== 'SearchText') error('BC-026', `Use case "${uc.id}" input "${input.name}" declares fields but type is not SearchText.`, `${loc}/fields`);

      // Range[T] requires an order-comparable scalar inner type.
      const rangeMatch = /^Range\[(.+)\]$/.exec(String(input.type || ''));
      if (rangeMatch) {
        const inner = rangeMatch[1].replace(/\(.*\)/, '').trim();
        if (!RANGE_ORDERABLE_TYPES.has(inner)) {
          error('BC-090', `Use case "${uc.id}" input "${input.name}" declares "${input.type}", but Range filters require an order-comparable scalar inner type (${[...RANGE_ORDERABLE_TYPES].join(', ')}). "${inner}" is not orderable.`, `${loc}/type`);
        }
      }
    }

    // When any input is multipart, no other input may be source: body.
    const hasMultipart = uc.input.some((it) => isMapping(it) && it.source === 'multipart');
    if (hasMultipart && uc.input.some((it) => isMapping(it) && it.source === 'body')) {
      error('BC-024', `Use case "${uc.id}" mixes source: multipart with source: body.`, `${baseLoc}/input`);
    }
  }

  return diagnostics;
}

module.exports = {
  validateUseCaseInputAnatomy,
  ALLOWED_UC_INPUT_KEYS,
  ALLOWED_UC_INPUT_SOURCES,
  MULTIPART_FORM_SCALARS,
  RANGE_ORDERABLE_TYPES,
};
