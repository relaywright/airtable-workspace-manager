/**
 * In-process fake of the Airtable REST API for backup and restore tests.
 *
 * Serves bases, schemas, records, and attachment files from memory, with the
 * behaviors a backup has to survive: 100-record pages with opaque offsets,
 * attachment URLs that expire, rate limits, dropped connections, and tokens
 * missing a scope. No test ever talks to the real Airtable.
 */
import http from 'node:http';

const PAGE_SIZE_MAX = 100;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const clone = (value) => JSON.parse(JSON.stringify(value));

function isAttachmentList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === 'object' && String(item.id).startsWith('att'))
  );
}

export async function startFakeAirtable(workspace) {
  const state = {
    bases: clone(workspace.bases),
    schemas: clone(workspace.schemas),
    records: clone(workspace.records),
    files: new Map(Object.entries(workspace.files || {})),
    clockMs: Date.parse('2026-09-26T12:00:00.000Z'),
    urlLifetimeMs: TWO_HOURS_MS,
    faults: [],
    requests: [],
  };
  let origin = '';

  function withFileUrls(record) {
    const copy = clone(record);
    const expires = state.clockMs + state.urlLifetimeMs;
    for (const [fieldId, value] of Object.entries(copy.fields || {})) {
      if (!isAttachmentList(value)) continue;
      copy.fields[fieldId] = value.map((attachment) => ({
        ...attachment,
        url: `${origin}/files/${attachment.id}?expires=${expires}`,
        thumbnails: {
          small: {
            url: `${origin}/files/${attachment.id}?expires=${expires}&size=small`,
            width: 36,
            height: 36,
          },
        },
      }));
    }
    return copy;
  }

  function takeFault(pathAndQuery) {
    const fault = state.faults.find((f) => f.times > 0 && pathAndQuery.includes(f.path));
    if (!fault) return null;
    fault.times -= 1;
    return fault.kind;
  }

  function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  function listRecords(res, url, baseId, tableId) {
    if (url.searchParams.get('returnFieldsByFieldId') !== 'true') {
      return sendJson(res, 422, {
        error: { type: 'INVALID_REQUEST', message: 'Request fields by field id' },
      });
    }
    const known = state.schemas[baseId]?.tables.some((t) => t.id === tableId);
    if (!known)
      return sendJson(res, 404, { error: { type: 'TABLE_NOT_FOUND', message: 'Could not find table' } });
    const all = state.records[baseId]?.[tableId] || [];
    const pageSize = Math.min(Number(url.searchParams.get('pageSize')) || PAGE_SIZE_MAX, PAGE_SIZE_MAX);
    const offsetParam = url.searchParams.get('offset');
    const start = offsetParam ? Number(offsetParam.replace(/^itr/, '')) : 0;
    const page = all.slice(start, start + pageSize).map(withFileUrls);
    const next = start + pageSize < all.length ? `itr${start + pageSize}` : undefined;
    return sendJson(res, 200, next ? { records: page, offset: next } : { records: page });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    const pathAndQuery = url.pathname + url.search;
    state.requests.push({ method: req.method, path: pathAndQuery });

    const fault = takeFault(pathAndQuery);
    if (fault === 'drop') return req.socket.destroy();
    if (fault === 'redirect-away') {
      res.writeHead(302, { Location: 'https://files.example.net/elsewhere.jpg' });
      return res.end();
    }
    if (fault === 'rate-limit') {
      return sendJson(res, 429, { errors: [{ error: 'RATE_LIMIT_REACHED' }] }, { 'Retry-After': '0' });
    }
    if (fault === 'server-error') {
      return sendJson(res, 500, { error: { type: 'SERVER_ERROR', message: 'Try again later' } });
    }
    if (fault === 'forbidden') {
      return sendJson(res, 403, {
        error: {
          type: 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND',
          message: 'Invalid permissions, or the requested model was not found.',
        },
      });
    }

    if (req.method !== 'GET') return sendJson(res, 405, { error: { type: 'METHOD_NOT_ALLOWED' } });

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'files' && parts.length === 2) {
      const bytes = state.files.get(parts[1]);
      if (!bytes) {
        res.writeHead(404);
        return res.end();
      }
      if (Number(url.searchParams.get('expires')) < state.clockMs) {
        res.writeHead(410);
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(bytes);
    }
    if (parts[0] !== 'v0') return sendJson(res, 404, { error: { type: 'NOT_FOUND' } });
    if (parts[1] === 'meta' && parts[2] === 'bases' && parts.length === 3) {
      return sendJson(res, 200, { bases: state.bases });
    }
    if (parts[1] === 'meta' && parts[2] === 'bases' && parts[4] === 'tables' && parts.length === 5) {
      const schema = state.schemas[parts[3]];
      return schema ? sendJson(res, 200, schema) : sendJson(res, 404, { error: { type: 'NOT_FOUND' } });
    }
    if (parts.length === 3) return listRecords(res, url, parts[1], parts[2]);
    return sendJson(res, 404, { error: { type: 'NOT_FOUND' } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  function tableRecords(baseId, tableId) {
    state.records[baseId] ||= {};
    state.records[baseId][tableId] ||= [];
    return state.records[baseId][tableId];
  }

  function findRecord(baseId, tableId, recordId) {
    const record = tableRecords(baseId, tableId).find((r) => r.id === recordId);
    if (!record) throw new Error(`Fake Airtable: no record ${recordId} in ${tableId}`);
    return record;
  }

  return {
    url: origin,
    apiUrl: `${origin}/v0`,
    requests: state.requests,
    addRecord(baseId, tableId, record) {
      tableRecords(baseId, tableId).push(clone(record));
    },
    // Merge `patch` into the record's fields; a null value clears that field.
    updateRecord(baseId, tableId, recordId, patch) {
      const record = findRecord(baseId, tableId, recordId);
      for (const [fieldId, value] of Object.entries(patch)) {
        if (value === null) delete record.fields[fieldId];
        else record.fields[fieldId] = clone(value);
      }
    },
    removeRecord(baseId, tableId, recordId) {
      const list = tableRecords(baseId, tableId);
      list.splice(list.indexOf(findRecord(baseId, tableId, recordId)), 1);
    },
    addFile(attachmentId, bytes) {
      state.files.set(attachmentId, bytes);
    },
    // Fail requests whose path+query contains `path`, `times` times (use Infinity to keep failing).
    addFault({ path, kind, times = 1 }) {
      state.faults.push({ path, kind, times });
    },
    clearFaults() {
      state.faults.length = 0;
    },
    setUrlLifetime(ms) {
      state.urlLifetimeMs = ms;
    },
    advanceClock(ms) {
      state.clockMs += ms;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
