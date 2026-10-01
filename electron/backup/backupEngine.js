/**
 * One backup run per base:
 *   save the schema version -> page through every table (100 records per
 *   page, through the client's rate limiter) -> download new attachment files
 *   right away, because their links expire -> store only records whose
 *   editable content changed -> mark records missing from a fully fetched
 *   table as deleted -> mark the run complete.
 *
 * Any failure ends the run as incomplete and discards everything it wrote,
 * so a half-finished run is never a restore point and never marks records
 * deleted. Files already saved stay on disk and are reused next time.
 */
const { logger } = require('../logger');
const { normalizeFields, fingerprintFields, isAttachmentList } = require('./recordFingerprint');
const { describeBackupError } = require('./backupErrors');

function emptyCounts() {
  return { records: 0, created: 0, changed: 0, deleted: 0, filesSaved: 0, filesFailed: 0 };
}

async function saveNewAttachments({
  client,
  store,
  files,
  baseId,
  runId,
  fields,
  fieldTypes,
  counts,
  savedAt,
}) {
  for (const [fieldId, value] of Object.entries(fields || {})) {
    // Recognise attachments by type or by shape, including lookups, because
    // tables are not read as one snapshot.
    const isAttachments = fieldTypes.get(fieldId) === 'multipleAttachments' || isAttachmentList(value);
    if (!isAttachments || !Array.isArray(value)) continue;
    for (const attachment of value) {
      if (!attachment?.id || !attachment.url || store.hasAttachment(attachment.id)) continue;
      let bytes;
      try {
        bytes = await client.downloadFile(attachment.url);
      } catch (err) {
        // One unreadable file must not cost the whole backup; it is retried next run.
        counts.filesFailed++;
        logger.warn('Backup', `Could not download file ${attachment.id}: ${err.message}`);
        continue;
      }
      const saved = files.save(bytes); // a full disk throws here and ends the run
      store.saveAttachment({
        attachmentId: attachment.id,
        baseId,
        hash: saved.hash,
        filename: attachment.filename ?? null,
        type: attachment.type ?? null,
        size: saved.size,
        runId,
        savedAt,
      });
      counts.filesSaved++;
    }
  }
}

async function backupTable({ client, store, files, base, table, runId, counts, now, onProgress }) {
  const fieldTypes = new Map((table.fields || []).map((field) => [field.id, field.type]));
  const previous = store.getLatestVersions(base.id, table.id);
  const seen = new Set();
  let offset;

  do {
    const page = await client.listRecords(base.id, table.id, { offset });
    const records = page.records || [];
    const events = [];
    for (const record of records) {
      seen.add(record.id);
      await saveNewAttachments({
        client,
        store,
        files,
        baseId: base.id,
        runId,
        fields: record.fields,
        fieldTypes,
        counts,
        savedAt: now().toISOString(),
      });
      const fields = normalizeFields(record.fields, fieldTypes);
      const fingerprint = fingerprintFields(fields, fieldTypes);
      const prior = previous.get(record.id);
      let kind = null;
      if (!prior || prior.kind === 'deleted') kind = 'created';
      else if (prior.fingerprint !== fingerprint) kind = 'changed';
      if (kind) {
        events.push({
          recordId: record.id,
          kind,
          fieldsJson: JSON.stringify(fields),
          fingerprint,
          createdTime: record.createdTime ?? null,
        });
      }
    }
    store.writeEvents(runId, base.id, table.id, events);
    counts.records += records.length;
    for (const event of events) counts[event.kind]++;
    onProgress?.({ phase: 'records', tableName: table.name, records: counts.records });
    offset = page.offset;
  } while (offset);

  // Reached only when every page of this table arrived.
  const deletedIds = [];
  for (const [recordId, prior] of previous) {
    if (prior.kind !== 'deleted' && !seen.has(recordId)) deletedIds.push(recordId);
  }
  store.writeDeletions(runId, base.id, table.id, deletedIds);
  counts.deleted += deletedIds.length;
}

async function runBaseBackup({
  client,
  store,
  files,
  base,
  trigger = 'manual',
  now = () => new Date(),
  onProgress,
}) {
  const counts = emptyCounts();
  // Stays null if the run can't even be recorded (for example a full disk),
  // which still gets a plain-words result instead of a rejected promise.
  let runId = null;
  try {
    runId = store.startRun({ baseId: base.id, baseName: base.name, startedAt: now().toISOString(), trigger });
    const schema = await client.getBaseSchema(base.id);
    store.saveSchemaVersion(runId, base.id, schema, now().toISOString());
    for (const table of schema.tables || []) {
      await backupTable({ client, store, files, base, table, runId, counts, now, onProgress });
    }
    store.completeRun(runId, { finishedAt: now().toISOString(), counts });
    return { runId, baseId: base.id, baseName: base.name, status: 'complete', counts, error: null };
  } catch (err) {
    const error = describeBackupError(err);
    logger.warn(
      'Backup',
      `Backup of "${base.name}" did not finish (${error.code}): ${err?.message || 'no details'}`,
    );
    try {
      if (runId !== null) store.failRun(runId, { finishedAt: now().toISOString(), counts, error });
    } catch (failErr) {
      logger.error('Backup', `Could not record the unfinished backup of "${base.name}":`, failErr.message);
    }
    return { runId, baseId: base.id, baseName: base.name, status: 'incomplete', counts, error };
  }
}

async function runBackup({
  client,
  store,
  files,
  bases,
  trigger = 'manual',
  now = () => new Date(),
  onProgress,
}) {
  const results = [];
  const basesTotal = bases.length;
  for (const [index, base] of bases.entries()) {
    const context = { baseId: base.id, baseName: base.name, basesDone: index, basesTotal };
    onProgress?.({ phase: 'base-started', records: 0, ...context });
    const result = await runBaseBackup({
      client,
      store,
      files,
      base,
      trigger,
      now,
      onProgress: (progress) => onProgress?.({ ...progress, ...context }),
    });
    results.push(result);
    if (result.error?.code === 'disk-full') break; // every later base would fail the same way
  }
  onProgress?.({ phase: 'finished', basesDone: results.length, basesTotal });
  return results;
}

module.exports = { runBaseBackup, runBackup };
