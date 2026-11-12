import { NextResponse } from "next/server"

interface AddressComponentLike {
  province?: string
  city?: string | string[]
  district?: string
  township?: string
  street?: string
  streetNumber?: string
}

interface AddressPayload {
  address: string
  province?: string
  city?: string
  district?: string
}

function toText(value?: string | string[]): string {
  if (Array.isArray(value)) return value.join("")
  return value ?? ""
}

function buildAddress(formatted: string | undefined, component: AddressComponentLike): string {
  if (formatted) return formatted
  return [component.province, toText(component.city), component.district, component.township, component.street, component.streetNumber]
    .filter(Boolean)
    .join("")
}

function isNonEmptyAddress(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

async function reverseGeocodeViaAmap(lng: number, lat: number): Promise<AddressPayload | null> {
  const key = process.env.AMAP_WEB_SERVICE_KEY?.trim()
  if (!key) return null

  const url = new URL("https://restapi.amap.com/v3/geocode/regeo")
  url.searchParams.set("key", key)
  url.searchParams.set("location", `${lng},${lat}`)
  url.searchParams.set("extensions", "base")
  url.searchParams.set("output", "json")

  const response = await fetch(url, { next: { revalidate: 0 } })
  if (!response.ok) return null

  const data = (await response.json()) as {
    status: string
    regeocode?: {
      formatted_address?: string | string[]
      addressComponent?: AddressComponentLike
    }
  }

  if (data.status !== "1" || !data.regeocode?.addressComponent) return null

  const component = data.regeocode.addressComponent
  const formatted = toText(
    Array.isArray(data.regeocode.formatted_address)
      ? data.regeocode.formatted_address.join("")
      : data.regeocode.formatted_address,
  )
  const address = buildAddress(formatted, component)
  if (!isNonEmptyAddress(address)) return null

  const province = component.province || undefined
  const city = toText(component.city) || province || undefined
  const district = component.district || undefined
  return { address, province, city, district }
}

async function reverseGeocodeViaNominatim(lng: number, lat: number): Promise<AddressPayload | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse")
  url.searchParams.set("lat", String(lat))
  url.searchParams.set("lon", String(lng))
  url.searchParams.set("format", "json")
  url.searchParams.set("accept-language", "zh-CN,en")

  const response = await fetch(url, {
    headers: { "User-Agent": "geo-admin-checkin/1.0" },
    next: { revalidate: 0 },
  })
  if (!response.ok) return null

  const data = (await response.json()) as {
    display_name?: string
    address?: {
      country?: string
      state?: string
      province?: string
      city?: string
      town?: string
      suburb?: string
      district?: string
      road?: string
    }
  }

  const address = data.display_name?.trim()
  if (!isNonEmptyAddress(address)) return null

  const component = data.address ?? {}
  const province = component.state || component.province || undefined
  const city = component.city || component.town || component.suburb || undefined
  const district = component.district || component.suburb || undefined
  return { address, province, city, district }
}

export const runtime = "nodejs"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lng = Number(searchParams.get("lng"))
  const lat = Number(searchParams.get("lat"))

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 })
  }

  try {
    const amapResult = await reverseGeocodeViaAmap(lng, lat)
    if (amapResult) return NextResponse.json(amapResult)

    const nominatimResult = await reverseGeocodeViaNominatim(lng, lat)
    if (nominatimResult) return NextResponse.json(nominatimResult)

    return NextResponse.json({ error: "地址解析失败" }, { status: 502 })
  } catch {
    return NextResponse.json({ error: "地址解析失败" }, { status: 500 })
  }
}
