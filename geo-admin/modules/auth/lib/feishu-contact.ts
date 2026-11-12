import { getTenantAccessToken } from "./feishu"
import { getSalesDepartmentIds, getSalesDepartmentNames } from "./role-resolver"
import { getConfiguredSalesDepartmentIds, getDepartmentLabelById, getDepartmentPathById } from "./feishu-department-map"

const FEISHU_BASE = "https://open.feishu.cn/open-apis"
const SALES_MEMBERS_CACHE_TTL_MS = 30 * 60 * 1000
const DEPARTMENT_TREE_CACHE_TTL_MS = 60 * 60 * 1000

interface FeishuApiResponse<T> {
  code: number
  msg: string
  data?: T
}

interface DepartmentItem {
  name?: string
  open_department_id?: string
}

interface DepartmentSearchItem {
  name?: string
  open_department_id?: string
}

interface FeishuContactUser {
  open_id?: string
  name?: string
  department_ids?: string[]
  status?: {
    is_frozen?: boolean
    is_resigned?: boolean
    is_exited?: boolean
    is_unjoin?: boolean
  }
}

export interface FeishuSalesColleague {
  feishuOpenId: string
  name: string
}

export interface FeishuDirectoryUser {
  feishuOpenId: string
  name: string
  departmentNames: string[]
  jobTitle?: string | null
  source: "feishu" | "database"
}

let salesMembersCache: { expiresAt: number; colleagues: FeishuSalesColleague[] } | null = null
let salesMembersInflight: Promise<FeishuSalesColleague[]> | null = null
const departmentTreeCache = new Map<string, { expiresAt: number; ids: string[] }>()

function isActiveFeishuUser(user: FeishuContactUser): boolean {
  const status = user.status
  const departmentIds = user.department_ids
  const noDept = !departmentIds || departmentIds.length === 0
  // 离职残留：status 缺失或空对象，且无部门 → 视为已离职
  if (noDept && (status == null || Object.keys(status).length === 0)) {
    return false
  }
  if (!status) return true
  return !status.is_frozen && !status.is_resigned && !status.is_exited && !status.is_unjoin
}

async function feishuGet<T>(path: string, token?: string): Promise<T> {
  const accessToken = token ?? (await getTenantAccessToken())
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
  const json = (await res.json()) as FeishuApiResponse<T>
  if (json.code !== 0) {
    throw new Error(json.msg || "飞书通讯录接口调用失败")
  }
  return json.data as T
}

async function feishuPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const accessToken = token ?? (await getTenantAccessToken())
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })
  const json = (await res.json()) as FeishuApiResponse<T>
  if (json.code !== 0) {
    throw new Error(json.msg || "飞书通讯录接口调用失败")
  }
  return json.data as T
}

async function fetchFeishuDepartmentsBatch(departmentIds: string[]): Promise<DepartmentItem[]> {
  if (departmentIds.length === 0) return []
  const qs = departmentIds.map((id) => `department_ids=${encodeURIComponent(id)}`).join("&")
  const data = await feishuGet<{ items?: DepartmentItem[] }>(
    `/contact/v3/departments/batch?department_id_type=open_department_id&${qs}`,
  )
  return data.items ?? []
}

async function listFeishuChildDepartmentIds(parentDepartmentId: string, token: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      department_id_type: "open_department_id",
      page_size: "50",
    })
    if (pageToken) params.set("page_token", pageToken)

    const data = await feishuGet<{
      items?: DepartmentItem[]
      has_more?: boolean
      page_token?: string
    }>(`/contact/v3/departments/${encodeURIComponent(parentDepartmentId)}/children?${params}`, token)

    for (const item of data.items ?? []) {
      if (item.open_department_id) ids.push(item.open_department_id)
    }
    pageToken = data.has_more ? data.page_token : undefined
  } while (pageToken)

  return ids
}

/** 遍历组织架构，按部门名称精确匹配 open_department_id */
async function findFeishuDepartmentIdFromOrgTree(departmentName: string): Promise<string | null> {
  const token = await getTenantAccessToken()
  const target = departmentName.trim()
  const queue = ["0"]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const parentId = queue.shift()!
    if (visited.has(parentId)) continue
    visited.add(parentId)

    const childIds = await listFeishuChildDepartmentIds(parentId, token)
    for (let i = 0; i < childIds.length; i += 50) {
      const chunk = childIds.slice(i, i + 50)
      const items = await fetchFeishuDepartmentsBatch(chunk)
      const match = items.find((item) => item.name?.trim() === target)
      if (match?.open_department_id) return match.open_department_id
    }
    queue.push(...childIds)
  }

  return null
}

/** 按部门名称精确匹配 open_department_id */
export async function findFeishuDepartmentIdByName(departmentName: string): Promise<string | null> {
  try {
    const data = await feishuPost<{ items?: DepartmentSearchItem[] }>(
      "/contact/v3/departments/search?department_id_type=open_department_id",
      { query: departmentName },
    )
    const match = (data.items ?? []).find((item) => item.name?.trim() === departmentName.trim())
    if (match?.open_department_id) return match.open_department_id
  } catch (error) {
    console.warn(`[feishu-contact] 搜索部门「${departmentName}」失败，尝试遍历组织架构`, error)
  }

  return findFeishuDepartmentIdFromOrgTree(departmentName)
}

/** 收集部门及其全部子部门 ID（含自身） */
async function collectDepartmentTreeIds(rootDepartmentId: string, token: string): Promise<string[]> {
  const cached = departmentTreeCache.get(rootDepartmentId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids
  }

  const ids = new Set<string>([rootDepartmentId])
  let frontier = [rootDepartmentId]

  while (frontier.length > 0) {
    const childLists = await Promise.all(frontier.map((parentId) => listFeishuChildDepartmentIds(parentId, token)))
    const next: string[] = []
    for (const childIds of childLists) {
      for (const childId of childIds) {
        if (!ids.has(childId)) {
          ids.add(childId)
          next.push(childId)
        }
      }
    }
    frontier = next
  }

  const result = Array.from(ids)
  departmentTreeCache.set(rootDepartmentId, {
    expiresAt: Date.now() + DEPARTMENT_TREE_CACHE_TTL_MS,
    ids: result,
  })
  return result
}

/** 解析销售部 open_department_id：环境变量 > 本地映射表 > 飞书搜索/遍历 */
export async function resolveSalesDepartmentIds(): Promise<string[]> {
  const configured = [...getSalesDepartmentIds(), ...(await getConfiguredSalesDepartmentIds())]
  if (configured.length > 0) {
    return Array.from(new Set(configured))
  }

  const ids = new Set<string>()
  for (const deptName of await getSalesDepartmentNames()) {
    const departmentId = await findFeishuDepartmentIdByName(deptName)
    if (departmentId) ids.add(departmentId)
  }

  return Array.from(ids)
}

/** 获取部门直属成员（需 contact:contact.base:readonly + contact:user.base:readonly） */
export async function fetchFeishuUsersInDepartment(
  departmentId: string,
  token?: string,
): Promise<FeishuContactUser[]> {
  const accessToken = token ?? (await getTenantAccessToken())
  const users: FeishuContactUser[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      department_id: departmentId,
      department_id_type: "open_department_id",
      user_id_type: "open_id",
      page_size: "50",
    })
    if (pageToken) params.set("page_token", pageToken)

    const data = await feishuGet<{
      items?: FeishuContactUser[]
      has_more?: boolean
      page_token?: string
    }>(`/contact/v3/users/find_by_department?${params}`, accessToken)

    users.push(...(data.items ?? []))
    pageToken = data.has_more ? data.page_token : undefined
  } while (pageToken)

  return users
}

/** 获取部门及子部门全部成员 */
async function fetchFeishuUsersInDepartmentTree(
  rootDepartmentId: string,
  token: string,
): Promise<FeishuContactUser[]> {
  const departmentIds = await collectDepartmentTreeIds(rootDepartmentId, token)
  const userLists = await Promise.all(departmentIds.map((id) => fetchFeishuUsersInDepartment(id, token)))
  return userLists.flat()
}

async function loadSalesDepartmentMembersFromFeishu(): Promise<FeishuSalesColleague[]> {
  const token = await getTenantAccessToken()
  const departmentIds = await resolveSalesDepartmentIds()
  if (departmentIds.length === 0) {
    throw new Error(
      "未能定位销售部部门 ID。请在环境变量 FEISHU_SALES_DEPARTMENT_IDS 中配置 open_department_id，或在飞书开放平台开通「搜索部门」「获取部门基础信息」权限。",
    )
  }

  const byOpenId = new Map<string, FeishuSalesColleague>()
  const userLists = await Promise.all(departmentIds.map((id) => fetchFeishuUsersInDepartmentTree(id, token)))

  for (const users of userLists) {
    for (const user of users) {
      if (!user.open_id || !user.name?.trim() || !isActiveFeishuUser(user)) continue
      byOpenId.set(user.open_id, { feishuOpenId: user.open_id, name: user.name.trim() })
    }
  }

  const colleagues = Array.from(byOpenId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  )

  if (colleagues.length === 0) {
    throw new Error("飞书销售部暂无可用成员，请检查 FEISHU_SALES_DEPARTMENT_IDS 或通讯录权限范围")
  }

  return colleagues
}

/** 从飞书通讯录拉取销售部成员（用于跟进人下拉） */
export async function fetchSalesDepartmentMembersFromFeishu(): Promise<FeishuSalesColleague[]> {
  if (salesMembersCache && salesMembersCache.expiresAt > Date.now()) {
    return salesMembersCache.colleagues
  }

  if (!salesMembersInflight) {
    salesMembersInflight = loadSalesDepartmentMembersFromFeishu()
      .then((colleagues) => {
        salesMembersCache = { expiresAt: Date.now() + SALES_MEMBERS_CACHE_TTL_MS, colleagues }
        return colleagues
      })
      .finally(() => {
        salesMembersInflight = null
      })
  }

  return salesMembersInflight
}

/** 通过 open_id 获取用户所属部门 open_department_id 列表（需 contact:user.department:readonly） */
export async function fetchFeishuUserDepartmentIds(openId: string): Promise<string[]> {
  const data = await feishuGet<{ user?: { department_ids?: string[] } }>(
    `/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id&department_id_type=open_department_id`,
  )
  return data.user?.department_ids ?? []
}

/** 配置的销售部及其全部子部门的 open_department_id 集合 */
export async function getConfiguredSalesDepartmentTreeIds(): Promise<Set<string>> {
  const token = await getTenantAccessToken()
  const roots = await resolveSalesDepartmentIds()
  const ids = new Set<string>()
  for (const root of roots) {
    for (const id of await collectDepartmentTreeIds(root, token)) {
      ids.add(id)
    }
  }
  return ids
}

/**
 * 判断用户是否属于配置的销售部组织树。
 * 优先比对 department_ids；若飞书未返回部门字段，则回退到销售部通讯录成员列表。
 */
export async function isUserInSalesDepartmentTree(openId: string): Promise<boolean> {
  const departmentIds = await fetchFeishuUserDepartmentIds(openId)
  if (departmentIds.length > 0) {
    const treeIds = await getConfiguredSalesDepartmentTreeIds()
    if (departmentIds.some((id) => treeIds.has(id))) return true
  }

  try {
    const members = await fetchSalesDepartmentMembersFromFeishu()
    return members.some((member) => member.feishuOpenId === openId)
  } catch (error) {
    console.warn("[feishu-contact] 销售部组织树成员校验失败:", error)
    return false
  }
}

function departmentNameFromItem(item: DepartmentItem): string | null {
  if (item.open_department_id) {
    const path = getDepartmentPathById(item.open_department_id)
    if (path) return path
    const label = getDepartmentLabelById(item.open_department_id)
    if (label) return label
  }
  return item.name?.trim() || null
}

/** 通过 open_id 获取用户所属部门名称列表（需 contact:user.department:readonly） */
export async function fetchFeishuUserDepartmentNames(openId: string): Promise<string[]> {
  const departmentIds = await fetchFeishuUserDepartmentIds(openId)
  if (departmentIds.length === 0) return []

  const names: string[] = []
  for (let i = 0; i < departmentIds.length; i += 50) {
    const chunk = departmentIds.slice(i, i + 50)
    const items = await fetchFeishuDepartmentsBatch(chunk)
    const resolvedIds = new Set<string>()
    for (const item of items) {
      const name = departmentNameFromItem(item)
      if (name) names.push(name)
      if (item.open_department_id) resolvedIds.add(item.open_department_id)
    }
    for (const id of chunk) {
      if (resolvedIds.has(id)) continue
      const path = getDepartmentPathById(id) || getDepartmentLabelById(id)
      if (path) names.push(path)
    }
  }

  return names
}

/** 按姓名搜索飞书通讯录成员（全组织，不限销售部） */
export async function searchFeishuDirectoryUsers(query: string): Promise<FeishuDirectoryUser[]> {
  const q = query.trim()
  if (!q) return []

  const data = await feishuPost<{
    users?: Array<{
      open_id?: string
      name?: string
      department_ids?: string[]
    }>
  }>("/contact/v3/users/search?user_id_type=open_id&department_id_type=open_department_id&page_size=20", {
    query: q,
  })

  const users = (data.users ?? []).filter((u) => u.open_id && u.name?.trim() && isActiveFeishuUser(u))
  const results: FeishuDirectoryUser[] = []

  for (const user of users) {
    const openId = user.open_id!
    const departmentIds = user.department_ids ?? []
    let departmentNames: string[] = []
    if (departmentIds.length > 0) {
      for (let i = 0; i < departmentIds.length; i += 50) {
        const chunk = departmentIds.slice(i, i + 50)
        const items = await fetchFeishuDepartmentsBatch(chunk)
        const resolvedIds = new Set<string>()
        for (const item of items) {
          const name = departmentNameFromItem(item)
          if (name) departmentNames.push(name)
          if (item.open_department_id) resolvedIds.add(item.open_department_id)
        }
        for (const id of chunk) {
          if (resolvedIds.has(id)) continue
          const path = getDepartmentPathById(id) || getDepartmentLabelById(id)
          if (path) departmentNames.push(path)
        }
      }
    }
    if (departmentNames.length === 0) {
      try {
        departmentNames = await fetchFeishuUserDepartmentNames(openId)
      } catch (error) {
        console.warn(`[feishu-contact] 获取用户 ${openId} 部门失败:`, error)
      }
    }
    results.push({
      feishuOpenId: openId,
      name: user.name!.trim(),
      departmentNames,
      source: "feishu",
    })
  }

  return results.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
}
