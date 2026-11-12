"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { canDo } from "@/modules/auth/lib/permissions"
import { InfoRow } from "@/modules/crm/components/ui"
import { useRole } from "@/modules/crm/hooks/use-crm-access"
import type { ProjectRecord } from "@/modules/projects/lib/types"
import {
  fetchProjectByContract,
  fetchProjectsByCustomer,
  ProjectApiError,
} from "@/modules/projects/services/projects-api"

type Props = { contractId: string; customerId?: never } | { customerId: string; contractId?: never }

export function RelatedProjectLinks(props: Props) {
  const { user } = useRole()
  const allowed = canDo(user?.permissions ?? [], "section:projects")
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [state, setState] = useState<"idle" | "loading" | "ready" | "forbidden" | "error">("idle")
  const contractId = "contractId" in props ? props.contractId : undefined
  const customerId = "customerId" in props ? props.customerId : undefined

  useEffect(() => {
    if (!allowed) {
      setProjects([])
      setState("idle")
      return
    }
    let cancelled = false
    setState("loading")
    const request = contractId
      ? fetchProjectByContract(contractId).then((project) => (project ? [project] : []))
      : fetchProjectsByCustomer(customerId as string)
    void request
      .then((items) => {
        if (cancelled) return
        setProjects(items)
        setState("ready")
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setProjects([])
        setState(error instanceof ProjectApiError && error.status === 403 ? "forbidden" : "error")
      })
    return () => {
      cancelled = true
    }
  }, [allowed, contractId, customerId])

  if (!allowed) return null
  return (
    <InfoRow label="交付项目">
      {state === "loading" && <span className="text-muted-foreground">加载中…</span>}
      {state === "forbidden" && <span className="text-muted-foreground">无权查看关联项目</span>}
      {state === "error" && <span className="text-destructive">关联项目加载失败，请稍后重试</span>}
      {state === "ready" && projects.length === 0 && (
        <span className="text-muted-foreground">尚未生成</span>
      )}
      {state === "ready" && projects.length > 0 && (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="text-primary hover:underline">
              {project.name}
            </Link>
          ))}
        </span>
      )}
    </InfoRow>
  )
}
