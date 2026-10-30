// One picture from the picture kid, saved to a file — and, with --subject,
// shelved as that subject's folder picture.
//
// This is the picture kid's live prove, not a record entry: it proves the
// plug answers with a real image, and it saves that image where a folder
// can use it. It writes nothing to the K-record, because a picture is not
// a fact entry and the record schema has no image entry to hold one. With
// --subject the picture also goes on the shelf beside the record, so the
// next page build shows it in that subject's folder — in a browser, where
// a picture can actually be seen. A terminal cannot show a picture, and
// this command does not pretend otherwise.
//
// Base64 replies are decoded and written as bytes, with the file extension
// read from the bytes themselves where it can be: a PNG header writes .png,
// a JPEG header writes .jpg, a RIFF/WEBP header writes .webp. An unknown
// header keeps .webp, which is what Muse Image's documented example returns.
// A URL reply is printed and not saved: fetching a URL's bytes is a second
// kind of request, and this command does not invent one for it — and a URL
// picture cannot be shelved either, because the shelf holds bytes.

import { writeFile } from 'node:fs/promises';

import { callImage, preflight, resolvePlug } from '../provider/index.js';
import { subjectsOf } from '../record/folders.js';
import { mimeForBuffer, resolvePicturesPath, savePicture } from '../record/pictures.js';
import { createStore } from '../record/store.js';

/** The default prompt when none is given: this command never invents work. */
export const DEFAULT_PICTURE_PROMPT = 'a simple flat folder icon, plain background';

function parseArgs(args) {
  const out = { prompt: null, out: null, subject: null, dryRun: false, bad: null };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--prompt' && i + 1 < args.length) {
      out.prompt = args[i + 1];
      i += 1;
    } else if (args[i] === '--out' && i + 1 < args.length) {
      out.out = args[i + 1];
      i += 1;
    } else if (args[i] === '--subject' && i + 1 < args.length) {
      out.subject = args[i + 1];
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
export async function pictureCommand({ args = [], env = process.env, fetchImpl = fetch, store = createStore() } = {}) {
  const { prompt, out, subject, dryRun, bad } = parseArgs(args);

  if (bad) {
    console.error(`Unknown option: ${bad}`);
    console.error('Usage: picture --prompt "..." [--out PATH] [--subject "..."] [--dry-run]');
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
    if (subject) console.log(`No picture was shelved for "${subject}": the shelf holds bytes, not URLs.`);
    if (result.image.revisedPrompt) console.log(`Revised prompt: ${result.image.revisedPrompt}`);
    return 0;
  }

  const buffer = Buffer.from(result.image.data, 'base64');
  const { mime, ext } = mimeForBuffer(buffer);
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

  if (subject) {
    const shelfPath = resolvePicturesPath(null, env);
    await savePicture(shelfPath, subject, {
      mime,
      data: result.image.data,
      prompt: text,
      model: result.model,
      when: new Date().toISOString(),
    });
    console.log(`Shelved as the folder picture for "${subject}" (${shelfPath})`);
    // A folder is a view of the record, so a picture for a subject no entry
    // names yet cannot appear on the page until one does. Saying so here
    // beats a builder wondering why the page shows no picture.
    try {
      const entries = await store.readAll();
      const named = entries.some((entry) => subjectsOf(entry).includes(subject));
      if (named) {
        console.log('Regenerate the page to see it: npm run page, then open record.html in a browser.');
      } else {
        console.log(`No entry names "${subject}" yet, so the page shows no folder for it until one does.`);
      }
    } catch {
      console.log('The record could not be read to check whether that folder exists yet.');
    }
  }

  return 0;
}
