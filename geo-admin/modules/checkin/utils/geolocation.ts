import type { GeoPosition } from "../lib/types"

export type GeolocationFailureReason =
  | "unsupported"
  | "insecure_context"
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "unknown"

export class GeolocationError extends Error {
  reason: GeolocationFailureReason

  constructor(reason: GeolocationFailureReason, message: string) {
    super(message)
    this.name = "GeolocationError"
    this.reason = reason
  }
}

export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator
}

export function isGeolocationSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext
}

/** 非 HTTPS / 非 localhost 时浏览器会直接拒绝定位（不会弹出授权框） */
export function getInsecureContextMessage(): string | null {
  if (typeof window === "undefined" || window.isSecureContext) {
    return null
  }

  return "当前网址无法使用定位，请联系管理员"
}

export async function queryGeolocationPermission(): Promise<PermissionState | "unknown"> {
  if (!isGeolocationSecureContext() || !navigator.permissions?.query) {
    return "unknown"
  }

  try {
    const result = await navigator.permissions.query({ name: "geolocation" })
    return result.state
  } catch {
    return "unknown"
  }
}

function mapBrowserErrorCode(code: number): GeolocationFailureReason {
  switch (code) {
    case 1:
      return "permission_denied"
    case 2:
      return "position_unavailable"
    case 3:
      return "timeout"
    default:
      return "unknown"
  }
}

function buildBrowserErrorMessage(reason: GeolocationFailureReason): string {
  switch (reason) {
    case "permission_denied":
      return "还没允许定位，请在浏览器里点「允许」"
    case "position_unavailable":
      return "暂时获取不到位置，请开启定位服务，并尝试关闭 VPN 后重试"
    case "timeout":
      return "定位超时，请关闭 VPN、连上稳定 Wi‑Fi 后重试"
    default:
      return "定位失败，请开启定位服务并尝试关闭 VPN 后重试"
  }
}

export function getGeolocationGuidance(
  reason: GeolocationFailureReason,
  permission: PermissionState | "unknown" = "unknown",
): string[] {
  if (reason === "insecure_context") {
    return []
  }

  if (reason === "unsupported") {
    return ["建议换用 Chrome 或 Safari 浏览器"]
  }

  if (reason === "permission_denied" || permission === "denied") {
    return [
      "浏览器弹出提示时，点「允许」",
      "如果之前点过拒绝：点地址栏左侧图标，把「位置」改成允许",
      "同时确认系统定位服务已打开，并尽量关闭 VPN",
    ]
  }

  if (reason === "position_unavailable" || reason === "timeout" || reason === "unknown") {
    return [
      "打开系统定位服务（macOS：系统设置 → 隐私与安全性 → 定位服务），并允许当前浏览器使用",
      "本页地址栏将「位置」设为允许",
      "关闭 VPN / 代理后再点「重新获取定位」（VPN 常会导致电脑端定位失败）",
      "仍失败时请改用手机浏览器打卡（手机有 GPS，更稳定）",
    ]
  }

  return ["点「重新获取定位」再试一次"]
}

function readBrowserPosition(options: PositionOptions): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
      },
      (error) => {
        const reason = mapBrowserErrorCode(error.code)
        reject(new GeolocationError(reason, buildBrowserErrorMessage(reason)))
      },
      options,
    )
  })
}

/** 先高精度，失败后再试普通定位（电脑端依赖 Wi‑Fi；VPN 可能导致失败） */
export async function getCurrentPosition(options?: { highAccuracy?: boolean }): Promise<GeoPosition> {
  const insecureMessage = getInsecureContextMessage()
  if (insecureMessage) {
    return Promise.reject(new GeolocationError("insecure_context", insecureMessage))
  }

  if (!isGeolocationSupported()) {
    return Promise.reject(new GeolocationError("unsupported", "当前浏览器不支持定位，请换一个试试"))
  }

  const wantHighAccuracy = options?.highAccuracy ?? true

  if (wantHighAccuracy) {
    try {
      return await readBrowserPosition({
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      })
    } catch (error) {
      if (error instanceof GeolocationError && error.reason === "permission_denied") {
        throw error
      }
    }
  }

  return readBrowserPosition({
    enableHighAccuracy: false,
    timeout: 15000,
    maximumAge: 60_000,
  })
}
