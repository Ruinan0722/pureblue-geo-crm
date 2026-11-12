export type IntakeBackupGeoVariant = "overseas" | "domestic"

export type IntakeSubmissionPayload = {
  data: object
  status: "submitted"
  inviteToken: string
}

export type LocalSaveResponse = {
  saved: true
  localSubmissionId: string
}
