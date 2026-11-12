export function channelContractEndDate(start?: string | null, months?: number | null) {
  if (!start || !months || !Number.isInteger(months) || months < 1 || months > 1200) return ""
  const source = new Date(start + "T00:00:00Z")
  if (Number.isNaN(source.getTime())) return ""
  const target = new Date(source)
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + months)
  const last = new Date(target)
  last.setUTCMonth(last.getUTCMonth() + 1)
  last.setUTCDate(0)
  target.setUTCDate(Math.min(source.getUTCDate(), last.getUTCDate()))
  return target.toISOString().slice(0, 10)
}

export function channelContractStatus(status: string) {
  return status === "是" ? "已签订" : status === "准备签约" ? "待签订" : status === "走入库流程了" ? "入库中" : status
}
