// One picture from the picture kid, saved to a file — and, with --subject,
// shelved as that subject's folder picture.
//
// This is the picture kid's live prove: it proves the plug answers with a
// real image, and it saves that image where a folder can use it. The call
// itself is written to the K-record as a small fact entry — model, prompt,
// byte count, no image bytes — because a paid call with no entry is exactly
// the hole the record exists to close. The picture's bytes stay out of the
// entry: they live on the shelf beside the record, never in it. With
// --subject the picture also goes on the shelf beside the record, so the
// next page build shows it on that subject's folder — in a browser, where
// a picture can actually be seen — and into a real folder of that subject's
// name, so Windows Explorer shows it on the folder itself. A terminal cannot
// show a picture, and this command does not pretend otherwise.
//
// Base64 replies are decoded and written as bytes, with the file extension
// read from the bytes themselves where it can be: a PNG header writes .png,
// a JPEG header writes .jpg, a RIFF/WEBP header writes .webp. An unknown
// header keeps .webp, which is what Muse Image's documented example returns.
// A URL reply is printed and not saved: fetching a URL's bytes is a second
// kind of request, and this command does not invent one for it — and a URL
// picture cannot be shelved either, because the shelf holds bytes.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { makerLabel, parseMaker, shapePrompt } from './maker-style.js';
import { callImage, preflight, resolvePlug } from '../provider/index.js';
import { makeEntry } from '../record/entry.js';
import { subjectsOf } from '../record/folders.js';
import { folderNameForSubject, mimeForBuffer, readPictures, resolvePicturesPath, savePicture } from '../record/pictures.js';
import { createStore } from '../record/store.js';

// The record kind a picture call writes. It carries no `subjects`: a picture
// call observes no subject, so it must not name a folder into existence —
// folders come from observed moves. The subject rides along as `subject`
// (singular), which the folder logic never reads, so held-not-shown keeps
// holding.
export const PICTURE_KIND = 'picture-call';

/**
 * Write the call to the record as one small fact entry: model, prompt, byte
 * count — never image bytes. A paid call with no entry is the hole the
 * record exists to close. A store that cannot be written is reported, not
 * thrown: the picture already exists, and losing it as well would double
 * the failure.
 */
async function recordCall(store, what) {
  try {
    const stored = await store.append(makeEntry({ when: new Date().toISOString(), label: 'fact', what }));
    console.log(`Recorded as entry seq ${stored.seq}.`);
  } catch (err) {
    console.error(`The record entry was not written: ${err?.message ?? err}`);
  }
}

/** The default prompt when none is given: this command never invents work. */
export const DEFAULT_PICTURE_PROMPT = 'a simple flat folder icon, plain background';

function parseArgs(args) {
  const out = { prompt: null, out: null, subject: null, age: null, skill: null, dryRun: false, bad: null };
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
    } else if (args[i] === '--age' && i + 1 < args.length) {
      out.age = args[i + 1];
      i += 1;
    } else if (args[i] === '--skill' && i + 1 < args.length) {
      out.skill = args[i + 1];
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
  const { prompt, out, subject, age, skill, dryRun, bad } = parseArgs(args);

  if (bad) {
    console.error(`Unknown option: ${bad}`);
    console.error('Usage: picture --prompt "..." [--out PATH] [--subject "..."] [--age N|adult] [--skill beginner|learning|confident|skilled|master] [--dry-run]');
    return 2;
  }

  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (text === '') {
    console.error('A prompt is required: picture --prompt "..."');
    return 2;
  }

  const maker = parseMaker({ age, skill });
  if (maker.problem) {
    console.error(maker.problem);
    return 2;
  }
  // The prompt that actually goes to the model: the maker's hand first,
  // then the subject. The shelf keeps the user's own prompt, and the
  // maker's age and skill beside it, so the page can say who drew it.
  const sent = shapePrompt(text, maker);
  const label = makerLabel(maker);

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
    console.log(JSON.stringify({ model: plug.model, prompt: sent }, null, 2));
    if (label) console.log(label);
    return 0;
  }

  const result = await callImage('picture', { prompt: sent, env, fetchImpl });

  if (!result.ok) {
    console.error('The picture call did not work.');
    console.error(result.error?.message ?? 'unknown error');
    if (result.noCallMade) console.error('Nothing was sent.');
    // A failed call is recorded too, because it also happened — with the
    // error, and without image bytes that never arrived.
    await recordCall(store, {
      kind: PICTURE_KIND,
      plug: 'picture',
      model: result.model ?? null,
      prompt: text,
      sentPrompt: sent,
      durationMs: result.durationMs ?? 0,
      ok: false,
      error: result.error ?? null,
      ...(result.noCallMade ? { noCallMade: true } : {}),
      ...(maker.age !== null ? { makerAge: maker.age } : {}),
      ...(maker.skill !== null ? { makerSkill: maker.skill } : {}),
    });
    return result.noCallMade ? 3 : 4;
  }

  if (result.image.source === 'url') {
    console.log('The picture kid answered with a URL, not bytes, so nothing was saved:');
    console.log(result.image.data);
    if (subject) console.log(`No picture was shelved for "${subject}": the shelf holds bytes, not URLs.`);
    if (result.image.revisedPrompt) console.log(`Revised prompt: ${result.image.revisedPrompt}`);
    await recordCall(store, {
      kind: PICTURE_KIND,
      plug: 'picture',
      model: result.model,
      prompt: text,
      sentPrompt: sent,
      source: 'url',
      durationMs: result.durationMs ?? 0,
      ok: true,
      ...(subject ? { subject } : {}),
      ...(maker.age !== null ? { makerAge: maker.age } : {}),
      ...(maker.skill !== null ? { makerSkill: maker.skill } : {}),
    });
    return 0;
  }

  const buffer = Buffer.from(result.image.data, 'base64');
  const { mime, ext } = mimeForBuffer(buffer);
  // A caller-named path keeps its name, but the bytes decide the format:
  // a path with no image extension gets the detected one appended, so a
  // WebP saved as .png (or the other way round) cannot happen by accident.
  // With a subject and no --out there is no separate file at all: the bytes
  // already land on the shelf and in the subject's real folder below, and a
  // third copy in the repo root is clutter, not proof.
  const path = out
    ? /\.(png|jpg|jpeg|webp)$/i.test(out)
      ? out
      : `${out}.${ext}`
    : subject
      ? null
    : `picture.${ext}`;
  if (path) {
    await writeFile(path, buffer);
    console.log(`Saved ${buffer.length} bytes to ${path} (${ext}, ${result.durationMs} ms)`);
  } else {
    console.log(`Kept ${buffer.length} bytes (${ext}, ${result.durationMs} ms), no --out so no separate file: the shelf and the folder below hold them.`);
  }
  if (result.image.revisedPrompt) console.log(`Revised prompt: ${result.image.revisedPrompt}`);

  if (subject) {
    const shelfPath = resolvePicturesPath(null, env);
    // Say before replacing, not after: the old picture is gone the moment
    // the next line runs, and a warning after the fact is no warning.
    const previous = (await readPictures(shelfPath))[subject];
    if (previous) {
      console.log(`Replaces the folder picture shelved ${previous.when ?? 'earlier'} (${previous.model ?? 'an unknown model'}): the old picture is gone, the record is untouched.`);
    }
    await savePicture(shelfPath, subject, {
      mime,
      data: result.image.data,
      prompt: text,
      // The exact sentence the model saw, beside the user prompt above:
      // nobody has to take the age-and-skill shaping on trust.
      sentPrompt: sent,
      model: result.model,
      when: new Date().toISOString(),
      ...(maker.age !== null ? { makerAge: maker.age } : {}),
      ...(maker.skill !== null ? { makerSkill: maker.skill } : {}),
    });
    console.log(`Shelved as the folder picture for "${subject}" (${shelfPath})`);
    // And put the same bytes in a real folder with that subject's name, so
    // Windows Explorer can do what it does: a folder holding an image shows
    // that image on the folder itself, in medium and large icon views.
    // Explorer decides the thumbnail; this just gives it a folder with an
    // image in it to work from. The shelf above stays the authority — the
    // disk folder is a view for Explorer, not a second record.
    const folderDir = join(dirname(shelfPath), 'folders', folderNameForSubject(subject));
    await mkdir(folderDir, { recursive: true });
    const folderFile = join(folderDir, `picture.${ext}`);
    await writeFile(folderFile, buffer);
    console.log(`Also in a real folder for Explorer: ${folderFile}`);
    console.log('Open its parent folder in Explorer (medium or large icons) to see the image on the folder.');
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

  // The call happened, so the record hears about it: model, prompt, byte
  // count — never the image bytes, which already live on the shelf.
  await recordCall(store, {
    kind: PICTURE_KIND,
    plug: 'picture',
    model: result.model,
    prompt: text,
    sentPrompt: sent,
    bytes: buffer.length,
    mime,
    durationMs: result.durationMs ?? 0,
    ok: true,
    ...(subject ? { subject } : {}),
    ...(maker.age !== null ? { makerAge: maker.age } : {}),
    ...(maker.skill !== null ? { makerSkill: maker.skill } : {}),
  });

  return 0;
}
