"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Eye,
  FileText,
  FolderTree,
  Layers3,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  ThumbsUp,
  Users,
  ArrowRight,
  MessageSquare,
  XCircle,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Textarea } from "@/shared/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog"
import { Pill } from "@/modules/crm/components/ui"
import { cn } from "@/shared/lib/utils"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import {
  KNOWLEDGE_DEPARTMENTS,
  KNOWLEDGE_DEPARTMENT_LEADERS,
  KNOWLEDGE_REVIEW_UPDATED_EVENT,
  KNOWLEDGE_UPDATED_EVENT,
  KNOWLEDGE_LEVELS,
  loadKnowledgeArticles,
  loadKnowledgeReviewNotifications,
  saveKnowledgeArticles,
  saveKnowledgeReviewNotifications,
  searchKnowledgeArticles,
  knowledgeReviewDepartments,
  type KnowledgeArticle,
  type KnowledgeLevel,
  type KnowledgeReviewNotification,
  type KnowledgeStatus,
} from "@/modules/knowledge/lib/knowledge-data"

type ArticleForm = {
  question: string
  answer: string
  department: string
  category: string
  level: KnowledgeLevel
  owner: string
  tags: string[]
  scenes: string[]
}

const EMPTY_FORM: ArticleForm = {
  question: "",
  answer: "",
  department: "客户成功",
  category: "常见问题",
  level: "部门级",
  owner: "",
  tags: [],
  scenes: [],
}

const STATUS_TONE: Record<KnowledgeStatus, string> = {
  已发布: "success",
  待审核: "warning",
  已驳回: "warning",
  草稿: "neutral",
  已停用: "neutral",
}

const QUICK_SCENES = ["客户初次沟通", "方案讲解", "客户异议", "项目验收", "开票申请"]
const HELPFUL_VOTES_STORAGE_KEY = "geo-admin:knowledge-helpful-votes:v1"

export function KnowledgeBasePage() {
  const { role, user } = useRole()
  const canManageAll = role === "admin" || role === "super_admin"
  const canMaintain = Boolean(user)
  const canCreate = Boolean(user)
  const [articles, setArticles] = useState<KnowledgeArticle[]>([])
  const [query, setQuery] = useState("")
  const [department, setDepartment] = useState("全部部门")
  const [category, setCategory] = useState("全部类别")
  const [level, setLevel] = useState<KnowledgeLevel | "全部层级">("全部层级")
  const [status, setStatus] = useState<KnowledgeStatus | "全部状态">("全部状态")
  const [owner, setOwner] = useState("全部维护人")
  const [updatedRange, setUpdatedRange] = useState("全部时间")
  const [selectedId, setSelectedId] = useState("")
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [helpfulVotedIds, setHelpfulVotedIds] = useState<string[]>([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ArticleForm>(EMPTY_FORM)
  const [tagDraft, setTagDraft] = useState("")
  const [sceneDraft, setSceneDraft] = useState("")
  const [reviewNotifications, setReviewNotifications] = useState<KnowledgeReviewNotification[]>([])
  const [reviewNoticeOpen, setReviewNoticeOpen] = useState(false)
  const [view, setView] = useState<"library" | "mine" | "review">("library")
  const [reviewFilter, setReviewFilter] = useState<"待审核" | "已发布" | "已驳回">("待审核")
  const [reviewQuery, setReviewQuery] = useState("")
  const [reviewDepartment, setReviewDepartment] = useState("全部部门")
  const [reviewId, setReviewId] = useState("")
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewAnswer, setReviewAnswer] = useState("")
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  const reviewDepartments = useMemo(() => knowledgeReviewDepartments(role, user?.name, user?.departmentNames), [role, user?.name, user?.departmentNames])
  const canReview = reviewDepartments.length > 0
  const mayReview = (article: KnowledgeArticle) => reviewDepartments.includes(article.department)
  const isOwn = (article: KnowledgeArticle) => (article.submitter || article.owner) === user?.name

  useEffect(() => {
    const loaded = loadKnowledgeArticles()
    setArticles(loaded)
    const params = new URLSearchParams(window.location.search)
    const requestedId = params.get("article")
    const requestedDepartment = params.get("department")
    const validDepartment = requestedDepartment && (KNOWLEDGE_DEPARTMENTS as readonly string[]).includes(requestedDepartment)
      ? requestedDepartment
      : "全部部门"
    const initialArticles = validDepartment === "全部部门"
      ? loaded
      : loaded.filter((item) => item.department === validDepartment)
    setDepartment(validDepartment)
    setSelectedId(requestedId && initialArticles.some((item) => item.id === requestedId) ? requestedId : initialArticles[0]?.id ?? "")
    try {
      const votedIds = JSON.parse(window.localStorage.getItem(HELPFUL_VOTES_STORAGE_KEY) || "[]") as unknown
      setHelpfulVotedIds(Array.isArray(votedIds) ? votedIds.filter((item): item is string => typeof item === "string") : [])
    } catch {
      setHelpfulVotedIds([])
    }
    setReviewNotifications(loadKnowledgeReviewNotifications())
    const syncReviewNotifications = () => { setReviewNotifications(loadKnowledgeReviewNotifications()); setArticles(loadKnowledgeArticles()) }
    window.addEventListener(KNOWLEDGE_REVIEW_UPDATED_EVENT, syncReviewNotifications)
    window.addEventListener(KNOWLEDGE_UPDATED_EVENT, syncReviewNotifications)
    window.addEventListener("storage", syncReviewNotifications)
    return () => {
      window.removeEventListener(KNOWLEDGE_REVIEW_UPDATED_EVENT, syncReviewNotifications)
      window.removeEventListener(KNOWLEDGE_UPDATED_EVENT, syncReviewNotifications)
      window.removeEventListener("storage", syncReviewNotifications)
    }
  }, [])

  const visibleArticles = useMemo(
    () => articles.filter((item) => canManageAll || item.status === "已发布" || (item.submitter || item.owner) === user?.name || reviewDepartments.includes(item.department)),
    [articles, canManageAll, user?.name, reviewDepartments],
  )

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          visibleArticles
            .filter((item) => department === "全部部门" || item.department === department)
            .map((item) => item.category),
        ),
      ).sort(),
    [department, visibleArticles],
  )

  const owners = useMemo(() => Array.from(new Set(visibleArticles.map((item) => item.owner))).sort(), [visibleArticles])

  const filtered = useMemo(() => {
    const matched = query.trim()
      ? searchKnowledgeArticles(query, visibleArticles, { includeUnpublished: true })
      : visibleArticles
    return matched.filter(
      (item) =>
        (department === "全部部门" || item.department === department) &&
        (category === "全部类别" || item.category === category) &&
        (level === "全部层级" || item.level === level) &&
        (status === "全部状态" || item.status === status) &&
        (owner === "全部维护人" || item.owner === owner) &&
        matchesUpdatedRange(item.updatedAt, updatedRange),
    ).filter((item) => view === "mine" ? (item.submitter || item.owner) === user?.name : item.status === "已发布").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [category, department, level, owner, query, status, updatedRange, visibleArticles, view, user?.name])

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null
  const publishedCount = visibleArticles.filter((item) => item.status === "已发布").length
  const pendingCount = articles.filter((item) => item.status === "待审核" && (canReview ? mayReview(item) : isOwn(item))).length
  const pendingReviewArticles = articles.filter((item) => item.status === "待审核" && mayReview(item))
  const reviewUnreadCount = canReview
    ? reviewNotifications.filter((item) => !item.read && !item.resolved && pendingReviewArticles.some((article) => article.id === item.articleId)).length
    : 0
  const categoryCount = new Set(visibleArticles.map((item) => `${item.department}/${item.category}`)).size
  const reviewArticles = articles.filter((item) => mayReview(item))
  const reviewRows = reviewArticles.filter((item) => item.status === reviewFilter && (reviewDepartment === "全部部门" || item.department === reviewDepartment) && `${item.question} ${item.submitter || item.owner}`.toLowerCase().includes(reviewQuery.toLowerCase()))
  const reviewing = articles.find((item) => item.id === reviewId)
  const ownArticles = articles.filter(isOwn)

  function selectDepartment(next: string) {
    setDepartment(next)
    setCategory("全部类别")
    setSelectedId("")
  }

  function openCreate() {
    if (!canCreate) return
    setEditingId(null)
    setTagDraft("")
    setSceneDraft("")
    setForm({ ...EMPTY_FORM, owner: user?.name || "", department: reviewDepartments[0] || "客户成功" })
    setFormOpen(true)
  }

  function resetFilters() {
    setQuery("")
    setDepartment("全部部门")
    setCategory("全部类别")
    setLevel("全部层级")
    setStatus("全部状态")
    setOwner("全部维护人")
    setUpdatedRange("全部时间")
    setSelectedId("")
  }

  function openAssistant() {
    window.dispatchEvent(new Event("geo-admin:open-knowledge-assistant"))
  }

  function openReviewNotifications() {
    if (!canReview) return
    setReviewNoticeOpen(true)
    const next = reviewNotifications.map((item) => reviewDepartments.includes(item.department) ? { ...item, read: true } : item)
    setReviewNotifications(next)
    saveKnowledgeReviewNotifications(next)
  }

  function queueReviewNotification(article: KnowledgeArticle, submitter: string) {
    const current = loadKnowledgeReviewNotifications()
    const next: KnowledgeReviewNotification[] = [
      {
        id: `kbr-${Date.now()}`,
        articleId: article.id,
        articleQuestion: article.question,
        department: article.department,
        submitter,
        createdAt: new Date().toISOString(),
        read: false,
        resolved: false,
      },
      ...current.filter((item) => item.articleId !== article.id || item.resolved),
    ]
    setReviewNotifications(next)
    saveKnowledgeReviewNotifications(next)
  }

  function resolveReviewNotifications(articleId: string) {
    const current = loadKnowledgeReviewNotifications()
    const next = current.map((item) => item.articleId === articleId ? { ...item, read: true, resolved: true } : item)
    setReviewNotifications(next)
    saveKnowledgeReviewNotifications(next)
  }

  function openEdit(article: KnowledgeArticle) {
    if (!canManageAll && !isOwn(article)) return
    setEditingId(article.id)
    setTagDraft("")
    setSceneDraft("")
    setForm({
      question: article.question,
      answer: article.answer,
      department: article.department,
      category: article.category,
      level: article.level,
      owner: article.owner,
      tags: normalizeKnowledgeTags(article.tags),
      scenes: normalizeKnowledgeTags(article.scenes),
    })
    setFormOpen(true)
  }

  function saveArticle() {
    if (!canCreate) return
    const previous = articles.find((article) => article.id === editingId)
    if (previous && !canManageAll && !isOwn(previous)) return
    if (!form.question.trim() || !form.answer.trim()) {
      toast.error("请填写问题和统一回复口径")
      return
    }
    const today = new Date().toLocaleDateString("sv-SE")
    const tags = normalizeKnowledgeTags([...form.tags, tagDraft])
    const scenes = normalizeKnowledgeTags([...form.scenes, sceneDraft])
    let next: KnowledgeArticle[]
    if (editingId) {
      next = articles.map((article) =>
        article.id === editingId
          ? {
              ...article,
              ...form,
              tags,
              scenes,
              updatedAt: today,
              version: bumpVersion(article.version),
              status: "待审核" as const,
              submitter: article.submitter || article.owner,
              submittedAt: new Date().toISOString(),
              rejectionReason: undefined,
              reviewer: undefined,
              reviewedAt: undefined,
              reviewHistory: [...(article.reviewHistory || []), { action: "提交审核" as const, actor: user?.name || "当前用户", at: new Date().toISOString() }],
            }
          : article,
      )
    } else {
      const article: KnowledgeArticle = {
        id: `kb-${Date.now()}`,
        question: form.question.trim(),
        answer: form.answer.trim(),
        department: form.department,
        category: form.category.trim() || "常见问题",
        level: form.level,
        owner: form.owner.trim() || user?.name || "当前用户",
        tags,
        scenes,
        submitter: user?.name || "当前用户",
        submittedAt: new Date().toISOString(),
        reviewHistory: [{ action: "提交审核", actor: user?.name || "当前用户", at: new Date().toISOString() }],
        status: "待审核",
        updatedAt: today,
        version: "v0.1",
        views: 0,
        helpful: 0,
      }
      next = [article, ...articles]
      setSelectedId(article.id)
    }
    setArticles(next)
    saveKnowledgeArticles(next)
    const submitted = next.find((article) => article.id === (editingId || next[0]?.id))
    if (submitted) queueReviewNotification(submitted, user?.name || "当前用户")
    setFormOpen(false)
    resetFilters()
    setView("mine")
    toast.success(editingId ? "修改已提交审核" : "知识已创建并进入待审核")
  }

  function changeStatus(article: KnowledgeArticle, nextStatus: KnowledgeStatus) {
    if (!mayReview(article)) {
      toast.error("请由所属部门 Leader 处理")
      return
    }
    if (article.status === "待审核") { openReview(article); return }
    const next = articles.map((item) => item.id === article.id ? { ...item, status: nextStatus, updatedAt: new Date().toLocaleDateString("sv-SE") } : item)
    setArticles(next)
    saveKnowledgeArticles(next)
    if (nextStatus === "已发布") resolveReviewNotifications(article.id)
    toast.success(nextStatus === "已发布" ? "知识已发布，QA 助手现在可以引用" : nextStatus === "已停用" ? "知识已停用，QA 助手不会再引用" : "知识状态已更新")
  }

  function toggleExpanded(id: string) {
    setExpandedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function openDetail(article: KnowledgeArticle) {
    setSelectedId(article.id)
    setDetailOpen(true)
  }

  function openReview(article: KnowledgeArticle) {
    if (!mayReview(article)) return
    setReviewId(article.id)
    setReviewAnswer(article.answer)
    setRejectReason("")
    setReviewNoticeOpen(false)
    setDetailOpen(false)
    setReviewOpen(true)
    const next = loadKnowledgeReviewNotifications().map((notice) => notice.articleId === article.id ? { ...notice, read: true } : notice)
    setReviewNotifications(next)
    saveKnowledgeReviewNotifications(next)
  }

  function processReview(action: "approve" | "reject" | "save") {
    const current = loadKnowledgeArticles()
    const article = current.find((item) => item.id === reviewId)
    if (!article || !mayReview(article)) return
    if (action !== "save" && article.status !== "待审核") { toast.error("这条知识已处理，请刷新后查看"); return }
    if (!reviewAnswer.trim()) { toast.error("请填写标准答案"); return }
    if (action === "reject" && !rejectReason.trim()) { toast.error("请填写驳回原因，便于提交人修改"); return }
    const at = new Date().toISOString()
    const actor = user?.name || "部门 Leader"
    const history = [...(article.reviewHistory || [])]
    if (reviewAnswer.trim() !== article.answer) history.push({ action: "修改答案", actor, at, answerBefore: article.answer, answerAfter: reviewAnswer.trim() })
    if (action !== "save") history.push({ action: action === "approve" ? "审核通过" : "驳回", actor, at, reason: action === "reject" ? rejectReason.trim() : undefined })
    const next = current.map((item): KnowledgeArticle => item.id === article.id ? {
      ...item, answer: reviewAnswer.trim(),
      status: action === "approve" ? "已发布" : action === "reject" ? "已驳回" : item.status,
      updatedAt: new Date().toLocaleDateString("sv-SE"),
      reviewHistory: history,
      ...(action !== "save" ? { reviewer: actor, reviewedAt: at, rejectionReason: action === "reject" ? rejectReason.trim() : undefined } : {}),
    } : item)
    setArticles(next)
    saveKnowledgeArticles(next)
    if (action !== "save") resolveReviewNotifications(article.id)
    setRejectOpen(false)
    if (action !== "save") setReviewOpen(false)
    toast.success(action === "approve" ? "审核通过，知识已上线，QA 助手可引用" : action === "reject" ? "已驳回，提交人可查看原因并重新提交" : "答案已保存")
  }

  function markHelpful(article: KnowledgeArticle) {
    if (helpfulVotedIds.includes(article.id)) {
      toast.info("这条知识已经标记过有帮助")
      return
    }
    const nextArticles = articles.map((item) =>
      item.id === article.id ? { ...item, helpful: item.helpful + 1 } : item,
    )
    const nextVotedIds = [...helpfulVotedIds, article.id]
    setArticles(nextArticles)
    setHelpfulVotedIds(nextVotedIds)
    saveKnowledgeArticles(nextArticles)
    window.localStorage.setItem(HELPFUL_VOTES_STORAGE_KEY, JSON.stringify(nextVotedIds))
    toast.success("已记录为有帮助")
  }

  async function copyAnswer(answer: string) {
    await navigator.clipboard.writeText(answer)
    toast.success("统一回复口径已复制")
  }

  return (
    <main className="min-h-screen bg-muted/20">
      <section className="border-b border-border bg-gradient-to-br from-card via-card to-primary/[0.035] px-5 py-6 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BookOpen className="size-5" />
              </span>
              <div>
                <p className="text-[11px] font-medium text-primary">企业统一口径中心</p>
                <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">知识库管理</h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              按知识层级、部门与业务类别管理客户问答；已发布内容会同步给全系统知识助手，用于快速检索和统一回复。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              <ShieldCheck className="size-3.5" />
              机器人仅引用已发布口径
            </div>
            <Button variant="outline" className="gap-1.5" onClick={openAssistant}>
              <Bot className="size-4" />打开知识助手
            </Button>
            {canReview ? (
              <Button
                variant={reviewUnreadCount ? "default" : "outline"}
                className="relative gap-1.5"
                onClick={openReviewNotifications}
              >
                <Bell className="size-4" />审核通知
                {reviewUnreadCount ? (
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
                    {reviewUnreadCount > 99 ? "99+" : reviewUnreadCount}
                  </span>
                ) : null}
              </Button>
            ) : null}
            {canCreate ? (
              <Button className="gap-1.5" onClick={openCreate}>
                <Plus className="size-4" />新增知识
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-5 px-5 py-5 lg:px-8">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={CircleHelp} label="QA 总数" value={visibleArticles.length} hint="当前可查看的知识" tone="blue" />
          <Metric icon={CheckCircle2} label="已发布" value={publishedCount} hint="可被知识助手引用" tone="green" />
          <Metric icon={FolderTree} label="知识分类" value={categoryCount} hint={`${KNOWLEDGE_DEPARTMENTS.length} 个部门`} tone="violet" />
          <Metric icon={Clock3} label={canReview ? "待我审核" : "我的待审核"} value={pendingCount} hint="发布前需确认口径" tone="amber" />
        </section>

        <section className="rounded-2xl border border-border bg-card p-2 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {([{ key: "library", label: "知识广场", count: publishedCount }, { key: "mine", label: "我的提交", count: ownArticles.length }, ...(canReview ? [{ key: "review", label: "审核工作台", count: pendingReviewArticles.length }] : [])] as const).map((tab) => (
              <button key={tab.key} type="button" onClick={() => { resetFilters(); setView(tab.key as typeof view) }} className={cn("flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition", view === tab.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}>
                {tab.label}<span className={cn("rounded-full px-2 py-0.5 text-xs", view === tab.key ? "bg-white/20" : "bg-muted")}>{tab.count}</span>
                {tab.key === "review" && pendingReviewArticles.length > 0 ? <span className="size-2 rounded-full bg-red-500" aria-label="有待审核知识" /> : null}
              </button>
            ))}
            <span className="ml-auto px-3 text-xs text-muted-foreground">人人可提交 · Leader 审核 · 通过后上线</span>
          </div>
        </section>

        {view === "review" && canReview ? (
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <header className="border-b border-border bg-primary/[0.035] p-5">
              <div className="flex items-start gap-3"><span className="rounded-xl bg-primary/10 p-2.5 text-primary"><ShieldCheck className="size-5" /></span><div><h2 className="text-lg font-semibold">知识审核工作台</h2><p className="mt-1 text-sm text-muted-foreground">先查看问题与答案，可修改标准答案；确认后上线，或填写原因退回提交人。</p><p className="mt-2 text-xs text-primary">负责部门：{reviewDepartments.join("、")}</p></div></div>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {(["待审核", "已发布", "已驳回"] as const).map((item) => <button key={item} onClick={() => setReviewFilter(item)} className={cn("rounded-lg px-3 py-2 text-sm font-medium", reviewFilter === item ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted")}>{item === "已发布" ? "已上线" : item} <span className="ml-1 tabular-nums">{reviewArticles.filter((article) => article.status === item).length}</span></button>)}
                <div className="ml-auto flex flex-wrap gap-2"><Input aria-label="搜索待审核知识" placeholder="搜索问题 / 提交人" className="w-60" value={reviewQuery} onChange={(event) => setReviewQuery(event.target.value)} /><div className="w-36"><NativeSelect value={reviewDepartment} onChange={setReviewDepartment}><option>全部部门</option>{reviewDepartments.map((item) => <option key={item}>{item}</option>)}</NativeSelect></div></div>
              </div>
            </header>
            <div className="divide-y divide-border">
              {reviewRows.map((article) => <button key={article.id} onClick={() => openReview(article)} className="group flex w-full items-center gap-4 p-5 text-left transition hover:bg-primary/[0.035]">
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", article.status === "待审核" ? "bg-amber-50 text-amber-600" : article.status === "已驳回" ? "bg-red-50 text-red-500" : "bg-emerald-50 text-emerald-600")}>{article.status === "待审核" ? <Clock3 className="size-5" /> : article.status === "已驳回" ? <XCircle className="size-5" /> : <CheckCircle2 className="size-5" />}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold group-hover:text-primary">{article.question}</p><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{article.answer}</p><p className="mt-2 text-xs text-muted-foreground">{article.department} · 提交人：{article.submitter || article.owner} · {formatReviewDate(article.submittedAt || article.updatedAt)}</p>{article.status === "已驳回" ? <p className="mt-1 line-clamp-1 text-xs text-red-600">驳回原因：{article.rejectionReason}</p> : null}</div>
                <Pill label={article.status} tone={STATUS_TONE[article.status]} /><span className="hidden items-center gap-1 text-xs font-medium text-primary sm:inline-flex">{article.status === "待审核" ? "去审核" : "查看详情"}<ArrowRight className="size-4" /></span>
              </button>)}
              {!reviewRows.length ? <div className="flex flex-col items-center py-16 text-center"><CheckCircle2 className="size-10 text-primary/30" /><p className="mt-3 font-medium">{reviewFilter === "待审核" ? "当前没有待审核知识" : "暂无符合条件的知识"}</p><p className="mt-1 text-sm text-muted-foreground">新提交的知识会自动进入对应部门 Leader 的审核队列。</p></div> : null}
            </div>
          </section>
        ) : null}

        {view !== "review" ? <>
        {view === "mine" ? <section className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3"><p className="text-sm font-medium">跟踪我的知识提交</p><p className="mt-1 text-xs text-muted-foreground">待审核请等待 Leader 处理；已驳回可查看原因，修改问题或答案后重新提交。</p></section> : null}

        <section className="overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-sm">
          <div>
            <div className="p-5 lg:p-6">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">新手快速上手</span>
                <span className="text-xs text-muted-foreground">从客户原话到标准答复，只需 3 步</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <GuideStep number="1" title="搜索客户问题" description="输入客户原话、关键词或业务场景，不必记住标准标题。" />
                <GuideStep number="2" title="确认已发布口径" description="优先使用带“已发布”状态的答案，避免引用仍在审核的内容。" />
                <GuideStep number="3" title="复制并回复" description="一键复制标准答复，再结合客户上下文补充称呼和细节。" />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">快速查找</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">输入客户怎么问，系统会同时匹配问题、答案、标签与场景</p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={resetFilters}>
              <RotateCcw className="size-3.5" />重置筛选
            </Button>
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(18rem,1.3fr)_repeat(5,minmax(8rem,.6fr))]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
                placeholder="搜索问题、答案、标签或适用场景"
              />
            </label>
            <NativeSelect value={level} onChange={(value) => setLevel(value as KnowledgeLevel | "全部层级")}>
              <option>全部层级</option>
              {KNOWLEDGE_LEVELS.map((item) => <option key={item}>{item}</option>)}
            </NativeSelect>
            <NativeSelect value={category} onChange={setCategory}>
              <option>全部类别</option>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </NativeSelect>
            <NativeSelect value={status} onChange={(value) => setStatus(value as KnowledgeStatus | "全部状态")}>
              <option>全部状态</option>
              {canManageAll || canMaintain ? <option>已发布</option> : null}
              {view === "mine" ? <><option>待审核</option><option>已驳回</option><option>草稿</option><option>已停用</option></> : null}
            </NativeSelect>
            <NativeSelect value={owner} onChange={setOwner}>
              <option>全部维护人</option>
              {owners.map((item) => <option key={item}>{item}</option>)}
            </NativeSelect>
            <NativeSelect value={updatedRange} onChange={setUpdatedRange}>
              <option>全部时间</option>
              <option>近 7 天</option>
              <option>近 30 天</option>
              <option>更早</option>
            </NativeSelect>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">常用场景</span>
            {QUICK_SCENES.map((scene) => (
              <button
                key={scene}
                type="button"
                onClick={() => setQuery(scene)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  query === scene ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                {scene}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">找到 <strong className="font-semibold text-foreground">{filtered.length}</strong> 条</span>
          </div>
        </section>

        <section className="grid min-h-[650px] gap-4 xl:grid-cols-[230px_minmax(360px,0.9fr)_minmax(440px,1.1fr)]">
          <aside className="rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2 px-2 pb-3 pt-1">
              <Layers3 className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">知识导航</h2>
            </div>
            <DepartmentButton
              active={department === "全部部门"}
              label="全部知识"
              count={visibleArticles.length}
              onClick={() => selectDepartment("全部部门")}
            />
            <div className="my-3 border-t border-border" />
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">按部门查看</p>
            <div className="space-y-1">
              {KNOWLEDGE_DEPARTMENTS.map((item) => (
                <DepartmentButton
                  key={item}
                  active={department === item}
                  label={item}
                  count={visibleArticles.filter((article) => article.department === item).length}
                  onClick={() => selectDepartment(item)}
                />
              ))}
            </div>
            <div className="my-3 border-t border-border" />
            <div className="space-y-2 px-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">层级说明</p>
              <p><span className="font-medium text-primary">公司级</span>：跨部门统一口径</p>
              <p><span className="font-medium text-violet-600">部门级</span>：部门业务规范</p>
              <p><span className="font-medium text-amber-600">业务专题</span>：场景化专业知识</p>
            </div>
          </aside>

          <section className="min-w-0 rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3 px-2 pb-3 pt-1">
              <div>
                <h2 className="text-sm font-semibold">QA 问题列表</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">共 {filtered.length} 条符合条件</p>
              </div>
              <Pill label={department} tone="info" />
            </div>
            <div className="max-h-[590px] space-y-2 overflow-y-auto pr-1">
              {filtered.map((article) => {
                const expanded = expandedIds.includes(article.id)
                const helpfulMarked = helpfulVotedIds.includes(article.id)
                return (
                  <div
                    key={article.id}
                    className={cn(
                      "rounded-xl border p-3 transition-all",
                      selected?.id === article.id
                        ? "border-primary/40 bg-primary/5 shadow-sm"
                        : "border-border bg-background hover:border-primary/20 hover:bg-muted/30",
                    )}
                  >
                    <button type="button" onClick={() => openDetail(article)} className="w-full text-left">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-sm font-medium leading-5">{article.question}</p>
                        <ChevronRight className={cn("mt-0.5 size-4 shrink-0", selected?.id === article.id ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <p className={cn("mt-2 text-xs leading-5 text-muted-foreground", expanded ? "whitespace-pre-wrap" : "line-clamp-2")}>{article.answer}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Pill label={article.status} tone={STATUS_TONE[article.status]} />
                        <Pill label={article.level} tone={article.level === "公司级" ? "info" : article.level === "业务专题" ? "warning" : "neutral"} />
                        <span className="text-[11px] text-muted-foreground">{article.department} · {article.category}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>{article.owner} · 更新于 {article.updatedAt}</span>
                        <span className="inline-flex items-center gap-1"><Eye className="size-3" />{article.views}</span>
                      </div>
                    </button>
                    <div className="mt-2 flex items-center justify-between border-t border-border/70 pt-2">
                      <div className="flex flex-wrap gap-1">
                        {article.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{tag}</span>)}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <button
                          type="button"
                          aria-pressed={helpfulMarked}
                          onClick={() => markHelpful(article)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition",
                            helpfulMarked ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <ThumbsUp className={cn("size-3", helpfulMarked && "fill-current")} />
                          {helpfulMarked ? "已帮助" : "有帮助"} {article.helpful}
                        </button>
                        <button type="button" onClick={() => toggleExpanded(article.id)} className="text-[11px] font-medium text-primary hover:underline">
                          {expanded ? "收起全文" : "展开全文"}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
              {!filtered.length ? (
                <div className="flex min-h-56 flex-col items-center justify-center text-center">
                  <Search className="size-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">没有找到匹配的 QA</p>
                  <p className="mt-1 text-xs text-muted-foreground">请调整关键词或筛选条件</p>
                  <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={resetFilters}>
                    <RotateCcw className="size-3.5" />清空筛选
                  </Button>
                </div>
              ) : null}
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-border bg-card shadow-sm">
            {selected ? (
              <article className="flex h-full flex-col">
                <header className="border-b border-border p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill label={selected.status} tone={STATUS_TONE[selected.status]} />
                    <Pill label={selected.level} tone="info" />
                    <span className="text-xs text-muted-foreground">{selected.version}</span>
                  </div>
                  <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">客户可能这样问</p>
                  <h2 className="mt-4 text-xl font-semibold leading-8 tracking-tight">{selected.question}</h2>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    <span>{selected.department} / {selected.category}</span>
                    <span>维护人：{selected.owner}</span>
                    <span>更新：{selected.updatedAt}</span>
                  </div>
                </header>
                <div className="flex-1 space-y-5 p-5">
                  {selected.status === "已驳回" ? <RejectionNote article={selected} /> : null}
                  <section>
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="size-4 text-primary" />{selected.status === "已发布" ? "可直接回复客户" : "提交的答案（尚未上线）"}
                    </div>
                    <div className="rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-7 text-foreground/90">
                      {selected.answer}
                    </div>
                  </section>
                  <section className="grid gap-4 sm:grid-cols-2">
                    <MetaBlock icon={Tags} title="知识标签" items={selected.tags} empty="暂未设置标签" />
                    <MetaBlock icon={Users} title="适用场景" items={selected.scenes} empty="暂未设置场景" />
                  </section>
                  <section className="rounded-xl border border-border bg-muted/20 p-4">
                    <p className="text-xs font-medium">使用与治理规则</p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                      <li>· 知识助手仅检索「已发布」内容，待审核内容不会对外推荐。</li>
                      <li>· 提交修改后重新进入待审核，通过后再上线。</li>
                      <li>· 涉及价格、合同、法律承诺时，仍应以正式文件为准。</li>
                    </ul>
                  </section>
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
                  <div className="text-xs text-muted-foreground">{selected.views} 次查看 · {selected.helpful} 次有帮助</div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={helpfulVotedIds.includes(selected.id) ? "secondary" : "outline"}
                      size="sm"
                      className="gap-1.5"
                      onClick={() => markHelpful(selected)}
                    >
                      <ThumbsUp className={cn("size-3.5", helpfulVotedIds.includes(selected.id) && "fill-current")} />
                      {helpfulVotedIds.includes(selected.id) ? "已标记有帮助" : "有帮助"}
                    </Button>
                    {canManageAll || isOwn(selected) || mayReview(selected) ? (
                      <>
                        {canManageAll || isOwn(selected) ? (
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(selected)}>
                            <Pencil className="size-3.5" />{selected.status === "已驳回" ? "修改并重新提交" : "编辑并提交审核"}
                          </Button>
                        ) : null}
                        {mayReview(selected) ? (
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openReview(selected)}>{selected.status === "待审核" ? "审核这条知识" : "查看审核 / 修改答案"}</Button>
                        ) : null}
                        {mayReview(selected) && selected.status === "已发布" ? (
                          <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => changeStatus(selected, "已停用")}>停用</Button>
                        ) : null}
                        {mayReview(selected) && selected.status === "已停用" ? (
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => changeStatus(selected, "已发布")}>重新启用</Button>
                        ) : null}
                      </>
                    ) : null}
                    <Button size="sm" className="gap-1.5" onClick={() => void copyAnswer(selected.answer)}>
                      <Copy className="size-3.5" />复制答复
                    </Button>
                  </div>
                </footer>
              </article>
            ) : (
              <div className="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
                <FileText className="size-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm font-medium">请选择一条知识查看详情</p>
              </div>
            )}
          </section>
        </section>
        </> : null}
      </div>

      <Dialog open={reviewNoticeOpen} onOpenChange={setReviewNoticeOpen}>
        <DialogContent className="max-h-[78vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="size-4 text-amber-600" />知识审核通知</DialogTitle>
            <DialogDescription>点击一条通知即可查看完整问答、修改答案，并选择通过上线或驳回。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {pendingReviewArticles.length ? pendingReviewArticles.map((article) => {
              const notice = reviewNotifications.find((item) => item.articleId === article.id && !item.resolved)
              return (
                <button
                  key={article.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/30 hover:bg-muted/30"
                  onClick={() => openReview(article)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{article.question}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{article.department} · 审核人：{KNOWLEDGE_DEPARTMENT_LEADERS[article.department] || "部门 Leader"} · 提交人：{notice?.submitter || article.owner} · {article.updatedAt}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800">待审核</span>
                </button>
              )
            }) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">当前没有待审核知识</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setView("review"); setReviewFilter("待审核"); setReviewNoticeOpen(false) }}>进入审核工作台</Button>
            <Button onClick={() => setReviewNoticeOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          {reviewing ? <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-2"><span className="rounded-lg bg-primary/10 p-2 text-primary"><ShieldCheck className="size-4" /></span><Pill label={reviewing.status} tone={STATUS_TONE[reviewing.status]} /><span className="text-xs text-muted-foreground">{reviewing.department} · {reviewing.version}</span></div>
              <DialogTitle className="text-xl leading-8">{reviewing.question}</DialogTitle>
              <DialogDescription>{reviewing.status === "待审核" ? "检查答案是否准确、完整，确认后通过上线；需要提交人补充时，请填写原因驳回。" : "查看处理记录；Leader 可以直接修订标准答案，修改过程会记录留痕。"}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
              <div className="space-y-4">
                {reviewing.status === "已驳回" ? <RejectionNote article={reviewing} /> : null}
                <section className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between gap-2"><label htmlFor="review-answer" className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="size-4 text-primary" />标准答案</label><span className="text-xs text-muted-foreground">Leader 可直接修改</span></div>
                  <Textarea id="review-answer" value={reviewAnswer} onChange={(event) => setReviewAnswer(event.target.value)} rows={11} className="leading-7" placeholder="请输入准确、可直接回复客户的答案" />
                  {reviewAnswer.trim() !== reviewing.answer ? <p className="mt-2 text-xs text-primary">答案已修改；通过或保存时会一并记录原答案与修改后答案。</p> : null}
                </section>
                <div className="grid gap-3 sm:grid-cols-2"><MetaBlock icon={Tags} title="知识标签" items={reviewing.tags} empty="暂未设置标签" /><MetaBlock icon={Users} title="适用场景" items={reviewing.scenes} empty="暂未设置场景" /></div>
              </div>
              <aside className="space-y-4">
                <section className="rounded-xl border border-border bg-muted/20 p-4 text-xs"><h3 className="mb-3 font-semibold">提交信息</h3><dl className="space-y-3"><div><dt className="text-muted-foreground">提交人</dt><dd className="mt-1 font-medium">{reviewing.submitter || reviewing.owner}</dd></div><div><dt className="text-muted-foreground">提交时间</dt><dd className="mt-1">{formatReviewDate(reviewing.submittedAt || reviewing.updatedAt)}</dd></div><div><dt className="text-muted-foreground">审核人</dt><dd className="mt-1">{KNOWLEDGE_DEPARTMENT_LEADERS[reviewing.department] || "部门 Leader"}</dd></div><div><dt className="text-muted-foreground">层级 / 分类</dt><dd className="mt-1">{reviewing.level} / {reviewing.category}</dd></div></dl></section>
                <section className="rounded-xl border border-border p-4"><h3 className="mb-3 text-xs font-semibold">处理记录</h3><div className="max-h-72 space-y-4 overflow-y-auto">
                  {(reviewing.reviewHistory || []).slice().reverse().map((record, index) => <div key={`${record.at}-${index}`} className="border-l-2 border-primary/20 pl-3 text-xs"><p className="font-medium">{record.actor} · {record.action}</p><p className="mt-1 text-[11px] text-muted-foreground">{formatReviewDate(record.at)}</p>{record.reason ? <p className="mt-1 leading-5 text-red-600">{record.reason}</p> : null}{record.answerBefore !== undefined ? <details className="mt-2"><summary className="cursor-pointer text-primary">查看答案修改前后</summary><p className="mt-2 whitespace-pre-wrap leading-5 text-muted-foreground">原答案：{record.answerBefore}</p><p className="mt-2 whitespace-pre-wrap leading-5">新答案：{record.answerAfter}</p></details> : null}</div>)}
                  {!reviewing.reviewHistory?.length ? <p className="text-xs text-muted-foreground">暂无处理记录，下一次操作会自动记录。</p> : null}
                </div></section>
              </aside>
            </div>
            <DialogFooter className="border-t border-border pt-4 sm:justify-between">
              <Button variant="outline" onClick={() => setReviewOpen(false)}>返回</Button>
              <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={reviewAnswer.trim() === reviewing.answer} onClick={() => processReview("save")}>保存答案修改</Button>{reviewing.status === "待审核" ? <><Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => { setRejectReason(""); setRejectOpen(true) }}><XCircle className="mr-1 size-4" />驳回并说明原因</Button><Button onClick={() => processReview("approve")}><CheckCircle2 className="mr-1 size-4" />通过并上线</Button></> : null}</div>
            </DialogFooter>
          </> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>说明驳回原因</DialogTitle><DialogDescription>提交人会看到这段说明，并据此修改后重新提交。</DialogDescription></DialogHeader>
          <p className="rounded-lg bg-muted/30 p-3 text-sm font-medium">{reviewing?.question}</p>
          <Field label="驳回原因 *"><Textarea rows={4} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="如：请补充适用范围，并核对答案中的交付周期。" /></Field>
          <DialogFooter><Button variant="outline" onClick={() => setRejectOpen(false)}>取消</Button><Button disabled={!rejectReason.trim()} onClick={() => processReview("reject")}>确认驳回</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          {selected ? (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill label={selected.status} tone={STATUS_TONE[selected.status]} />
                  <Pill label={selected.level} tone="info" />
                  <span className="text-xs text-muted-foreground">{selected.version}</span>
                </div>
                <DialogTitle className="pt-2 text-xl leading-8">{selected.question}</DialogTitle>
                <DialogDescription>完整知识内容 · {selected.department} / {selected.category}</DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                {selected.status === "已驳回" ? <RejectionNote article={selected} /> : null}
                <section>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">标准答案</p>
                  <div className="whitespace-pre-wrap rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-7">{selected.answer}</div>
                </section>
                <div className="grid gap-3 sm:grid-cols-2">
                  <MetaBlock icon={Tags} title="知识标签" items={selected.tags} empty="暂未设置标签" />
                  <MetaBlock icon={Users} title="适用场景" items={selected.scenes} empty="暂未设置场景" />
                </div>
                <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-xs sm:grid-cols-3">
                  <div><span className="text-muted-foreground">维护部门</span><p className="mt-1 font-medium">{selected.department}</p></div>
                  <div><span className="text-muted-foreground">维护人</span><p className="mt-1 font-medium">{selected.owner}</p></div>
                  <div><span className="text-muted-foreground">更新时间</span><p className="mt-1 font-medium">{selected.updatedAt}</p></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>返回列表</Button>
                {isOwn(selected) || canManageAll ? <Button variant="outline" onClick={() => { setDetailOpen(false); openEdit(selected) }}>{selected.status === "已驳回" ? "修改并重新提交" : "编辑并提交审核"}</Button> : null}
                {mayReview(selected) ? <Button onClick={() => openReview(selected)}>{selected.status === "待审核" ? "审核这条知识" : "查看审核 / 修改答案"}</Button> : null}
                <Button
                  variant={helpfulVotedIds.includes(selected.id) ? "secondary" : "outline"}
                  className="gap-1.5"
                  onClick={() => markHelpful(selected)}
                >
                  <ThumbsUp className={cn("size-3.5", helpfulVotedIds.includes(selected.id) && "fill-current")} />
                  {helpfulVotedIds.includes(selected.id) ? `已帮助 ${selected.helpful}` : `有帮助 ${selected.helpful}`}
                </Button>
                <Button className="gap-1.5" onClick={() => void copyAnswer(selected.answer)}><Copy className="size-3.5" />复制回复</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑知识" : "新增知识"}</DialogTitle>
            <DialogDescription>写下问题和你的答案，交给所属部门 Leader 确认。审核通过后上线，驳回后可按原因修改并重新提交。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="问题 *">
              <Input value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="客户可能会怎么问？" />
            </Field>
            <Field label="统一回复口径 *">
              <Textarea value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} rows={7} placeholder="填写可直接用于回复客户的标准答案" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="所属部门">
                <NativeSelect value={form.department} onChange={(value) => setForm({ ...form, department: value })}>
                  {KNOWLEDGE_DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}
                </NativeSelect>
              </Field>
              <Field label="知识层级">
                <NativeSelect value={form.level} onChange={(value) => setForm({ ...form, level: value as KnowledgeLevel })}>
                  {KNOWLEDGE_LEVELS.map((item) => <option key={item}>{item}</option>)}
                </NativeSelect>
              </Field>
              <Field label="知识分类（第三级）">
                <Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="如：效果与验收；上级分类在左侧导航维护" />
              </Field>
              <Field label="维护人">
                <Input value={form.owner} readOnly className="bg-muted/30" />
              </Field>
            </div>
            <KnowledgeTagInput
              id="knowledge-tags"
              label="知识标签"
              value={form.tags}
              draft={tagDraft}
              onDraftChange={setTagDraft}
              onChange={(tags) => setForm((current) => ({ ...current, tags }))}
              placeholder="如：平台、ChatGPT、Gemini"
            />
            <KnowledgeTagInput
              id="knowledge-scenes"
              label="适用场景"
              value={form.scenes}
              draft={sceneDraft}
              onDraftChange={setSceneDraft}
              onChange={(scenes) => setForm((current) => ({ ...current, scenes }))}
              placeholder="如：客户初次沟通、需求诊断、方案确认"
            />
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-3 text-xs leading-5"><span className="font-medium text-primary">审核人：{KNOWLEDGE_DEPARTMENT_LEADERS[form.department] || "部门 Leader"}</span><p className="text-muted-foreground">提交后状态为「待审核」，审核通知将进入该部门的审核工作台。</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={saveArticle}>提交审核</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function normalizeKnowledgeTags(values: string[]): string[] {
  return Array.from(new Set(values.flatMap((value) => value.split(/[、，,\r\n]+/)).map((value) => value.trim()).filter(Boolean)))
}

function KnowledgeTagInput({ id, label, value, draft, onChange, onDraftChange, placeholder }: {
  id: string
  label: string
  value: string[]
  draft: string
  onChange: (value: string[]) => void
  onDraftChange: (value: string) => void
  placeholder: string
}) {
  const composing = useRef(false)

  function commit(text = draft) {
    onChange(normalizeKnowledgeTags([...value, text]))
    onDraftChange("")
  }

  function updateDraft(text: string) {
    if (!composing.current && /[、，,\r\n]/.test(text)) {
      const pieces = text.split(/[、，,\r\n]+/)
      const remainder = pieces.pop() || ""
      onChange(normalizeKnowledgeTags([...value, ...pieces]))
      onDraftChange(remainder)
      return
    }
    onDraftChange(text)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-foreground">{label}</label>
        {value.length ? <span className="text-[11px] text-muted-foreground">已添加 {value.length} 个</span> : null}
      </div>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-background px-3 py-2 transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        {value.map((tag) => (
          <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/10 bg-primary/5 py-1 pl-2.5 pr-1 text-xs text-primary">
            <span className="break-words">{tag}</span>
            <button type="button" aria-label={`删除${label}：${tag}`} onClick={() => {
              onChange(normalizeKnowledgeTags([...value, draft]).filter((item) => item !== tag))
              onDraftChange("")
            }} className="flex size-5 shrink-0 items-center justify-center rounded-full text-primary/60 outline-none transition hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
          placeholder={value.length ? "继续输入…" : placeholder}
          className="min-w-36 flex-1 border-0 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => updateDraft(event.target.value)}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={(event) => { composing.current = false; updateDraft(event.currentTarget.value) }}
          onBlur={() => { if (!composing.current && draft.trim()) commit() }}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === "Enter") { event.preventDefault(); commit() }
            if (event.key === "Backspace" && !draft && value.length) { event.preventDefault(); onChange(value.slice(0, -1)) }
          }}
          onPaste={(event) => {
            if (composing.current) return
            const pasted = event.clipboardData.getData("text")
            if (/[、，,\r\n]/.test(pasted)) {
              event.preventDefault()
              const target = event.currentTarget
              const start = target.selectionStart ?? draft.length
              const end = target.selectionEnd ?? start
              commit(`${draft.slice(0, start)}${pasted}${draft.slice(end)}`)
            }
          }}
        />
      </div>
      <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">回车生成标签 · 顿号或逗号批量添加 · 点击 × 删除</p>
    </div>
  )
}

function Metric({ icon: Icon, label, value, hint, tone }: { icon: typeof BookOpen; label: string; value: number; hint: string; tone: "blue" | "green" | "violet" | "amber" }) {
  const color = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    amber: "bg-amber-50 text-amber-600",
  }[tone]
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", color)}><Icon className="size-4.5" /></span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 flex items-baseline gap-2"><strong className="text-2xl tabular-nums">{value}</strong><span className="truncate text-[11px] text-muted-foreground">{hint}</span></div>
      </div>
    </div>
  )
}

function formatReviewDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
}

function RejectionNote({ article }: { article: KnowledgeArticle }) {
  return <div className="rounded-xl border border-red-200 bg-red-50/60 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-red-700"><XCircle className="size-4" />已驳回，请按原因修改后重新提交</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-red-700">{article.rejectionReason || "请与审核人确认需要补充的内容。"}</p><p className="mt-2 text-xs text-red-600/80">{article.reviewer || "部门 Leader"}{article.reviewedAt ? ` · ${formatReviewDate(article.reviewedAt)}` : ""}</p></div>
}

function GuideStep({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-border/80 bg-background/70 p-3.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">{number}</span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function DepartmentButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors", active ? "bg-primary text-primary-foreground" : "text-foreground/75 hover:bg-muted")}>
      <span>{label}</span><span className={cn("rounded-full px-2 py-0.5 text-[10px] tabular-nums", active ? "bg-primary-foreground/15" : "bg-muted text-muted-foreground")}>{count}</span>
    </button>
  )
}

function NativeSelect({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30">
      {children}
    </select>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-foreground">{label}</span>{children}</label>
}

function MetaBlock({ icon: Icon, title, items, empty }: { icon: typeof Tags; title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-xl border border-border p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-medium"><Icon className="size-3.5 text-primary" />{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length ? items.map((item) => <span key={item} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{item}</span>) : <span className="text-xs text-muted-foreground">{empty}</span>}
      </div>
    </div>
  )
}

function bumpVersion(version: string) {
  const match = version.match(/^v(\d+)\.(\d+)$/)
  if (!match) return "v1.1"
  return `v${match[1]}.${Number(match[2]) + 1}`
}

function matchesUpdatedRange(value: string, range: string) {
  if (range === "全部时间") return true
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return true
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (range === "近 7 天") return days <= 7
  if (range === "近 30 天") return days <= 30
  return days > 30
}
