// Reading `--name value` off the command line.
//
// One copy, because every command that takes an option has to agree on what
// counts as a value: a flag that follows the name is a flag, not a value, and a
// bare `--name` with nothing after it means "not given" rather than "empty".

/** The value after `--name`, or undefined when it is missing or another flag. */
export function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}
