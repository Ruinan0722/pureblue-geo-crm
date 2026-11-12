import { Sparkles } from "lucide-react"

export function NeedLinkPage() {
  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Sparkles className="size-6 text-primary" />
      </div>
      <h1 className="text-xl font-semibold">请通过专属链接访问</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        客户需求填报仅对持有项目顾问邀请链接的用户开放。请向您的 GEO 项目顾问索取链接后再访问。
      </p>
      <p className="text-xs text-muted-foreground">
        内部人员请{" "}
        <a
          href={process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL ?? "http://localhost:47821/login"}
          className="text-primary underline-offset-2 hover:underline"
        >
          前往内部系统登录
        </a>
      </p>
    </main>
  )
}
