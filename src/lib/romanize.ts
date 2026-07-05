/**
 * Romanization — converts non-Latin scripts to Latin characters so listeners
 * can sing along. NOT translation: meaning is untouched, only the script changes.
 *
 * Supported: Devanagari (Hindi), Gurmukhi (Punjabi), Bengali, Tamil, Telugu,
 * Kannada, Malayalam (via sanscript), Korean (built-in Revised Romanization),
 * Japanese kana (via wanakana; kanji passes through unchanged — a full kanji
 * reading requires a morphological dictionary, out of scope for now).
 */

import Sanscript from '@indic-transliteration/sanscript';
import { toRomaji, isJapanese } from 'wanakana';

type IndicScheme = 'devanagari' | 'gurmukhi' | 'bengali' | 'tamil' | 'telugu' | 'kannada' | 'malayalam';

interface ScriptRange {
  scheme: IndicScheme;
  start: number;
  end: number;
  /** Hindi/Punjabi/Bengali drop the inherent word-final "a" in speech. */
  schwaDeleting: boolean;
}

const INDIC_RANGES: ScriptRange[] = [
  { scheme: 'devanagari', start: 0x0900, end: 0x097f, schwaDeleting: true },
  { scheme: 'bengali', start: 0x0980, end: 0x09ff, schwaDeleting: true },
  { scheme: 'gurmukhi', start: 0x0a00, end: 0x0a7f, schwaDeleting: true },
  { scheme: 'tamil', start: 0x0b80, end: 0x0bff, schwaDeleting: false },
  { scheme: 'telugu', start: 0x0c00, end: 0x0c7f, schwaDeleting: false },
  { scheme: 'kannada', start: 0x0c80, end: 0x0cff, schwaDeleting: false },
  { scheme: 'malayalam', start: 0x0d00, end: 0x0d7f, schwaDeleting: false },
];

function toUnicodeRange(range: ScriptRange): string {
  const hex = (n: number) => n.toString(16).padStart(4, '0');
  return `\\u${hex(range.start)}-\\u${hex(range.end)}`;
}

function hasHangul(text: string): boolean {
  return /[가-힯ᄀ-ᇿ]/.test(text);
}

function hasKana(text: string): boolean {
  return /[぀-ヿ]/.test(text);
}

/** Strip combining diacritics (ā→a, ī→i, ṇ→n) for easy sing-along reading. */
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

/** IAST → casual Hinglish-style digraphs: ś/ṣ → sh, c → ch, ch → chh. */
function casualizeIast(s: string): string {
  return s
    .replace(/ch/g, 'chh')
    .replace(/c(?!h)/g, 'ch')
    .replace(/[śṣ]/g, 'sh')
    .replace(/[ŚṢ]/g, 'Sh');
}

/** Drop the unpronounced word-final inherent "a" ("nāla" → "nāl") for Hindi/Punjabi/Bengali. */
function deleteFinalSchwa(s: string): string {
  return s.replace(/([bcdfghjklmnpqrstvwyzśṣṭḍṇñṅ])a\b/g, '$1');
}

function romanizeIndic(text: string, range: ScriptRange): string {
  // Nukta marks (क़ ज़ फ़ etc.) aren't in sanscript's tables — drop the mark and
  // use the base consonant (ka/ja/pha for qa/za/fa: close enough to sing).
  const cleaned = text.normalize('NFD').replace(/[़়਼]/g, '').normalize('NFC');

  let iast = Sanscript.t(cleaned, range.scheme, 'iast');
  if (range.schwaDeleting) iast = deleteFinalSchwa(iast);
  iast = casualizeIast(iast);
  return stripDiacritics(iast).replace(/\s{2,}/g, ' ').trim();
}

// --- Korean Revised Romanization (syllable decomposition, no assimilation rules) ---

const RR_INITIALS = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const RR_MEDIALS = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const RR_FINALS = ['','k','k','ks','n','nj','nh','t','l','lk','lm','lb','ls','lt','lp','lh','m','p','ps','t','t','ng','t','t','k','t','p','t'];

function romanizeKorean(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00;
      out += RR_INITIALS[Math.floor(idx / 588)] + RR_MEDIALS[Math.floor((idx % 588) / 28)] + RR_FINALS[idx % 28];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Romanize one lyric line. Returns null when the line needs no romanization
 * (already Latin, or an unsupported script) — callers show the original then.
 *
 * Mixed-script lines (Hinglish: "मेरा dil crazy है") are handled by romanizing
 * only the contiguous non-Latin runs — embedded Latin words are passed through
 * verbatim, never re-processed (otherwise "crazy" would become "chrazy" via the
 * IAST c→ch rule).
 */
export function romanizeLine(text: string): string | null {
  let out = text;
  let changed = false;

  for (const range of INDIC_RANGES) {
    // A run = Indic chars of this script, allowing spaces/danda between them so
    // multi-word phrases transliterate as one sanscript call.
    const runRe = new RegExp(`[${toUnicodeRange(range)}](?:[${toUnicodeRange(range)}\\s]*[${toUnicodeRange(range)}])?`, 'gu');
    if (runRe.test(out)) {
      changed = true;
      out = out.replace(runRe, (run) => romanizeIndic(run, range));
    }
  }

  if (hasHangul(out)) {
    changed = true;
    out = romanizeKorean(out); // per-char: only Hangul syllables are converted
  }

  if (hasKana(out) && isJapanese(out.replace(/[a-zA-Z0-9\s'".,!?-]+/g, ''))) {
    changed = true;
    out = toRomaji(out); // wanakana passes non-kana through unchanged
  }

  return changed ? out.replace(/\s{2,}/g, ' ').trim() : null;
}
