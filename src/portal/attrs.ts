// Helpers for reading a Power Apps CRM record's name-keyed Attributes array.
//
// Each attribute carries Value (raw) and usually DisplayValue (human-readable,
// e.g. an option-set label or formatted date). We prefer DisplayValue and fall
// back to Value.

import type { PortalAttribute, PortalRecord } from "./types.ts";

export function attr(rec: PortalRecord, name: string): string | null {
  const a = rec.Attributes.find((x) => x.Name === name);
  return a ? coerce(a) : null;
}

function coerce(a: PortalAttribute): string | null {
  const dv = a.DisplayValue;
  if (typeof dv === "string" && dv.trim()) return dv.trim();
  if (typeof a.Value === "string" && a.Value.trim()) return a.Value.trim();
  if (a.Value && typeof a.Value === "object" && "Name" in (a.Value as object)) {
    const n = (a.Value as { Name?: string }).Name;
    return n?.trim() || null;
  }
  return null;
}

// Flatten a record to a plain name -> string map (handy for debugging / raw dumps).
export function flatten(rec: PortalRecord): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const a of rec.Attributes) out[a.Name] = coerce(a);
  return out;
}

// A Power Apps Yes/No option set surfaces as the DisplayValue string "Yes"/"No".
export function yesNo(value: string | null): boolean | null {
  if (value == null) return null;
  const v = value.trim().toLowerCase();
  if (v === "yes" || v === "true") return true;
  if (v === "no" || v === "false") return false;
  return null;
}
