/** 客户端/服务端均可用的部门名格式化（无 Node fs 依赖） */

function stripDepartmentMeta(name: string): string {
  return name.replace(/（[^）]*）$/u, "").trim()
}

function shortNameFromPath(path: string): string {
  const parts = path.split(">").map((s) => s.trim()).filter(Boolean)
  const last = parts[parts.length - 1]
  return last ? stripDepartmentMeta(last) : stripDepartmentMeta(path.trim())
}

const ROOT_PREFIXES = ["PureblueAI > ", "PureblueAI>", "Pureblue AI > "] as const

/** 去掉公司根前缀，保留业务组织路径 */
export function stripCompanyRootPrefix(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return trimmed
  for (const prefix of ROOT_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
  }
  const parts = trimmed.split(">").map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 2 && parts[0].replace(/\s+/g, "").toLowerCase() === "pureblueai") {
    return parts.slice(1).join(" > ")
  }
  return trimmed
}

/**
 * 人员/查询场景：保留上级部门路径（如 销售部 > 直销 > 北一）。
 * 树节点短名请用 formatDepartmentDisplayName。
 */
export function formatDepartmentPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith("od-")) return trimmed
  const normalized = stripCompanyRootPrefix(trimmed)
  if (!normalized.includes(">")) return stripDepartmentMeta(normalized)
  return normalized
    .split(">")
    .map((part) => stripDepartmentMeta(part.trim()))
    .filter(Boolean)
    .join(" > ")
}

/** 统一格式化为列表展示的短部门名（不含 PureblueAI > 前缀） */
export function formatDepartmentDisplayName(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed.includes(">")) return shortNameFromPath(trimmed)
  return stripDepartmentMeta(trimmed)
}
