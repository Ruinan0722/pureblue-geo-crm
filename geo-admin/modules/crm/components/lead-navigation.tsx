import Link from "next/link"
import { FileText, Handshake, List } from "lucide-react"
import { cn } from "@/shared/lib/utils"

export function LeadNavigation({ active }: { active: "all" | "channels" | "profile" }) {
  return <nav aria-label="线索管理" className="mb-6 flex flex-wrap gap-1 border-b border-border pb-3">
    {[{ key: "all", href: "/leads", label: "全部线索", icon: List }, { key: "channels", href: "/leads/channels", label: "渠道线索", icon: Handshake }, { key: "profile", href: "/leads/channel-profile", label: "渠道资料单", icon: FileText }].map(({ key, href, label, icon: Icon }) => <Link key={key} href={href} className={cn("inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors", active === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}><Icon className="size-4" />{label}</Link>)}
  </nav>
}
