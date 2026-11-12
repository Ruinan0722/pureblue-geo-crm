// 状态机/常量唯一权威源：geo-api/app/modules/contracts/status_catalog.py
import {
  PROJECT_HEALTH_META,
  PROJECT_NOTE_KIND_META,
  PROJECT_PLATFORM_OPTIONS,
  PROJECT_RISK_META,
  PROJECT_STAGE_META,
  PROJECT_TYPE_OPTIONS,
} from "@/modules/crm/lib/status-catalog.generated"
import type { ProjectStage } from "./types"

export {
  PROJECT_HEALTH_META,
  PROJECT_NOTE_KIND_META,
  PROJECT_PLATFORM_OPTIONS,
  PROJECT_RISK_META,
  PROJECT_STAGE_META,
  PROJECT_TYPE_OPTIONS,
}

export const ACTIVE_STAGES: ProjectStage[] = [
  "pending_start",
  "active",
  "paused",
]
