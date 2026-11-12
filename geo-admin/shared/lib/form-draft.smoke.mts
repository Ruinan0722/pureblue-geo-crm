#!/usr/bin/env node
/**
 * Smoke test for form-draft + schemaVersion.
 * Run: npx tsx shared/lib/form-draft.smoke.mts
 */
import {
  clearFormDraft,
  formDraftStorageKey,
  hasAnyFormDraft,
  loadFormDraft,
  saveFormDraft,
  type DraftStorage,
} from "./form-draft.ts"

function memoryStorage(): DraftStorage & { _map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

const store = memoryStorage()
const key = "crm:create-customer"

if (!saveFormDraft(key, { companyName: "Acme" }, { schemaVersion: 1, storage: store })) {
  throw new Error("save failed")
}
if (loadFormDraft<{ companyName: string }>(key, { schemaVersion: 1, storage: store })?.companyName !== "Acme") {
  throw new Error("load mismatch")
}
// incompatible schema discarded
if (loadFormDraft(key, { schemaVersion: 2, storage: store }) !== null) {
  throw new Error("schema mismatch should discard")
}
if (hasAnyFormDraft(store)) throw new Error("draft should be cleared after schema mismatch")

if (!saveFormDraft(key, { companyName: "Acme" }, { schemaVersion: 1, storage: store })) {
  throw new Error("save2 failed")
}
if (!store.getItem(formDraftStorageKey(key))) throw new Error("missing raw key")
clearFormDraft(key, store)
if (loadFormDraft(key, { storage: store }) !== null) throw new Error("clear failed")
console.log("form-draft smoke ok")
