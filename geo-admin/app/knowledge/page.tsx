import { KnowledgeBasePage } from "@/modules/knowledge/components/knowledge-base-page"
import { requireCrmSection } from "@/modules/crm/lib/require-section"

export default async function Page() {
  // 知识库是员工基础能力；当前复用轻量登录守卫，细粒度审核权限后续接 RBAC。
  await requireCrmSection("home")
  return <KnowledgeBasePage />
}
