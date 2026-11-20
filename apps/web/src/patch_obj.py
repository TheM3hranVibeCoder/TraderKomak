import io

p = "pine/runtime.ts"
s = io.open(p, encoding="utf-8").read()

# A1. PineObject + V union
old = """/** na for numbers is NaN (arithmetic propagates it naturally); other types
 *  use null. Tuples (multi-return builtins) are transient JS arrays. */
export type V = number | boolean | string | PineColor | null;"""
new = """/** A Pine object: UDT instances, drawing objects (box/label/line/linefill)
 *  and arrays. REFERENCES — mutations persist across bars (Pine semantics). */
export interface PineObject {
  __kind: "udt" | "box" | "label" | "line" | "linefill" | "array";
  /** UDT type name (kind === "udt"). */
  type?: string;
  fields?: Record<string, V>;
  /** Array items (kind === "array"). */
  items?: V[];
  /** Drawing-object id (kind !== "udt"/"array"). */
  id?: number;
  props?: Record<string, V>;
  deleted?: boolean;
}

/** na for numbers is NaN (arithmetic propagates it naturally); other types
 *  use null. Tuples (multi-return builtins) are transient JS arrays. */
export type V = number | boolean | string | PineColor | PineObject | null;"""
assert old in s, "A1 V union"
s = s.replace(old, new)

# A2. isNa/num/truthy handle objects
old = """function isNa(v: V): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

function num(v: V): number {
  return typeof v === "number" ? v : NaN;
}

function truthy(v: V): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !Number.isNaN(v) && v !== 0;
  if (v === null || v === undefined) return false;
  return true;
}"""
new = """function isNa(v: V): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

function num(v: V): number {
  return typeof v === "number" ? v : NaN;
}

function truthy(v: V): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !Number.isNaN(v) && v !== 0;
  if (v === null || v === undefined) return false;
  return true;
}

function isObjectV(v: V): v is PineObject {
  return !!v && typeof v === "object" && "__kind" in v;
}

function isArrV(v: V): v is PineObject & { items: V[] } {
  return isObjectV(v) && v.__kind === "array" && Array.isArray(v.items);
}"""
assert old in s, "A2 helpers"
s = s.replace(old, new)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("A ok")
