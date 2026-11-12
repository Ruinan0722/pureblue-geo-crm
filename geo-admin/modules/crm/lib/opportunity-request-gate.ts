import type { OppStage } from "./crm-data"
export const MSG_OPP_NO_ROLLBACK_TO_CONTACT = "已离开「初步接触」后不可再回退至该阶段，请继续推进或标记输单"
/** 商机自身的阶段限制，与需求记录无关。 */
export function evaluateOpportunityStageGate(from: OppStage, to: OppStage, _legacyLinked?: unknown[]) {
  return to === "contact" && from !== "contact" ? { ok: false, message: MSG_OPP_NO_ROLLBACK_TO_CONTACT } : { ok: true }
}
