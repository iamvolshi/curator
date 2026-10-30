// The picture maker's age and skill — the fun knob on the picture kid.
//
// The picture kid's joke, from the start, was a kid drawing on printer
// paper for bring-your-daughter-to-work day. So the maker is a person
// with an age and a skill, and the builder picks both. Muse Image has
// no age or skill parameter, so this shapes the prompt the model
// actually sees — honestly, in plain words, in the prompt itself.
// It cannot make the model draw like a real child; it can only ask
// for that hand. The shaped prompt is what gets sent, and the dry run
// shows it, so nobody has to take the shaping on trust.
//
// Age bands, because a 5-year-old's hand and a 12-year-old's hand are
// not the same hand: 3–5 crayon and chunky, 6–8 coloured pencil and
// big, 9–12 detail and shading attempts, 13–17 confident lines
// reaching for realism, 18+ an adult's hand. "adult" is accepted as
// an age. Skill is separate from age on purpose: a 7-year-old can be
// a beginner or a little master, and an adult can be a beginner too.

export const MAKER_SKILLS = ['beginner', 'learning', 'confident', 'skilled', 'master'];

const SKILL_WORDS = {
  beginner: 'just starting out, rough and simple',
  learning: 'practising and getting better',
  confident: 'confident and neat',
  skilled: 'skilled and detailed',
  master: 'masterful and polished',
};

function agePhrase(age) {
  if (age === 'adult') return "an adult artist's drawing";
  if (age <= 5) return `a ${age}-year-old's crayon drawing, chunky simple shapes, wobbly lines, bright colours`;
  if (age <= 8) return `a ${age}-year-old's coloured-pencil drawing, simple shapes, big and cheerful, a little wobbly`;
  if (age <= 12) return `a ${age}-year-old's drawing, more detail and shading attempts, still clearly a kid's hand`;
  if (age <= 17) return `a ${age}-year-old's drawing, confident lines, reaching for realism`;
  return `a ${age}-year-old artist's drawing`;
}

/**
 * Parse --age and --skill. Returns { age, skill, problem } — age is a
 * number or 'adult' or null, skill is one of MAKER_SKILLS or null.
 * A problem is a plain sentence, never a guess: a bad age or skill
 * stops the command instead of silently drawing as someone else.
 */
export function parseMaker({ age, skill }) {
  let parsedAge = null;
  if (age !== null && age !== undefined) {
    const raw = String(age).trim().toLowerCase();
    if (raw === 'adult') {
      parsedAge = 'adult';
    } else if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (n < 3 || n > 100) return { age: null, skill: null, problem: `--age must be 3 to 100, or "adult" — got ${age}` };
      parsedAge = n;
    } else {
      return { age: null, skill: null, problem: `--age must be a number from 3 to 100, or "adult" — got ${age}` };
    }
  }

  let parsedSkill = null;
  if (skill !== null && skill !== undefined) {
    const raw = String(skill).trim().toLowerCase();
    if (!MAKER_SKILLS.includes(raw)) {
      return { age: null, skill: null, problem: `--skill must be one of ${MAKER_SKILLS.join(', ')} — got ${skill}` };
    }
    parsedSkill = raw;
  }

  return { age: parsedAge, skill: parsedSkill, problem: null };
}

/** The label the folder tile shows, e.g. "Made like a 7-year-old, beginner". */
export function makerLabel({ age, skill }) {
  if (age === null && skill === null) return null;
  const who = age === null ? 'the picture kid' : age === 'adult' ? 'an adult' : `a ${age}-year-old`;
  const how = skill === null ? '' : `, ${skill}`;
  return `Made like ${who}${how}`;
}

/**
 * The prompt that actually goes to the model. With no age or skill
 * picked, it is the user's prompt untouched — the old behaviour.
 * With either picked, the maker's hand is asked for first, then the
 * subject, so the style is a request in the prompt, not a hidden
 * parameter the model never saw.
 */
export function shapePrompt(prompt, { age, skill }) {
  if (age === null && skill === null) return prompt;
  const parts = [];
  if (age !== null) parts.push(agePhrase(age));
  if (skill !== null) parts.push(SKILL_WORDS[skill]);
  return `Draw it like ${parts.join(', ')}: ${prompt}`;
}
