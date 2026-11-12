/**
 * Smoke: admin hierarchy policy.
 * Run: node --experimental-strip-types modules/rbac/lib/admin-hierarchy.smoke.mts
 */
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {}
  const keys = Object.keys(env)
  for (const k of keys) {
    prev[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]!
  }
  try {
    fn()
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

const dir = dirname(fileURLToPath(import.meta.url))
const mod = await import(pathToFileURL(join(dir, "admin-hierarchy.ts")).href)
const {
  AdminHierarchyError,
  assertCanAssignRoles,
  assertCanEditRoleTemplate,
  assertCanGrantNewUser,
  assertCanMutateTargetRbac,
  assertCanRevokeRole,
  assertCanSyncIdentitySeed,
  isSuperAdminActor,
  roleCodesAssignableByActor,
} = mod

const SUPER = "ou_super_test_001"
const OTHER = "ou_other_test_002"
const ORPHAN = "ou_orphan_sa_003"

withEnv({ SUPER_ADMIN_FEISHU_OPEN_ID: SUPER }, () => {
  const sa = { role: "super_admin", feishuOpenId: SUPER }
  const admin = { role: "admin", feishuOpenId: OTHER }
  const salesTarget = { role: "sales", feishuOpenId: "ou_sales_1" }
  const saTarget = { role: "super_admin", feishuOpenId: SUPER }
  const orphanTarget = { role: "super_admin", feishuOpenId: ORPHAN }

  assert.doesNotThrow(() => assertCanAssignRoles(sa, salesTarget, ["admin"], "admin"))
  assert.throws(
    () => assertCanAssignRoles(admin, salesTarget, ["admin"], "admin"),
    (e: unknown) => e instanceof AdminHierarchyError && e.message.includes("仅超级管理员"),
  )
  assert.throws(
    () => assertCanAssignRoles(sa, salesTarget, ["super_admin"], "super_admin"),
    (e: unknown) => e instanceof AdminHierarchyError && e.message.includes("唯一"),
  )
  assert.throws(
    () => assertCanMutateTargetRbac(admin, saTarget),
    (e: unknown) => e instanceof AdminHierarchyError && e.message.includes("超级管理员"),
  )
  assert.throws(
    () => assertCanMutateTargetRbac(sa, saTarget),
    (e: unknown) => e instanceof AdminHierarchyError,
  )
  assert.doesNotThrow(() => assertCanAssignRoles(admin, salesTarget, ["viewer"], "viewer"))
  assert.throws(
    () => assertCanRevokeRole(admin, { role: "admin", feishuOpenId: "ou_admin_2" }, "admin"),
    (e: unknown) => e instanceof AdminHierarchyError && e.message.includes("取消管理员"),
  )
  assert.doesNotThrow(() => assertCanRevokeRole(sa, { role: "admin", feishuOpenId: "ou_admin_2" }, "admin"))
  assert.throws(
    () => assertCanGrantNewUser(admin, "ou_new", ["admin"], "admin"),
    (e: unknown) => e instanceof AdminHierarchyError,
  )
  assert.throws(
    () => assertCanGrantNewUser(sa, SUPER, ["viewer"], "viewer"),
    (e: unknown) => e instanceof AdminHierarchyError && e.message.includes("超级管理员"),
  )

  assert.throws(
    () => assertCanAssignRoles(admin, salesTarget, ["admin", "viewer"], "viewer"),
    (e: unknown) => e instanceof AdminHierarchyError && e.message.includes("仅超级管理员"),
  )
  assert.throws(
    () => assertCanAssignRoles(admin, salesTarget, ["super_admin", "viewer"], "viewer"),
    (e: unknown) => e instanceof AdminHierarchyError,
  )
  assert.doesNotThrow(() => assertCanAssignRoles(sa, salesTarget, ["admin", "viewer"], "viewer"))

  const orphanActor = { role: "super_admin", feishuOpenId: ORPHAN }
  assert.equal(isSuperAdminActor(orphanActor), false)
  assert.throws(
    () => assertCanAssignRoles(orphanActor, salesTarget, ["admin"], "admin"),
    (e: unknown) => e instanceof AdminHierarchyError && e.message.includes("仅超级管理员"),
  )

  assert.throws(
    () => assertCanMutateTargetRbac(admin, orphanTarget),
    (e: unknown) => e instanceof AdminHierarchyError,
  )
  assert.doesNotThrow(() => assertCanMutateTargetRbac(sa, orphanTarget))
  assert.doesNotThrow(() => assertCanRevokeRole(sa, orphanTarget, "super_admin"))
  assert.doesNotThrow(() => assertCanAssignRoles(sa, orphanTarget, ["admin"], "admin"))
  assert.throws(
    () => assertCanAssignRoles(admin, orphanTarget, ["viewer"], "viewer"),
    (e: unknown) => e instanceof AdminHierarchyError,
  )

  assert.throws(
    () => assertCanEditRoleTemplate(admin, "admin"),
    (e: unknown) => e instanceof AdminHierarchyError,
  )
  assert.doesNotThrow(() => assertCanEditRoleTemplate(sa, "admin"))
  assert.doesNotThrow(() => assertCanEditRoleTemplate(admin, "sales"))
  assert.throws(
    () => assertCanSyncIdentitySeed(admin),
    (e: unknown) => e instanceof AdminHierarchyError,
  )
  assert.doesNotThrow(() => assertCanSyncIdentitySeed(sa))

  const assignableAdmin = roleCodesAssignableByActor(admin, [
    "viewer",
    "sales",
    "admin",
    "super_admin",
  ])
  assert.deepEqual(assignableAdmin, ["viewer", "sales"])

  const assignableSa = roleCodesAssignableByActor(sa, ["viewer", "sales", "admin", "super_admin"])
  assert.deepEqual(assignableSa, ["viewer", "sales", "admin"])
})

console.log("admin-hierarchy.smoke: ok")
