// Dependency-free fuzzy matcher (subsequence match with positional bonuses).
// Pure functions only, so it runs unchanged in the extension and in `node --test`.
//
// Hot path: `prepare()` a text once, then `scorePrepared()` it on every
// keystroke. `positionsPrepared()` is the slower variant that also says which
// characters matched, and is only needed for rows that get drawn.

const SCORE_GAP_LEADING = -0.005;
const SCORE_GAP_TRAILING = -0.005;
const SCORE_GAP_INNER = -0.01;
const SCORE_MATCH_CONSECUTIVE = 1.0;
const SCORE_MATCH_SLASH = 0.9;
const SCORE_MATCH_WORD = 0.8;
const SCORE_MATCH_CAPITAL = 0.7;
const SCORE_MATCH_DOT = 0.6;

/** Longest haystack (in characters) the scorer looks at. */
export const MAX_TEXT_LENGTH = 160;

const WORD_SEPARATORS = new Set([
  ' ', '　', '-', '_', ':', '?', '=', '&', '#', '|', '(', '[', '「', '『', '・', '、', '。', ',',
]);

/** Lower-cases and width-folds text so that "ＧitＨub" and "github" compare equal. */
export function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase();
}

/** Folds one character to exactly one character, keeping indices aligned with the source. */
function foldChar(ch) {
  if (ch <= '\u007f') return ch.toLowerCase();
  const folded = Array.from(normalize(ch));
  return folded.length >= 1 ? folded[0] : ch;
}

function isLower(ch) {
  return ch >= 'a' && ch <= 'z';
}

function isUpper(ch) {
  return ch >= 'A' && ch <= 'Z';
}

function isAscii(ch) {
  return ch <= '\u007f';
}

/** Bonus for matching `cur`, judged from the character before it. */
function boundaryBonus(prev, cur) {
  if (prev === undefined) return SCORE_MATCH_WORD;
  if (prev === '/') return SCORE_MATCH_SLASH;
  if (prev === '.') return SCORE_MATCH_DOT;
  if (WORD_SEPARATORS.has(prev)) return SCORE_MATCH_WORD;
  if (isLower(prev) && isUpper(cur)) return SCORE_MATCH_CAPITAL;
  // Script change such as "Notion議事録": the first kanji starts a word.
  if (isAscii(prev) && !isAscii(cur)) return SCORE_MATCH_WORD;
  return 0;
}

/** True when every element of `needle` appears in `hay` in order. */
export function isSubsequence(needle, hay) {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) {
    if (hay[i] === needle[j]) j++;
  }
  return j === needle.length;
}

/**
 * @typedef {object} Prepared
 * @property {string[]} hay folded characters, one per source character
 * @property {Float64Array} bonus bonus for a match starting at each index
 */

/** Pre-computes everything about a text that does not depend on the query. */
export function prepare(text) {
  const source = Array.from(String(text ?? '')).slice(0, MAX_TEXT_LENGTH);
  const hay = source.map(foldChar);
  const bonus = new Float64Array(source.length);
  for (let j = 0; j < source.length; j++) bonus[j] = boundaryBonus(source[j - 1], source[j]);
  return { hay, bonus };
}

/** Splits a query term into the folded characters the scorer compares. */
export function toNeedle(term) {
  return Array.from(normalize(term));
}

// Rolling DP rows shared by every scorePrepared call (the scorer is synchronous).
const SCRATCH = [0, 1, 2, 3].map(() => new Float64Array(MAX_TEXT_LENGTH));

/**
 * Score only. Reuses four fixed rows, so a call allocates nothing.
 * @param {string[]} needle from `toNeedle`
 * @param {Prepared} prepared
 * @returns {number | null} null when the needle is not a subsequence
 */
export function scorePrepared(needle, prepared) {
  const { hay, bonus } = prepared;
  const n = needle.length;
  const m = hay.length;
  if (n === 0) return 0;
  if (n > m || !isSubsequence(needle, hay)) return null;

  let [prevD, prevM, curD, curM] = SCRATCH;

  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    const gap = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
    const ch = needle[i];
    for (let j = 0; j < m; j++) {
      let d = -Infinity;
      if (ch === hay[j]) {
        if (i === 0) {
          d = j * SCORE_GAP_LEADING + bonus[j];
        } else if (j > 0) {
          const viaGap = prevM[j - 1] + bonus[j];
          const viaRun = prevD[j - 1] + SCORE_MATCH_CONSECUTIVE;
          d = viaGap > viaRun ? viaGap : viaRun;
        }
        best = d > best + gap ? d : best + gap;
      } else {
        best += gap;
      }
      curD[j] = d;
      curM[j] = best;
    }
    [prevD, curD] = [curD, prevD];
    [prevM, curM] = [curM, prevM];
  }
  return prevM[m - 1];
}

/**
 * Score plus the indices of the matched characters (code-point indices into the source text).
 * @returns {{score: number, positions: number[]} | null}
 */
export function positionsPrepared(needle, prepared) {
  const { hay, bonus } = prepared;
  const n = needle.length;
  const m = hay.length;
  if (n === 0) return { score: 0, positions: [] };
  if (n > m || !isSubsequence(needle, hay)) return null;

  // D[i][j]: best score with needle[i] matched exactly at hay[j].
  // M[i][j]: best score for needle[0..i] somewhere within hay[0..j].
  const D = Array.from({ length: n }, () => new Float64Array(m).fill(-Infinity));
  const M = Array.from({ length: n }, () => new Float64Array(m).fill(-Infinity));

  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    const gap = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
    for (let j = 0; j < m; j++) {
      if (needle[i] === hay[j]) {
        let score = -Infinity;
        if (i === 0) {
          score = j * SCORE_GAP_LEADING + bonus[j];
        } else if (j > 0) {
          score = Math.max(M[i - 1][j - 1] + bonus[j], D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE);
        }
        D[i][j] = score;
        best = Math.max(score, best + gap);
      } else {
        best += gap;
      }
      M[i][j] = best;
    }
  }

  // Walk back to recover which characters matched.
  const positions = new Array(n);
  let mustContinueRun = false;
  for (let i = n - 1, j = m - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      if (D[i][j] !== -Infinity && (mustContinueRun || D[i][j] === M[i][j])) {
        mustContinueRun =
          i > 0 && j > 0 && M[i][j] === D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE;
        positions[i] = j--;
        break;
      }
    }
  }

  return { score: M[n - 1][m - 1], positions };
}

/**
 * Convenience wrapper: scores one query term against a raw text.
 * @returns {{score: number, positions: number[]} | null}
 */
export function fuzzyMatch(query, text) {
  return positionsPrepared(toNeedle(query), prepare(text));
}

/**
 * Variants of a term with one typo undone: one character dropped, or two
 * neighbours swapped. Meant as a fallback when the term itself finds nothing.
 */
export function typoVariants(term) {
  const chars = toNeedle(term);
  if (chars.length < 4) return [];
  const out = new Set();
  for (let i = 0; i < chars.length; i++) {
    out.add(chars.slice(0, i).concat(chars.slice(i + 1)).join(''));
  }
  for (let i = 0; i < chars.length - 1; i++) {
    const swapped = chars.slice();
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    out.add(swapped.join(''));
  }
  out.delete(chars.join(''));
  return [...out];
}
