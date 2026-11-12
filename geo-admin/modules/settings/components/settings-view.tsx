"use client"

import { useState } from "react"
import { Check, GripVertical, Plus, Tags, UserCog, X } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { cn } from "@/shared/lib/utils"
import {
  AI_PLATFORM_OPTIONS,
  OPTIMIZATION_GOALS,
  SETTINGS_COUNTRY_PRESETS,
  SETTINGS_LANGUAGE_PRESETS,
} from "@/modules/intake"
import { RbacConfig } from "@/modules/settings/components/rbac-config"
import { toast } from "sonner"

type Tab = "fields" | "options" | "users"

const TABS: { key: Tab; label: string; icon: typeof Tags }[] = [
  { key: "fields", label: "表单字段配置", icon: GripVertical },
  { key: "options", label: "选项库配置", icon: Tags },
  { key: "users", label: "用户与权限", icon: UserCog },
]

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("fields")
  // 首次进入后保持挂载，避免切回「用户与权限」时重复拉取 RBAC/通讯录接口
  const [mountedTabs, setMountedTabs] = useState<Record<Tab, boolean>>({
    fields: true,
    options: false,
    users: false,
  })

  function switchTab(next: Tab) {
    setTab(next)
    setMountedTabs((prev) => (prev[next] ? prev : { ...prev, [next]: true }))
  }

  return (
    <div>
      <header className="border-b border-border bg-card/60 px-5 py-5 lg:px-8">
        <h1 className="text-xl font-semibold tracking-tight">系统配置</h1>
        <p className="mt-1 text-sm text-muted-foreground">配置客户需求表单字段、选项库，以及用户与角色权限。</p>
        <div className="mt-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm transition-colors",
                tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="px-5 py-6 lg:px-8">
        {mountedTabs.fields ? (
          <div className={tab === "fields" ? undefined : "hidden"}>
            <FieldsConfig />
          </div>
        ) : null}
        {mountedTabs.options ? (
          <div className={tab === "options" ? undefined : "hidden"}>
            <OptionsConfig />
          </div>
        ) : null}
        {mountedTabs.users ? (
          <div className={tab === "users" ? undefined : "hidden"}>
            <RbacConfig />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ===== 表单字段配置 ===== */

interface FieldDef {
  id: string
  label: string
  type: string
  required: boolean
  enabled: boolean
}

const INITIAL_FIELDS: { module: string; fields: FieldDef[] }[] = [
  {
    module: "一、项目联系人",
    fields: [
      { id: "companyName", label: "公司名称", type: "单行文本", required: true, enabled: true },
      { id: "contactName", label: "联系人姓名", type: "单行文本", required: true, enabled: true },
      { id: "contactTitle", label: "职位", type: "单行文本", required: true, enabled: true },
      { id: "contactPhone", label: "手机号", type: "手机号", required: true, enabled: true },
    ],
  },
  {
    module: "二、品牌与产品信息",
    fields: [
      { id: "brandName", label: "希望优化的品牌名称", type: "单行文本", required: true, enabled: true },
      { id: "products", label: "希望优化的产品或服务", type: "多项添加", required: true, enabled: true },
      { id: "productIntro", label: "产品或服务介绍", type: "多行文本", required: true, enabled: true },
      { id: "hasOverseasSite", label: "是否有海外官网", type: "单选", required: true, enabled: true },
      { id: "overseasSiteUrl", label: "海外官网地址", type: "网址（条件显示）", required: true, enabled: true },
      { id: "targetCustomer", label: "品牌核心目标用户（TOC / TOB / TOC&TOB）", type: "单选", required: true, enabled: true },
    ],
  },
  {
    module: "三、GEO 优化需求",
    fields: [
      { id: "countries", label: "目标国家或地区", type: "多选标签", required: true, enabled: true },
      { id: "languages", label: "目标语言", type: "多选标签", required: true, enabled: true },
      { id: "platforms", label: "AI 平台", type: "多选标签", required: true, enabled: true },
      { id: "intent", label: "用户问题 / 业务方向", type: "条件文本", required: false, enabled: true },
      { id: "goal", label: "具体优化目标", type: "单选", required: true, enabled: true },
    ],
  },
]

function FieldsConfig() {
  const [groups, setGroups] = useState(INITIAL_FIELDS)

  function toggle(moduleIdx: number, fieldId: string, key: "required" | "enabled") {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === moduleIdx
          ? { ...g, fields: g.fields.map((f) => (f.id === fieldId ? { ...f, [key]: !f[key] } : f)) }
          : g,
      ),
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          控制客户填报表单中各字段是否显示、是否必填。配置仅在本演示中即时生效。
        </p>
        <Button size="sm" onClick={() => toast.success("表单配置已保存")}>
          保存配置
        </Button>
      </div>

      {groups.map((g, mi) => (
        <div key={g.module} className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-secondary/40 px-4 py-2.5 text-sm font-medium">{g.module}</div>
          <div className="divide-y divide-border">
            {g.fields.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <GripVertical className="size-4 shrink-0 text-muted-foreground/40" />
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-medium">{f.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{f.id}</p>
                </div>
                <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{f.type}</span>
                <TogglePill active={f.required} onClick={() => toggle(mi, f.id, "required")} label="必填" />
                <TogglePill active={f.enabled} onClick={() => toggle(mi, f.id, "enabled")} label="显示" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TogglePill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent/40",
      )}
    >
      {active ? <Check className="size-3" /> : <X className="size-3" />}
      {label}
    </button>
  )
}

/* ===== 选项库配置 ===== */

function OptionsConfig() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <TagEditor title="目标国家或地区" initial={SETTINGS_COUNTRY_PRESETS} placeholder="如：新加坡" />
      <TagEditor title="目标语言" initial={SETTINGS_LANGUAGE_PRESETS} placeholder="如：意大利语" />
      <TagEditor title="AI 平台" initial={AI_PLATFORM_OPTIONS} placeholder="如：Grok" />
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">优化目标（考核指标）</h3>
        <p className="mt-1 text-xs text-muted-foreground">用于客户选择本次项目的核心 KPI。</p>
        <div className="mt-3 space-y-2">
          {OPTIMIZATION_GOALS.map((goal) => (
            <div key={goal.value} className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-sm font-medium">{goal.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{goal.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TagEditor({ title, initial, placeholder }: { title: string; initial: string[]; placeholder: string }) {
  const [tags, setTags] = useState<string[]>(initial)
  const [draft, setDraft] = useState("")

  function add() {
    const v = draft.trim()
    if (!v) return
    if (tags.includes(v)) {
      toast.error("该选项已存在")
      return
    }
    setTags([...tags, v])
    setDraft("")
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
            {t}
            <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`删除 ${t}`} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button variant="outline" size="icon" onClick={add} aria-label="添加选项">
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  )
}
