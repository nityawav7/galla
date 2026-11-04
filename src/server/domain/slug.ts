/**
 * Business slugs for URLs (/b/{slug}). They must match the businesses.slug CHECK:
 * lower-case letters, digits and single hyphens, at most 50 characters.
 */

export const MAX_SLUG_LENGTH = 50;
const SUFFIX_LENGTH = 4;
/** Room for "-" and a suffix when the plain slug is taken. */
const MAX_BASE_LENGTH = MAX_SLUG_LENGTH - SUFFIX_LENGTH - 1;
const FALLBACK = "shop";

/** "Gupta's Kirana Store" → "guptas-kirana-store". Names with no Latin letters give "shop". */
export function slugify(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_BASE_LENGTH) break;
    slug = next;
  }
  // A single word longer than the limit: cut it.
  if (!slug && words[0]) slug = words[0].slice(0, MAX_BASE_LENGTH);
  return slug || FALLBACK;
}

/** "sharma-hardware" + "x7k2" → "sharma-hardware-x7k2". */
export function slugWithSuffix(base: string, suffix: string): string {
  if (!/^[a-zA-Z0-9]{4}$/.test(suffix)) throw new RangeError("Suffix must be 4 letters or digits");
  return `${base.slice(0, MAX_BASE_LENGTH)}-${suffix.toLowerCase()}`;
}
