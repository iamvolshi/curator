#!/usr/bin/env node
// The command line for this scaffold.
//
//   prove [--dry-run] [--prompt "..."]   one real call, recorded, read back
//   records [--last] [--json]            read the record file back
//   status                               is the API address reachable?
//
// Each command returns an exit code; 0 means it held.

import { proveCommand, DEFAULT_PROMPT } from '../cli/prove.js';
import { recordsCommand } from '../cli/records.js';
import { statusCommand } from '../cli/status.js';

const USAGE = `Overseer — the K-record accountability layer (Outcome 1 scaffold)

  node bin/overseer.js prove [--dry-run] [--prompt "..."]
      Make one real Muse Spark call through the wrapper, then read the record
      back from the file. --dry-run shows the request and sends nothing.

  node bin/overseer.js records [--last] [--json]
      Read what has been recorded.

  node bin/overseer.js status
      Check the Meta Model API address is reachable. Needs no key.

  node bin/overseer.js help
      This text.

A key is needed for "prove". Put it in MODEL_API_KEY, or in a .env file next to
this repo. Default prompt: ${JSON.stringify(DEFAULT_PROMPT)}

Exit codes: 0 held | 1 unexpected problem | 2 unknown command | 3 no key
            4 the call did not work | 5 the call worked but the record did not match
`;

const [command, ...args] = process.argv.slice(2);
const name = command ?? 'help';

const commands = {
  prove: () => proveCommand({ args }),
  records: () => recordsCommand({ args }),
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
