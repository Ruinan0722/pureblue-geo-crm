import { assertGeoApiConfigured } from "@/shared/lib/runtime-mode"

export type InviteResolveReason = "revoked" | "invalid"
export type InviteGeoVariant = "overseas" | "domestic"

export type InviteResolveResult = {
  valid: boolean
  reason?: InviteResolveReason
  staffName?: string | null
  geoVariant?: InviteGeoVariant | null
}

function getGeoApiBase(): string {
  assertGeoApiConfigured("resolveInviteToken")
  return process.env.GEO_API_URL!.trim().replace(/\/$/, "")
}

/** 校验邀请 token；通过 geo-api（MySQL）解析。 */
export async function resolveInviteToken(
  token: string,
  options?: { countVisit?: boolean },
): Promise<InviteResolveResult> {
  const countVisit = options?.countVisit ?? false
  const apiBase = getGeoApiBase()

  try {
    const qs = countVisit ? "?count_visit=true" : ""
    const res = await fetch(`${apiBase}/api/invites/resolve/${encodeURIComponent(token)}${qs}`, {
      cache: "no-store",
    })
    if (!res.ok) return { valid: false, reason: "invalid" }
    const data = (await res.json()) as {
      valid?: boolean
      staffName?: string
      staff_name?: string
      reason?: InviteResolveReason
      geoVariant?: InviteGeoVariant
      geo_variant?: InviteGeoVariant
    }
    const geoVariant = data.geoVariant ?? data.geo_variant ?? null
    if (!data.valid) {
      return { valid: false, reason: data.reason ?? "invalid", geoVariant }
    }
    return {
      valid: true,
      staffName: data.staffName ?? data.staff_name ?? null,
      geoVariant,
    }
  } catch {
    return { valid: false, reason: "invalid" }
  }
}
