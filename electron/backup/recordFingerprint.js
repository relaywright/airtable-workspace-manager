/**
 * Canonical record content for backups, with attachments recognised by type or by shape.
 *
 * Airtable hands back a fresh signed URL for every attachment on every
 * fetch, so those are stripped before anything is stored or compared. Only
 * fields a person can edit feed the fingerprint: a formula like TODAY() or a
 * lookup of another table changes on its own, and must not create a new
 * version of the record every day. Computed values are still stored with
 * each version that is written.
 */
const crypto = require('crypto');

// Field types whose values Airtable computes. Restore skips them too.
const COMPUTED_FIELD_TYPES = new Set([
  'formula',
  'multipleLookupValues',
  'rollup',
  'count',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'button',
  'aiText',
]);

const ATTACHMENT_KEYS = ['id', 'filename', 'type', 'size'];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stripAttachment(attachment) {
  const kept = {};
  for (const key of ATTACHMENT_KEYS) {
    if (attachment && attachment[key] !== undefined) kept[key] = attachment[key];
  }
  return kept;
}

function isAttachmentList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        item.id.startsWith('att') &&
        typeof item.url === 'string',
    )
  );
}

/**
 * @param {Record<string, unknown>} fields - a record's fields keyed by field id
 * @param {Map<string, string>} fieldTypes - field id -> Airtable field type
 */
function normalizeFields(fields, fieldTypes) {
  const normalized = {};
  for (const [fieldId, value] of Object.entries(fields || {})) {
    const isAttachments =
      (fieldTypes.get(fieldId) === 'multipleAttachments' && Array.isArray(value)) || isAttachmentList(value);
    normalized[fieldId] = isAttachments ? value.map(stripAttachment) : value;
  }
  return canonicalize(normalized);
}

function fingerprintFields(normalizedFields, fieldTypes) {
  const editable = {};
  for (const [fieldId, value] of Object.entries(normalizedFields)) {
    if (!COMPUTED_FIELD_TYPES.has(fieldTypes.get(fieldId))) editable[fieldId] = value;
  }
  return sha256(stableStringify(editable));
}

module.exports = {
  COMPUTED_FIELD_TYPES,
  canonicalize,
  stableStringify,
  sha256,
  isAttachmentList,
  normalizeFields,
  fingerprintFields,
};
