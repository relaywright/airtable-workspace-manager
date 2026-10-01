/**
 * Content-addressed storage for backed-up attachment files.
 *
 * Each file is named by the SHA-256 of its bytes and kept under a two-letter
 * shard folder (files/ab/ab12...), so identical files are stored once no
 * matter how many records or bases use them. Writes go to a temp file first
 * and are renamed into place, so a crash never leaves a half-written file
 * under a real hash.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function createFileStore(folder, { fsImpl = fs } = {}) {
  const root = path.join(folder, 'files');

  function pathFor(hash) {
    if (!HASH_PATTERN.test(hash)) throw new Error('Invalid file hash');
    return path.join(root, hash.slice(0, 2), hash);
  }

  function save(buffer) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const target = pathFor(hash);
    if (fsImpl.existsSync(target)) return { hash, size: buffer.length, alreadyStored: true };

    const temp = `${target}.${process.pid}.tmp`;
    try {
      fsImpl.mkdirSync(path.dirname(target), { recursive: true });
      fsImpl.writeFileSync(temp, buffer);
      fsImpl.renameSync(temp, target);
    } catch (err) {
      try {
        fsImpl.rmSync(temp, { force: true });
      } catch (cleanupErr) {
        logger.warn('Backup', 'Could not remove a partial backup file:', cleanupErr.message);
      }
      if (err.code === 'ENOSPC') err.bytesNeeded = buffer.length;
      throw err;
    }
    return { hash, size: buffer.length, alreadyStored: false };
  }

  return {
    root,
    pathFor,
    save,
    has: (hash) => fsImpl.existsSync(pathFor(hash)),
  };
}

module.exports = { createFileStore };
