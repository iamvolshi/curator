// The manner rule, as a check.
//
// A judgment observes; it never directs. "The result supports X" is a judgment.
// "You should have done Y" is an instruction wearing a judgment's clothes, and a
// reader of the record has no way to tell it apart from an observation.
//
// So the wording of a judgment is checked before the entry is written. The list
// is deliberately small and deliberately about direction — it is not a style
// police. A phrase that tells the Worker what to do next stops the entry being
// written at all; the run says so rather than writing it and hoping nobody
// notices.

const DIRECTIVES = [
  /\byou (should|must|need to|ought to|have to)\b/i,
  /\b(do|try|run|add|fix|change|revert) (this|that|it) next\b/i,
  /\bnext,? (you|do|try|run|add|fix)\b/i,
  /\btry (to|doing|again)\b/i,
  /\bi (recommend|suggest|advise)\b/i,
  /\bmake sure (you|to)\b/i,
  /\bconsider (doing|adding|changing|using)\b/i,
  /\bwhy don'?t you\b/i,
  /\byou'?d better\b/i,
];

/**
 * The phrase that made this wording a direction, or null when it only observes.
 * The phrase is returned rather than a boolean so a report can name what stopped it.
 */
export function directs(text) {
  const value = String(text ?? '');
  for (const pattern of DIRECTIVES) {
    const found = value.match(pattern);
    if (found) return found[0];
  }
  return null;
}

/** The phrases themselves, for a check that wants to test each one. */
export const DIRECTIVE_PATTERNS = DIRECTIVES;
