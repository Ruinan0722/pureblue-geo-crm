/** 需求单跟进人展示：保留姓名用于历史回溯，离职额外标注。 */
export function formatRequestOwner(
  owner: string | null | undefined,
  employmentStatus?: "active" | "resigned" | null,
): string {
  const name = (owner || "").trim() || "未分配"
  if (employmentStatus === "resigned" && name !== "未分配") {
    return `${name}（已离职）`
  }
  return name
}
