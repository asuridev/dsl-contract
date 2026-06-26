# @dsl/contract

Single source of truth for the DSL YAML **contract validators** shared by the two
phases of the pipeline:

- **Phase 1** — `dsl-design-system` (validates design YAML: `dsl validate`)
- **Phase 2** — `dsl-springboot-generator` (consumes design YAML: `dsl-springboot build`)

## Installation

Both repos depend on this package via a **git URL pinned to a tag**, so a fresh
`git clone` + `npm install` of either consumer resolves it from GitHub — no
sibling checkout, no registry, no `.npmrc`:

```json
"@dsl/contract": "git+https://github.com/asuridev/dsl-contract.git#v0.1.0"
```

The repo is **public**, so the install needs no credentials (works in CI too).
npm clones it and installs its own dependency (`fs-extra`) automatically.

### Local development of this package

A git-URL dependency does **not** reflect local edits to this folder. To iterate
on the validators while developing a consumer, use `npm link`:

```bash
cd dsl-contract && npm link
cd ../dsl-springboot-generator && npm link @dsl/contract   # (and/or dsl-design-system)
# … edit dsl-contract/src/* and re-run the consumer …
npm install   # undo the link, back to the pinned git version
```

(Or temporarily set `"@dsl/contract": "file:../dsl-contract"` in the consumer
without committing it.)

### Releasing a new version

1. Edit `src/*`, bump `version` in `package.json`.
2. `git commit`, `git tag vX.Y.Z`, `git push && git push --tags`.
3. In each consumer: update the `#vX.Y.Z` ref, `npm install`, commit the lockfile.

For a fully immutable pin you can reference a commit SHA instead of a tag.

## Why this package exists (GAP-1)

These validators previously existed as **copies** in both repos and drifted —
a YAML that passed `dsl validate` could break `build` (and vice versa). The audit
called this GAP-1. Extracting them here makes each contract rule live in one place.

## Contents and reconciliation

Each file is the **superset** of the two former copies (both repos' test suites
must stay green):

| File | Canonical source | Why |
|---|---|---|
| `src/integration-validator.js` | Phase 1 | Had the named helpers (`emittedEventNames` reading **both** `emits` and `emitsList`, `domainMethodParamNames`) and the full INT-028..031 docblock; Phase 2 had inlined logic that only read `emitsList`. `INT-007` `sourceBc \|\| from` and `checkStorageCalls` were already identical in both. |
| `src/openapi-usecase-validator.js` | Phase 2 | Had the `[G8] Range[T]` handling (maps an input to `{name}Min`/`{name}Max` OpenAPI params); Phase 1 lacked it. |
| `src/openapi-contract.js` | Either (identical) | Only a trailing-newline difference. |
| `src/naming.js` | Phase 1 | Minimal `toKebabCase` (null-guarded); only `toKebabCase` is used by the validators. |
| `src/input-anatomy-validator.js` | **Superset of both** | Per-input anatomy rules, formerly duplicated in Phase 1 `bc-yaml-validator.js` and Phase 2 `bc-yaml-reader.js` (GAP-3). Reconciled: the multipart base-type check (was Phase 2 only) is now enforced both sides, and `Decimal` is accepted for `max` (was Phase 1 only). Added in v0.2.0. |

## Public API (`src/index.js`)

```js
const {
  validateIntegrationCoherence,
  reportDiagnostics,
  expectedEventChannel,
  validateOpenApiUseCases,
  validateOpenApiDocumentSchemas,
  validateUseCaseInputAnatomy,   // per-input anatomy rules (multipart/File, maxSize, …)
} = require('@dsl/contract');
```

`validateUseCaseInputAnatomy(bcYaml)` takes a parsed `<bc>.yaml` and returns the same
`Diagnostic[]` shape (`{ code, level, message, location }`) using the `BC-*` codes.
Phase 1 merges those diagnostics into its own array; Phase 2's reader calls it and
`fail()`s on the first `level: 'error'` diagnostic (preserving its "Failed to load BC …"
behavior). The module also exports the reconciled constants `ALLOWED_UC_INPUT_KEYS`,
`ALLOWED_UC_INPUT_SOURCES`, `MULTIPART_FORM_SCALARS`, `RANGE_ORDERABLE_TYPES`.

## Out of scope

`bc-yaml-validator.js` (Phase 1) and `bc-yaml-reader.js` (Phase 2) are **not**
unified here — Phase 2's reader is entangled with the generator's model. Their
rule parity is tracked separately (GAP-3). `canonical-types.js` / `canonical-vo.js`
also remain per-repo (GAP-5).
