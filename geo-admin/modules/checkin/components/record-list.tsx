"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, MapPin, CircleDot } from "lucide-react"
import { checkinAttachmentUrl } from "../services/checkin-attachments"
import type { CheckinRecord } from "../lib/types"
import { cn } from "@/shared/lib/utils"
import { DEFAULT_LIST_PAGE_SIZE, paginateSlice } from "@/shared/lib/list-pagination"
import { ListPagination } from "@/shared/ui/list-pagination"

interface RecordListProps {
  records: CheckinRecord[]
  variant?: "own" | "team"
  loading?: boolean
  error?: string
}

const PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE

function formatRegion(record: CheckinRecord) {
  return [record.province, record.city, record.district].filter(Boolean).join(" · ")
}

function formatDepartments(record: CheckinRecord) {
  return record.departmentNames?.filter(Boolean).join("、") ?? ""
}

function statusMeta(type: CheckinRecord["type"]) {
  if (type === "arrive") {
    return { label: "到达", className: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300" }
  }
  return { label: "结束", className: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300" }
}

export function RecordList({ records, variant = "own", loading = false, error }: RecordListProps) {
  const isTeam = variant === "team"
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [records, variant])

  const paged = useMemo(() => paginateSlice(records, page, PAGE_SIZE), [records, page])

  if (loading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
        正在加载打卡记录…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
        <CalendarClock className="mb-3 size-9 text-destructive/60" />
        <p className="text-sm font-medium text-destructive">打卡记录加载失败</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
        <CalendarClock className="mb-3 size-9 text-muted-foreground/50" />
        <p className="text-sm font-medium">暂无打卡记录</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          {isTeam ? "调整筛选条件，或等待成员完成打卡" : "完成到达或结束打卡后，记录会显示在这里"}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {paged.pageItems.map((record) => (
          <RecordCard key={record.id} record={record} isTeam={isTeam} />
        ))}
      </ul>
      <ListPagination
        total={paged.total}
        page={paged.currentPage}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  )
}

function RecordCard({ record, isTeam }: { record: CheckinRecord; isTeam: boolean }) {
  const status = statusMeta(record.type)
  const locationText = record.address || formatRegion(record) || "未获取到打卡地点"
  const departments = formatDepartments(record)

  if (isTeam) {
    return (
      <li className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-accent/15">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{record.userName || "未知成员"}</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  status.className,
                )}
              >
                {status.label}
              </span>
              {departments && <span className="text-xs text-muted-foreground">{departments}</span>}
            </div>
            <p className="mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span>{locationText}</span>
            </p>
          </div>
          <time className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{record.beijingTime}</time>
        </div>
        {record.attachmentIds && record.attachmentIds.length > 0 && (
          <div className="mt-2">
            <AttachmentThumbs ids={record.attachmentIds} />
          </div>
        )}
      </li>
    )
  }

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:bg-accent/20">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
            status.className,
          )}
        >
          <CircleDot className="mr-1 size-3" />
          {status.label}打卡
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{record.beijingTime}</span>
      </div>

      <div className="space-y-2 px-4 py-3 text-sm">
        <p className="flex items-start gap-1.5 leading-relaxed">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>{locationText}</span>
        </p>
        {record.address && formatRegion(record) && (
          <p className="text-xs text-muted-foreground">{formatRegion(record)}</p>
        )}
        {record.attachmentIds && record.attachmentIds.length > 0 && (
          <AttachmentThumbs ids={record.attachmentIds} />
        )}
      </div>
    </li>
  )
}

function AttachmentThumbs({ ids }: { ids: string[] }) {
  const urls = useMemo(() => ids.map((id) => checkinAttachmentUrl(id)), [ids])

  if (urls.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer">
          <img className="size-16 rounded-lg border border-border object-cover" src={url} alt="附件图片" />
        </a>
      ))}
    </div>
  )
}
