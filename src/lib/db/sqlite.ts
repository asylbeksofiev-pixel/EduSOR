import "server-only";
import { createRequire } from "node:module";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type SqliteStatement = {
  run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
};

export type SqliteDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

export const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "edusor-data")
  : path.join(process.cwd(), "data");
export const STORAGE_DIR = path.join(DATA_DIR, "storage");
const DB_FILE = path.join(DATA_DIR, "edusor.sqlite");

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const derived = scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, "hex");
  return derived.length === keyBuf.length && timingSafeEqual(derived, keyBuf);
}

export function generateJoinCode(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export type RelationDef = {
  type: "m2o" | "o2m" | "o2o";
  target: string;
  localCol: string;
  targetCol: string;
  fkName?: string;
};

export const TABLE_PK: Record<string, string | string[]> = {
  auth_users: "id",
  profiles: "id",
  schools: "id",
  school_memberships: "id",
  academic_years: "id",
  subjects: "id",
  classes: "id",
  class_teachers: "id",
  class_enrollments: "id",
  invitations: "id",
  teacher_verification_requests: "id",
  question_bank_items: "id",
  assessments: "id",
  assessment_sections: "id",
  assessment_questions: "id",
  assessment_assignments: "id",
  assessment_snapshots: "id",
  assessment_snapshot_keys: ["snapshot_id", "question_id"],
  student_accommodations: "id",
  attempts: "id",
  answers: "id",
  submission_files: "id",
  question_scores: "answer_id",
  lockdown_events: "id",
  final_grades: "attempt_id",
  result_releases: "attempt_id",
  teacher_reviews: "id",
  grading_jobs: "id",
  grading_suggestions: "id",
  criterion_scores: "id",
  ocr_jobs: "id",
  ocr_transcriptions: "id",
  ai_explanations: "id",
  practice_questions: "id",
  ai_usage: "id",
  system_errors: "id",
  platform_settings: "key",
  notifications: "id",
  audit_events: "id",
  rate_limits: "key",
  ai_exam_checks: "id",
};

export const BOOLEAN_COLS: Record<string, Set<string>> = {
  profiles: new Set(["is_super_admin"]),
  schools: new Set(["is_active"]),
  academic_years: new Set(["is_current"]),
  question_bank_items: new Set(["is_shared"]),
  assessments: new Set([
    "shuffle_questions",
    "shuffle_options",
    "allow_navigation",
    "lockdown_mode",
    "show_correct_answers",
    "allow_ai_explanations",
    "allow_ai_followup",
    "allow_practice",
  ]),
  assessment_questions: new Set(["reveal_after_release", "ai_generated", "ai_uncertain"]),
  assessment_snapshot_keys: new Set(["reveal_after_release"]),
  answers: new Set(["flagged"]),
  question_scores: new Set(["needs_review"]),
  grading_suggestions: new Set(["needs_manual_review"]),
  ocr_transcriptions: new Set(["uncertain"]),
  ai_usage: new Set(["success"]),
};

export const JSON_COLS: Record<string, Set<string>> = {
  auth_users: new Set(["user_metadata", "app_metadata"]),
  question_bank_items: new Set(["content", "answer_key", "rubric"]),
  assessment_questions: new Set(["content", "answer_key", "rubric"]),
  assessment_snapshots: new Set(["sections", "questions"]),
  assessment_snapshot_keys: new Set(["answer_key", "rubric"]),
  attempts: new Set(["question_order", "option_orders"]),
  answers: new Set(["response"]),
  lockdown_events: new Set(["metadata"]),
  teacher_reviews: new Set(["criterion_scores"]),
  ocr_jobs: new Set(["result", "hints"]),
  ai_explanations: new Set(["messages"]),
  practice_questions: new Set(["content", "answer_key", "student_response"]),
  system_errors: new Set(["context"]),
  platform_settings: new Set(["value"]),
  notifications: new Set(["payload"]),
  audit_events: new Set(["metadata"]),
  ai_exam_checks: new Set(["tasks"]),
};

export const TABLE_RELATIONS: Record<string, RelationDef[]> = {
  profiles: [
    { type: "o2m", target: "school_memberships", localCol: "id", targetCol: "user_id" },
    { type: "o2m", target: "class_enrollments", localCol: "id", targetCol: "student_id" },
  ],
  schools: [
    { type: "o2m", target: "school_memberships", localCol: "id", targetCol: "school_id" },
    { type: "o2m", target: "classes", localCol: "id", targetCol: "school_id" },
    { type: "o2m", target: "subjects", localCol: "id", targetCol: "school_id" },
  ],
  school_memberships: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "user_id", targetCol: "id" },
  ],
  academic_years: [{ type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" }],
  subjects: [{ type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" }],
  classes: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "academic_years", localCol: "academic_year_id", targetCol: "id" },
    { type: "o2m", target: "class_enrollments", localCol: "id", targetCol: "class_id" },
    { type: "o2m", target: "class_teachers", localCol: "id", targetCol: "class_id" },
  ],
  class_teachers: [
    { type: "m2o", target: "classes", localCol: "class_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "teacher_id", targetCol: "id" },
    { type: "m2o", target: "subjects", localCol: "subject_id", targetCol: "id" },
  ],
  class_enrollments: [
    { type: "m2o", target: "classes", localCol: "class_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" },
  ],
  invitations: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "classes", localCol: "class_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "invited_by", targetCol: "id" },
  ],
  teacher_verification_requests: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "user_id", targetCol: "id", fkName: "teacher_verification_requests_user_id_fkey" },
    { type: "m2o", target: "profiles", localCol: "reviewed_by", targetCol: "id", fkName: "teacher_verification_requests_reviewed_by_fkey" },
  ],
  question_bank_items: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "owner_id", targetCol: "id" },
    { type: "m2o", target: "subjects", localCol: "subject_id", targetCol: "id" },
  ],
  assessments: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "created_by", targetCol: "id" },
    { type: "m2o", target: "subjects", localCol: "subject_id", targetCol: "id" },
    { type: "m2o", target: "classes", localCol: "class_id", targetCol: "id" },
    { type: "m2o", target: "assessment_snapshots", localCol: "current_snapshot_id", targetCol: "id", fkName: "assessments_snapshot_fk" },
    { type: "o2m", target: "assessment_assignments", localCol: "id", targetCol: "assessment_id" },
    { type: "o2m", target: "assessment_questions", localCol: "id", targetCol: "assessment_id" },
    { type: "o2m", target: "assessment_sections", localCol: "id", targetCol: "assessment_id" },
    { type: "o2m", target: "attempts", localCol: "id", targetCol: "assessment_id" },
    { type: "o2m", target: "final_grades", localCol: "id", targetCol: "assessment_id" },
  ],
  assessment_sections: [{ type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" }],
  assessment_questions: [
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
    { type: "m2o", target: "assessment_sections", localCol: "section_id", targetCol: "id" },
  ],
  assessment_assignments: [
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
    { type: "m2o", target: "classes", localCol: "class_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" },
  ],
  assessment_snapshots: [{ type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" }],
  assessment_snapshot_keys: [{ type: "m2o", target: "assessment_snapshots", localCol: "snapshot_id", targetCol: "id" }],
  student_accommodations: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" },
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
  ],
  attempts: [
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
    { type: "m2o", target: "assessment_snapshots", localCol: "snapshot_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" },
    { type: "o2m", target: "question_scores", localCol: "id", targetCol: "attempt_id" },
    { type: "o2m", target: "answers", localCol: "id", targetCol: "attempt_id" },
    { type: "o2o", target: "final_grades", localCol: "id", targetCol: "attempt_id" },
    { type: "o2o", target: "result_releases", localCol: "id", targetCol: "attempt_id" },
  ],
  answers: [
    { type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" },
    { type: "o2o", target: "question_scores", localCol: "id", targetCol: "answer_id" },
  ],
  submission_files: [{ type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" }],
  question_scores: [
    { type: "m2o", target: "answers", localCol: "answer_id", targetCol: "id" },
    { type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "approved_by", targetCol: "id" },
  ],
  lockdown_events: [
    { type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" },
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" },
  ],
  final_grades: [
    { type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" },
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "approved_by", targetCol: "id", fkName: "final_grades_approved_by_fkey" },
  ],
  result_releases: [
    { type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" },
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
  ],
  teacher_reviews: [
    { type: "m2o", target: "answers", localCol: "answer_id", targetCol: "id" },
    { type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "reviewer_id", targetCol: "id" },
  ],
  grading_jobs: [
    { type: "m2o", target: "attempts", localCol: "attempt_id", targetCol: "id" },
    { type: "m2o", target: "answers", localCol: "answer_id", targetCol: "id" },
  ],
  grading_suggestions: [
    { type: "m2o", target: "answers", localCol: "answer_id", targetCol: "id" },
    { type: "o2m", target: "criterion_scores", localCol: "id", targetCol: "suggestion_id" },
  ],
  criterion_scores: [{ type: "m2o", target: "grading_suggestions", localCol: "suggestion_id", targetCol: "id" }],
  ocr_jobs: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "created_by", targetCol: "id" },
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
  ],
  ocr_transcriptions: [
    { type: "m2o", target: "ocr_jobs", localCol: "job_id", targetCol: "id" },
    { type: "m2o", target: "submission_files", localCol: "submission_file_id", targetCol: "id" },
  ],
  ai_explanations: [
    { type: "m2o", target: "answers", localCol: "answer_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" },
  ],
  practice_questions: [{ type: "m2o", target: "profiles", localCol: "student_id", targetCol: "id" }],
  ai_usage: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "user_id", targetCol: "id" },
  ],
  audit_events: [
    { type: "m2o", target: "profiles", localCol: "actor_id", targetCol: "id" },
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
  ],
  notifications: [{ type: "m2o", target: "profiles", localCol: "user_id", targetCol: "id" }],
  ai_exam_checks: [
    { type: "m2o", target: "schools", localCol: "school_id", targetCol: "id" },
    { type: "m2o", target: "profiles", localCol: "teacher_id", targetCol: "id" },
    { type: "m2o", target: "assessments", localCol: "assessment_id", targetCol: "id" },
  ],
};

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_confirmed_at TEXT,
  user_metadata TEXT NOT NULL DEFAULT '{}',
  app_metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  locale TEXT NOT NULL DEFAULT 'ru',
  login TEXT UNIQUE,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  region TEXT,
  join_code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS school_memberships (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  student_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(school_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS academic_years (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(school_id, name)
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name_ru TEXT NOT NULL,
  name_kk TEXT NOT NULL,
  code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(school_id, name_ru)
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id TEXT REFERENCES academic_years(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  grade INTEGER NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(school_id, academic_year_id, name)
);

CREATE TABLE IF NOT EXISTS class_teachers (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_enrollments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(class_id, student_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_verification_requests (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_bank_items (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  grade INTEGER,
  topic TEXT,
  learning_objective TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  answer_key TEXT NOT NULL DEFAULT '{}',
  rubric TEXT,
  explanation TEXT,
  points REAL NOT NULL DEFAULT 1,
  is_shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sor',
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  grade INTEGER,
  class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  instructions TEXT,
  starts_at TEXT,
  due_at TEXT,
  duration_minutes INTEGER,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  shuffle_questions INTEGER NOT NULL DEFAULT 0,
  shuffle_options INTEGER NOT NULL DEFAULT 0,
  allow_navigation INTEGER NOT NULL DEFAULT 1,
  lockdown_mode INTEGER NOT NULL DEFAULT 0,
  release_mode TEXT NOT NULL DEFAULT 'manual',
  show_correct_answers INTEGER NOT NULL DEFAULT 1,
  allow_ai_explanations INTEGER NOT NULL DEFAULT 1,
  allow_ai_followup INTEGER NOT NULL DEFAULT 1,
  allow_practice INTEGER NOT NULL DEFAULT 1,
  grading_profile TEXT NOT NULL DEFAULT 'balanced',
  current_snapshot_id TEXT,
  source_job_id TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_sections (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assessment_questions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES assessment_sections(id) ON DELETE SET NULL,
  bank_item_id TEXT REFERENCES question_bank_items(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  answer_key TEXT NOT NULL DEFAULT '{}',
  rubric TEXT,
  explanation TEXT,
  points REAL NOT NULL DEFAULT 1,
  topic TEXT,
  learning_objective TEXT,
  reveal_after_release INTEGER NOT NULL DEFAULT 1,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  ai_uncertain INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_assignments (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_snapshots (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT,
  sections TEXT NOT NULL DEFAULT '[]',
  questions TEXT NOT NULL,
  total_points REAL NOT NULL,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(assessment_id, version)
);

CREATE TABLE IF NOT EXISTS assessment_snapshot_keys (
  snapshot_id TEXT NOT NULL REFERENCES assessment_snapshots(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  type TEXT NOT NULL,
  points REAL NOT NULL,
  answer_key TEXT NOT NULL,
  rubric TEXT,
  explanation TEXT,
  reveal_after_release INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(snapshot_id, question_id)
);

CREATE TABLE IF NOT EXISTS student_accommodations (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE CASCADE,
  extra_minutes INTEGER NOT NULL DEFAULT 0,
  extra_attempts INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES assessment_snapshots(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  grading_status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT NOT NULL,
  deadline_at TEXT,
  submitted_at TEXT,
  submit_reason TEXT,
  question_order TEXT NOT NULL DEFAULT '[]',
  option_orders TEXT NOT NULL DEFAULT '{}',
  current_question_id TEXT,
  answered_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  lockdown_event_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(assessment_id, student_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT '{}',
  client_seq INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS submission_files (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_scores (
  answer_id TEXT PRIMARY KEY REFERENCES answers(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  max_points REAL NOT NULL,
  auto_points REAL,
  auto_result TEXT NOT NULL DEFAULT 'pending',
  final_points REAL,
  final_result TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  teacher_feedback TEXT,
  approved_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lockdown_events (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  client_time TEXT,
  duration_ms INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS final_grades (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  max_score REAL NOT NULL,
  percent REAL NOT NULL,
  feedback TEXT,
  approved_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  approved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS result_releases (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  released_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  released_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teacher_reviews (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  previous_points REAL,
  points REAL NOT NULL,
  criterion_scores TEXT,
  feedback TEXT,
  suggestion_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grading_jobs (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  tries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TEXT,
  requested_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grading_suggestions (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES grading_jobs(id) ON DELETE SET NULL,
  suggested_score REAL NOT NULL,
  max_score REAL NOT NULL,
  explanation TEXT NOT NULL,
  feedback TEXT NOT NULL,
  confidence REAL NOT NULL,
  needs_manual_review INTEGER NOT NULL,
  profile TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS criterion_scores (
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL REFERENCES grading_suggestions(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL,
  title TEXT NOT NULL,
  score REAL NOT NULL,
  max_score REAL NOT NULL,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS ocr_jobs (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  tries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TEXT,
  page_count INTEGER,
  result TEXT,
  hints TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ocr_transcriptions (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  submission_file_id TEXT REFERENCES submission_files(id) ON DELETE CASCADE,
  page INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL,
  text TEXT NOT NULL,
  uncertain INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_explanations (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(answer_id, locale)
);

CREATE TABLE IF NOT EXISTS practice_questions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_answer_id TEXT REFERENCES answers(id) ON DELETE SET NULL,
  topic TEXT,
  locale TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  answer_key TEXT NOT NULL,
  explanation TEXT,
  student_response TEXT,
  checked_result TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_errors (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  link TEXT,
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE SET NULL,
  actor_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_exam_checks (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  student_name TEXT,
  kind TEXT NOT NULL DEFAULT 'sor',
  subject TEXT,
  grade INTEGER,
  title TEXT NOT NULL,
  source_text TEXT NOT NULL,
  rubric_text TEXT,
  total_score REAL NOT NULL,
  max_score REAL NOT NULL,
  percent REAL NOT NULL,
  mark INTEGER NOT NULL,
  summary TEXT NOT NULL,
  feedback TEXT NOT NULL,
  tasks TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL
);
`;

declare global {
  var __edusorSqliteDb: SqliteDb | undefined;
}

export function getSqliteDb(): SqliteDb {
  if (globalThis.__edusorSqliteDb) return globalThis.__edusorSqliteDb;
  const targetFile = process.env.EDUSOR_SQLITE_PATH || DB_FILE;
  if (targetFile !== ":memory:") {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
  }
  const req = createRequire(import.meta.url);
  const { DatabaseSync } = req("node:sqlite") as { DatabaseSync: new (p: string) => SqliteDb };
  const db = new DatabaseSync(targetFile);
  db.exec(SCHEMA_SQL);
  ensureSeeded(db);
  globalThis.__edusorSqliteDb = db;
  return db;
}

export function resetSqliteDbForTests(): void {
  if (globalThis.__edusorSqliteDb) {
    try {
      globalThis.__edusorSqliteDb.close();
    } catch {
      // ignore
    }
    globalThis.__edusorSqliteDb = undefined;
  }
}

function ensureSeeded(db: SqliteDb) {
  const existing = db.prepare("SELECT COUNT(*) AS cnt FROM auth_users").get() as { cnt: number } | undefined;
  if (existing && Number(existing.cnt) > 0) return;

  const now = new Date().toISOString();
  const pwHash = hashPassword("EduSor-dev-2026");
  const domain = process.env.STUDENT_LOGIN_EMAIL_DOMAIN || "students.edusor.local";

  const createUser = (email: string, fullName: string, opts: { login?: string; superAdmin?: boolean; locale?: string } = {}) => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO auth_users (id, email, password_hash, email_confirmed_at, user_metadata, app_metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      email.toLowerCase(),
      pwHash,
      now,
      JSON.stringify({ full_name: fullName, locale: opts.locale ?? "ru" }),
      JSON.stringify(opts.login ? { login: opts.login } : {}),
      now,
    );
    db.prepare(
      `INSERT INTO profiles (id, full_name, email, locale, login, is_super_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, fullName, email.toLowerCase(), opts.locale ?? "ru", opts.login ?? null, opts.superAdmin ? 1 : 0, now, now);
    return id;
  };

  db.exec("BEGIN");
  try {
    createUser("superadmin@edusor.local", "Администратор Платформы", { superAdmin: true });

    const s1 = randomUUID();
    db.prepare(`INSERT INTO schools (id, name, city, region, join_code, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(
      s1,
      "Школа-гимназия № 1",
      "Астана",
      "Астана",
      "GYM1AST",
      now,
      now,
    );

    const year1 = randomUUID();
    db.prepare(`INSERT INTO academic_years (id, school_id, name, starts_on, ends_on, is_current, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`).run(
      year1,
      s1,
      "2026–2027",
      "2026-09-01",
      "2027-05-25",
      now,
    );

    const admin1 = createUser("admin@gym1.edusor.local", "Сейтказиева Динара Маратовна");
    db.prepare(`INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'school_admin', 'active', ?)`).run(
      randomUUID(),
      s1,
      admin1,
      now,
    );

    const t1 = createUser("teacher@gym1.edusor.local", "Ахметов Ерлан Серикович");
    const t2 = createUser("teacher2@gym1.edusor.local", "Иванова Ольга Петровна", { locale: "kk" });
    db.prepare(`INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'teacher', 'active', ?)`).run(randomUUID(), s1, t1, now);
    db.prepare(`INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'teacher', 'active', ?)`).run(randomUUID(), s1, t2, now);

    const subjMap: Record<string, string> = {};
    for (const [ru, kk, code] of [
      ["Математика", "Математика", "MATH"],
      ["Алгебра", "Алгебра", "ALG"],
      ["Физика", "Физика", "PHYS"],
      ["Казахский язык и литература", "Қазақ тілі мен әдебиеті", "KAZ"],
      ["Биология", "Биология", "BIO"],
      ["Информатика", "Информатика", "INF"],
    ]) {
      const id = randomUUID();
      subjMap[code!] = id;
      db.prepare(`INSERT INTO subjects (id, school_id, name_ru, name_kk, code, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, s1, ru, kk, code, now);
    }

    const clsMap: Record<string, string> = {};
    for (const [name, grade, jcode] of [
      ["7А", 7, "7AMATH"],
      ["7Б", 7, "7BMATH"],
      ["9А", 9, "9APHYS"],
    ] as const) {
      const id = randomUUID();
      clsMap[name] = id;
      db.prepare(`INSERT INTO classes (id, school_id, academic_year_id, name, grade, join_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        s1,
        year1,
        name,
        grade,
        jcode,
        now,
      );
    }

    for (const [cName, tId, sCode] of [
      ["7А", t1, "MATH"],
      ["7А", t1, "ALG"],
      ["7Б", t1, "MATH"],
      ["9А", t1, "PHYS"],
      ["7А", t2, "KAZ"],
      ["9А", t2, "BIO"],
    ] as const) {
      db.prepare(`INSERT INTO class_teachers (id, class_id, teacher_id, subject_id, created_at) VALUES (?, ?, ?, ?, ?)`).run(
        randomUUID(),
        clsMap[cName],
        tId,
        subjMap[sCode],
        now,
      );
    }

    const studentIds: Record<string, string> = {};
    let idx = 1;
    for (const [list, cName] of [
      [
        [
          ["aidar.s", "Сапаров Айдар"],
          ["aruzhan.k", "Касымова Аружан"],
          ["daniyar.n", "Нурланов Данияр"],
          ["madina.t", "Тулегенова Мадина"],
          ["timur.b", "Бекенов Тимур"],
          ["amina.zh", "Жумабаева Амина"],
        ],
        "7А",
      ],
      [
        [
          ["alikhan.m", "Мухамеджанов Алихан"],
          ["dana.o", "Омарова Дана"],
          ["sultan.r", "Рахимов Султан"],
        ],
        "7Б",
      ],
      [
        [
          ["erasyl.a", "Абенов Ерасыл"],
          ["zarina.s", "Сейтжанова Зарина"],
        ],
        "9А",
      ],
    ] as const) {
      for (const [login, fullName] of list) {
        const uid = createUser(`${login}@${domain}`, fullName, { login });
        studentIds[login] = uid;
        db.prepare(`INSERT INTO school_memberships (id, school_id, user_id, role, status, student_code, created_at) VALUES (?, ?, ?, 'student', 'active', ?, ?)`).run(
          randomUUID(),
          s1,
          uid,
          String(idx++).padStart(4, "0"),
          now,
        );
        db.prepare(`INSERT INTO class_enrollments (id, class_id, student_id, created_at) VALUES (?, ?, ?, ?)`).run(randomUUID(), clsMap[cName], uid, now);
      }
    }

    // Second school for tenant isolation
    const s2 = randomUUID();
    db.prepare(`INSERT INTO schools (id, name, city, region, join_code, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(
      s2,
      "Лицей № 2",
      "Алматы",
      "Алматы",
      "LYC2ALM",
      now,
      now,
    );
    const t3 = createUser("teacher@lyc2.edusor.local", "Ким Сергей Александрович");
    db.prepare(`INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'teacher', 'active', ?)`).run(randomUUID(), s2, t3, now);
    const c2 = randomUUID();
    db.prepare(`INSERT INTO classes (id, school_id, academic_year_id, name, grade, join_code, created_at) VALUES (?, ?, NULL, '8В', 8, '8VLYC2', ?)`).run(c2, s2, now);
    db.prepare(`INSERT INTO class_teachers (id, class_id, teacher_id, subject_id, created_at) VALUES (?, ?, ?, NULL, ?)`).run(randomUUID(), c2, t3, now);
    const st2 = createUser(`lyc2.student@${domain}`, "Ли Виктория", { login: "lyc2.student" });
    db.prepare(`INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'student', 'active', ?)`).run(randomUUID(), s2, st2, now);
    db.prepare(`INSERT INTO class_enrollments (id, class_id, student_id, created_at) VALUES (?, ?, ?, ?)`).run(randomUUID(), c2, st2, now);

    // Sample Published СОР №1
    const a1 = randomUUID();
    const snap1 = randomUUID();
    const startsAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const dueAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    db.prepare(
      `INSERT INTO assessments (
        id, school_id, created_by, title, kind, subject_id, grade, class_id, status,
        instructions, starts_at, due_at, duration_minutes, max_attempts,
        shuffle_questions, shuffle_options, allow_navigation, lockdown_mode,
        release_mode, show_correct_answers, allow_ai_explanations, allow_ai_followup, allow_practice,
        grading_profile, current_snapshot_id, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'sor', ?, 7, ?, 'published', ?, ?, ?, 40, 1, 0, 0, 1, 0, 'manual', 1, 1, 1, 1, 'balanced', ?, ?, ?, ?)`,
    ).run(
      a1,
      s1,
      t1,
      "СОР №1 по разделу «Линейные уравнения с одной переменной»",
      subjMap.MATH,
      clsMap["7А"],
      "Внимательно прочитайте условия заданий. Для развёрнутого задания запишите полное решение по шагам.",
      startsAt,
      dueAt,
      snap1,
      now,
      now,
      now,
    );

    const questions = [
      {
        id: randomUUID(),
        position: 1,
        type: "single_choice",
        content: {
          prompt: "Решите уравнение $2x + 6 = 0$.",
          images: [],
          options: [
            { id: "a1", text: "$x = 3$" },
            { id: "b2", text: "$x = -3$" },
            { id: "c3", text: "$x = 6$" },
            { id: "d4", text: "$x = -6$" },
          ],
        },
        answer_key: { correct: "b2" },
        rubric: null,
        points: 1,
        topic: "Линейные уравнения",
        learning_objective: "7.2.2.1 решать линейные уравнения",
        explanation: "$2x = -6 \\Rightarrow x = -3$.",
      },
      {
        id: randomUUID(),
        position: 2,
        type: "multiple_choice",
        content: {
          prompt: "Какие из чисел являются корнями уравнения $|x| = 4$?",
          images: [],
          options: [
            { id: "a", text: "$4$" },
            { id: "b", text: "$-4$" },
            { id: "c", text: "$0$" },
            { id: "d", text: "$16$" },
          ],
        },
        answer_key: { correct: ["a", "b"], scoring: "partial" },
        rubric: null,
        points: 2,
        topic: "Модуль числа",
        learning_objective: "7.2.2.2 решать уравнения с модулем",
        explanation: "Расстояние от нуля равно 4 для чисел $4$ и $-4$.",
      },
      {
        id: randomUUID(),
        position: 3,
        type: "numeric",
        content: { prompt: "Найдите корень уравнения $3(x - 2) = 4{,}5$.", images: [], unit: "" },
        answer_key: { value: 3.5, tolerance: 0 },
        rubric: null,
        points: 2,
        topic: "Раскрытие скобок",
        learning_objective: "7.2.2.1 решать линейные уравнения",
        explanation: "$3x - 6 = 4{,}5 \\Rightarrow 3x = 10{,}5 \\Rightarrow x = 3{,}5$.",
      },
      {
        id: randomUUID(),
        position: 4,
        type: "essay",
        content: {
          prompt: "Составьте текстовую задачу, которая решается с помощью уравнения $x + (x + 5) = 25$, и запишите полное решение.",
          images: [],
          minWords: 12,
          maxWords: null,
        },
        answer_key: {
          referenceAnswer:
            "Пример задачи: В двух коробках 25 карандашей, причём во второй на 5 больше, чем в первой. Сколько карандашей в каждой коробке? Решение: $x + x + 5 = 25 \\Rightarrow 2x = 20 \\Rightarrow x = 10$ (в первой), $10 + 5 = 15$ (во второй).",
        },
        rubric: {
          criteria: [
            { id: "c1", title: "Составлена корректная математическая модель / условие", description: "Условие задачи точно соответствует уравнению x + (x + 5) = 25", maxPoints: 2 },
            { id: "c2", title: "Выполнено верное решение и записан ответ", description: "Верно приведены подобные слагаемые, найдены оба значения (10 и 15)", maxPoints: 3 },
          ],
        },
        points: 5,
        topic: "Текстовые задачи",
        learning_objective: "7.4.2.1 решать текстовые задачи с помощью уравнений",
        explanation: null,
      },
    ];

    for (const q of questions) {
      db.prepare(
        `INSERT INTO assessment_questions (
          id, assessment_id, position, type, content, answer_key, rubric, explanation,
          points, topic, learning_objective, reveal_after_release, ai_generated, ai_uncertain, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`,
      ).run(
        q.id,
        a1,
        q.position,
        q.type,
        JSON.stringify(q.content),
        JSON.stringify(q.answer_key),
        q.rubric ? JSON.stringify(q.rubric) : null,
        q.explanation,
        q.points,
        q.topic,
        q.learning_objective,
        now,
        now,
      );
    }

    db.prepare(`INSERT INTO assessment_assignments (id, assessment_id, class_id, student_id, created_at) VALUES (?, ?, ?, NULL, ?)`).run(
      randomUUID(),
      a1,
      clsMap["7А"],
      now,
    );

    const snapQuestions = questions.map((q) => ({
      id: q.id,
      sectionId: null,
      position: q.position,
      type: q.type,
      content: q.content,
      points: q.points,
      topic: q.topic,
      learningObjective: q.learning_objective,
    }));

    db.prepare(
      `INSERT INTO assessment_snapshots (id, assessment_id, version, title, instructions, sections, questions, total_points, created_by, created_at)
       VALUES (?, ?, 1, ?, ?, '[]', ?, 10, ?, ?)`,
    ).run(
      snap1,
      a1,
      "СОР №1 по разделу «Линейные уравнения с одной переменной»",
      "Внимательно прочитайте условия заданий. Для развёрнутого задания запишите полное решение по шагам.",
      JSON.stringify(snapQuestions),
      t1,
      now,
    );

    for (const q of questions) {
      db.prepare(
        `INSERT INTO assessment_snapshot_keys (snapshot_id, question_id, type, points, answer_key, rubric, explanation, reveal_after_release)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(snap1, q.id, q.type, q.points, JSON.stringify(q.answer_key), q.rubric ? JSON.stringify(q.rubric) : null, q.explanation);
    }

    // Create a submitted attempt by Aruzhan waiting for Gemini AI / Teacher Review!
    const attAruzhan = randomUUID();
    const qOrder = questions.map((q) => q.id);
    db.prepare(
      `INSERT INTO attempts (
        id, assessment_id, snapshot_id, student_id, attempt_no, status, grading_status,
        started_at, deadline_at, submitted_at, submit_reason, question_order, option_orders,
        current_question_id, answered_count, last_seen_at, lockdown_event_count, created_at
      ) VALUES (?, ?, ?, ?, 1, 'submitted', 'needs_review', ?, NULL, ?, 'manual', ?, '{}', ?, 4, ?, 0, ?)`,
    ).run(attAruzhan, a1, snap1, studentIds["aruzhan.k"], startsAt, now, JSON.stringify(qOrder), qOrder[3], now, now);

    const aruzhanResponses: [number, Record<string, unknown>, number | null, string, number | null, string | null, number][] = [
      [0, { choice: "b2" }, 1, "correct", 1, "correct", 0],
      [1, { choices: ["a", "b"] }, 2, "correct", 2, "correct", 0],
      [2, { value: "3.5" }, 2, "correct", 2, "correct", 0],
      [
        3,
        {
          text: "На двух полках стоит 25 книг. На второй полке на 5 книг больше, чем на первой. Пусть на первой полке x книг, тогда на второй (x + 5) книг. Составим уравнение: x + (x + 5) = 25, 2x + 5 = 25, 2x = 20, x = 10. Значит на первой полке 10 книг, а на второй 15 книг.",
        },
        null,
        "pending",
        null,
        null,
        1,
      ],
    ];

    for (const [qi, resp, autoPts, autoRes, finPts, finRes, needsRev] of aruzhanResponses) {
      const q = questions[qi]!;
      const ansId = randomUUID();
      db.prepare(`INSERT INTO answers (id, attempt_id, question_id, response, client_seq, flagged, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?)`).run(
        ansId,
        attAruzhan,
        q.id,
        JSON.stringify(resp),
        now,
        now,
      );
      db.prepare(
        `INSERT INTO question_scores (answer_id, attempt_id, question_id, max_points, auto_points, auto_result, final_points, final_result, needs_review, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ansId, attAruzhan, q.id, q.points, autoPts, autoRes, finPts, finRes, needsRev, now);
    }

    // Sample Published СОЧ №1
    const a2 = randomUUID();
    const snap2 = randomUUID();
    const qSoch1 = randomUUID();
    const qSoch2 = randomUUID();
    db.prepare(
      `INSERT INTO assessments (
        id, school_id, created_by, title, kind, subject_id, grade, class_id, status,
        instructions, starts_at, due_at, duration_minutes, max_attempts,
        shuffle_questions, shuffle_options, allow_navigation, lockdown_mode,
        release_mode, show_correct_answers, allow_ai_explanations, allow_ai_followup, allow_practice,
        grading_profile, current_snapshot_id, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'soch', ?, 7, ?, 'published', ?, ?, ?, 45, 1, 0, 0, 1, 1, 'manual', 1, 1, 1, 1, 'balanced', ?, ?, ?, ?)`,
    ).run(
      a2,
      s1,
      t1,
      "СОЧ за 1 четверть по Алгебре",
      subjMap.ALG,
      clsMap["7А"],
      "Суммативное оценивание за четверть. Время выполнения — 45 минут.",
      startsAt,
      dueAt,
      snap2,
      now,
      now,
      now,
    );

    const sochQuestions = [
      {
        id: qSoch1,
        position: 1,
        type: "single_choice",
        content: {
          prompt: "Упростите выражение $a^5 \\cdot a^3 : a^2$.",
          images: [],
          options: [
            { id: "s1", text: "$a^6$" },
            { id: "s2", text: "$a^{10}$" },
            { id: "s3", text: "$a^8$" },
            { id: "s4", text: "$a^4$" },
          ],
        },
        answer_key: { correct: "s1" },
        rubric: null,
        points: 2,
        topic: "Степень с натуральным показателем",
      },
      {
        id: qSoch2,
        position: 2,
        type: "essay",
        content: {
          prompt: "Докажите, что значение выражения $9^4 - 3^6$ кратно $8$. Запишите подробное преобразование.",
          images: [],
          minWords: 8,
          maxWords: null,
        },
        answer_key: {
          referenceAnswer: "$9^4 - 3^6 = (3^2)^4 - 3^6 = 3^8 - 3^6 = 3^6(3^2 - 1) = 3^6 \\cdot 8$. Так как один из множителей равен 8, произведение делится на 8.",
        },
        rubric: {
          criteria: [
            { id: "sc1", title: "Приведение к одному основанию степени", description: "Записано 9^4 = 3^8", maxPoints: 2 },
            { id: "sc2", title: "Вынесение общего множителя и вывод", description: "Получено 3^6 * 8 и сделан обоснованный вывод о кратности 8", maxPoints: 3 },
          ],
        },
        points: 5,
        topic: "Свойства степеней",
      },
    ];

    for (const q of sochQuestions) {
      db.prepare(
        `INSERT INTO assessment_questions (
          id, assessment_id, position, type, content, answer_key, rubric, explanation,
          points, topic, learning_objective, reveal_after_release, ai_generated, ai_uncertain, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 1, 0, 0, ?, ?)`,
      ).run(q.id, a2, q.position, q.type, JSON.stringify(q.content), JSON.stringify(q.answer_key), q.rubric ? JSON.stringify(q.rubric) : null, q.points, q.topic, now, now);
    }

    db.prepare(`INSERT INTO assessment_assignments (id, assessment_id, class_id, student_id, created_at) VALUES (?, ?, ?, NULL, ?)`).run(
      randomUUID(),
      a2,
      clsMap["7А"],
      now,
    );

    db.prepare(
      `INSERT INTO assessment_snapshots (id, assessment_id, version, title, instructions, sections, questions, total_points, created_by, created_at)
       VALUES (?, ?, 1, ?, ?, '[]', ?, 7, ?, ?)`,
    ).run(
      snap2,
      a2,
      "СОЧ за 1 четверть по Алгебре",
      "Суммативное оценивание за четверть. Время выполнения — 45 минут.",
      JSON.stringify(
        sochQuestions.map((q) => ({
          id: q.id,
          sectionId: null,
          position: q.position,
          type: q.type,
          content: q.content,
          points: q.points,
          topic: q.topic,
          learningObjective: null,
        })),
      ),
      t1,
      now,
    );

    for (const q of sochQuestions) {
      db.prepare(
        `INSERT INTO assessment_snapshot_keys (snapshot_id, question_id, type, points, answer_key, rubric, explanation, reveal_after_release)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 1)`,
      ).run(snap2, q.id, q.type, q.points, JSON.stringify(q.answer_key), q.rubric ? JSON.stringify(q.rubric) : null);
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
