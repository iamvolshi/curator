// Folder pictures: one image per subject, held beside the record, not in it.
//
// A picture is not a fact entry, a judgment or a question, so it has no place
// in the K-record: putting base64 bytes in a record line would bloat the
// ledger, break its one-line-per-call shape, and make a picture look like
// evidence the record holds. The shelf below is the same kind of thing as
// the parked-moves ledger beside the record: a file the page reads, not a
// second record, and replacing a folder's picture rewrites the shelf, never
// the record. History is not rewritten by changing a picture.
//
// A folder is still a view of the record, so a picture only ever shows on a
// folder the record names. A shelved picture for a subject no entry has
// named yet is held, not shown, until an entry names that subject — showing
// it earlier would be a folder nobody observed, which is priming, not a view.
//
// The shelf file is JSON, one key per subject, exactly as declared:
//   { "Ada Okafor": { "mime": "image/webp", "data": "<base64>", "prompt": "...", "model": "muse-image-1.0", "when": "..." } }
// Only the three image types below are ever embedded. Anything else is
// ignored when the page is built, so a damaged or foreign shelf entry can
// hide a picture but can never put an arbitrary data URI on the page.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { resolveRecordsPath } from './store.js';

export const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

/** Where the shelf lives: an explicit path wins, then OVERSEER_PICTURES, then beside the record. */
export function resolvePicturesPath(explicit, env = process.env) {
  if (explicit) return resolve(explicit);
  if (env.OVERSEER_PICTURES) return resolve(env.OVERSEER_PICTURES);
  return join(dirname(resolveRecordsPath(null, env)), 'pictures.json');
}

/** The image type and file extension for image bytes, read from the bytes themselves. */
export function mimeForBuffer(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  // Muse Image's documented example returns WebP, so an unknown header
  // keeps that rather than refusing a picture the model did return.
  return { mime: 'image/webp', ext: 'webp' };
}

/** Read the shelf. A shelf that does not exist yet reads as "no pictures". */
export async function readPictures(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`the folder-pictures shelf is damaged: ${path}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`the folder-pictures shelf is damaged: ${path}`);
  }
  return parsed;
}

/** Shelf one picture under one subject, replacing any picture already there. */
export async function savePicture(path, subject, picture) {
  const name = String(subject ?? '').trim();
  if (name === '') throw new Error('a folder picture needs a subject');
  const shelf = await readPictures(path);
  shelf[name] = picture;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(shelf, null, 2)}\n`, 'utf8');
  return shelf[name];
}

/**
 * A subject name made safe for a real folder on disk, Windows included.
 *
 * Windows forbids < > : " / \ | ? * in a folder name, and reserves CON, PRN,
 * AUX, NUL, COM1–9 and LPT1–9. Those characters become '-', the name is
 * trimmed and capped, and a reserved name gets an underscore. Two different
 * subjects can still sanitise to the same folder name — on disk the last
 * picture wins for that folder, while the shelf above stays exact per
 * subject and is the authority. A disk folder is a view for Explorer, not
 * a second record, so a collision there cannot rewrite what the shelf says.
 */
export function folderNameForSubject(subject) {
  const raw = String(subject ?? '').trim().replace(/[<>:\"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  const capped = raw.slice(0, 100).trim() || 'unnamed';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  return reserved.test(capped) ? `${capped}_` : capped;
}

/** The data URI for a shelved picture, or null when the entry is not a safe image. */
export function dataUriFor(picture) {
  if (!picture || typeof picture !== 'object') return null;
  if (!ALLOWED_MIMES.includes(picture.mime)) return null;
  if (typeof picture.data !== 'string' || picture.data.trim() === '') return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(picture.data.trim())) return null;
  return `data:${picture.mime};base64,${picture.data.trim()}`;
}
