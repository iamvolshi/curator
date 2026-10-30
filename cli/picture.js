// One picture from the picture kid, saved to a file.
//
// This is the picture kid's live prove, not a record entry: it proves the
// plug answers with a real image, and it saves that image where a folder
// can use it. It writes nothing to the K-record, because a picture is not
// a fact entry and the record schema has no image entry to hold one.
//
// Base64 replies are decoded and written as bytes, with the file extension
// read from the bytes themselves where it can be: a PNG header writes .png,
// a JPEG header writes .jpg, a RIFF/WEBP header writes .webp. An unknown
// header keeps .webp, which is what Muse Image's documented example returns.
// A URL reply is printed and not saved: fetching a URL's bytes is a second
// kind of request, and this command does not invent one for it.

import { writeFile } from 'node:fs/promises';

import { callImage, preflight, resolvePlug } from '../provider/index.js';

/** The default prompt when none is given: this command never invents work. */
export const DEFAULT_PICTURE_PROMPT = 'a simple flat folder icon, plain background';

function extensionFor(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'jpg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return 'webp';
}

function parseArgs(args) {
  const out = { prompt: null, out: null, dryRun: false, bad: null };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--prompt' && i + 1 < args.length) {
      out.prompt = args[i + 1];
      i += 1;
    } else if (args[i] === '--out' && i + 1 < args.length) {
      out.out = args[i + 1];
      i += 1;
    } else if (args[i] === '--dry-run') {
      out.dryRun = true;
    } else {
      out.bad = args[i];
      break;
    }
  }
  return out;
}

/**
 * Make one picture. Returns an exit code: 0 saved, 2 bad options,
 * 3 the plug is not ready so nothing was attempted, 4 the call did not work.
 */
export async function pictureCommand({ args = [], env = process.env, fetchImpl = fetch } = {}) {
  const { prompt, out, dryRun, bad } = parseArgs(args);

  if (bad) {
    console.error(`Unknown option: ${bad}`);
    console.error('Usage: picture --prompt "..." [--out PATH] [--dry-run]');
    return 2;
  }

  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (text === '') {
    console.error('A prompt is required: picture --prompt "..."');
    return 2;
  }

  const ready = preflight('picture', env);
  if (!ready.ready) {
    console.error('Stopped before the call.');
    console.error(ready.problem ?? 'the picture plug is not ready');
    console.error(`Key: ${ready.envVar} — put what it needs in a file named .env next to this repo; the npm scripts read it, and it stays out of git`);
    return 3;
  }

  if (dryRun) {
    const plug = resolvePlug('picture', env);
    console.log('Would send (sends nothing):');
    console.log(`POST ${plug.imageUrl}`);
    console.log(`Authorization: Bearer <${ready.envVar}>`);
    console.log(JSON.stringify({ model: plug.model, prompt: text }, null, 2));
    return 0;
  }

  const result = await callImage('picture', { prompt: text, env, fetchImpl });

  if (!result.ok) {
    console.error('The picture call did not work.');
    console.error(result.error?.message ?? 'unknown error');
    if (result.noCallMade) console.error('Nothing was sent.');
    return result.noCallMade ? 3 : 4;
  }

  if (result.image.source === 'url') {
    console.log('The picture kid answered with a URL, not bytes, so nothing was saved:');
    console.log(result.image.data);
    if (result.image.revisedPrompt) console.log(`Revised prompt: ${result.image.revisedPrompt}`);
    return 0;
  }

  const buffer = Buffer.from(result.image.data, 'base64');
  const ext = extensionFor(buffer);
  // A caller-named path keeps its name, but the bytes decide the format:
  // a path with no image extension gets the detected one appended, so a
  // WebP saved as .png (or the other way round) cannot happen by accident.
  const path = out
    ? /\.(png|jpg|jpeg|webp)$/i.test(out)
      ? out
      : `${out}.${ext}`
    : `picture.${ext}`;
  await writeFile(path, buffer);
  console.log(`Saved ${buffer.length} bytes to ${path} (${ext}, ${result.durationMs} ms)`);
  if (result.image.revisedPrompt) console.log(`Revised prompt: ${result.image.revisedPrompt}`);
  return 0;
}
