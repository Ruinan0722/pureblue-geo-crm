"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { ArrowUpRight, Bot, BookOpen, Copy, GripVertical, Search, Send, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Pill } from "@/modules/crm/components/ui"
import {
  KNOWLEDGE_UPDATED_EVENT,
  loadKnowledgeArticles,
  searchKnowledgeArticles,
  type KnowledgeArticle,
} from "@/modules/knowledge/lib/knowledge-data"

const POSITION_KEY = "geo-admin:knowledge-assistant-position:v1"
const OPEN_EVENT = "geo-admin:open-knowledge-assistant"
const EDGE_GAP = 14
const BUTTON_HEIGHT = 48

type FloatingPosition = { x: number; y: number }
type Viewport = { width: number; height: number }
type DragState = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function initialPosition(viewport: Viewport, buttonWidth: number): FloatingPosition {
  try {
    const stored = JSON.parse(window.localStorage.getItem(POSITION_KEY) || "null") as FloatingPosition | null
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      return {
        x: clamp(stored.x, EDGE_GAP, viewport.width - buttonWidth - EDGE_GAP),
        y: clamp(stored.y, EDGE_GAP, viewport.height - BUTTON_HEIGHT - EDGE_GAP),
      }
    }
  } catch {
    // 位置缓存异常时回到右下角。
  }
  return {
    x: Math.max(EDGE_GAP, viewport.width - buttonWidth - 20),
    y: Math.max(EDGE_GAP, viewport.height - BUTTON_HEIGHT - 20),
  }
}

export function KnowledgeQaAssistant() {
  const [open, setOpen] = useState(false)
  const [articles, setArticles] = useState<KnowledgeArticle[]>([])
  const [input, setInput] = useState("")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 })
  const [position, setPosition] = useState<FloatingPosition | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    const refresh = () => setArticles(loadKnowledgeArticles())
    refresh()
    window.addEventListener(KNOWLEDGE_UPDATED_EVENT, refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener(KNOWLEDGE_UPDATED_EVENT, refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  useEffect(() => {
    const openAssistant = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, openAssistant)
    return () => window.removeEventListener(OPEN_EVENT, openAssistant)
  }, [])

  useEffect(() => {
    const syncViewport = () => {
      const nextViewport = { width: window.innerWidth, height: window.innerHeight }
      const buttonWidth = triggerRef.current?.offsetWidth || 154
      setViewport(nextViewport)
      setPosition((current) => current
        ? {
            x: clamp(current.x, EDGE_GAP, nextViewport.width - buttonWidth - EDGE_GAP),
            y: clamp(current.y, EDGE_GAP, nextViewport.height - BUTTON_HEIGHT - EDGE_GAP),
          }
        : initialPosition(nextViewport, buttonWidth))
    }
    syncViewport()
    window.addEventListener("resize", syncViewport)
    return () => window.removeEventListener("resize", syncViewport)
  }, [])

  const hot = useMemo(() => searchKnowledgeArticles("", articles).slice(0, 4), [articles])
  const results = useMemo(
    () => (query ? searchKnowledgeArticles(query, articles).slice(0, 4) : hot),
    [articles, hot, query],
  )
  const selected = results.find((item) => item.id === selectedId) ?? results[0] ?? null

  const panelStyle = useMemo<CSSProperties>(() => {
    if (!position || !viewport.width || !viewport.height) return { right: 20, bottom: 80 }
    const panelWidth = Math.min(410, viewport.width - EDGE_GAP * 2)
    const panelHeight = Math.min(680, viewport.height - EDGE_GAP * 2)
    const buttonWidth = triggerRef.current?.offsetWidth || 154
    const panelX = clamp(position.x + buttonWidth / 2 - panelWidth / 2, EDGE_GAP, viewport.width - panelWidth - EDGE_GAP)
    const spaceAbove = position.y - EDGE_GAP
    const panelY = spaceAbove >= panelHeight + 12
      ? position.y - panelHeight - 12
      : clamp(position.y + BUTTON_HEIGHT + 12, EDGE_GAP, viewport.height - panelHeight - EDGE_GAP)
    return { left: panelX, top: panelY, width: panelWidth, height: panelHeight }
  }, [position, viewport])

  function submit() {
    const next = input.trim()
    if (!next) return
    setQuery(next)
    setSelectedId("")
  }

  function chooseQuestion(article: KnowledgeArticle) {
    setInput(article.question)
    setQuery(article.question)
    setSelectedId(article.id)
  }

  async function copyAnswer(answer: string) {
    await navigator.clipboard.writeText(answer)
    toast.success("标准答案已复制，可直接回复客户")
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!position || event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true
    if (!drag.moved) return
    const buttonWidth = triggerRef.current?.offsetWidth || 154
    setPosition({
      x: clamp(drag.originX + dx, EDGE_GAP, viewport.width - buttonWidth - EDGE_GAP),
      y: clamp(drag.originY + dy, EDGE_GAP, viewport.height - BUTTON_HEIGHT - EDGE_GAP),
    })
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const buttonWidth = triggerRef.current?.offsetWidth || 154
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const raw = {
      x: clamp(drag.originX + dx, EDGE_GAP, viewport.width - buttonWidth - EDGE_GAP),
      y: clamp(drag.originY + dy, EDGE_GAP, viewport.height - BUTTON_HEIGHT - EDGE_GAP),
    }
    if (drag.moved) {
      setPosition(raw)
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(raw))
    }
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function toggleOpen() {
    setOpen((value) => !value)
  }

  return (
    <>
      {open ? (
        <section
          style={panelStyle}
          className="fixed z-40 flex max-h-[calc(100vh-1.75rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ring-1 ring-black/5 print:hidden"
        >
          <header className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary to-blue-500 px-4 py-4 text-primary-foreground">
            <div className="absolute -right-8 -top-10 size-28 rounded-full bg-white/10" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 shadow-inner"><Bot className="size-5" /></span>
                <div>
                  <h2 className="text-sm font-semibold">QA 知识助手</h2>
                  <p className="mt-0.5 text-[11px] text-primary-foreground/75">快捷搜索各部门已发布统一口径</p>
                </div>
              </div>
              <button type="button" aria-label="关闭知识助手" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-primary-foreground/80 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
            </div>
          </header>

          <div className="border-b border-border p-3">
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); submit() }}>
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={input} onChange={(event) => setInput(event.target.value)} className="pl-9" placeholder="输入客户问题，如：如何验收效果" autoFocus />
              </label>
              <Button type="submit" size="icon" aria-label="搜索知识库"><Send className="size-4" /></Button>
            </form>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Sparkles className="size-3 text-primary" />仅引用已审核发布的内容</span>
              <Link href="/knowledge" className="inline-flex items-center gap-1 text-primary hover:underline">进入知识库<ArrowUpRight className="size-3" /></Link>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!query ? (
              <div className="mb-3 rounded-xl border border-primary/10 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                你好，我会从企业已发布 QA 中帮你找到统一回复。可以输入客户原话，也可以点击下面的热门问题。
              </div>
            ) : null}
            <p className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">{query ? `找到 ${results.length} 条相关知识` : "热门问题"}</p>
            <div className="space-y-2">
              {results.map((article) => (
                <div key={article.id} className="overflow-hidden rounded-xl border border-border bg-background">
                  <button type="button" onClick={() => chooseQuestion(article)} className="flex w-full items-start gap-2.5 p-3 text-left hover:bg-muted/30">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><BookOpen className="size-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-5">{article.question}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"><span>{article.department}</span><span>·</span><span>{article.category}</span></span>
                    </span>
                  </button>
                  {selected?.id === article.id && query ? (
                    <div className="border-t border-border bg-muted/20 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <Pill label="标准答案" tone="success" />
                        <div className="flex items-center gap-2">
                          <Link href={`/knowledge?article=${article.id}`} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">查看原知识<ArrowUpRight className="size-3" /></Link>
                          <button type="button" onClick={() => void copyAnswer(article.answer)} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><Copy className="size-3" />复制回复</button>
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/85">{article.answer}</p>
                      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">来源：{article.department} / {article.category} / {article.question}<br />{article.version} · {article.owner} · 更新于 {article.updatedAt}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {query && !results.length ? (
              <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
                <Search className="size-8 text-muted-foreground/30" />
                <p className="mt-3 text-sm font-medium">知识库暂无匹配答案</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">可以换一个关键词，或进入知识库新增并提交审核。</p>
                <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/knowledge">进入知识库</Link></Button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <div
        ref={triggerRef}
        style={position ? { left: position.x, top: position.y } : undefined}
        className={`fixed z-40 flex touch-none select-none items-stretch overflow-hidden rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-[box-shadow,transform,left,top] duration-200 hover:shadow-xl print:hidden ${position ? "" : "bottom-5 right-5"}`}
      >
        <button
          type="button"
          aria-label="拖动 QA 知识助手"
          title="按住拖动到任意位置"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { dragRef.current = null }}
          className="flex cursor-grab items-center border-r border-white/15 px-2.5 text-primary-foreground/65 hover:bg-white/10 hover:text-primary-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={toggleOpen}
          aria-label={open ? "收起 QA 知识助手" : "打开 QA 知识助手"}
          className="flex items-center gap-2 py-3 pl-2.5 pr-3.5 hover:bg-white/10"
        >
          <span className="relative"><Bot className="size-5" /><span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-primary bg-emerald-400" /></span>
          <span>{open ? "收起助手" : "QA 知识助手"}</span>
        </button>
      </div>
    </>
  )
}
