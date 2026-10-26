// Showing an entry to a person. Reading it back is the whole point of a record,
// so the output leads with the three things every entry carries: when, label, what.

/** One entry as readable lines. */
export function renderEntry(entry) {
  const lines = [
    `seq:    ${entry.seq}`,
    `when:   ${entry.when}`,
    `label:  ${entry.label}`,
  ];

  const what = entry.what ?? {};
  if (what.kind === 'worker-call') {
    lines.push(`what:   a call to ${what.worker ?? 'a worker'} using ${what.model ?? 'an unnamed model'}`);
    if (what.endpoint) lines.push(`sent to: ${what.endpoint}`);
    lines.push(`prompt: ${oneLine(what.prompt)}`);
    if (what.ok) {
      lines.push(`result: the call worked`);
      lines.push(`reply:  ${oneLine(what.response)}`);
      if (what.usage) {
        lines.push(`tokens: ${what.usage.total_tokens ?? '?'} in total`);
      }
    } else {
      lines.push(`result: the call did not work`);
      lines.push(`problem: ${oneLine(what.error?.message)}`);
      lines.push(`kind:   ${what.error?.kind ?? 'unknown'}`);
      lines.push(`fix:    ${what.error?.fix ?? 'read the message'}`);
    }
    if (typeof what.durationMs === 'number') lines.push(`took:   ${what.durationMs} ms`);
  } else {
    lines.push(`what:   ${oneLine(JSON.stringify(what))}`);
  }

  return lines.join('\n');
}

/** Several entries, each separated by a blank line. */
export function renderEntries(entries) {
  return entries.map(renderEntry).join('\n\n');
}

/** Keep long text on one line so the shape of an entry stays readable. */
function oneLine(value) {
  const text = value === null || value === undefined ? '(nothing)' : String(value);
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 220 ? `${flat.slice(0, 217)}...` : flat;
}
