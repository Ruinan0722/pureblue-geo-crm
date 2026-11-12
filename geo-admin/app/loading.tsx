import { PageLoading } from "@/modules/shell/components/page-loading"

/**
 * 兜底：非侧栏触发的软导航（如页内 Link）仍可显示骨架。
 * 侧栏切换由 AppShell 在右侧内容区控制 loading。
 */
export default function Loading() {
  return <PageLoading />
}
