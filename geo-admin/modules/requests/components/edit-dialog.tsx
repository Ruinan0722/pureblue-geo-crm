"use client"

import { useState } from "react"
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
import { ChoiceCard, ChipGroup, Field, ProductEditor, RegionEditor, RowList } from "@/modules/intake/components/form-bits"
import { useRequests } from "../context/requests-provider"
import {
  AI_PLATFORM_OPTIONS,
  DOMESTIC_AI_PLATFORM_OPTIONS,
  DOMESTIC_OPTIMIZATION_GOALS,
  OPTIMIZATION_GOALS,
  OVERSEAS_RECOMMENDATION_GOALS,
  isDomesticFormData,
  syncRegionsForPlatforms,
  type GeoFormData,
} from "@/modules/intake"
import type { RequestRecord } from "../lib/types"
import { toast } from "sonner"
import { useFormDraft } from "@/shared/hooks/use-form-draft"

export function EditDialog({
  open,
  onOpenChange,
  record,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  record: RequestRecord
}) {
  const { updateData } = useRequests()
  const domestic = isDomesticFormData(record.data)
  const [draft, setDraft] = useState<GeoFormData>(() => ({
    ...record.data,
    regions: domestic ? record.data.regions : syncRegionsForPlatforms(record.data.regions, record.data.platforms ?? []),
    goals: record.data.goals?.length ? record.data.goals : record.data.goal ? [record.data.goal] : [],
  }))
  const draftKey = `request-edit:${record.id}`
  const { clearDraft } = useFormDraft({
    key: draftKey,
    schemaVersion: 1,
    open,
    value: draft,
    onRestore: setDraft,
    getBaseline: () => record.data,
  })

  function set<K extends keyof GeoFormData>(key: K, val: GeoFormData[K]) {
    setDraft((d) => ({ ...d, [key]: val }))
  }

  function setPlatforms(platforms: string[]) {
    setDraft((current) => ({
      ...current,
      platforms,
      regions: domestic ? current.regions : syncRegionsForPlatforms(current.regions, platforms),
    }))
  }

  const selectedGoals = draft.goals?.length ? draft.goals : draft.goal ? [draft.goal] : []

  function setGoals(goals: string[]) {
    const ordered = OPTIMIZATION_GOALS.map((item) => item.value).filter((value) => goals.includes(value))
    setDraft((current) => ({ ...current, goals: ordered, goal: ordered[0] || "" }))
  }

  function save() {
    updateData(record.id, draft)
      .then(() => {
        clearDraft()
        onOpenChange(false)
        toast.success("客户信息已更新")
      })
      .catch(() => toast.error("保存失败，请重试"))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑客户信息</DialogTitle>
          <DialogDescription>内部人员可补充或修正客户提交的信息，保存后将更新需求记录。</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="公司名称" required>
              <Input value={draft.companyName} onChange={(e) => set("companyName", e.target.value)} />
            </Field>
            <Field label="联系人姓名" required>
              <Input value={draft.contactName} onChange={(e) => set("contactName", e.target.value)} />
            </Field>
            <Field label="职位" required>
              <Input value={draft.contactTitle} onChange={(e) => set("contactTitle", e.target.value)} />
            </Field>
            <Field label="手机号" required>
              <Input value={draft.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
            </Field>
          </div>

          <Field label="品牌名称" required>
            <Input value={draft.brandName} onChange={(e) => set("brandName", e.target.value)} />
            <div className="mt-3">
              <p className="mb-2 text-xs text-muted-foreground">品牌别名（选填）</p>
              <RowList
                value={draft.brandAliases}
                onChange={(v) => set("brandAliases", v)}
                placeholder={() => "例如：Apple"}
                addLabel="添加别名"
                numbered={false}
              />
            </div>
          </Field>

          <Field label="本次优化范围" required>
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceCard
                selected={draft.scopeType === "brand_only"}
                onSelect={() => set("scopeType", "brand_only")}
                title="仅优化品牌整体"
              />
              <ChoiceCard
                selected={draft.scopeType === "specific"}
                onSelect={() => set("scopeType", "specific")}
                title="优化具体产品或服务"
              />
            </div>
          </Field>

          {draft.scopeType === "specific" && (
            <div className="rounded-xl border border-dashed border-primary/40 bg-accent/30 p-4">
              <Field label="请简单介绍该产品或服务" required>
                <ProductEditor value={draft.products} onChange={(v) => set("products", v)} />
              </Field>
            </div>
          )}

          <Field label="是否有海外官网" required>
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceCard selected={draft.hasOverseasSite === "yes"} onSelect={() => set("hasOverseasSite", "yes")} title="有海外官网" />
              <ChoiceCard selected={draft.hasOverseasSite === "no"} onSelect={() => set("hasOverseasSite", "no")} title="暂无海外官网" />
            </div>
          </Field>
          {draft.hasOverseasSite === "yes" && (
            <Field label="海外官网地址" required>
              <Input value={draft.overseasSiteUrl} onChange={(e) => set("overseasSiteUrl", e.target.value)} />
            </Field>
          )}

          <Field
            label="品牌核心目标用户"
            required
            hint="请选择品牌主要面向的目标用户类型。"
          >
            <div className="grid gap-2">
              <ChoiceCard
                selected={draft.targetCustomer === "toc"}
                onSelect={() => set("targetCustomer", "toc")}
                title="A、TOC"
                desc="个人消费者：品牌核心目标用户为普通个人消费者，聚焦个体日常消费场景"
              />
              <ChoiceCard
                selected={draft.targetCustomer === "tob"}
                onSelect={() => set("targetCustomer", "tob")}
                title="B、TOB"
                desc="企业/机构客户：品牌核心目标用户为企业、机构、组织等商业客户"
              />
              <ChoiceCard
                selected={draft.targetCustomer === "both"}
                onSelect={() => set("targetCustomer", "both")}
                title="C、TOC & TOB"
                desc="两类用户均覆盖：同时覆盖个人消费者与企业、机构等商业客户"
              />
            </div>
          </Field>

          <Field label="AI 平台" required hint="请先选择平台，再分别配置对应国家与语言。">
            <ChipGroup
              options={domestic ? DOMESTIC_AI_PLATFORM_OPTIONS : AI_PLATFORM_OPTIONS}
              value={draft.platforms}
              onChange={setPlatforms}
            />
          </Field>
          {!domestic && <Field label="各平台目标国家与语言" required>
            <RegionEditor platforms={draft.platforms} value={draft.regions} onChange={(v) => set("regions", v)} />
          </Field>}
          <Field label="优化背景">
            <Textarea
              rows={3}
              placeholder="是否有营销规划 / 排期？如有可以自定义填写"
              value={draft.optimizeBackground}
              onChange={(e) => set("optimizeBackground", e.target.value)}
            />
          </Field>
          <Field label="具体优化目标" required hint="来源率可独立选择；推荐率指标三选一。">
            {domestic ? <div className="grid gap-2 sm:grid-cols-2">
              {DOMESTIC_OPTIMIZATION_GOALS.map((goal) => {
                const selected = (draft.goals ?? []).includes(goal.value)
                return <ChoiceCard key={goal.value} selected={selected} onSelect={() => set("goals", selected ? (draft.goals ?? []).filter((value) => value !== goal.value) : [...(draft.goals ?? []), goal.value])} title={goal.label} />
              })}
            </div> : <div className="space-y-3">
              {OPTIMIZATION_GOALS.filter((goal) => goal.value === "source").map((goal) => (
                <ChoiceCard key={goal.value} selected={selectedGoals.includes(goal.value)} onSelect={() => setGoals(selectedGoals.includes(goal.value) ? selectedGoals.filter((value) => value !== goal.value) : [...selectedGoals, goal.value])} title={goal.label} />
              ))}
              <div className="grid gap-2 sm:grid-cols-3">
                {OPTIMIZATION_GOALS.filter((goal) => OVERSEAS_RECOMMENDATION_GOALS.includes(goal.value as (typeof OVERSEAS_RECOMMENDATION_GOALS)[number])).map((goal) => (
                  <ChoiceCard key={goal.value} selected={selectedGoals.includes(goal.value)} onSelect={() => { const withoutRecommendation = selectedGoals.filter((value) => !OVERSEAS_RECOMMENDATION_GOALS.includes(value as (typeof OVERSEAS_RECOMMENDATION_GOALS)[number])); setGoals(selectedGoals.includes(goal.value) ? withoutRecommendation : [...withoutRecommendation, goal.value]) }} title={goal.label} />
                ))}
              </div>
            </div>}
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save}>保存修改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
