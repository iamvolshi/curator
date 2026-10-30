#!/usr/bin/env node
// The command line for this scaffold.
//
//   prove [--dry-run] [--prompt "..."]   one real call, recorded, read back
//   task --prompt "..."                  one real piece of work, recorded
//   folders [--subject "..."]            a subject's entries, rebuilt from the record
//   judge                                observe the moves and write judgments
//   panel [--move N | --limit N]         three seats judge a move; one readout
//   records [--last] [--json]            read the record file back
//   status                               is the API address reachable?
//
// Each command returns an exit code; 0 means it held.

import { foldersCommand } from '../cli/folders.js';
import { judgeCommand } from '../cli/judge.js';
import { liveCommand } from '../cli/live.js';
import { pageCommand } from '../cli/page.js';
import { panelCommand } from '../cli/panel.js';
import { proveCommand, DEFAULT_PROMPT } from '../cli/prove.js';
import { pictureCommand } from '../cli/picture.js';
import { recordsCommand } from '../cli/records.js';
import { statusCommand } from '../cli/status.js';
import { taskCommand } from '../cli/task.js';

const USAGE = `Overseer — the K-record accountability layer (Outcome 1 scaffold)

  node bin/overseer.js prove [--dry-run] [--plug NAME] [--prompt "..."]
      Make one real call through the wrapper, then read the record back from the
      file. With no --plug it proves the Worker's own plug (meta); name another
      (baseten, openrouter) to prove that one on its own. --dry-run shows the
      request that would be sent and sends nothing.

  node bin/overseer.js task --prompt "..." [--plug NAME] [--subject "..."]
      Do one piece of real work through a plug and record it. This is not a
      prove: nothing is checked, and the entry is marked 'plug-task' so a reader
      can tell work apart from a proof that a plug works. With no --plug it goes
      to the Worker's plug (meta). A plug that is not ready sends nothing and
      records nothing. --subject says what the work is about and may be repeated;
      that is what puts the entry in a folder.

  node bin/overseer.js judge [--move N | --limit N]
      The Overseer observes the record's observed moves and appends judgments,
      and questions where the record does not show the basis. It runs on the
      Overseer's plug (baseten) and never touches a fact entry. Without Baseten
      credentials it refuses: no call, no entry. --move N judges the one move
      with that seq; --limit N judges at most N moves from the front of the
      queue. Either way a first run costs one call instead of one per move, and
      what it does not judge is offered again next time.

  node bin/overseer.js folders [--subject "..."]
      One folder per subject the record names. With --subject, read that folder
      back: its entries in record order, each with its label visible. A folder is
      a view of the record, not a store, so nothing here can create one or lose
      an entry — a subject nobody named has no folder, on purpose.

  node bin/overseer.js panel [--move N | --limit N]
      The judge panel: three seats read the same move, and the record gets one
      entry per seat. Seat 1 is the main seat (Muse, through the meta plug); seats
      2 and 3 are the provisional free seats, each seated by its own model
      variable. A seat whose judge fails is filled from the bank, and the fill is
      labelled in the entry it produced. What the seats add up to is printed as a
      readout — the highest probable opinion and the edge greys — rebuilt from the
      record afterwards, never merged into one opinion. An unseated panel refuses
      before the record is read or anything is sent. --limit N seats N moves;
      --move N seats the one move with that seq.

  node bin/overseer.js records [--last] [--json]
      Read what has been recorded.

  node bin/overseer.js page [--out PATH]
      Write the record out as one readable page. Built from the file as it is
      now, so it can never describe a record that does not exist.

  node bin/overseer.js live [--port 4780]
      Serve that same page on 127.0.0.1 while calls are made. Every request is
      rebuilt from the record, and the page reloads itself when the record grows.
      Ctrl+C stops it.

  node bin/overseer.js status
      Every plug: how it is wired, and whether its address answers. Needs no
      key. Reachability is only probed where a plug names a key-free health
      address; the rest say so rather than guessing at one.

  node bin/overseer.js picture --prompt "..." [--out PATH] [--dry-run]
      One picture from the picture kid (Muse Image), saved to a file.
      This is the picture plug's live prove; it writes nothing to the
      K-record, because a picture is not a fact entry.

  node bin/overseer.js help
      This text.

A key is needed for "prove" and "task", and which key depends on the plug. Put
it in a .env file next to this repo. Default prove prompt: ${JSON.stringify(DEFAULT_PROMPT)}
"task" has no default prompt: it will not invent work nobody asked for.

Exit codes: 0 held | 1 unexpected problem | 2 unknown command, plug name,
            nothing to do, or a bad option | 3 the plug is not ready, so nothing
            was attempted
            4 the call did not work | 5 the call worked but the record did not match

For "panel" the same codes mean: 0 the run finished cleanly | 2 the options were
not usable, or the named move cannot be judged | 3 a seat is not seated, so
nothing was read and nothing was sent | 4 a model call did not work and no bank
plug filled that seat | 5 a reply could not be read, or a reading directed the
agent, and no bank plug filled that seat
`;

const [command, ...args] = process.argv.slice(2);
const name = command ?? 'help';

const commands = {
  prove: () => proveCommand({ args }),
  task: () => taskCommand({ args }),
  folders: () => foldersCommand({ args }),
  judge: () => judgeCommand({ args }),
  panel: () => panelCommand({ args }),
  records: () => recordsCommand({ args }),
  page: () => pageCommand({ args }),
  live: () => liveCommand({ args }),
  picture: () => pictureCommand({ args }),
  status: () => statusCommand({ args }),
  help: async () => {
    console.log(USAGE);
    return 0;
  },
};

const run = commands[name];

if (!run) {
  console.error(`Unknown command: ${name}`);
  console.error('Run "node bin/overseer.js help" to see the commands.');
  process.exit(2);
}

// The code is set rather than exit()ed, so output written to a pipe is flushed
// before the process ends: `process.exit` can cut the tail off a piped report.
run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('The command could not finish:', err?.message ?? err);
    process.exitCode = 1;
  });
