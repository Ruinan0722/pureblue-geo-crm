import { emptyForm, type GeoFormData } from "./form-schema"
import {
  DOMESTIC_AI_PLATFORM_OPTIONS,
  DOMESTIC_OPTIMIZATION_GOALS,
  DOMESTIC_OPTIMIZE_PERIODS,
  REQUEST_GEO_SOURCE_META,
} from "@/modules/crm/lib/status-catalog.generated"

/** 填报门户变体：海外 GEO / 国内 GEO（同域不同路径） */
export type IntakeGeoVariant = "overseas" | "domestic"

export { DOMESTIC_AI_PLATFORM_OPTIONS, DOMESTIC_OPTIMIZATION_GOALS, DOMESTIC_OPTIMIZE_PERIODS }

export function isDomesticVariant(variant: IntakeGeoVariant | undefined): boolean {
  return variant === "domestic"
}

export function isDomesticFormData(data: GeoFormData | null | undefined): boolean {
  if (!data) return false
  if (data.importMeta?.source === REQUEST_GEO_SOURCE_META.domestic.feishuSource) return true
  if (data.optimizePeriod || data.expectedStartDate) return true
  return false
}

export function emptyDomesticForm(): GeoFormData {
  const base = emptyForm()
  return {
    ...base,
    regions: [{ id: "r1", country: "CN", language: "zh" }],
    goals: [],
    optimizePeriod: "",
    optimizePeriodCustom: "",
    expectedStartDate: "",
    brandCompetitors: [""],
    strengthMarket: "",
    strengthTech: "",
    strengthBrand: "",
    strengthEcosystem: "",
    strengthOther: "",
  }
}

export function emptyFormForVariant(variant: IntakeGeoVariant = "overseas"): GeoFormData {
  return variant === "domestic" ? emptyDomesticForm() : emptyForm()
}

/** 提交前打标，供列表 geoSource / 编号前缀识别 */
export function stampGeoVariant(form: GeoFormData, variant: IntakeGeoVariant): GeoFormData {
  const source = REQUEST_GEO_SOURCE_META[variant].feishuSource
  return {
    ...form,
    importMeta: {
      ...(form.importMeta ?? {}),
      source,
    },
  }
}

export function intakeVariantDraftSuffix(variant: IntakeGeoVariant): string {
  return variant === "domestic" ? ":cn" : ":ov"
}

export function domesticPeriodLabel(form: GeoFormData): string {
  if (form.optimizePeriod === "custom") {
    return form.optimizePeriodCustom?.trim() || "自定义"
  }
  const hit = DOMESTIC_OPTIMIZE_PERIODS.find((p) => p.value === form.optimizePeriod)
  return hit?.label ?? "—"
}
