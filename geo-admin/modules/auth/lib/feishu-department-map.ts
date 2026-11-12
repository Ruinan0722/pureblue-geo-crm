import { readFileSync } from "fs"
import { join } from "path"
import { formatDepartmentDisplayName, formatDepartmentPath } from "./department-display-name"
import { getSalesDepartmentNames } from "./role-resolver"

export interface MemberDepartmentProfile {
  feishuOpenId?: string
  name: string
  departmentOpenId: string
  departmentName: string
  breadcrumb: string
  leader?: boolean
  note?: string
}

interface DepartmentMapFile {
  roles?: Record<string, string>
  labels?: Record<string, string>
  breadcrumbs?: Record<string, string>
  leaders?: Record<string, string>
  memberProfiles?: MemberDepartmentProfile[]
}

let cachedMap: DepartmentMapFile | null | undefined

function loadDepartmentMapFile(): DepartmentMapFile | null {
  if (cachedMap !== undefined) return cachedMap

  try {
    const raw = readFileSync(join(process.cwd(), "config/feishu-department-map.json"), "utf8")
    cachedMap = JSON.parse(raw) as DepartmentMapFile
  } catch {
    cachedMap = null
  }

  return cachedMap
}

/** 从 config/feishu-department-map.json 读取角色对应的 open_department_id */
export function getMappedDepartmentIdsForRole(roleDepartmentName: string): string[] {
  const map = loadDepartmentMapFile()
  const id = map?.roles?.[roleDepartmentName]?.trim()
  return id ? [id] : []
}

/** 解析销售部 open_department_id（配置文件 > 环境变量） */
export async function getConfiguredSalesDepartmentIds(): Promise<string[]> {
  const ids = new Set<string>()

  for (const name of await getSalesDepartmentNames()) {
    for (const id of getMappedDepartmentIdsForRole(name)) {
      ids.add(id)
    }
  }

  return Array.from(ids)
}

function displayNameForDepartment(map: DepartmentMapFile, openDepartmentId: string): string | null {
  const label = map.labels?.[openDepartmentId]?.trim()
  if (label) return formatDepartmentDisplayName(label)
  const breadcrumb = map.breadcrumbs?.[openDepartmentId]?.trim()
  if (breadcrumb) return formatDepartmentDisplayName(breadcrumb)
  return null
}

/** 人员展示用完整路径（优先 breadcrumbs，保留上级部门） */
export function getDepartmentPathById(openDepartmentId: string): string | null {
  const map = loadDepartmentMapFile()
  if (!map) return null
  const oid = openDepartmentId.trim()
  if (!oid.startsWith("od-")) return null
  const breadcrumb = map.breadcrumbs?.[oid]?.trim()
  if (breadcrumb) return formatDepartmentPath(breadcrumb)
  const label = map.labels?.[oid]?.trim()
  if (label) return formatDepartmentPath(label)
  return null
}

/**
 * 将库内部门字段转为展示路径：od-xxx → 中文组织路径；已是路径则规范化。
 * 服务端可读 map；解析失败时原样返回。
 */
export function resolveDepartmentPathValue(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith("od-")) {
    return getDepartmentPathById(trimmed) || trimmed
  }
  return formatDepartmentPath(trimmed)
}

export function resolveDepartmentPathList(names: string[]): string[] {
  const out: string[] = []
  for (const name of names) {
    const resolved = resolveDepartmentPathValue(name)
    if (resolved && !out.includes(resolved)) out.push(resolved)
  }
  return out
}

/** 通过 open_department_id 获取人工标注名称（用于飞书接口缺少部门名时兜底） */
export function getDepartmentLabelById(openDepartmentId: string): string | null {
  const map = loadDepartmentMapFile()
  if (!map) return null
  return displayNameForDepartment(map, openDepartmentId)
}

/** 通过 open_department_id 获取部门负责人姓名 */
export function getDepartmentLeaderById(openDepartmentId: string): string | null {
  const map = loadDepartmentMapFile()
  const leader = map?.leaders?.[openDepartmentId]?.trim()
  return leader ? leader : null
}

/** 列出配置文件中标注的部门负责人（open_department_id → 姓名） */
export function listConfiguredDepartmentLeaders(): Record<string, string> {
  const map = loadDepartmentMapFile()
  const leaders = map?.leaders ?? {}
  const out: Record<string, string> = {}
  for (const [id, name] of Object.entries(leaders)) {
    const trimmed = name.trim()
    if (id && trimmed) out[id] = trimmed
  }
  return out
}

/** 列出人工标注的成员部门映射（供批量导入/标注参考） */
export function listMemberDepartmentProfiles(): MemberDepartmentProfile[] {
  const map = loadDepartmentMapFile()
  return map?.memberProfiles ?? []
}

/** 按姓名查找成员部门映射（重名时返回全部匹配） */
export function findMemberDepartmentProfilesByName(name: string): MemberDepartmentProfile[] {
  const trimmed = name.trim()
  if (!trimmed) return []
  return listMemberDepartmentProfiles().filter((p) => p.name === trimmed)
}

/** 列出人工标注部门（供搜索兜底） */
export function listDepartmentLabels(): Array<{ id: string; name: string }> {
  const map = loadDepartmentMapFile()
  if (!map) return []
  const labels = map.labels ?? {}
  return Object.entries(labels)
    .map(([id, name]) => ({
      id,
      name: displayNameForDepartment(map, id) ?? name.trim(),
    }))
    .filter((x) => x.id && x.name)
}

/** 在本地配置（labels + breadcrumbs）中模糊搜索部门 */
export function searchConfiguredDepartments(query: string): Array<{ id: string; name: string }> {
  const map = loadDepartmentMapFile()
  if (!map) return []
  const qLower = query.trim().toLowerCase()
  if (!qLower) return []

  const seen = new Set<string>()
  const results: Array<{ id: string; name: string }> = []

  const tryAdd = (id: string, raw: string) => {
    const trimmed = raw.trim()
    if (!id || !trimmed || seen.has(id)) return
    const display = displayNameForDepartment(map!, id) ?? formatDepartmentDisplayName(trimmed)
    if (!display.toLowerCase().includes(qLower) && !trimmed.toLowerCase().includes(qLower)) return
    seen.add(id)
    results.push({ id, name: display })
  }

  for (const [id, name] of Object.entries(map.labels ?? {})) {
    tryAdd(id, name)
  }
  for (const [id, breadcrumb] of Object.entries(map.breadcrumbs ?? {})) {
    tryAdd(id, breadcrumb)
  }

  return results.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
}
