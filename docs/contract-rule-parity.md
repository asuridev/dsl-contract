# Contract rule parity — Phase 1 (design) ↔ Phase 2 (generator)

Cross-phase audit of the YAML contract enforced by each side:

- **Phase 1** — `dsl-design-system/src/utils/bc-yaml-validator.js` (`BC-001..BC-170`, ~103 codes).
- **Phase 2** — `dsl-springboot-generator/src/utils/bc-yaml-reader.js` (reads + validates; 334 `fail(...)`
  calls grouped by `[Gxx]` gap markers — no shared numbering).

> The cross-BC integration / OpenAPI contract validators (`integration-validator`,
> `openapi-usecase-validator`, `openapi-contract`) are **no longer duplicated** — they live in this
> `@dsl/contract` package and are the single source of truth (GAP-1). This document covers only the
> per-BC anatomy rules, which remain per repo because Phase 2's reader is entangled with the
> generator's model (GAP-3), plus a field-semantics parity table (GAP-5).

Status legend: **=** parity (both enforce equivalent rule) · **P1>** Phase 1 stricter · **P2>** Phase 2
stricter · **?** needs per-rule verification (documented TODO).

## Part A — BC anatomy rule parity (GAP-3)

| Concept | Phase 1 (method / codes) | Phase 2 (reader marker) | Status | Notes |
|---|---|---|---|---|
| Document header | `validateDocumentHeader` BC-001 | inline `bc` checks | = | |
| Enums | `validateEnums` BC-005..008 | inline (enum name/value/dupes) | = | identifier + duplicate checks both sides |
| Use case core | `validateUseCases` BC-010..020 | `[G18]` strict key whitelist | = | UC key whitelists identical |
| Use case inputs | `validateUseCaseInputs` BC-021..028 | inline + `[G5]` `[G11]` | **=** | **verified**: `source` enum and input-key whitelist byte-identical (`body,path,query,authContext,header,multipart`) |
| Multipart parts | BC-024 (File + scalar form parts) | `[G12]` | **=** | **verified**: both accept mixed multipart (File + String/enum/number); maxSize/contentTypes only on File |
| Pagination | `validateUseCasePagination` | `[G7]` | = | sortable/defaultSort |
| Authorization | `validateUseCaseAuthorization` | `[G3]` | = | rolesAnyOf/permissions/scopes/ownership |
| Idempotency | `validateUseCaseIdempotency` | `[G2]` | = | header/ttl/storage |
| Cacheable | `validateUseCaseCacheable` | `[G21]` | = | ttl/keyFields/cacheWhen |
| Bulk | `validateUseCaseBulk` | `[G9]` | = | itemType/maxItems/onItemError |
| Async | `validateUseCaseAsync` | `[G10]` | = | mode/statusEndpoint |
| Multi-aggregate saga | `validateUseCaseMultiAggregate` | `[G6]` | = | steps/onFailure/compensate |
| FK / lookups / validations | `validateUseCaseFkLookupsValidations` | inline + `[G20]` | ? | cross-field guards — verify conditional FK parity |
| SearchText / Range | `validateSearchTextFields` | `[G8]` | = | fields[] for SearchText; orderable inner for Range |
| Returns | `validateUseCaseReturns` | `[G24]` Void normalize | = | BinaryStream only on queries |
| Errors | `validateErrors` / `validateErrorArgs` BC-050..054 | inline | = | |
| Domain rules & aggregates | `validateDomainRulesAndAggregates` BC-060..068 | inline | ? | verify rule-type coverage |
| Value objects (+ cycles) | `validateValueObjects` / `…Cycles` BC-070..074 | inline (GEN-003 cycle) | = | cycle detection both sides |
| Projections | `validateProjections` / `…AdditionalSources` BC-080..086 | inline + INT-010..012/027 (shared) | ? | additionalSources/upsertStrategy — see Part B |
| Event DTOs | `validateEventDtos` BC-090..094 | inline | ? | |
| Domain events | `validateDomainEvents` / payload types BC-100..122 | inline + `[G15]` trigger | ? | payload type resolution — verify BC-122 ↔ reader |
| Read models | `validateReadModels` | inline | ? | |
| Repositories | `validateRepositories` + method/qualifier BC-150..170 | inline (preflight) | ? | qualified-find preflight both sides — verify qualifier set |
| Properties / readOnly / type | `validateProperties` etc. BC-130..141 | inline | = | readOnly+defaultValue:generated early-identity both |
| Java identifier safety | `checkJavaIdentifier` BC-095 / case-collision BC-096 / Decimal scale≤precision BC-097 | `java-identifiers.js` `assertJavaIdentifier` + collision/Decimal checks in `bc-yaml-reader.js` | = | names emitted verbatim (bc, aggregate, entity, property, VO, projection, eventDto, enum value, error arg) must be valid Java identifiers and not reserved words; two names that collapse to the same camelCase field / snake_case column rejected; `DECIMAL(p,s)` requires p≥1 and 0≤s≤p |
| Actor cross-validation | `validateUseCaseReferences` | `[G14]` | = | actor must exist in system.yaml actors[] |

**High-impact findings:** none in the verified rows. The likeliest break class — a use-case input
`source`/key that Phase 1 accepts but Phase 2 rejects (or vice versa) — was checked and is in **exact
parity** (identical whitelists), and mixed multipart is aligned on both sides. The structural divergence
that did exist (duplicated cross-BC validators, incl. the `INT-007 from` severity mismatch) is resolved by
GAP-1 (this package).

**TODO (documented, not high-impact):** verify the `?` rows rule-by-rule — domain rules coverage, event
payload type resolution (BC-122 ↔ reader), projections additionalSources, eventDtos, read models, and the
repository qualified-find qualifier set. Each is a follow-up; none is known to break the pipeline today.

## Part B — Advanced field semantic parity (GAP-5)

Every advanced field Phase 1 emits/validates is **consumed** by the generator with matching semantics
(spot-checked):

| Field | Phase 1 validates | Phase 2 consumes (where) | Semantics | Status |
|---|---|---|---|---|
| `cacheable.cacheWhen` | `validateUseCaseCacheable` | `application-generator.js` `[G21]` | → Spring SpEL `condition` (`#query.f != null` AND-joined) | = |
| `pagination.defaultSort` / `sortable` | `validateUseCasePagination` | `controller-generator.js`, `repository-generator.js` | sortable[] whitelist guard + default sort | = |
| `storageCalls.bindsTo` | `validateUseCaseStorageCalls` | `application-generator.js` | names the local bound to the storage op result | = |
| `fkValidations.conditional` | `validateUseCaseFkLookupsValidations` | `application-generator.js`, `repository-generator.js` | conditional FK existence check | = (verify edge cases) |
| `domainEvents.published[].broker.{retry,dlq}` | `validateDomainEvents` (`allowedBrokerKeys`) | `messaging-generator.js` | retry → RetryOperationsInterceptor; dlq → DLQ routing | = |
| `eventDtos` | `validateEventDtos` | aggregate/application/messaging/value-object generators | incoming DTO type from external BC | = |
| `projections.additionalSources` | `validateProjectionAdditionalSources` | `projection-updater-generator.js` + INT-012 (shared) | extra event sources for a persistent projection | = |
| `projections.upsertStrategy` | `validateProjections` | `projection-updater-generator.js` + INT-027 (shared) | `lastWriteWins` \| `versionGuarded` | = |

**High-impact findings:** none — no advanced field is emitted-by-design-yet-ignored-by-generator.

## Maintenance

When adding a per-BC rule to one phase, add (or consciously decide not to add) the equivalent to the other
and update this table. The integration/OpenAPI rules need no such care — they live once in `@dsl/contract`.
