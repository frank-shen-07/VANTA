/** Text helpers shared by the heuristic generator and the LLM output expander. */

/** Lower-cased word list (letters, digits, apostrophes, hyphens kept). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ""))
    .filter(Boolean);
}

/** Naive singular form so "rings" matches "ring". */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es") && /(sh|ch|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export class WordSet {
  readonly words: string[];
  private readonly set: Set<string>;
  readonly text: string;

  constructor(text: string) {
    this.text = ` ${tokenize(text).join(" ")} `;
    this.words = tokenize(text);
    this.set = new Set(this.words.flatMap((w) => [w, singular(w)]));
  }

  /** True when any of the words (or multi-word phrases) appears. */
  has(...terms: string[]): boolean {
    return terms.some((t) => (t.includes(" ") ? this.text.includes(` ${t} `) : this.set.has(t) || this.set.has(singular(t))));
  }

  /** Index of the first occurrence of any term (or -1). */
  indexOf(...terms: string[]): number {
    let best = -1;
    for (const t of terms) {
      const i = this.words.findIndex((w) => w === t || singular(w) === singular(t));
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  }

  count(...terms: string[]): number {
    return terms.filter((t) => this.has(t)).length;
  }
}

/** Removes control characters and markup-ish characters, collapses whitespace, truncates. */
export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>`{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

export function titleCase(words: string): string {
  return words.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
