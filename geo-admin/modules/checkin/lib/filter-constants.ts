import type { CheckinType } from "./types"

/** 筛选「全部」占位值（仅 UI，不传给 API） */
export const CHECKIN_FILTER_ALL = "__all__" as const

export interface CheckinTypeFilterOption {
  value: CheckinType
  label: string
}

/** 打卡类型筛选项：value 为存储/API 用的 code，label 仅用于展示 */
export const CHECKIN_TYPE_FILTER_OPTIONS: CheckinTypeFilterOption[] = [
  { value: "arrive", label: "到达打卡" },
  { value: "leave", label: "结束打卡" },
]

export function isCheckinType(value: string): value is CheckinType {
  return value === "arrive" || value === "leave"
}

export function checkinTypeLabel(type: CheckinType): string {
  return CHECKIN_TYPE_FILTER_OPTIONS.find((item) => item.value === type)?.label ?? type
}
