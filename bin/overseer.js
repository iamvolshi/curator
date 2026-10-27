#!/usr/bin/env node
// The command line for this scaffold.
//
//   prove [--dry-run] [--prompt "..."]   one real call, recorded, read back
//   records [--last] [--json]            read the record file back
//   status                               is the API address reachable?
//
// Each command returns an exit code; 0 means it held.

import { liveCommand } from '../cli/live.js';
import { pageCommand } from '../cli/page.js';
import { proveCommand, DEFAULT_PROMPT } from '../cli/prove.js';
import { recordsCommand } from '../cli/records.js';
import { statusCommand } from '../cli/status.js';

const USAGE = `Overseer — the K-record accountability layer (Outcome 1 scaffold)

  node bin/overseer.js prove [--dry-run] [--plug NAME] [--prompt "..."]
      Make one real call through the wrapper, then read the record back from the
      file. With no --plug it proves the Worker's own plug (meta); name another
      (baseten, openrouter) to prove that one on its own. --dry-run shows the
      request that would be sent and sends nothing.

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

  node bin/overseer.js help
      This text.

A key is needed for "prove", and which key depends on the plug. Put it in a .env
file next to this repo. Default prompt: ${JSON.stringify(DEFAULT_PROMPT)}

Exit codes: 0 held | 1 unexpected problem | 2 unknown command or plug name
            3 the plug is not ready, so nothing was attempted
            4 the call did not work | 5 the call worked but the record did not match
`;

const [command, ...args] = process.argv.slice(2);
const name = command ?? 'help';

const commands = {
  prove: () => proveCommand({ args }),
  records: () => recordsCommand({ args }),
  page: () => pageCommand({ args }),
  live: () => liveCommand({ args }),
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

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('The command could not finish:', err?.message ?? err);
    process.exit(1);
  });
