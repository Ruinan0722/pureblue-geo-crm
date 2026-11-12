/** 客户填报端：业务数据走 geo-api + MySQL */
export function isGeoApiMode(): boolean {
  return Boolean(process.env.GEO_API_URL?.trim())
}

export function assertGeoApiConfigured(caller: string): void {
  if (!isGeoApiMode()) {
    throw new Error(`${caller}: 请配置 GEO_API_URL 指向 geo-api（MySQL 为唯一数据源）。`)
  }
}
