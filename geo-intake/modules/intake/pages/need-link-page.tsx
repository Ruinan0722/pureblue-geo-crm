import { Link2Off } from "lucide-react"
import { getTranslations } from "next-intl/server"

export async function NeedLinkPage({ reason }: { reason?: string | null }) {
  const t = await getTranslations("needLink")
  const revoked = reason === "revoked"
  const invalid = reason === "invalid"

  const title = revoked ? t("revokedTitle") : invalid ? t("invalidTitle") : t("noAccessTitle")
  const description = revoked
    ? t("revokedDescription")
    : invalid
      ? t("invalidDescription")
      : t("noAccessDescription")

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Link2Off className="size-6 text-primary" />
      </div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      <p className="text-xs text-muted-foreground">
        {t("staffHint")}{" "}
        <a
          href={process.env.NEXT_PUBLIC_ADMIN_PORTAL_URL ?? "http://localhost:47821/login"}
          className="text-primary underline-offset-2 hover:underline"
        >
          {t("staffLogin")}
        </a>
      </p>
    </main>
  )
}
