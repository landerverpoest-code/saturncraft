// Books you write in, and the Lectern that holds one open for everybody.
//
// * Writable Book (book + black dye + feather): stack.pages is a list of up
//   to 50 pages of up to 256 characters (line breaks allowed). Signing it
//   (a title of up to 32 characters; the author is the player's name) makes a
//   Written Book that can only be read - a signed book is never edited again
//   (reference behaviour). Written copies with the same text, title, author
//   and generation stack (up to 16); writable books never stack.
// * Copying (crafting grid): a Written Book with one or more Writable Books
//   gives as many copies, and the book itself stays in the grid. Each copy is
//   one generation further (stack.gen: 0 original, 1 copy of original, 2 copy
//   of a copy, shown in the tooltip); copies of copies cannot be copied.
// * Lectern (4 wooden slabs + a bookshelf): right-click with a book puts it
//   on the desk; anyone can then read it there, and take it off through the
//   reading screen. Turning a page sends a short cinnabar pulse (2 ticks) and
//   a comparator behind the lectern reads the open page (reference formula):
//   floor(14 * page / (pages - 1)) + 1, 15 for a one-page book, 0 when empty.
//   Per position state lives in game.lecterns ("x,y,z" -> { book, page }).
import { I } from './items.js';

export const BOOK_MAX_PAGES = 50;
export const PAGE_MAX = 256;
export const TITLE_MAX = 32; // as long as a Name Tag's name
/** Lectern meta bits (0-1 are the side its reader stands on). */
export const LECTERN_HAS_BOOK = 4, LECTERN_POWERED = 8;
export const LECTERN_PULSE_TICKS = 2;

export const isBook = (id) => id === I.WRITABLE_BOOK || id === I.WRITTEN_BOOK;

/** Generations of a written book (stack.gen), as the tooltip names them. Only originals and first copies can be copied. */
export const BOOK_GENERATIONS = ['Original', 'Copy of original', 'Copy of a copy', 'Tattered'];
export const MAX_COPY_GEN = 1;
/** Generation of a book stack (0 = original). */
export const bookGeneration = (st) => Math.max(0, Math.min(3, (st && st.gen) | 0));

/** A cleaned page (from untrusted data): control characters other than line breaks go, at most PAGE_MAX characters. */
export function cleanPage(t) {
  if (typeof t !== 'string') return '';
  return t.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, PAGE_MAX);
}

/** Cleaned pages (from untrusted data): up to BOOK_MAX_PAGES strings, or null when there is no text at all. */
export function cleanPages(list) {
  if (!Array.isArray(list)) return null;
  const out = list.slice(0, BOOK_MAX_PAGES).map(cleanPage);
  while (out.length && !out[out.length - 1]) out.pop(); // blank pages at the end are not kept
  return out.length ? out : null;
}

/** A cleaned one-line title or author name (trimmed, up to TITLE_MAX characters), or null. */
export function cleanTitle(t) {
  if (typeof t !== 'string') return null;
  const s = t.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, TITLE_MAX);
  return s || null;
}

/** Copy a book's text (pages, and for a written book its title and author) from `src` onto `dst`, cleaned. */
export function copyBookFields(dst, src) {
  if (!src) return dst;
  const pages = cleanPages(src.pages);
  if (pages) dst.pages = pages;
  const title = cleanTitle(src.title);
  if (title) dst.title = title;
  const author = cleanTitle(src.author);
  if (author) dst.author = author;
  const gen = bookGeneration(src);
  if (gen) dst.gen = gen;
  return dst;
}

/** Same text, title and author (for stacking written books and comparing stacks). */
export function sameBook(a, b) {
  const pa = (a && a.pages) || [], pb = (b && b.pages) || [];
  if (pa.length !== pb.length || ((a && a.title) || '') !== ((b && b.title) || '') || ((a && a.author) || '') !== ((b && b.author) || '')) return false;
  if (bookGeneration(a) !== bookGeneration(b)) return false;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false;
  return true;
}

/** The pages to show for a book stack: at least one (blank) page. */
export function bookPages(st) {
  const p = st && Array.isArray(st.pages) ? st.pages : [];
  return p.length ? p : [''];
}

/** Sign a writable book: a new Written Book stack, or null when the title is blank. */
export function signBook(st, title, author) {
  const t = cleanTitle(title);
  if (!st || st.id !== I.WRITABLE_BOOK || !t) return null;
  const out = { id: I.WRITTEN_BOOK, count: 1, damage: 0, title: t, author: cleanTitle(author) || 'Unknown' };
  const pages = cleanPages(st.pages);
  if (pages) out.pages = pages;
  return out;
}

/**
 * Book copying in a crafting grid (stacks or nulls): exactly one Written Book and one or more
 * Writable Books, nothing else. Returns { result, keep } - the copies (one per writable book, a
 * generation further) and the grid index of the written book, which stays - or null when the grid
 * is not a book copy or the book is a copy of a copy.
 */
export function bookCopy(grid) {
  let src = -1, blanks = 0;
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (!s) continue;
    if (s.id === I.WRITTEN_BOOK) { if (src >= 0) return null; src = i; } else if (s.id === I.WRITABLE_BOOK) blanks++;
    else return null;
  }
  if (src < 0 || !blanks) return null;
  const book = grid[src], gen = bookGeneration(book);
  if (gen > MAX_COPY_GEN) return null;
  const result = copyBookFields({ id: I.WRITTEN_BOOK, count: blanks, damage: 0 }, book);
  result.gen = gen + 1;
  return { result, keep: src };
}

/** Comparator signal of a lectern holding `book` open at `page` (reference formula). */
export function lecternSignal(book, page) {
  if (!book) return 0;
  const n = bookPages(book).length;
  const p = Math.max(0, Math.min(n - 1, page | 0));
  const f = n > 1 ? p / (n - 1) : 1;
  return Math.floor(f * 14) + 1;
}

/**
 * A lectern's meta after its state went from `before` to `after` ({ book, page } or null): the book bit
 * follows the book, and a page that changed sets the pulse bit (world/circuits.js ends the pulse).
 */
export function lecternMeta(meta, before, after) {
  let m = after ? meta | LECTERN_HAS_BOOK : meta & ~(LECTERN_HAS_BOOK | LECTERN_POWERED);
  if (after && before && before.page !== after.page) m |= LECTERN_POWERED;
  return m;
}

/** A cleaned lectern state from untrusted data (saves, network): { book, page } or null when it holds no book. */
export function cleanLectern(s) {
  if (!s || !s.book || !isBook(s.book.id | 0)) return null;
  const book = copyBookFields({ id: s.book.id | 0, count: 1, damage: 0 }, s.book);
  const n = bookPages(book).length;
  return { book, page: Math.max(0, Math.min(n - 1, s.page | 0)) };
}
