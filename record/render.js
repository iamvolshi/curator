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
  // Three kinds of observed call so far: the Worker agent doing a task, a plug
  // doing real work, and a plug being checked. They read the same way apart from
  // the line that says which — a proof and a task must not read alike.
  if (what.kind === 'worker-call' || what.kind === 'plug-prove' || what.kind === 'plug-task') {
    lines.push(describeCall(what));
    if (what.endpoint) lines.push(`sent to: ${what.endpoint}`);
    // Entries written before the body was kept do not have one; saying nothing is
    // better than implying an empty body was sent.
    if (what.request?.body) lines.push('body:   kept exactly as sent, in request.body');
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

/** The one line that says which kind of call this was. */
function describeCall(what) {
  const model = what.model ?? 'an unnamed model';

  if (what.kind === 'plug-prove') {
    return `what:   a prove call to the ${what.plug} plug (${what.role ?? 'no role'}) using ${model}`;
  }

  if (what.kind === 'plug-task') {
    return `what:   a task run on the ${what.plug} plug (${what.role ?? 'no role'}) using ${model}`;
  }

  return `what:   a call to ${what.worker ?? 'a worker'} using ${model}`;
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
