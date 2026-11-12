"use client"

import { useAudit } from "@/modules/audit/context/audit-provider"
import { useAuth } from "@/modules/auth/context/auth-provider"
import { mentionPreview } from "@/modules/crm/lib/crm-data"
import { createNotifications } from "@/modules/crm/services/crm-directory"
import type { GeoFormData } from "@/modules/intake"
import {
EMPTY_REQUEST_STATS,
fetchRequestById,
fetchRequests,
fetchRequestStats,
patchRequestDocument,
type RequestListFilters,
type RequestListResult,
type RequestStats,
} from "@/modules/requests/services/requests-api"
import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from "react"
import { toast } from "sonner"
import { STATUS_META,type RequestStatus } from "../lib/status"
import type { RequestAttachment,RequestRecord } from "../lib/types"

interface AdminContextValue {
  requests: RequestRecord[]
  requestStats: RequestStats
  requestListTotal: number
  requestsListLoading: boolean
  loading: boolean
  searchRequests: (filters?: RequestListFilters) => Promise<RequestListResult>
  loadRequestById: (id: string) => Promise<RequestRecord | undefined>
  refreshRequestStats: () => Promise<void>
  refresh: () => Promise<void>
  getById: (id: string) => RequestRecord | undefined
  updateData: (id: string, data: GeoFormData) => Promise<void>
  updateStatus: (id: string, status: RequestStatus) => Promise<RequestRecord>
  assignOwner: (id: string, owner: string) => Promise<void>
  addNote: (id: string, content: string, options?: { author?: string; mentions?: string[] }) => Promise<void>
  addAttachment: (
    id: string,
    attachment: {
      id: string
      name: string
      size: number
      url?: string
      contentType?: string
      storagePath?: string
      description?: string
      uploadedBy: string
    },
  ) => Promise<void>
}

const AdminContext = createContext<AdminContextValue | null>(null)

/** 模块级去重：并发 / Strict Mode 重挂载只打一次 stats */
let statsInflight: Promise<RequestStats> | null = null

function loadRequestStatsOnce(): Promise<RequestStats> {
  if (!statsInflight) {
    statsInflight = fetchRequestStats().finally(() => {
      statsInflight = null
    })
  }
  return statsInflight
}

function upsertById(list: RequestRecord[], record: RequestRecord): RequestRecord[] {
  const idx = list.findIndex((r) => r.id === record.id)
  if (idx === -1) return [record, ...list]
  return list.map((r) => (r.id === record.id ? record : r))
}

export function RequestsProvider({ children }: { children: ReactNode }) {
  const { kind, user, canAccess } = useAuth()
  const { recordAudit } = useAudit()
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [requestStats, setRequestStats] = useState<RequestStats>(EMPTY_REQUEST_STATS)
  const [requestListTotal, setRequestListTotal] = useState(0)
  const [requestsListLoading, setRequestsListLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const canLoadRequests = kind === "user" && Boolean(user) && canAccess("requests")
  const searchInflight = useRef<Map<string, Promise<RequestListResult>>>(new Map())
  const searchSeq = useRef(0)

  const refreshRequestStats = useCallback(async () => {
    if (!canLoadRequests) {
      setRequestStats(EMPTY_REQUEST_STATS)
      return
    }
    const stats = await loadRequestStatsOnce()
    setRequestStats(stats)
  }, [canLoadRequests])

  const searchRequests = useCallback(
    async (filters: RequestListFilters = {}): Promise<RequestListResult> => {
      if (!canLoadRequests) {
        setRequests([])
        setRequestListTotal(0)
        return { items: [], total: 0, page: 1, pageSize: filters.pageSize ?? 10 }
      }
      const key = JSON.stringify(filters)
      const existing = searchInflight.current.get(key)
      if (existing) return existing

      const seq = ++searchSeq.current
      const task = (async () => {
        setRequestsListLoading(true)
        try {
          const result = await fetchRequests(filters)
          if (seq === searchSeq.current) {
            setRequests(result.items)
            setRequestListTotal(result.total)
            setRequestsListLoading(false)
          }
          return result
        } catch (err) {
          if (seq === searchSeq.current) setRequestsListLoading(false)
          throw err
        } finally {
          searchInflight.current.delete(key)
        }
      })()

      searchInflight.current.set(key, task)
      return task
    },
    [canLoadRequests],
  )

  const loadRequestById = useCallback(async (id: string): Promise<RequestRecord | undefined> => {
    try {
      const record = await fetchRequestById(id)
      setRequests((prev) => upsertById(prev, record))
      return record
    } catch {
      return undefined
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!canLoadRequests) {
      setRequests([])
      setRequestListTotal(0)
      setRequestStats(EMPTY_REQUEST_STATS)
      return
    }
    await Promise.all([
      searchRequests({ page: 1, pageSize: 10 }),
      refreshRequestStats().catch(() => undefined),
    ])
  }, [canLoadRequests, searchRequests, refreshRequestStats])

  useEffect(() => {
    if (!canLoadRequests) {
      setRequests([])
      setRequestListTotal(0)
      setRequestStats(EMPTY_REQUEST_STATS)
      setRequestsListLoading(false)
      setLoading(false)
      return
    }
    // 不预载全量列表；统计可先拉，列表由页面 searchRequests 驱动
    setLoading(true)
    void refreshRequestStats()
      .catch(() => toast.error("加载需求统计失败，请刷新页面重试"))
      .finally(() => setLoading(false))
  }, [canLoadRequests, user?.id, refreshRequestStats])

  const getById = useCallback((id: string) => requests.find((r) => r.id === id), [requests])

  const updateData = async (id: string, data: GeoFormData) => {
    const before = requests.find((r) => r.id === id)
    try {
      const record = await patchRequestDocument(id, { data })
      setRequests((prev) => upsertById(prev, record))
      recordAudit({
        module: "需求管理",
        entityType: "需求",
        entityId: id,
        entityName: record.code,
        action: "编辑需求信息",
        changes: [{ field: "data", label: "表单内容", before: "…", after: "已更新" }],
      })
    } catch (e) {
      await loadRequestById(id)
      throw e
    }
    void before
  }

  const updateStatus = async (id: string, status: RequestStatus) => {
    const before = requests.find((r) => r.id === id)
    try {
      const record = await patchRequestDocument(id, { status })
      setRequests((prev) => upsertById(prev, record))
      void refreshRequestStats().catch(() => undefined)
      recordAudit({
        module: "需求管理",
        entityType: "需求",
        entityId: id,
        entityName: record.code,
        action: "变更需求状态",
        changes: [
          {
            field: "status",
            label: "状态",
            before: before?.status ? STATUS_META[before.status]?.label || before.status : "—",
            after: STATUS_META[status]?.label || status,
          },
        ],
      })
      return record
    } catch (e) {
      await loadRequestById(id)
      throw e
    }
  }

  const assignOwner = async (id: string, owner: string) => {
    const before = requests.find((r) => r.id === id)
    try {
      const record = await patchRequestDocument(id, { owner })
      setRequests((prev) => upsertById(prev, record))
      recordAudit({
        module: "需求管理",
        entityType: "需求",
        entityId: id,
        entityName: record.code,
        action: "分配跟进人",
        changes: [
          {
            field: "owner",
            label: "跟进人",
            before: before?.owner || "—",
            after: owner,
          },
        ],
      })
    } catch (e) {
      await loadRequestById(id)
      throw e
    }
  }

  const addNote = async (
    id: string,
    content: string,
    options: { author?: string; mentions?: string[] } = {},
  ) => {
    const author = options.author ?? user?.name
    try {
      const record = await patchRequestDocument(id, { note: content, author })
      setRequests((prev) => upsertById(prev, record))
      recordAudit({
        module: "需求管理",
        entityType: "需求",
        entityId: id,
        entityName: record.code,
        action: "添加跟进记录",
        changes: [{ field: "note", label: "跟进内容", before: "—", after: content.slice(0, 80) }],
      })
      const targets = (options.mentions ?? []).filter((name) => name && name !== author)
      if (targets.length) {
        void createNotifications(
          targets.map((targetName) => ({
            targetName,
            message: `在【${record.data.companyName || record.data.brandName || record.code}】的需求跟进记录中提到了你：${mentionPreview(content)}`,
            href: `/requests/${id}`,
          })),
          "requests",
        ).catch(() => undefined)
      }
    } catch (e) {
      await loadRequestById(id)
      throw e
    }
  }

  const addAttachment = async (
    id: string,
    attachment: {
      id: string
      name: string
      size: number
      url?: string
      contentType?: string
      storagePath?: string
      description?: string
      uploadedBy: string
    },
  ) => {
    const before = requests.find((r) => r.id === id)
    const nextItem: RequestAttachment = {
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      url: attachment.url,
      contentType: attachment.contentType,
      storagePath: attachment.storagePath,
      description: attachment.description,
      uploadedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      uploadedBy: attachment.uploadedBy,
    }
    const nextAttachments = [...(before?.attachments ?? []), nextItem]
    try {
      const record = await patchRequestDocument(id, { attachments: nextAttachments })
      setRequests((prev) => upsertById(prev, record))
      recordAudit({
        module: "需求管理",
        entityType: "需求",
        entityId: id,
        entityName: record.code,
        action: "上传附件",
        changes: [{ field: "attachment", label: "附件", before: "—", after: attachment.name }],
      })
    } catch (e) {
      await loadRequestById(id)
      throw e
    }
  }

  return (
    <AdminContext.Provider
      value={{
        requests,
        requestStats,
        requestListTotal,
        requestsListLoading,
        loading,
        searchRequests,
        loadRequestById,
        refreshRequestStats,
        refresh,
        getById,
        updateData,
        updateStatus,
        assignOwner,
        addNote,
        addAttachment,
      }}
    >
      {children}
    </AdminContext.Provider>
  )
}

export function useRequests() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error("useRequests must be used within RequestsProvider")
  return ctx
}
