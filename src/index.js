'use strict';

/**
 * @dsl/contract — single source of truth for the YAML contract validators shared
 * by dsl-design-system (Phase 1, validates design YAML) and
 * dsl-springboot-generator (Phase 2, consumes design YAML).
 *
 * Previously each repo carried its own copy of these validators and they drifted
 * (see contract-audit GAP-1). Both repos now consume this package via a `file:`
 * dependency so a YAML contract rule lives in exactly one place.
 */

const {
  validateIntegrationCoherence,
  reportDiagnostics,
  expectedEventChannel,
} = require('./integration-validator');

const {
  validateOpenApiUseCases,
  validateOpenApiDocumentSchemas,
} = require('./openapi-usecase-validator');

// OpenAPI contract helpers — used by the validators above and, in Phase 2, by the
// controller/openapi generators (buildOpenApiOperationMap). Re-exported so the
// generator does not need a local copy of openapi-contract.js.
const openApiContract = require('./openapi-contract');

module.exports = {
  validateIntegrationCoherence,
  reportDiagnostics,
  expectedEventChannel,
  validateOpenApiUseCases,
  validateOpenApiDocumentSchemas,
  ...openApiContract,
};
