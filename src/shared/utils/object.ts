/** Small, dependency-free helpers shared by every module. */

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges `patch` into `base`, returning a new object.
 * Plain objects are merged; arrays and primitives in `patch` replace the base value.
 * `undefined` values in the patch are ignored.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out as T;
}

/** Reads a dot-separated path ("particles.count", "transform.position.0"). */
export function getAtPath(obj: unknown, path: string | readonly (string | number)[]): unknown {
  const keys = typeof path === "string" ? path.split(".") : path;
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[key as string];
  }
  return cur;
}

/** Immutably sets a value at a path, cloning objects/arrays along the way. */
export function setAtPath<T>(obj: T, path: string | readonly (string | number)[], value: unknown): T {
  const keys = typeof path === "string" ? path.split(".") : [...path];
  if (keys.length === 0) return value as T;
  const [head, ...rest] = keys;
  const container: Record<string | number, unknown> | unknown[] = Array.isArray(obj)
    ? [...obj]
    : isPlainObject(obj)
      ? { ...obj }
      : /^\d+$/.test(String(rest[0] ?? "")) ? [] : {};
  const child = (container as Record<string | number, unknown>)[head as string];
  (container as Record<string | number, unknown>)[head as string] =
    rest.length === 0 ? value : setAtPath(child, rest, value);
  return container as T;
}

/** Builds a nested partial object from a dot path: ("a.b", 1) → { a: { b: 1 } }. Tuple indices are not supported; set whole tuples instead. */
export function pathToPatch(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  let out: unknown = value;
  for (let i = keys.length - 1; i >= 0; i--) out = { [keys[i]]: out };
  return out as Record<string, unknown>;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Short random ID such as "lyr_k3j9x2ab". Matches IdSchema. */
export function createId(prefix: string): string {
  let suffix = "";
  const bytes =
    typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
      ? crypto.getRandomValues(new Uint8Array(8))
      : Uint8Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
  for (const b of bytes) suffix += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${prefix}_${suffix}`;
}
