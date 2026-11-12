import gcoord from "gcoord"
import type { AddressInfo } from "../lib/types"

interface AddressComponentLike {
  province?: string
  city?: string | string[]
  district?: string
  township?: string
  street?: string
  streetNumber?: string
}

export type GeocodeResult = AddressInfo & {
  degraded: boolean
  errorMessage?: string
}

let loadScriptPromise: Promise<typeof AMap> | null = null

function getJsApiKey() {
  return process.env.NEXT_PUBLIC_AMAP_KEY?.trim() ?? ""
}

function getSecurityCode() {
  return process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE?.trim() ?? ""
}

function ensureSecurityConfig(securityCode: string) {
  if (typeof window === "undefined") return
  window._AMapSecurityConfig = { securityJsCode: securityCode }
}

function normalizeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error
  return fallback
}

function loadAmapScript(): Promise<typeof AMap> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("高德 JS API 只能在浏览器中使用"))
  }

  if (window.AMap) return Promise.resolve(window.AMap)

  const key = getJsApiKey()
  const securityCode = getSecurityCode()
  if (!key || !securityCode) {
    return Promise.reject(new Error("缺少高德 Key 配置"))
  }

  ensureSecurityConfig(securityCode)

  if (!loadScriptPromise) {
    loadScriptPromise = new Promise((resolve, reject) => {
      const callbackName = `___amapLoaded_${Date.now()}`
      const cleanup = () => {
        delete (window as unknown as Record<string, unknown>)[callbackName]
      }

      ;(window as unknown as Record<string, (err?: unknown) => void>)[callbackName] = (err?: unknown) => {
        cleanup()
        if (err) {
          loadScriptPromise = null
          reject(new Error(normalizeError(err, "高德地图加载失败")))
          return
        }
        if (!window.AMap) {
          loadScriptPromise = null
          reject(new Error("高德地图加载失败"))
          return
        }
        resolve(window.AMap)
      }

      const script = document.createElement("script")
      script.type = "text/javascript"
      script.async = true
      script.src = `https://webapi.amap.com/maps?callback=${callbackName}&v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder`
      script.onerror = () => {
        cleanup()
        loadScriptPromise = null
        script.remove()
        reject(new Error("高德地图脚本加载失败"))
      }
      document.head.appendChild(script)
    })
  }

  return loadScriptPromise
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

function parseAddressComponent(component: AddressComponentLike, formatted?: string): AddressInfo {
  const province = component.province || undefined
  const city = toText(component.city) || province || undefined
  const district = component.district || undefined
  return { address: buildAddress(formatted, component), province, city, district }
}

function getFormattedAddress(regeocode: AMap.Regeocode & { formatted_address?: string }): string | undefined {
  return regeocode.formattedAddress || regeocode.formatted_address
}

function loadGeocoderPlugin(AMapApi: typeof AMap): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof AMapApi.plugin !== "function") {
      resolve()
      return
    }
    const timer = window.setTimeout(() => reject(new Error("地址解析超时")), 8000)
    AMapApi.plugin("AMap.Geocoder", () => {
      window.clearTimeout(timer)
      resolve()
    })
  })
}

function reverseGeocodeViaJs(AMapApi: typeof AMap, lng: number, lat: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const geocoder = new AMapApi.Geocoder({ city: "全国", radius: 1000 })
    geocoder.getAddress([lng, lat], (status: string, result: AMap.GeocoderResult) => {
      if (status === "complete" && result.info === "OK" && result.regeocode) {
        resolve(parseAddressComponent(result.regeocode.addressComponent, getFormattedAddress(result.regeocode)))
        return
      }
      reject(new Error("中文地址解析失败"))
    })
  })
}

async function reverseGeocodeViaServer(lng: number, lat: number): Promise<AddressInfo> {
  const response = await fetch(
    `/api/geocode/reverse?lng=${encodeURIComponent(String(lng))}&lat=${encodeURIComponent(String(lat))}`,
    { cache: "no-store" },
  )
  if (!response.ok) {
    throw new Error("中文地址解析失败")
  }
  return response.json() as Promise<AddressInfo>
}

export function buildCoordinateFallbackAddress(latitude: number, longitude: number): AddressInfo {
  return { address: `坐标位置（${latitude.toFixed(6)}, ${longitude.toFixed(6)}）` }
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<AddressInfo> {
  const result = await reverseGeocodeDetailed(latitude, longitude)
  if (result.degraded) {
    throw new Error(result.errorMessage ?? "中文地址解析失败")
  }
  return result
}

export async function reverseGeocodeDetailed(latitude: number, longitude: number): Promise<GeocodeResult> {
  const [lng, lat] = gcoord.transform([longitude, latitude], gcoord.WGS84, gcoord.GCJ02)

  try {
    const AMapApi = await loadAmapScript()
    await loadGeocoderPlugin(AMapApi)
    const address = await reverseGeocodeViaJs(AMapApi, lng, lat)
    return { ...address, degraded: false }
  } catch {
    loadScriptPromise = null
  }

  try {
    const address = await reverseGeocodeViaServer(lng, lat)
    return { ...address, degraded: false }
  } catch {
    // fall through to coordinate fallback
  }

  return {
    ...buildCoordinateFallbackAddress(latitude, longitude),
    degraded: true,
    errorMessage: "中文地址解析失败",
  }
}
