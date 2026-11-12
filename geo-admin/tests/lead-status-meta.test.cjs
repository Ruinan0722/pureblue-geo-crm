/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads the project TypeScript compiler. */
const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const { test } = require("node:test")
const ts = require("typescript")

// Load the real TS helper and generated catalog with the project's compiler.
function loadTs(file) {
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const originalRequire = instance.require.bind(instance)
  instance.require = (id) => id === "./status-catalog.generated"
    ? loadTs(path.join(path.dirname(file), "status-catalog.generated.ts"))
    : originalRequire(id)
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  instance._compile(compiled.outputText, file)
  return instance.exports
}
const { leadStatusMeta, LEAD_STATUS_META } = loadTs(path.join(__dirname, "../modules/crm/lib/crm-data.ts"))

test("all current lead states retain their catalog presentation", () => {
  for (const [status, meta] of Object.entries(LEAD_STATUS_META)) assert.deepEqual(leadStatusMeta(status), meta)
})
test("legacy following records render without undefined metadata", () => {
  assert.deepEqual(leadStatusMeta("following"), LEAD_STATUS_META.touched)
})
test("unknown, missing and inherited-property status values cannot crash the page", () => {
  for (const status of [undefined, null, "", "future-status", "__proto__", "constructor", 123]) {
    const meta = leadStatusMeta(status)
    assert.equal(typeof meta.label, "string")
    assert.equal(typeof meta.tone, "string")
    assert.ok(meta.label.length > 0)
  }
})
test("channel conversion has its own label without changing direct-customer presentation", () => {
  assert.equal(leadStatusMeta("converted", "channel").label, "已转渠道商")
  assert.deepEqual(leadStatusMeta("converted"), LEAD_STATUS_META.converted)
})
