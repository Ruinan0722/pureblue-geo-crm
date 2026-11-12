/**
 * Smoke: release-notes seen gate (localStorage).
 * Run: node --experimental-strip-types shared/lib/release-notes.smoke.mts
 */
import assert from "node:assert/strict"
import {
  clearReleaseNotesSeen,
  hasSeenReleaseNotes,
  markReleaseNotesSeen,
  releaseNotesSeenKey,
} from "./release-notes.ts"

const store = new Map<string, string>()

Object.defineProperty(globalThis, "window", {
  value: globalThis,
  configurable: true,
})
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
  },
  configurable: true,
})

const version = "v-local-1"
assert.equal(hasSeenReleaseNotes(version), false)
markReleaseNotesSeen(version)
const storedRaw = store.get(releaseNotesSeenKey(version))
assert.ok(storedRaw)
assert.equal((JSON.parse(storedRaw) as { v: number }).v, 1)
assert.equal(hasSeenReleaseNotes(version), true)
assert.equal(hasSeenReleaseNotes("v-local-2"), false)

clearReleaseNotesSeen("v-local-1")
assert.equal(hasSeenReleaseNotes("v-local-1"), false)

markReleaseNotesSeen("a")
markReleaseNotesSeen("b")
clearReleaseNotesSeen()
assert.equal(hasSeenReleaseNotes("a"), false)
assert.equal(hasSeenReleaseNotes("b"), false)

console.log("release-notes.smoke: ok")
