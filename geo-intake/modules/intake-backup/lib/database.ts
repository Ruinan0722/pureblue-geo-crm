import "server-only"

import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import type { IntakeBackupGeoVariant, IntakeSubmissionPayload } from "./types"

const DEFAULT_DATABASE_PATH = path.join(process.cwd(), "data", "intake-submissions.sqlite3")

let database: Database.Database | null = null

function databasePath(): string {
  return process.env.INTAKE_BACKUP_DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH
}

function getDatabase(): Database.Database {
  if (database) return database

  const filename = databasePath()
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
  database = new Database(filename)
  database.pragma("journal_mode = WAL")
  database.pragma("synchronous = FULL")
  database.pragma("busy_timeout = 5000")
  database.exec(`
    CREATE TABLE IF NOT EXISTS intake_submissions (
      id TEXT PRIMARY KEY,
      geo_variant TEXT NOT NULL CHECK (geo_variant IN ('overseas', 'domestic')),
      request_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `)
  return database
}

function geoVariant(payload: IntakeSubmissionPayload): IntakeBackupGeoVariant {
  const data = payload.data as {
    geoVariant?: unknown
    importMeta?: { source?: unknown } | null
  }
  const source = data.importMeta
  if (
    source &&
    typeof source === "object" &&
    "source" in source &&
    source.source === "国内GEO需求"
  ) {
    return "domestic"
  }
  if (data.geoVariant === "domestic") return "domestic"
  return "overseas"
}

export function saveIntakeSubmission(payload: IntakeSubmissionPayload): string {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  getDatabase()
    .prepare(`
      INSERT INTO intake_submissions (id, geo_variant, request_json, created_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(id, geoVariant(payload), JSON.stringify(payload), now)
  return id
}
