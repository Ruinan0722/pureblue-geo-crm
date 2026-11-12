"use client"

import { StatCards } from "@/modules/crm/components/ui"
import { ROLE_META,useRole } from "@/modules/crm/hooks/use-crm-access"
import { wan } from "@/modules/crm/lib/crm-data"
import {
EMPTY_WORKBENCH_STATS,
fetchWorkbenchStats,
type WorkbenchStats,
} from "@/modules/crm/services/crm-api"
import { cn } from "@/shared/lib/utils"
import { ArrowRight,CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { useEffect,useState } from "react"
import { toast } from "sonner"

interface TodoItem {
  label: string
  count: number
  href: string
  urgent?: boolean
}

function TodoGrid({ items }: { items: TodoItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className={cn(
            "group rounded-xl border bg-card p-4 transition-colors hover:border-primary/50",
            t.urgent && t.count > 0 ? "border-amber-300 bg-amber-50/50" : "border-border",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              t.urgent && t.count > 0 ? "text-amber-600" : "text-foreground",
            )}
          >
            {t.count}
          </p>
        </Link>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export function Workbench() {
  const { role } = useRole()
  const [stats, setStats] = useState<WorkbenchStats>(EMPTY_WORKBENCH_STATS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchWorkbenchStats()
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "加载工作台数据失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const body = (() => {
    if (role === "viewer") {
      return (
        <div className="space-y-8">
          <Section title="交付待办">
            <TodoGrid
              items={[
                { label: "延期项目", count: stats.projectsDelayed, href: "/projects", urgent: true },
                { label: "续费预警", count: stats.projectsRenewalWarning, href: "/projects", urgent: true },
                { label: "健康度异常", count: stats.projectsUnhealthy, href: "/projects", urgent: true },
                { label: "进行中项目", count: stats.projectsActive, href: "/projects" },
              ]}
            />
          </Section>
          <Section title="交付概览">
            <StatCards
              cols={5}
              items={[
                { label: "在管项目", value: stats.projectsTotal },
                { label: "进行中", value: stats.projectsActive, tone: "text-primary" },
                { label: "延期", value: stats.projectsDelayed, tone: "text-amber-600" },
                { label: "续费预警", value: stats.projectsRenewalWarning, tone: "text-amber-600" },
                { label: "健康异常", value: stats.projectsUnhealthy, tone: "text-red-600" },
                { label: "已完成", value: stats.projectsCompleted, tone: "text-emerald-600" },
              ]}
            />
          </Section>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" />
            当前身份：
            <span className="font-medium text-foreground">
              {ROLE_META[role]?.label ?? String(role)}
            </span>
            {ROLE_META[role]?.desc ? ` —— ${ROLE_META[role].desc}` : null}
          </div>
        </div>
      )
    }

    if (role === "sdr") {
      return (
        <div className="space-y-8">
          <Section title="我的待办">
            <TodoGrid
              items={[
                { label: "今日待触达线索", count: stats.leadsUntouched, href: "/leads", urgent: true },
                { label: "待转出线索", count: stats.leadsToTransfer, href: "/leads" },
                { label: "需要跟进线索", count: stats.leadsNeed, href: "/leads" },
                { label: "待销售确认需求", count: stats.reqPending, href: "/requests", urgent: true },
              ]}
            />
          </Section>
          <Section title="我的数据">
            <StatCards
              cols={5}
              items={[
                { label: "我的线索数", value: stats.leadsTotal },
                { label: "已转客户数量", value: stats.leadsConverted, tone: "text-emerald-600" },
                { label: "无效线索数量", value: stats.leadsInvalid },
                { label: "已转客户", value: stats.customersTotal },
                { label: "线索转化率", value: `${stats.leadRate}%`, tone: "text-primary" },
              ]}
            />
          </Section>
        </div>
      )
    }

    if (role === "leader") {
      return (
        <div className="space-y-8">
          <Section title="团队经营数据">
            <StatCards
              cols={4}
              items={[
                { label: "团队线索数", value: stats.leadsTotal },
                { label: "团队客户数", value: stats.customersTotal },
                { label: "团队商机数", value: stats.oppsTotal },
                { label: "团队签署中金额", value: wan(stats.monthExpected), tone: "text-amber-600" },
                { label: "团队已成交金额", value: wan(stats.wonAmount), tone: "text-emerald-600" },
                { label: "团队输单数", value: stats.oppsLost },
                { label: "超期未跟进商机", value: stats.oppsStale, tone: "text-amber-600" },
                { label: "待签订合同", value: stats.signingContracts },
              ]}
            />
          </Section>
          <Section title="需关注">
            <TodoGrid
              items={[
                { label: "超7天未跟进商机", count: stats.oppsStale, href: "/opportunities", urgent: true },
                { label: "待补充输单原因", count: stats.oppsLostNoReason, href: "/opportunities", urgent: true },
                { label: "长期未跟进客户", count: stats.customersStale, href: "/customers" },
                { label: "待销售确认需求", count: stats.reqPending, href: "/requests" },
              ]}
            />
          </Section>
        </div>
      )
    }

    if (role === "ops") {
      return (
        <div className="space-y-8">
          <Section title="合同待办">
            <TodoGrid
              items={[
                { label: "待维护合同", count: stats.signingContracts, href: "/contracts", urgent: true },
                { label: "已签订合同", count: stats.signedContracts, href: "/contracts" },
                { label: "签署中商机", count: stats.oppsSigning, href: "/opportunities" },
                { label: "合作中客户", count: stats.customersCooperating, href: "/customers" },
              ]}
            />
          </Section>
          <Section title="合同数据">
            <StatCards
              cols={4}
              items={[
                { label: "合同总数", value: stats.contractsTotal },
                { label: "待签订", value: stats.contractsPending, tone: "text-amber-600" },
                { label: "已签订", value: stats.signedContracts, tone: "text-emerald-600" },
                { label: "合同总金额", value: wan(stats.contractAmount) },
              ]}
            />
          </Section>
        </div>
      )
    }

    if (role === "presales") {
      return (
        <div className="space-y-8">
          <Section title="我的待办">
            <TodoGrid
              items={[
                { label: "待跟进商机", count: stats.oppsFollowDue, href: "/opportunities" },
                { label: "超7天未跟进商机", count: stats.oppsStale, href: "/opportunities", urgent: true },
              ]}
            />
          </Section>
          <Section title="我的数据">
            <StatCards
              cols={3}
              items={[
                { label: "可见商机数", value: stats.oppsTotal },
                { label: "推进中商机", value: stats.oppsActive, tone: "text-primary" },
                { label: "签署中商机", value: stats.oppsSigning, tone: "text-amber-600" },
              ]}
            />
          </Section>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" />
            当前身份：
            <span className="font-medium text-foreground">
              {ROLE_META[role]?.label ?? String(role)}
            </span>
            {ROLE_META[role]?.desc ? ` —— ${ROLE_META[role].desc}` : null}
          </div>
        </div>
      )
    }

    if (role === "overseas") {
      return (
        <div className="space-y-8">
          <Section title="我的待办">
            <TodoGrid
              items={[
                { label: "今日待跟进商机", count: stats.oppsFollowDue, href: "/opportunities" },
                { label: "超7天未跟进商机", count: stats.oppsStale, href: "/opportunities", urgent: true },
                { label: "待销售确认需求", count: stats.reqPending, href: "/requests", urgent: true },
                { label: "需补充需求", count: stats.reqSupplement, href: "/requests", urgent: true },
                { label: "待签订合同", count: stats.signingContracts, href: "/contracts" },
                { label: "延期项目", count: stats.projectsDelayed, href: "/projects", urgent: true },
              ]}
            />
          </Section>
          <Section title="我的数据">
            <StatCards
              cols={6}
              items={[
                { label: "我的商机数", value: stats.oppsTotal },
                { label: "签署中商机", value: stats.oppsSigning, tone: "text-amber-600" },
                { label: "已确认需求", value: stats.reqConfirmed, tone: "text-emerald-600" },
                { label: "合同总数", value: stats.contractsTotal },
                { label: "在管项目", value: stats.projectsTotal },
                { label: "本月预计签约", value: wan(stats.monthExpected), tone: "text-primary" },
              ]}
            />
          </Section>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" />
            当前身份：
            <span className="font-medium text-foreground">
              {ROLE_META[role]?.label ?? String(role)}
            </span>
            {ROLE_META[role]?.desc ? ` —— ${ROLE_META[role].desc}` : null}
          </div>
        </div>
      )
    }

    // 销售 / 管理员 —— 完整视角
    return (
      <div className="space-y-8">
        <Section title="我的待办">
          <TodoGrid
            items={[
              { label: "今日待跟进线索", count: stats.leadsNeed, href: "/leads" },
              { label: "今日待跟进客户", count: stats.customersActive, href: "/customers" },
              { label: "今日待跟进商机", count: stats.oppsFollowDue, href: "/opportunities" },
              { label: "待销售确认需求", count: stats.reqPending, href: "/requests", urgent: true },
              { label: "需补充需求", count: stats.reqSupplement, href: "/requests", urgent: true },
              { label: "超7天未跟进商机", count: stats.oppsStale, href: "/opportunities", urgent: true },
              { label: "待补充输单原因", count: stats.oppsLostNoReason, href: "/opportunities", urgent: true },
              { label: "待签订合同", count: stats.signingContracts, href: "/contracts" },
            ]}
          />
        </Section>
        <Section title="我的数据">
          <StatCards
            cols={6}
            items={[
              { label: "我的线索数", value: stats.leadsTotal },
              { label: "我的客户数", value: stats.customersTotal },
              { label: "我的商机数", value: stats.oppsTotal },
              { label: "签署中商机", value: stats.oppsSigning, tone: "text-amber-600" },
              { label: "已确认需求", value: stats.reqConfirmed, tone: "text-emerald-600" },
              { label: "本月预计签约", value: wan(stats.monthExpected), tone: "text-primary" },
            ]}
          />
        </Section>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-600" />
          当前身份：
          <span className="font-medium text-foreground">
            {ROLE_META[role]?.label ?? String(role)}
          </span>
          {ROLE_META[role]?.desc ? ` —— ${ROLE_META[role].desc}` : null}
        </div>
      </div>
    )
  })()

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/40 pt-16 text-sm text-muted-foreground">
          加载工作台数据…
        </div>
      )}
      {body}
    </div>
  )
}
