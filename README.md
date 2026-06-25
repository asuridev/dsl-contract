# @dsl/contract

Single source of truth for the DSL YAML **contract validators** shared by the two
phases of the pipeline:

- **Phase 1** — `dsl-design-system` (validates design YAML: `dsl validate`)
- **Phase 2** — `dsl-springboot-generator` (consumes design YAML: `dsl-springboot build`)

Both repos depend on this package via a `file:` link:

```json
"@dsl/contract": "file:../dsl-contract"
```

> `file:` copies into `node_modules` at `npm install` time. After editing this
> package, run `npm install` in each consumer repo (or use `npm link` during
> development) to pick up the change.

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

## Public API (`src/index.js`)

```js
const {
  validateIntegrationCoherence,
  reportDiagnostics,
  expectedEventChannel,
  validateOpenApiUseCases,
  validateOpenApiDocumentSchemas,
} = require('@dsl/contract');
```

## Out of scope

`bc-yaml-validator.js` (Phase 1) and `bc-yaml-reader.js` (Phase 2) are **not**
unified here — Phase 2's reader is entangled with the generator's model. Their
rule parity is tracked separately (GAP-3). `canonical-types.js` / `canonical-vo.js`
also remain per-repo (GAP-5).
