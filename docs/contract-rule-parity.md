# Contract rule parity — Phase 1 (design) ↔ Phase 2 (generator)

Cross-phase audit of the YAML contract enforced by each side:

- **Phase 1** — `dsl-design-system/src/utils/bc-yaml-validator.js` (`BC-001..BC-170`, ~103 codes).
- **Phase 2** — `dsl-springboot-generator/src/utils/bc-yaml-reader.js` (reads + validates; 334 `fail(...)`
  calls grouped by `[Gxx]` gap markers — no shared numbering).

> The cross-BC integration / OpenAPI contract validators (`integration-validator`,
> `openapi-usecase-validator`, `openapi-contract`) are **no longer duplicated** — they live in this
> `@dsl/contract` package and are the single source of truth (GAP-1). As of v0.2.0 the **use-case input
> anatomy** rules (multipart/File, `maxSize`, source enum, `max`, `SearchText`, `Range`) are also
> centralized here in `input-anatomy-validator.js` (`validateUseCaseInputAnatomy`) — see Part A. The
> remaining per-BC anatomy rules still live per repo because Phase 2's reader is entangled with the
> generator's model (GAP-3), plus a field-semantics parity table (GAP-5).

Status legend: **=** parity (both enforce equivalent rule) · **P1>** Phase 1 stricter · **P2>** Phase 2
stricter · **?** needs per-rule verification (documented TODO).

## Part A — BC anatomy rule parity (GAP-3)

| Concept | Phase 1 (method / codes) | Phase 2 (reader marker) | Status | Notes |
|---|---|---|---|---|
| Document header | `validateDocumentHeader` BC-001 | inline `bc` checks | = | |
| Enums | `validateEnums` BC-005..008 | inline (enum name/value/dupes) | = | identifier + duplicate checks both sides |
| Use case core | `validateUseCases` BC-010..020 | `[G18]` strict key whitelist | = | UC key whitelists identical |
| Use case inputs | **shared** `validateUseCaseInputAnatomy` (BC-012/020..026, BC-090) | **shared** (adapter → `fail()`) | **=** centralized (GAP-1) | source enum + input-key whitelist + `max`/`SearchText`/`Range` now single-source in `@dsl/contract`; Phase 1 still runs its own `validateType` (BC-090 type grammar, GAP-5) per input |
| Multipart parts | **shared** `validateUseCaseInputAnatomy` BC-024 | **shared** | **=** centralized (GAP-1) | File + scalar/enum form parts; `maxSize` size-string, `partName` safe-id, `contentTypes` MIME — reconciled superset (base-type check added to P1; `Decimal` accepted in `max` both sides) |
| Pagination | `validateUseCasePagination` | `[G7]` | = | sortable/defaultSort |
| Authorization | `validateUseCaseAuthorization` | `[G3]` | = | rolesAnyOf/permissions/scopes/ownership |
| Idempotency | `validateUseCaseIdempotency` | `[G2]` | = | header/ttl/storage |
| Cacheable | `validateUseCaseCacheable` | `[G21]` | = | ttl/keyFields/cacheWhen |
| Bulk | `validateUseCaseBulk` | `[G9]` | = | itemType/maxItems/onItemError |
| Async | `validateUseCaseAsync` | `[G10]` | = | mode/statusEndpoint |
| Multi-aggregate saga | `validateUseCaseMultiAggregate` | `[G6]` | = | steps/onFailure/compensate |
| FK / lookups / validations | `validateUseCaseFkLookupsValidations` | inline + `[G20]` | ? | cross-field guards — verify conditional FK parity |
| SearchText / Range | **shared** `validateUseCaseInputAnatomy` (BC-026/BC-090) | **shared** | = centralized (GAP-1) | fields[] for SearchText; orderable inner for Range |
| Returns | `validateUseCaseReturns` | `[G24]` Void normalize | = | BinaryStream only on queries |
| Errors | `validateErrors` / `validateErrorArgs` BC-050..054 | inline | = | |
| Domain rules & aggregates | `validateDomainRulesAndAggregates` BC-060..068 | inline | ? | verify rule-type coverage |
| Value objects (+ cycles) | `validateValueObjects` / `…Cycles` BC-070..074 | inline (GEN-003 cycle) | = | cycle detection both sides |
| Projections | `validateProjections` / `…AdditionalSources` BC-080..086 + key whitelist BC-012 | inline + `ALLOWED_PROJECTION_KEYS` + INT-010..012/027 (shared) | = | additionalSources/upsertStrategy — see Part B; projection-level key whitelist now both sides (rejects typos like `persistant`) |
| Event DTOs | `validateEventDtos` BC-090..094 | inline | ? | |
| Domain events | `validateDomainEvents` / payload types BC-100..122 | inline + `[G15]` trigger | ? | payload type resolution — verify BC-122 ↔ reader |
| Read models | `validateReadModels` | inline | ? | |
| Repositories | `validateRepositories` + method/qualifier BC-150..170 + `repositoryQualifierMatchesBoolean` | inline (preflight) + `booleanQualifierMatches` | = | boolean-flag qualifiers (`find/count{Flag}By…` over a `Boolean` prop) accepted both sides — Phase 1 no longer false-flags BC-161. `exists{Qualifier}By` and `search{Qualifier}` qualifier validation now mirrored in Phase 1 (BC-161) too — **verified** parity with reader `qualifiedExists`/`qualifiedSearch` (returns shape + status/boolean qualifier resolution). **BC-166** mirrors the reader's projection-as-repo-return rule (`bc-yaml-reader.js` `SELECT new <Projection>(a.f1,…)` constructor expression): a projection used as a repository method `returns` must map 1:1 to aggregate fields by exact name and carry no `derivedFrom` property — **verified** parity. **BC-160 LIKE-on-scalar** (a `filterOn` targeted by `LIKE_CONTAINS`/`LIKE_STARTS`/`LIKE_ENDS` must resolve to a scalar column — 11 comparable canonicals + enums, **plus single-property value objects** which flatten to one same-named column so LIKE is unambiguous; multi-property VOs like `Money` expand to N columns and are rejected — filter their expanded column, e.g. `priceAmount`) is a **shared** validator `validateRepositoryFilters` in `@dsl/contract` (v0.3.1), consumed by both phases (Phase 1 merges its diagnostics, Phase 2 `fail()`s on the first error; the reader's inline `isScalarComparableType` was removed). Previously the rule lived only in the reader, so Phase 1 accepted designs the build later rejected — **verified** parity |
| Properties / readOnly / type | `validateProperties` etc. BC-130..141 | inline | = | readOnly+defaultValue:generated early-identity both |
| Java identifier safety | `checkJavaIdentifier` BC-095 / case-collision BC-096 / Decimal scale≤precision BC-097 | `java-identifiers.js` `assertJavaIdentifier` + collision/Decimal checks in `bc-yaml-reader.js` | = | names emitted verbatim (bc, aggregate, entity, property, VO, projection, eventDto, enum value, error arg) must be valid Java identifiers and not reserved words; two names that collapse to the same camelCase field / snake_case column rejected; `DECIMAL(p,s)` requires p≥1 and 0≤s≤p |
| Actor cross-validation | `validateUseCaseReferences` | `[G14]` | = | actor must exist in system.yaml actors[] |

**High-impact findings:** none. The likeliest break class — a use-case input `source`/key/multipart shape
that Phase 1 accepts but Phase 2 rejects (or vice versa) — is now **structurally impossible** for the input
anatomy rules: both phases call the same `validateUseCaseInputAnatomy` (v0.2.0), so they cannot drift. The
earlier structural divergences (duplicated cross-BC validators incl. the `INT-007 from` severity mismatch;
the `maxSize` byte-vs-unit-string drift) are resolved by GAP-1 (this package).

**TODO (documented, not high-impact):** verify the remaining `?` rows rule-by-rule — domain rules
coverage, event payload type resolution (BC-122 ↔ reader), projections additionalSources, eventDtos, and
read models. Each is a follow-up; none is known to break the pipeline today. The repository qualified-find
qualifier set is now **closed**: Phase 1 BC-161 mirrors the reader's `exists{Qualifier}By` and
`search{Qualifier}` checks (added 2026-06; covered by the canasta conformance guard + `dsl validate`).

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
