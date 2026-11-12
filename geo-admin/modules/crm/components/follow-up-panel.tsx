"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, MessageCircle, Send } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/shared/lib/utils"
import { EmptyState } from "@/modules/crm/components/ui"
import { Textarea } from "@/shared/ui/textarea"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import {
  createFollowUpComment,
  fetchFollowUpComments,
  type FollowUpComment,
} from "@/modules/crm/services/follow-up-comments"

const SALES_QUICK_REPLIES = [
  "收到，我会按建议推进并及时反馈。",
  "已了解，我会在下次跟进时重点确认。",
  "客户暂未回复，我会继续跟进。",
  "正在处理中，完成后同步最新进展。",
]

function commentTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.replace("T", " ")
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function FollowUpConversation({ followUpId }: { followUpId: string }) {
  const { role, user } = useRole()
  const roleCodes = new Set([role, ...(user?.roles ?? [])])
  const isLeader = ["leader", "ops", "admin", "super_admin"].some((code) => roleCodes.has(code)) || Boolean(user?.manualDepartmentLeader)
  const isSales = ["sales", "sdr"].some((code) => roleCodes.has(code))
  const canComment = isLeader || isSales
  const showSalesQuickReplies = isSales || roleCodes.has("admin") || roleCodes.has("super_admin")
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [comments, setComments] = useState<FollowUpComment[]>([])
  const [draft, setDraft] = useState("")

  async function toggle() {
    const nextOpen = !open
    setOpen(nextOpen)
    if (!nextOpen || loaded || loading) return
    setLoading(true)
    try {
      setComments(await fetchFollowUpComments(followUpId))
      setLoaded(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载评论失败")
    } finally {
      setLoading(false)
    }
  }

  async function send() {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const created = await createFollowUpComment(followUpId, content)
      setComments((current) => [...current, created])
      setDraft("")
      setLoaded(true)
      toast.success(isLeader ? "指导意见已发送" : "回复已发送")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送评论失败")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-3 border-t border-border/70 pt-2.5">
      <button
        type="button"
        onClick={() => void toggle()}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <MessageCircle className="size-3.5" />
        评论回复{loaded && comments.length ? `（${comments.length}）` : ""}
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {open ? (
        <div className="mt-2.5 rounded-xl border border-border/80 bg-muted/20 p-3">
          {loading ? (
            <p className="py-4 text-center text-xs text-muted-foreground">正在加载对话…</p>
          ) : comments.length ? (
            <div className="space-y-2.5">
              {comments.map((comment) => (
                <div key={comment.id} className="flex items-start gap-2.5">
                  <span className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    comment.authorRole === "leader" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700",
                  )}>
                    {comment.authorName.slice(0, 1) || "用"}
                  </span>
                  <div className="min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-semibold text-foreground">{comment.authorName}</span>
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 font-medium",
                        comment.authorRole === "leader" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700",
                      )}>
                        {comment.authorRole === "leader" ? "Leader 指导" : "销售回复"}
                      </span>
                      <span className="ml-auto text-muted-foreground">{commentTime(comment.createdAt)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-foreground/90">{comment.content}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              暂无评论，Leader 可在这里指导下一步动作，销售可继续回复。
            </div>
          )}

          {canComment ? (
            <div className="mt-3 border-t border-border/70 pt-3">
              {showSalesQuickReplies ? (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-muted-foreground">销售快捷回复</span>
                  {SALES_QUICK_REPLIES.map((reply) => (
                    <button
                      key={reply}
                      type="button"
                      onClick={() => setDraft(reply)}
                      className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault()
                      void send()
                    }
                  }}
                  rows={2}
                  maxLength={1000}
                  placeholder={isLeader ? "填写下一步动作、注意事项或指导建议…" : "回复 Leader，可连续发送多条…"}
                  className="min-h-16 flex-1 resize-none bg-background text-xs"
                />
                <button
                  type="button"
                  disabled={!draft.trim() || sending}
                  onClick={() => void send()}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="size-3.5" />{sending ? "发送中" : isLeader ? "发表评论" : "发送回复"}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">支持多次评论与回复；Ctrl/⌘ + Enter 快速发送</p>
            </div>
          ) : (
            <p className="mt-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">当前角色可查看对话，Leader 与销售可参与回复。</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** 跟进记录条目（统一样式：左边框时间线 + 头部信息行 + 正文）。 */
export interface FollowUpRecord {
  id: string
  author: string
  date: string
  content: string
  /** 头部徽章（跟进方式 / 联系人 / 归属 / 来源 / 计划下次等，条件由各页面决定） */
  pills?: ReactNode
  /** 头部右侧操作（如项目记录删除按钮） */
  actions?: ReactNode
  /** 强调色：warning 用于线索带入等黄色强调，默认 primary */
  accent?: "default" | "warning"
  /** 自动动态等非跟进事件可关闭评论区 */
  conversationEnabled?: boolean
}

export function FollowUpRecords({
  records,
  emptyText = "暂无跟进记录",
  className,
  variant = "default",
}: {
  records: FollowUpRecord[]
  emptyText?: string
  className?: string
  variant?: "default" | "timeline"
}) {
  if (records.length === 0) {
    return <EmptyState text={emptyText} />
  }
  const isTimeline = variant === "timeline"
  return (
    <div
      className={cn(
        isTimeline
          ? "relative mt-5 space-y-3 before:absolute before:bottom-5 before:left-[0.375rem] before:top-5 before:w-px before:bg-border"
          : "mt-4 space-y-3",
        className,
      )}
    >
      {records.map((record) => {
        const card = (
          <div
            className={cn(
              isTimeline
                ? "rounded-xl border border-border/80 bg-background/80 p-3.5 shadow-sm transition-colors group-hover:border-primary/30 group-hover:bg-primary/5"
                : "",
              record.accent === "warning"
                ? isTimeline
                  ? "border-amber-300/70 bg-amber-50/60 group-hover:border-amber-400/80 dark:bg-amber-950/10"
                  : "rounded-r-lg border-l-2 border-amber-400/70 bg-amber-50/40 py-2 pl-3 pr-2"
                : !isTimeline
                  ? "border-l-2 border-primary/30 pl-3"
                  : "",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground">{record.author}</span>
                {record.pills}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {record.actions}
                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{record.date}</span>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{record.content}</p>
            {record.conversationEnabled !== false ? <FollowUpConversation followUpId={record.id} /> : null}
          </div>
        )

        return isTimeline ? (
          <div key={record.id} className="group relative pl-7">
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-0.5 top-4 z-[1] size-3 rounded-full border-2 border-background shadow-sm ring-1",
                record.accent === "warning"
                  ? "bg-amber-400 ring-amber-300/50"
                  : "bg-primary ring-primary/20",
              )}
            />
            {card}
          </div>
        ) : (
          <div key={record.id}>{card}</div>
        )
      })}
    </div>
  )
}

/** 跟进记录录入容器（统一样式：浅色圆角卡片；具体字段由各页面按条件传入）。 */
export function FollowUpComposer({
  children,
  footerLeft,
  footerRight,
}: {
  children: ReactNode
  footerLeft?: ReactNode
  footerRight: ReactNode
}) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-secondary/25 p-4">
      {children}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {footerLeft}
        <div className="ml-auto">{footerRight}</div>
      </div>
    </div>
  )
}
