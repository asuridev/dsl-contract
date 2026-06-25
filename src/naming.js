'use strict';

/**
 * Converts a PascalCase or camelCase string to kebab-case.
 * Examples: "ProductActivated" → "product-activated", "domainEvent" → "domain-event"
 */
function toKebabCase(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/([A-Z])/g, '-$1')
    .replace(/[\s_]+/g, '-')
    .replace(/^-/, '')
    .toLowerCase();
}

module.exports = { toKebabCase };
