import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { startFakeAirtable } from '../../test/fakeAirtable.mjs';

const require = createRequire(import.meta.url);
const { AirtableClient } = require('../airtableClient.js');

const BASE_ID = 'appTestPaging0001';
const TABLE_ID = 'tblTestPaging0001';
const NAME = 'fldTestPagingName';
const PHOTOS = 'fldTestPagingFile';
const PHOTO = { id: 'attTestPaging0001', filename: 'front.jpg', type: 'image/jpeg', size: 5 };

function workspace() {
  const records = Array.from({ length: 150 }, (_, i) => ({
    id: `recTestPaging${String(i + 1).padStart(4, '0')}`,
    createdTime: '2026-09-01T12:00:00.000Z',
    fields: { [NAME]: `Item ${i + 1}`, ...(i === 0 ? { [PHOTOS]: [PHOTO] } : {}) },
  }));
  return {
    bases: [{ id: BASE_ID, name: 'Paging', permissionLevel: 'create' }],
    schemas: {
      [BASE_ID]: {
        tables: [
          {
            id: TABLE_ID,
            name: 'Items',
            fields: [
              { id: NAME, name: 'Name', type: 'singleLineText' },
              { id: PHOTOS, name: 'Photos', type: 'multipleAttachments' },
            ],
          },
        ],
      },
    },
    records: { [BASE_ID]: { [TABLE_ID]: records } },
    files: { [PHOTO.id]: Buffer.from('bytes') },
  };
}

describe('AirtableClient record paging and file downloads', () => {
  let fake;
  let client;

  beforeEach(async () => {
    fake = await startFakeAirtable(workspace());
    client = new AirtableClient('test-token', { baseUrl: fake.apiUrl, fileOrigins: [fake.url] });
    client.sleep = async () => {};
    client.maxRequestsPerSecond = Infinity;
  });

  afterEach(async () => {
    await fake.close();
  });

  it('pages through a table 100 records at a time, keyed by field id', async () => {
    const first = await client.listRecords(BASE_ID, TABLE_ID);
    expect(first.records).toHaveLength(100);
    expect(first.records[0].fields[NAME]).toBe('Item 1');
    expect(first.offset).toBeTruthy();

    const second = await client.listRecords(BASE_ID, TABLE_ID, { offset: first.offset });
    expect(second.records).toHaveLength(50);
    expect(second.offset).toBeUndefined();
    expect(
      fake.requests.every((r) => !r.path.includes(TABLE_ID) || r.path.includes('returnFieldsByFieldId=true')),
    ).toBe(true);
  });

  it('downloads attachment files only from the allowed file host', async () => {
    const page = await client.listRecords(BASE_ID, TABLE_ID);
    const photo = page.records[0].fields[PHOTOS][0];
    expect(photo.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/files\//);
    expect((await client.downloadFile(photo.url)).toString()).toBe('bytes');

    const production = new AirtableClient('test-token');
    expect(production.isAllowedFileUrl('https://v5.airtableusercontent.com/v3/u/1/abc')).toBe(true);
    expect(production.isAllowedFileUrl('http://v5.airtableusercontent.com/v3/u/1/abc')).toBe(false);
    expect(production.isAllowedFileUrl('https://airtableusercontent.com.example.net/x')).toBe(false);
    await expect(production.downloadFile('https://example.com/x.jpg')).rejects.toThrow(
      /Refusing to download/,
    );

    // An allowed host that redirects somewhere else is refused too.
    fake.addFault({ path: `/files/${PHOTO.id}`, kind: 'redirect-away' });
    await expect(client.downloadFile(photo.url)).rejects.toThrow(/Refusing to download/);
  });
});
