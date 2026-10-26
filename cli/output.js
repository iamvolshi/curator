// Printing for people. Small helpers so every command looks the same.

const LABEL_WIDTH = 12;

export function heading(text) {
  console.log(`\n${text}`);
  console.log('-'.repeat(text.length));
}

export function line(label, value) {
  console.log(`${String(label).padEnd(LABEL_WIDTH)} ${value}`);
}

export function note(text) {
  console.log(text);
}

/** A pass/fail line for a named check. */
export function check(passed, description, detail = '') {
  const mark = passed ? 'ok' : 'FAILED';
  const tail = detail ? `  (${detail})` : '';
  console.log(`  [${mark}] ${description}${tail}`);
  return Boolean(passed);
}

export function blank() {
  console.log('');
}
