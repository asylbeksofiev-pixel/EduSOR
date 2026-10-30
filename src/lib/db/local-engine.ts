import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { serverEnv } from "@/lib/env.server";
import { LOCAL_SESSION_COOKIE, signToken, verifyToken, type LocalSessionPayload } from "./session-token";
import {
  BOOLEAN_COLS,
  JSON_COLS,
  STORAGE_DIR,
  TABLE_PK,
  TABLE_RELATIONS,
  generateJoinCode,
  getSqliteDb,
  hashPassword,
  verifyPassword,
  type RelationDef,
  type SqliteDb,
} from "./sqlite";

type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  set: (name: string, value: string, options?: Record<string, unknown>) => void;
};

type PostgrestError = { message: string; code?: string; details?: string; hint?: string };
type QueryResult<T = unknown> = { data: T | null; error: PostgrestError | null; count?: number | null };

function err(message: string, code = "P0001"): PostgrestError {
  return { message, code };
}

function deserializeRow(table: string, raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const bools = BOOLEAN_COLS[table];
  const jsons = JSON_COLS[table];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) {
      out[k] = null;
    } else if (bools?.has(k)) {
      out[k] = Boolean(Number(v));
    } else if (jsons?.has(k) && typeof v === "string") {
      try {
        out[k] = JSON.parse(v);
      } catch {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function serializeValue(table: string, col: string, val: unknown): unknown {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (BOOLEAN_COLS[table]?.has(col)) return val ? 1 : 0;
  if (JSON_COLS[table]?.has(col) || typeof val === "object") return JSON.stringify(val);
  return val;
}

type SelectField =
  | { kind: "star" }
  | { kind: "col"; name: string; alias: string }
  | { kind: "rel"; alias: string; target: string; fkHint: string | null; inner: boolean; sub: string };

function splitTopLevel(spec: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(spec.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = spec.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseSelect(spec: string): SelectField[] {
  const tokens = splitTopLevel(spec || "*");
  const out: SelectField[] = [];
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok === "*") {
      out.push({ kind: "star" });
      continue;
    }
    const paren = tok.indexOf("(");
    if (paren > 0 && tok.endsWith(")")) {
      const head = tok.slice(0, paren).trim();
      const sub = tok.slice(paren + 1, -1).trim();
      let alias = head;
      let rest = head;
      const colon = head.indexOf(":");
      if (colon > 0) {
        alias = head.slice(0, colon).trim();
        rest = head.slice(colon + 1).trim();
      }
      let target = rest;
      let inner = false;
      let fkHint: string | null = null;
      const bangParts = rest.split("!").map((s) => s.trim());
      if (bangParts.length > 1) {
        target = bangParts[0]!;
        for (const bp of bangParts.slice(1)) {
          if (bp === "inner") inner = true;
          else if (bp) fkHint = bp;
        }
        if (colon < 0) alias = target;
      }
      out.push({ kind: "rel", alias, target, fkHint, inner, sub });
    } else {
      const colon = tok.indexOf(":");
      if (colon > 0) {
        out.push({ kind: "col", alias: tok.slice(0, colon).trim(), name: tok.slice(colon + 1).trim() });
      } else {
        out.push({ kind: "col", alias: tok, name: tok });
      }
    }
  }
  return out.length ? out : [{ kind: "star" }];
}

function findRelation(sourceTable: string, target: string, alias: string, fkHint: string | null): RelationDef | null {
  const rels = TABLE_RELATIONS[sourceTable] ?? [];
  if (fkHint) {
    const exactFk = rels.find((r) => r.fkName === fkHint || r.localCol === fkHint);
    if (exactFk) return exactFk;
  }
  const candidates = rels.filter((r) => r.target === target);
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) {
    const byAlias = candidates.find((r) => r.localCol === `${alias}_id` || r.localCol.startsWith(alias));
    return byAlias ?? candidates[0]!;
  }
  return null;
}

type FilterCond =
  | { kind: "cmp"; field: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "ilike" | "like" | "is"; val: unknown }
  | { kind: "in"; field: string; vals: unknown[] }
  | { kind: "not"; field: string; op: string; val: unknown }
  | { kind: "or"; expr: string };

function getByPath(row: Record<string, unknown>, field: string): unknown {
  if (!field.includes(".")) return row[field];
  const parts = field.split(".");
  let cur: unknown = row;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) return cur.map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>)[p] : undefined));
    if (typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

function matchLike(actual: unknown, pattern: string, caseInsensitive: boolean): boolean {
  if (actual === null || actual === undefined) return false;
  const s = String(actual);
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "").test(s);
}

function evalScalarCmp(actual: unknown, op: string, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((a) => evalScalarCmp(a, op, expected));
  switch (op) {
    case "eq":
      return actual === expected || (actual !== null && expected !== null && String(actual) === String(expected));
    case "neq":
      return actual !== expected && String(actual ?? "") !== String(expected ?? "");
    case "is":
      if (expected === null) return actual === null || actual === undefined;
      return Boolean(actual) === Boolean(expected);
    case "gt":
      return actual !== null && actual !== undefined && (typeof actual === "number" && typeof expected === "number" ? actual > expected : String(actual) > String(expected));
    case "gte":
      return actual !== null && actual !== undefined && (typeof actual === "number" && typeof expected === "number" ? actual >= expected : String(actual) >= String(expected));
    case "lt":
      return actual !== null && actual !== undefined && (typeof actual === "number" && typeof expected === "number" ? actual < expected : String(actual) < String(expected));
    case "lte":
      return actual !== null && actual !== undefined && (typeof actual === "number" && typeof expected === "number" ? actual <= expected : String(actual) <= String(expected));
    case "ilike":
      return matchLike(actual, String(expected), true);
    case "like":
      return matchLike(actual, String(expected), false);
    default:
      return true;
  }
}

function matchFilter(row: Record<string, unknown>, f: FilterCond): boolean {
  if (f.kind === "cmp") return evalScalarCmp(getByPath(row, f.field), f.op, f.val);
  if (f.kind === "in") {
    const actual = getByPath(row, f.field);
    if (Array.isArray(actual)) return actual.some((a) => f.vals.some((v) => evalScalarCmp(a, "eq", v)));
    return f.vals.some((v) => evalScalarCmp(actual, "eq", v));
  }
  if (f.kind === "not") {
    const actual = getByPath(row, f.field);
    if (f.op === "in") {
      const list = Array.isArray(f.val)
        ? f.val
        : String(f.val)
            .replace(/^\(|\)$/g, "")
            .split(",")
            .map((s) => s.trim().replace(/^"|"$/g, ""));
      return !list.some((v) => evalScalarCmp(actual, "eq", v));
    }
    return !evalScalarCmp(actual, f.op, f.val);
  }
  if (f.kind === "or") {
    const clauses = splitTopLevel(f.expr);
    return clauses.some((c) => {
      const firstDot = c.indexOf(".");
      const secondDot = c.indexOf(".", firstDot + 1);
      if (firstDot <= 0 || secondDot <= firstDot) return false;
      const col = c.slice(0, firstDot);
      const op = c.slice(firstDot + 1, secondDot);
      const val = c.slice(secondDot + 1);
      return evalScalarCmp(getByPath(row, col), op, val === "null" ? null : val);
    });
  }
  return true;
}

class AuthCtx {
  db: SqliteDb;
  userId: string | null;
  isAdmin: boolean;

  constructor(db: SqliteDb, userId: string | null, isAdmin: boolean) {
    this.db = db;
    this.userId = userId;
    this.isAdmin = isAdmin;
  }

  isSuperAdmin(): boolean {
    if (this.isAdmin) return true;
    if (!this.userId) return false;
    const r = this.db.prepare("SELECT is_super_admin FROM profiles WHERE id = ?").get(this.userId);
    return Boolean(r?.is_super_admin);
  }

  hasSchoolRole(schoolId: string | null | undefined, roles: string[]): boolean {
    if (!schoolId || !this.userId) return false;
    if (this.isSuperAdmin()) return true;
    const placeholders = roles.map(() => "?").join(",");
    const r = this.db
      .prepare(`SELECT 1 FROM school_memberships WHERE school_id = ? AND user_id = ? AND status = 'active' AND role IN (${placeholders}) LIMIT 1`)
      .get(schoolId, this.userId, ...roles);
    return Boolean(r);
  }

  isSchoolAdmin(schoolId: string | null | undefined): boolean {
    return this.hasSchoolRole(schoolId, ["school_admin"]);
  }

  isSchoolStaff(schoolId: string | null | undefined): boolean {
    return this.hasSchoolRole(schoolId, ["school_admin", "teacher"]);
  }

  isSchoolMember(schoolId: string | null | undefined): boolean {
    return this.hasSchoolRole(schoolId, ["school_admin", "teacher", "student"]);
  }

  teachesClass(classId: string | null | undefined, subjectId?: string | null): boolean {
    if (!classId || !this.userId) return false;
    if (this.isSuperAdmin()) return true;
    const rows = this.db.prepare("SELECT subject_id FROM class_teachers WHERE class_id = ? AND teacher_id = ?").all(classId, this.userId);
    if (!rows.length) return false;
    if (!subjectId) return true;
    return rows.some((r) => r.subject_id === null || r.subject_id === subjectId);
  }

  isEnrolled(classId: string | null | undefined): boolean {
    if (!classId || !this.userId) return false;
    return Boolean(this.db.prepare("SELECT 1 FROM class_enrollments WHERE class_id = ? AND student_id = ? LIMIT 1").get(classId, this.userId));
  }

  canManageAssessment(assessmentId: string | null | undefined): boolean {
    if (!assessmentId) return false;
    if (this.isAdmin || this.isSuperAdmin()) return true;
    if (!this.userId) return false;
    const a = this.db.prepare("SELECT school_id, created_by, class_id, subject_id FROM assessments WHERE id = ?").get(assessmentId) as
      | { school_id: string; created_by: string; class_id: string | null; subject_id: string | null }
      | undefined;
    if (!a) return false;
    if (a.created_by === this.userId) return true;
    if (this.isSchoolAdmin(a.school_id)) return true;
    if (a.class_id && this.teachesClass(a.class_id, a.subject_id) && this.isSchoolStaff(a.school_id)) return true;
    return false;
  }

  isAssigned(assessmentId: string | null | undefined): boolean {
    if (!assessmentId || !this.userId) return false;
    const direct = this.db
      .prepare("SELECT 1 FROM assessment_assignments WHERE assessment_id = ? AND student_id = ? LIMIT 1")
      .get(assessmentId, this.userId);
    if (direct) return true;
    const byClass = this.db
      .prepare(
        `SELECT 1 FROM assessment_assignments aa
         JOIN class_enrollments ce ON ce.class_id = aa.class_id
         WHERE aa.assessment_id = ? AND ce.student_id = ? LIMIT 1`,
      )
      .get(assessmentId, this.userId);
    return Boolean(byClass);
  }

  isReleased(attemptId: string | null | undefined): boolean {
    if (!attemptId) return false;
    return Boolean(this.db.prepare("SELECT 1 FROM result_releases WHERE attempt_id = ? LIMIT 1").get(attemptId));
  }

  canReadRow(table: string, row: Record<string, unknown>): boolean {
    if (this.isAdmin || this.isSuperAdmin()) return true;
    const uid = this.userId;
    if (!uid) return false;

    switch (table) {
      case "profiles":
        return true;
      case "schools":
        return this.isSchoolMember(String(row.id));
      case "school_memberships":
        return row.user_id === uid || this.isSchoolStaff(String(row.school_id));
      case "academic_years":
      case "subjects":
        return this.isSchoolMember(String(row.school_id));
      case "classes":
        return this.isSchoolStaff(String(row.school_id)) || this.isEnrolled(String(row.id));
      case "class_teachers": {
        const cls = this.db.prepare("SELECT school_id FROM classes WHERE id = ?").get(row.class_id) as { school_id: string } | undefined;
        return Boolean(cls && (this.isSchoolStaff(cls.school_id) || this.isEnrolled(String(row.class_id))));
      }
      case "class_enrollments": {
        const cls = this.db.prepare("SELECT school_id FROM classes WHERE id = ?").get(row.class_id) as { school_id: string } | undefined;
        return row.student_id === uid || this.teachesClass(String(row.class_id)) || Boolean(cls && this.isSchoolAdmin(cls.school_id));
      }
      case "invitations":
        return this.isSchoolAdmin(String(row.school_id));
      case "teacher_verification_requests":
        return row.user_id === uid || this.isSchoolAdmin(String(row.school_id));
      case "question_bank_items":
        return row.owner_id === uid || (Boolean(row.is_shared) && this.isSchoolStaff(String(row.school_id))) || this.isSchoolAdmin(String(row.school_id));
      case "assessments":
        if (this.canManageAssessment(String(row.id))) return true;
        return ["published", "closed", "archived"].includes(String(row.status)) && this.isAssigned(String(row.id));
      case "assessment_sections":
      case "assessment_questions":
        return this.canManageAssessment(String(row.assessment_id));
      case "assessment_assignments":
        return (
          this.canManageAssessment(String(row.assessment_id)) ||
          row.student_id === uid ||
          (row.class_id !== null && this.isEnrolled(String(row.class_id)))
        );
      case "assessment_snapshots":
        return this.canManageAssessment(String(row.assessment_id)) || this.isAssigned(String(row.assessment_id));
      case "assessment_snapshot_keys": {
        const snap = this.db.prepare("SELECT assessment_id FROM assessment_snapshots WHERE id = ?").get(row.snapshot_id) as { assessment_id: string } | undefined;
        if (snap && this.canManageAssessment(snap.assessment_id)) return true;
        if (!row.reveal_after_release) return false;
        const att = this.db
          .prepare(
            `SELECT t.id FROM attempts t
             JOIN assessments a ON a.id = t.assessment_id
             WHERE t.snapshot_id = ? AND t.student_id = ? AND a.show_correct_answers = 1`,
          )
          .all(row.snapshot_id, uid) as { id: string }[];
        return att.some((t) => this.isReleased(t.id));
      }
      case "student_accommodations":
        return row.student_id === uid || this.isSchoolStaff(String(row.school_id));
      case "attempts":
        return row.student_id === uid || this.canManageAssessment(String(row.assessment_id));
      case "answers":
      case "submission_files": {
        const t = this.db.prepare("SELECT student_id, assessment_id FROM attempts WHERE id = ?").get(row.attempt_id) as
          | { student_id: string; assessment_id: string }
          | undefined;
        return Boolean(t && (t.student_id === uid || this.canManageAssessment(t.assessment_id)));
      }
      case "question_scores": {
        const t = this.db.prepare("SELECT student_id, assessment_id FROM attempts WHERE id = ?").get(row.attempt_id) as
          | { student_id: string; assessment_id: string }
          | undefined;
        if (!t) return false;
        if (this.canManageAssessment(t.assessment_id)) return true;
        return t.student_id === uid && this.isReleased(String(row.attempt_id));
      }
      case "final_grades":
        if (this.canManageAssessment(String(row.assessment_id))) return true;
        return row.student_id === uid && this.isReleased(String(row.attempt_id));
      case "result_releases": {
        if (this.canManageAssessment(String(row.assessment_id))) return true;
        const t = this.db.prepare("SELECT student_id FROM attempts WHERE id = ?").get(row.attempt_id) as { student_id: string } | undefined;
        return t?.student_id === uid;
      }
      case "lockdown_events":
        return this.canManageAssessment(String(row.assessment_id));
      case "teacher_reviews":
      case "grading_jobs": {
        const t = this.db.prepare("SELECT assessment_id FROM attempts WHERE id = ?").get(row.attempt_id) as { assessment_id: string } | undefined;
        return Boolean(t && this.canManageAssessment(t.assessment_id));
      }
      case "grading_suggestions": {
        const ans = this.db.prepare("SELECT attempt_id FROM answers WHERE id = ?").get(row.answer_id) as { attempt_id: string } | undefined;
        const t = ans ? (this.db.prepare("SELECT assessment_id FROM attempts WHERE id = ?").get(ans.attempt_id) as { assessment_id: string } | undefined) : undefined;
        return Boolean(t && this.canManageAssessment(t.assessment_id));
      }
      case "criterion_scores": {
        const gs = this.db.prepare("SELECT answer_id FROM grading_suggestions WHERE id = ?").get(row.suggestion_id) as { answer_id: string } | undefined;
        if (!gs) return false;
        const ans = this.db.prepare("SELECT attempt_id FROM answers WHERE id = ?").get(gs.answer_id) as { attempt_id: string } | undefined;
        const t = ans ? (this.db.prepare("SELECT assessment_id FROM attempts WHERE id = ?").get(ans.attempt_id) as { assessment_id: string } | undefined) : undefined;
        return Boolean(t && this.canManageAssessment(t.assessment_id));
      }
      case "ocr_jobs":
        return row.created_by === uid || this.isSchoolAdmin(String(row.school_id));
      case "ocr_transcriptions":
        return true;
      case "ai_explanations":
      case "practice_questions":
      case "notifications":
        return row.student_id === uid || row.user_id === uid;
      case "audit_events":
        return row.school_id !== null && this.isSchoolAdmin(String(row.school_id));
      case "ai_exam_checks":
        return row.teacher_id === uid || this.isSchoolAdmin(String(row.school_id));
      default:
        return false;
    }
  }
}

function hydrateRow(ctx: AuthCtx, table: string, baseRow: Record<string, unknown>, fields: SelectField[]): { row: Record<string, unknown>; keep: boolean } {
  const hasStar = fields.some((f) => f.kind === "star");
  const out: Record<string, unknown> = hasStar ? { ...baseRow } : {};

  for (const f of fields) {
    if (f.kind === "col") {
      out[f.alias] = baseRow[f.name];
    } else if (f.kind === "rel") {
      const rel = findRelation(table, f.target, f.alias, f.fkHint);
      if (!rel) {
        out[f.alias] = null;
        if (f.inner) return { row: out, keep: false };
        continue;
      }
      if (f.sub === "count") {
        const rawList = ctx.db.prepare(`SELECT * FROM ${rel.target} WHERE ${rel.targetCol} = ?`).all(baseRow[rel.localCol]);
        const visible = rawList.map((r) => deserializeRow(rel.target, r)!).filter((r) => ctx.canReadRow(rel.target, r));
        out[f.alias] = [{ count: visible.length }];
        continue;
      }
      const subFields = parseSelect(f.sub);
      if (rel.type === "m2o" || rel.type === "o2o") {
        const fkVal = baseRow[rel.localCol];
        if (fkVal === null || fkVal === undefined) {
          out[f.alias] = null;
          if (f.inner) return { row: out, keep: false };
          continue;
        }
        const rawTarget = ctx.db.prepare(`SELECT * FROM ${rel.target} WHERE ${rel.targetCol} = ? LIMIT 1`).get(fkVal);
        const targetObj = deserializeRow(rel.target, rawTarget);
        if (!targetObj || !ctx.canReadRow(rel.target, targetObj)) {
          out[f.alias] = null;
          if (f.inner) return { row: out, keep: false };
          continue;
        }
        const hydrated = hydrateRow(ctx, rel.target, targetObj, subFields);
        if (!hydrated.keep) {
          out[f.alias] = null;
          if (f.inner) return { row: out, keep: false };
          continue;
        }
        out[f.alias] = hydrated.row;
      } else {
        const rawChildren = ctx.db.prepare(`SELECT * FROM ${rel.target} WHERE ${rel.targetCol} = ?`).all(baseRow[rel.localCol]);
        const items: Record<string, unknown>[] = [];
        for (const rc of rawChildren) {
          const obj = deserializeRow(rel.target, rc);
          if (!obj || !ctx.canReadRow(rel.target, obj)) continue;
          const hydrated = hydrateRow(ctx, rel.target, obj, subFields);
          if (hydrated.keep) items.push(hydrated.row);
        }
        if (f.inner && items.length === 0) return { row: out, keep: false };
        out[f.alias] = items;
      }
    }
  }
  return { row: out, keep: true };
}

class LocalQueryBuilder implements PromiseLike<QueryResult> {
  private ctx: AuthCtx;
  private table: string;
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private selectSpec = "*";
  private selectAssigned = false;
  private wantCount: "exact" | null = null;
  private headOnly = false;
  private payload: unknown = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: FilterCond[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private limitN: number | null = null;
  private rangeBounds: [number, number] | null = null;
  private cardinality: "many" | "single" | "maybeSingle" = "many";

  constructor(ctx: AuthCtx, table: string) {
    this.ctx = ctx;
    this.table = table;
  }

  select(spec = "*", opts?: { count?: "exact"; head?: boolean }) {
    this.selectSpec = spec;
    this.selectAssigned = true;
    if (opts?.count) this.wantCount = opts.count;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(values: unknown) {
    this.op = "insert";
    this.payload = values;
    return this;
  }

  upsert(values: unknown, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = values;
    this.upsertOpts = opts ?? {};
    return this;
  }

  update(values: unknown, opts?: { count?: "exact" }) {
    this.op = "update";
    this.payload = values;
    if (opts?.count) this.wantCount = opts.count;
    return this;
  }

  delete(opts?: { count?: "exact" }) {
    this.op = "delete";
    if (opts?.count) this.wantCount = opts.count;
    return this;
  }

  eq(field: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: "eq", val });
    return this;
  }
  neq(field: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: "neq", val });
    return this;
  }
  gt(field: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: "gt", val });
    return this;
  }
  gte(field: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: "gte", val });
    return this;
  }
  lt(field: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: "lt", val });
    return this;
  }
  lte(field: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: "lte", val });
    return this;
  }
  ilike(field: string, val: string) {
    this.filters.push({ kind: "cmp", field, op: "ilike", val });
    return this;
  }
  like(field: string, val: string) {
    this.filters.push({ kind: "cmp", field, op: "like", val });
    return this;
  }
  is(field: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: "is", val });
    return this;
  }
  in(field: string, vals: readonly unknown[]) {
    this.filters.push({ kind: "in", field, vals: [...vals] });
    return this;
  }
  not(field: string, op: string, val: unknown) {
    this.filters.push({ kind: "not", field, op, val });
    return this;
  }
  filter(field: string, op: string, val: unknown) {
    this.filters.push({ kind: "cmp", field, op: op as "eq", val });
    return this;
  }
  or(expr: string) {
    this.filters.push({ kind: "or", expr });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeBounds = [from, to];
    return this;
  }
  single() {
    this.cardinality = "single";
    return this;
  }
  maybeSingle() {
    this.cardinality = "maybeSingle";
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private prepareInsertDefaults(item: Record<string, unknown>): Record<string, unknown> {
    const now = new Date().toISOString();
    const row = { ...item };
    const pk = TABLE_PK[this.table];
    if (pk === "id" && !row.id) row.id = randomUUID();
    if (this.table === "schools") {
      if (!row.join_code) row.join_code = generateJoinCode(8);
      if (row.is_active === undefined) row.is_active = true;
      row.created_at ??= now;
      row.updated_at ??= now;
    } else if (this.table === "classes") {
      if (!row.join_code) row.join_code = generateJoinCode(6);
      row.created_at ??= now;
    } else if (this.table === "invitations") {
      row.expires_at ??= new Date(Date.now() + 14 * 86400 * 1000).toISOString();
      row.created_at ??= now;
    } else if (this.table === "lockdown_events") {
      row.occurred_at = now;
      row.metadata ??= {};
      const nonViolation = new Set(["fullscreen_enter", "visibility_visible", "window_focus", "connection_restored"]);
      if (!nonViolation.has(String(row.event_type))) {
        this.ctx.db.prepare("UPDATE attempts SET lockdown_event_count = lockdown_event_count + 1 WHERE id = ?").run(row.attempt_id);
      }
    } else if (this.table === "final_grades") {
      row.approved_at ??= now;
    } else if (this.table === "result_releases") {
      row.released_at ??= now;
    } else if (this.table === "platform_settings") {
      row.updated_at ??= now;
    } else if (this.table === "question_scores") {
      row.updated_at ??= now;
    } else {
      const cols = this.tableColumns();
      if (cols.has("created_at") && row.created_at === undefined) row.created_at = now;
      if (cols.has("updated_at") && row.updated_at === undefined) row.updated_at = now;
    }
    return row;
  }

  private tableColumns(): Set<string> {
    const info = this.ctx.db.prepare(`PRAGMA table_info(${this.table})`).all() as { name: string }[];
    return new Set(info.map((c) => c.name));
  }

  private fetchRowByPk(inserted: Record<string, unknown>): Record<string, unknown> | null {
    const pk = TABLE_PK[this.table] ?? "id";
    if (Array.isArray(pk)) {
      const where = pk.map((k) => `${k} = ?`).join(" AND ");
      const vals = pk.map((k) => inserted[k]);
      return deserializeRow(this.table, this.ctx.db.prepare(`SELECT * FROM ${this.table} WHERE ${where}`).get(...vals));
    }
    return deserializeRow(this.table, this.ctx.db.prepare(`SELECT * FROM ${this.table} WHERE ${pk} = ?`).get(inserted[pk]));
  }

  private execute(): QueryResult {
    try {
      if (this.op === "select") return this.execSelect();
      if (this.op === "insert") return this.execInsert(false);
      if (this.op === "upsert") return this.execInsert(true);
      if (this.op === "update") return this.execUpdate();
      if (this.op === "delete") return this.execDelete();
      return { data: null, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE constraint failed/i.test(msg)) return { data: null, error: err(msg, "23505") };
      if (/FOREIGN KEY constraint failed/i.test(msg)) return { data: null, error: err(msg, "23503") };
      return { data: null, error: err(msg, "P0001") };
    }
  }

  private execSelect(): QueryResult {
    const rawAll = this.ctx.db.prepare(`SELECT * FROM ${this.table}`).all();
    const fields = parseSelect(this.selectSpec);
    const hasRelations = fields.some((f) => f.kind === "rel");
    const hasDottedFilters = this.filters.some(
      (f) => (f.kind === "cmp" || f.kind === "in" || f.kind === "not") && f.field.includes("."),
    );

    const matched: Record<string, unknown>[] = [];
    for (const raw of rawAll) {
      const base = deserializeRow(this.table, raw);
      if (!base || !this.ctx.canReadRow(this.table, base)) continue;

      if (!hasDottedFilters) {
        if (!this.filters.every((f) => matchFilter(base, f))) continue;
      }

      if (hasRelations || !fields.some((f) => f.kind === "star")) {
        const hydrated = hydrateRow(this.ctx, this.table, base, fields);
        if (!hydrated.keep) continue;
        const checkTarget = hasDottedFilters ? { ...base, ...hydrated.row } : hydrated.row;
        if (hasDottedFilters && !this.filters.every((f) => matchFilter(checkTarget, f))) continue;
        matched.push(hydrated.row);
      } else {
        if (hasDottedFilters && !this.filters.every((f) => matchFilter(base, f))) continue;
        matched.push(base);
      }
    }

    for (let i = this.orders.length - 1; i >= 0; i--) {
      const { col, asc } = this.orders[i]!;
      matched.sort((a, b) => {
        const va = a[col];
        const vb = b[col];
        if (va === vb) return 0;
        if (va === null || va === undefined) return asc ? 1 : -1;
        if (vb === null || vb === undefined) return asc ? -1 : 1;
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return asc ? cmp : -cmp;
      });
    }

    const totalCount = matched.length;
    let sliced = matched;
    if (this.rangeBounds) sliced = sliced.slice(this.rangeBounds[0], this.rangeBounds[1] + 1);
    else if (this.limitN !== null) sliced = sliced.slice(0, this.limitN);

    if (this.headOnly) {
      return { data: null, error: null, count: this.wantCount ? totalCount : null };
    }
    return this.finalizeShape(sliced, totalCount);
  }

  private execInsert(isUpsert: boolean): QueryResult {
    const items = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Record<string, unknown>[];
    const validCols = this.tableColumns();
    const outRows: Record<string, unknown>[] = [];
    const fields = parseSelect(this.selectSpec);

    for (const rawItem of items) {
      const prepared = this.prepareInsertDefaults(rawItem);
      const cols = Object.keys(prepared).filter((k) => validCols.has(k) && prepared[k] !== undefined);
      const vals = cols.map((k) => serializeValue(this.table, k, prepared[k]));
      const placeholders = cols.map(() => "?").join(", ");

      if (isUpsert) {
        const conflictCols = (this.upsertOpts.onConflict ?? (Array.isArray(TABLE_PK[this.table]) ? (TABLE_PK[this.table] as string[]).join(",") : String(TABLE_PK[this.table] ?? "id")))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (this.upsertOpts.ignoreDuplicates) {
          const res = this.ctx.db
            .prepare(`INSERT OR IGNORE INTO ${this.table} (${cols.join(", ")}) VALUES (${placeholders})`)
            .run(...vals);
          if (Number(res.changes) === 0) continue;
        } else {
          const updateCols = cols.filter((c) => !conflictCols.includes(c) && c !== "id" && c !== "created_at");
          const setClause = updateCols.length
            ? `DO UPDATE SET ${updateCols.map((c) => `${c} = excluded.${c}`).join(", ")}`
            : "DO NOTHING";
          this.ctx.db
            .prepare(`INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${placeholders}) ON CONFLICT (${conflictCols.join(", ")}) ${setClause}`)
            .run(...vals);
          // Fetch existing row if conflict updated another id
          const whereConflict = conflictCols.map((c) => `${c} IS ?`).join(" AND ");
          const found = deserializeRow(
            this.table,
            this.ctx.db.prepare(`SELECT * FROM ${this.table} WHERE ${whereConflict}`).get(...conflictCols.map((c) => serializeValue(this.table, c, prepared[c]))),
          );
          if (found) {
            outRows.push(hydrateRow(this.ctx, this.table, found, fields).row);
            continue;
          }
        }
      } else {
        this.ctx.db.prepare(`INSERT INTO ${this.table} (${cols.join(", ")}) VALUES (${placeholders})`).run(...vals);
      }

      const stored = this.fetchRowByPk(prepared);
      if (stored) outRows.push(hydrateRow(this.ctx, this.table, stored, fields).row);
    }

    if (!this.selectAssigned) return { data: null, error: null, count: outRows.length };
    return this.finalizeShape(outRows, outRows.length);
  }

  private matchingBaseRows(): Record<string, unknown>[] {
    const rawAll = this.ctx.db.prepare(`SELECT * FROM ${this.table}`).all();
    return rawAll
      .map((r) => deserializeRow(this.table, r)!)
      .filter((r) => Boolean(r) && this.ctx.canReadRow(this.table, r) && this.filters.every((f) => matchFilter(r, f)));
  }

  private execUpdate(): QueryResult {
    const patch = (this.payload ?? {}) as Record<string, unknown>;
    const validCols = this.tableColumns();
    const updateData: Record<string, unknown> = { ...patch };
    if (validCols.has("updated_at") && updateData.updated_at === undefined) {
      updateData.updated_at = new Date().toISOString();
    }
    const cols = Object.keys(updateData).filter((k) => validCols.has(k) && updateData[k] !== undefined);
    if (!cols.length) return { data: [], error: null, count: 0 };

    const targets = this.matchingBaseRows();
    const pk = TABLE_PK[this.table] ?? "id";
    const pkCols = Array.isArray(pk) ? pk : [pk];
    const setSql = cols.map((c) => `${c} = ?`).join(", ");
    const whereSql = pkCols.map((k) => `${k} = ?`).join(" AND ");
    const stmt = this.ctx.db.prepare(`UPDATE ${this.table} SET ${setSql} WHERE ${whereSql}`);
    const fields = parseSelect(this.selectSpec);
    const updated: Record<string, unknown>[] = [];

    for (const row of targets) {
      stmt.run(...cols.map((c) => serializeValue(this.table, c, updateData[c])), ...pkCols.map((k) => row[k]));
      const fresh = this.fetchRowByPk(row);
      if (fresh) updated.push(hydrateRow(this.ctx, this.table, fresh, fields).row);
    }

    if (!this.selectAssigned) return { data: null, error: null, count: targets.length };
    return this.finalizeShape(updated, targets.length);
  }

  private execDelete(): QueryResult {
    const targets = this.matchingBaseRows();
    const pk = TABLE_PK[this.table] ?? "id";
    const pkCols = Array.isArray(pk) ? pk : [pk];
    const whereSql = pkCols.map((k) => `${k} = ?`).join(" AND ");
    const stmt = this.ctx.db.prepare(`DELETE FROM ${this.table} WHERE ${whereSql}`);
    for (const row of targets) stmt.run(...pkCols.map((k) => row[k]));
    return { data: null, error: null, count: targets.length };
  }

  private finalizeShape(rows: Record<string, unknown>[], totalCount: number): QueryResult {
    const countVal = this.wantCount ? totalCount : undefined;
    if (this.cardinality === "single") {
      if (rows.length !== 1) return { data: null, error: err("Row not found", "PGRST116"), count: countVal };
      return { data: rows[0]!, error: null, count: countVal };
    }
    if (this.cardinality === "maybeSingle") {
      if (rows.length > 1) return { data: null, error: err("Multiple rows returned", "PGRST116"), count: countVal };
      return { data: rows[0] ?? null, error: null, count: countVal };
    }
    return { data: rows, error: null, count: countVal };
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function finalizeAttemptRpc(ctx: AuthCtx, attemptId: string, reason: "manual" | "timeout" | "teacher"): Record<string, unknown> {
  const raw = ctx.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId);
  const t = deserializeRow("attempts", raw);
  if (!t) throw new Error("attempt_not_found");
  if (!ctx.isAdmin && ctx.userId && t.student_id !== ctx.userId && !ctx.canManageAssessment(String(t.assessment_id))) {
    throw new Error("forbidden");
  }
  if (t.status === "submitted") return t;
  if (reason === "teacher" && !ctx.canManageAssessment(String(t.assessment_id))) throw new Error("forbidden");
  const now = new Date();
  if (reason === "timeout" && (!t.deadline_at || new Date(String(t.deadline_at)) > now)) throw new Error("not_expired");

  const submittedAt =
    reason === "timeout" && t.deadline_at
      ? new Date(Math.min(now.getTime(), new Date(String(t.deadline_at)).getTime())).toISOString()
      : now.toISOString();
  ctx.db.prepare("UPDATE attempts SET status = 'submitted', submitted_at = ?, submit_reason = ? WHERE id = ?").run(submittedAt, reason, attemptId);
  return deserializeRow("attempts", ctx.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId))!;
}

function executeRpc(ctx: AuthCtx, fn: string, args: Record<string, unknown> = {}): QueryResult {
  const db = ctx.db;
  const nowIso = new Date().toISOString();
  try {
    switch (fn) {
      case "rate_limit_hit": {
        const key = String(args.p_key ?? "");
        const limit = Number(args.p_limit ?? 10);
        const winSec = Number(args.p_window_seconds ?? 60);
        const existing = db.prepare("SELECT window_start, count FROM rate_limits WHERE key = ?").get(key) as
          | { window_start: string; count: number }
          | undefined;
        let nextCount = 1;
        if (!existing || new Date(existing.window_start).getTime() < Date.now() - winSec * 1000) {
          db.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1").run(
            key,
            nowIso,
          );
        } else {
          nextCount = Number(existing.count) + 1;
          db.prepare("UPDATE rate_limits SET count = ? WHERE key = ?").run(nextCount, key);
        }
        return { data: nextCount <= limit, error: null };
      }

      case "accept_invitation": {
        if (!ctx.userId) return { data: null, error: err("not_authenticated", "28000") };
        const token = String(args.p_token ?? "");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const inv = db.prepare("SELECT * FROM invitations WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | undefined;
        if (!inv) return { data: null, error: err("invitation_not_found", "P0002") };
        if (inv.revoked_at) return { data: null, error: err("invitation_revoked", "P0001") };
        if (inv.accepted_at) {
          if (inv.accepted_by === ctx.userId) return { data: inv.school_id, error: null };
          return { data: null, error: err("invitation_used", "P0001") };
        }
        if (new Date(String(inv.expires_at)).getTime() < Date.now()) return { data: null, error: err("invitation_expired", "P0001") };
        const u = db.prepare("SELECT email FROM auth_users WHERE id = ?").get(ctx.userId) as { email: string } | undefined;
        if (!u || u.email.toLowerCase() !== String(inv.email).toLowerCase()) return { data: null, error: err("invitation_email_mismatch", "42501") };

        db.prepare(
          `INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at)
           VALUES (?, ?, ?, ?, 'active', ?)
           ON CONFLICT(school_id, user_id, role) DO UPDATE SET status = 'active'`,
        ).run(randomUUID(), inv.school_id, ctx.userId, inv.role, nowIso);

        if (inv.class_id && inv.role === "student") {
          db.prepare(`INSERT OR IGNORE INTO class_enrollments (id, class_id, student_id, created_at) VALUES (?, ?, ?, ?)`).run(
            randomUUID(),
            inv.class_id,
            ctx.userId,
            nowIso,
          );
        }
        db.prepare("UPDATE invitations SET accepted_at = ?, accepted_by = ? WHERE id = ?").run(nowIso, ctx.userId, inv.id);
        return { data: inv.school_id, error: null };
      }

      case "request_teacher_access": {
        if (!ctx.userId) return { data: null, error: err("not_authenticated", "28000") };
        const code = String(args.p_join_code ?? "").trim().toUpperCase();
        const message = String(args.p_message ?? "").slice(0, 1000);
        const school = db.prepare("SELECT id FROM schools WHERE join_code = ? AND is_active = 1").get(code) as { id: string } | undefined;
        if (!school) return { data: null, error: err("school_not_found", "P0002") };
        if (ctx.hasSchoolRole(school.id, ["teacher"])) return { data: null, error: err("already_member", "P0001") };
        const pending = db
          .prepare("SELECT id FROM teacher_verification_requests WHERE school_id = ? AND user_id = ? AND status = 'pending'")
          .get(school.id, ctx.userId) as { id: string } | undefined;
        if (pending) {
          db.prepare("UPDATE teacher_verification_requests SET message = ? WHERE id = ?").run(message, pending.id);
          return { data: pending.id, error: null };
        }
        const id = randomUUID();
        db.prepare("INSERT INTO teacher_verification_requests (id, school_id, user_id, message, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(
          id,
          school.id,
          ctx.userId,
          message,
          nowIso,
        );
        return { data: id, error: null };
      }

      case "review_teacher_request": {
        const reqId = String(args.p_request ?? "");
        const approve = Boolean(args.p_approve);
        const req = db.prepare("SELECT * FROM teacher_verification_requests WHERE id = ?").get(reqId) as Record<string, unknown> | undefined;
        if (!req) return { data: null, error: err("request_not_found", "P0002") };
        if (!ctx.isSchoolAdmin(String(req.school_id))) return { data: null, error: err("forbidden", "42501") };
        if (req.status !== "pending") return { data: undefined, error: null };
        db.prepare("UPDATE teacher_verification_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(
          approve ? "approved" : "rejected",
          ctx.userId,
          nowIso,
          reqId,
        );
        if (approve) {
          db.prepare(
            `INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at)
             VALUES (?, ?, ?, 'teacher', 'active', ?)
             ON CONFLICT(school_id, user_id, role) DO UPDATE SET status = 'active'`,
          ).run(randomUUID(), req.school_id, req.user_id, nowIso);
        }
        return { data: undefined, error: null };
      }

      case "create_school_with_admin": {
        if (!ctx.userId) return { data: null, error: err("not_authenticated", "28000") };
        const name = String(args.p_name ?? "").trim();
        const city = String(args.p_city ?? "").trim() || null;
        const region = String(args.p_region ?? city ?? "").trim() || null;
        if (name.length < 2) return { data: null, error: err("invalid", "22023") };

        const schoolId = randomUUID();
        db.prepare("INSERT INTO schools (id, name, city, region, join_code, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").run(
          schoolId,
          name,
          city,
          region,
          generateJoinCode(8),
          nowIso,
          nowIso,
        );
        for (const r of ["school_admin", "teacher"] as const) {
          db.prepare(
            `INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at)
             VALUES (?, ?, ?, ?, 'active', ?)
             ON CONFLICT(school_id, user_id, role) DO UPDATE SET status = 'active'`,
          ).run(randomUUID(), schoolId, ctx.userId, r, nowIso);
        }
        db.prepare("INSERT INTO academic_years (id, school_id, name, starts_on, ends_on, is_current, created_at) VALUES (?, ?, '2026–2027', '2026-09-01', '2027-05-25', 1, ?)").run(
          randomUUID(),
          schoolId,
          nowIso,
        );
        for (const [ru, kk, code] of [
          ["Математика", "Математика", "MATH"],
          ["Алгебра", "Алгебра", "ALG"],
          ["Физика", "Физика", "PHYS"],
          ["Информатика", "Информатика", "INF"],
          ["Казахский язык и литература", "Қазақ тілі мен әдебиеті", "KAZ"],
          ["Русский язык и литература", "Орыс тілі мен әдебиеті", "RUS"],
          ["Английский язык", "Ағылшын тілі", "ENG"],
          ["История Казахстана", "Қазақстан тарихы", "HIST"],
          ["Биология", "Биология", "BIO"],
          ["Химия", "Химия", "CHEM"],
        ]) {
          db.prepare("INSERT OR IGNORE INTO subjects (id, school_id, name_ru, name_kk, code, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
            randomUUID(),
            schoolId,
            ru,
            kk,
            code,
            nowIso,
          );
        }
        return { data: schoolId, error: null };
      }

      case "join_class_by_code": {
        if (!ctx.userId) return { data: null, error: err("not_authenticated", "28000") };
        const code = String(args.p_join_code ?? "").trim().toUpperCase();
        const cls = db.prepare("SELECT * FROM classes WHERE join_code = ?").get(code) as { id: string; school_id: string } | undefined;
        if (!cls) return { data: null, error: err("class_not_found", "P0002") };
        const school = db.prepare("SELECT id FROM schools WHERE id = ? AND is_active = 1").get(cls.school_id);
        if (!school) return { data: null, error: err("school_not_found", "P0002") };

        db.prepare(
          `INSERT INTO school_memberships (id, school_id, user_id, role, status, created_at)
           VALUES (?, ?, ?, 'student', 'active', ?)
           ON CONFLICT(school_id, user_id, role) DO UPDATE SET status = 'active'`,
        ).run(randomUUID(), cls.school_id, ctx.userId, nowIso);
        db.prepare("INSERT OR IGNORE INTO class_enrollments (id, class_id, student_id, created_at) VALUES (?, ?, ?, ?)").run(
          randomUUID(),
          cls.id,
          ctx.userId,
          nowIso,
        );
        return { data: cls.id, error: null };
      }

      case "publish_assessment": {
        const aId = String(args.p_assessment ?? "");
        const a = deserializeRow("assessments", db.prepare("SELECT * FROM assessments WHERE id = ?").get(aId));
        if (!a) return { data: null, error: err("assessment_not_found", "P0002") };
        if (!ctx.canManageAssessment(aId)) return { data: null, error: err("forbidden", "42501") };
        if (a.status === "archived") return { data: null, error: err("assessment_archived", "P0001") };

        const qRows = db
          .prepare("SELECT * FROM assessment_questions WHERE assessment_id = ? ORDER BY position ASC")
          .all(aId)
          .map((r) => deserializeRow("assessment_questions", r)!);
        if (!qRows.length) return { data: null, error: err("no_questions", "P0001") };

        const assignCount = db.prepare("SELECT COUNT(*) AS c FROM assessment_assignments WHERE assessment_id = ?").get(aId) as { c: number };
        if (!assignCount?.c) return { data: null, error: err("no_assignees", "P0001") };
        if (a.due_at && new Date(String(a.due_at)).getTime() <= Date.now()) return { data: null, error: err("due_in_past", "P0001") };

        const maxVer = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM assessment_snapshots WHERE assessment_id = ?").get(aId) as { v: number };
        const nextVer = Number(maxVer.v) + 1;
        const sections = db.prepare("SELECT id, title, instructions, position FROM assessment_sections WHERE assessment_id = ? ORDER BY position ASC").all(aId);
        const secPos = new Map(sections.map((s) => [String(s.id), Number(s.position)]));
        const sortedQs = [...qRows].sort((x, y) => {
          const sx = x.section_id ? (secPos.get(String(x.section_id)) ?? 0) : -1;
          const sy = y.section_id ? (secPos.get(String(y.section_id)) ?? 0) : -1;
          return sx !== sy ? sx - sy : Number(x.position) - Number(y.position);
        });

        const snapQuestions = sortedQs.map((q) => ({
          id: q.id,
          sectionId: q.section_id,
          position: q.position,
          type: q.type,
          content: q.content,
          points: Number(q.points),
          topic: q.topic,
          learningObjective: q.learning_objective,
        }));
        const totalPts = sortedQs.reduce((s, q) => s + Number(q.points), 0);
        const snapId = randomUUID();

        db.prepare(
          `INSERT INTO assessment_snapshots (id, assessment_id, version, title, instructions, sections, questions, total_points, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(snapId, aId, nextVer, a.title, a.instructions ?? null, JSON.stringify(sections), JSON.stringify(snapQuestions), totalPts, ctx.userId, nowIso);

        for (const q of sortedQs) {
          db.prepare(
            `INSERT INTO assessment_snapshot_keys (snapshot_id, question_id, type, points, answer_key, rubric, explanation, reveal_after_release)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            snapId,
            q.id,
            q.type,
            q.points,
            JSON.stringify(q.answer_key ?? {}),
            q.rubric ? JSON.stringify(q.rubric) : null,
            q.explanation ?? null,
            q.reveal_after_release ? 1 : 0,
          );
        }

        db.prepare("UPDATE assessments SET status = 'published', current_snapshot_id = ?, published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?").run(
          snapId,
          nowIso,
          nowIso,
          aId,
        );
        return { data: snapId, error: null };
      }

      case "start_attempt": {
        if (!ctx.userId) return { data: null, error: err("not_authenticated", "28000") };
        const aId = String(args.p_assessment ?? "");
        const a = deserializeRow("assessments", db.prepare("SELECT * FROM assessments WHERE id = ?").get(aId));
        if (!a || !ctx.isAssigned(aId)) return { data: null, error: err("forbidden", "42501") };
        if (a.status !== "published") return { data: null, error: err("not_available", "P0001") };

        const existing = deserializeRow(
          "attempts",
          db.prepare("SELECT * FROM attempts WHERE assessment_id = ? AND student_id = ? AND status = 'in_progress'").get(aId, ctx.userId),
        );
        if (existing) {
          if (existing.deadline_at && new Date(String(existing.deadline_at)).getTime() <= Date.now()) {
            finalizeAttemptRpc(ctx, String(existing.id), "timeout");
          } else {
            return { data: existing.id, error: null };
          }
        }

        if (a.starts_at && Date.now() < new Date(String(a.starts_at)).getTime()) return { data: null, error: err("not_started", "P0001") };
        if (a.due_at && Date.now() >= new Date(String(a.due_at)).getTime()) return { data: null, error: err("expired", "P0001") };

        const acc = db
          .prepare(
            "SELECT COALESCE(SUM(extra_minutes), 0) AS em, COALESCE(SUM(extra_attempts), 0) AS ea FROM student_accommodations WHERE student_id = ? AND school_id = ? AND (assessment_id IS NULL OR assessment_id = ?)",
          )
          .get(ctx.userId, a.school_id, aId) as { em: number; ea: number };
        const used = db.prepare("SELECT COUNT(*) AS c FROM attempts WHERE assessment_id = ? AND student_id = ?").get(aId, ctx.userId) as { c: number };
        if (Number(used.c) >= Number(a.max_attempts) + Number(acc.ea)) return { data: null, error: err("no_attempts_left", "P0001") };

        const snap = deserializeRow("assessment_snapshots", db.prepare("SELECT * FROM assessment_snapshots WHERE id = ?").get(a.current_snapshot_id));
        if (!snap) return { data: null, error: err("not_available", "P0001") };

        let deadlineMs: number | null = null;
        if (a.duration_minutes) deadlineMs = Date.now() + (Number(a.duration_minutes) + Number(acc.em)) * 60000;
        if (a.due_at) {
          const duePlus = new Date(String(a.due_at)).getTime() + Number(acc.em) * 60000;
          deadlineMs = deadlineMs === null ? duePlus : Math.min(deadlineMs, duePlus);
        }

        const qs = (snap.questions as { id: string; type: string; content: Record<string, unknown> }[]) ?? [];
        const qOrder = a.shuffle_questions ? shuffleArray(qs.map((q) => q.id)) : qs.map((q) => q.id);
        const optOrders: Record<string, string[]> = {};
        for (const q of qs) {
          if ((q.type === "single_choice" || q.type === "multiple_choice") && a.shuffle_options) {
            const opts = (q.content.options as { id: string }[]) ?? [];
            optOrders[q.id] = shuffleArray(opts.map((o) => o.id));
          } else if (q.type === "ordering") {
            const items = (q.content.items as { id: string }[]) ?? [];
            optOrders[q.id] = shuffleArray(items.map((o) => o.id));
          } else if (q.type === "matching") {
            const right = (q.content.right as { id: string }[]) ?? [];
            optOrders[q.id] = shuffleArray(right.map((o) => o.id));
          }
        }

        const attId = randomUUID();
        db.prepare(
          `INSERT INTO attempts (
            id, assessment_id, snapshot_id, student_id, attempt_no, status, grading_status,
            started_at, deadline_at, question_order, option_orders, current_question_id,
            answered_count, last_seen_at, lockdown_event_count, created_at
          ) VALUES (?, ?, ?, ?, ?, 'in_progress', 'pending', ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
        ).run(
          attId,
          aId,
          snap.id,
          ctx.userId,
          Number(used.c) + 1,
          nowIso,
          deadlineMs ? new Date(deadlineMs).toISOString() : null,
          JSON.stringify(qOrder),
          JSON.stringify(optOrders),
          qOrder[0] ?? null,
          nowIso,
          nowIso,
        );
        return { data: attId, error: null };
      }

      case "finalize_attempt": {
        const res = finalizeAttemptRpc(ctx, String(args.p_attempt ?? ""), args.p_reason as "manual" | "timeout" | "teacher");
        return { data: res, error: null };
      }

      case "submit_attempt": {
        const attId = String(args.p_attempt ?? "");
        const t = deserializeRow("attempts", db.prepare("SELECT * FROM attempts WHERE id = ?").get(attId));
        if (!t || t.student_id !== ctx.userId) return { data: null, error: err("forbidden", "42501") };
        if (t.status === "submitted") {
          return { data: { status: "submitted", submitted_at: t.submitted_at, duplicate: true }, error: null };
        }
        const reason = t.deadline_at && Date.now() > new Date(String(t.deadline_at)).getTime() ? "timeout" : "manual";
        const updated = finalizeAttemptRpc(ctx, attId, reason);
        return { data: { status: "submitted", submitted_at: updated.submitted_at, reason: updated.submit_reason, duplicate: false }, error: null };
      }

      case "save_answer": {
        const attId = String(args.p_attempt ?? "");
        const qId = String(args.p_question ?? "");
        const response = args.p_response ?? {};
        const seq = Number(args.p_seq ?? 0);
        const flagged = args.p_flagged;

        const t = deserializeRow("attempts", db.prepare("SELECT * FROM attempts WHERE id = ?").get(attId));
        if (!t || t.student_id !== ctx.userId) return { data: null, error: err("forbidden", "42501") };
        if (t.status !== "in_progress") {
          return { data: { ok: false, reason: "locked", server_now: nowIso }, error: null };
        }
        if (t.deadline_at && Date.now() > new Date(String(t.deadline_at)).getTime() + 10000) {
          finalizeAttemptRpc(ctx, attId, "timeout");
          return { data: { ok: false, reason: "expired", server_now: nowIso }, error: null };
        }
        const order = (t.question_order as string[]) ?? [];
        if (!order.includes(qId)) return { data: null, error: err("unknown_question", "22023") };

        const existing = db.prepare("SELECT id, client_seq, flagged FROM answers WHERE attempt_id = ? AND question_id = ?").get(attId, qId) as
          | { id: string; client_seq: number; flagged: number }
          | undefined;
        let applied = false;
        if (!existing) {
          db.prepare("INSERT INTO answers (id, attempt_id, question_id, response, client_seq, flagged, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
            randomUUID(),
            attId,
            qId,
            JSON.stringify(response),
            seq,
            flagged ? 1 : 0,
            nowIso,
            nowIso,
          );
          applied = true;
        } else if (Number(existing.client_seq) < seq) {
          db.prepare("UPDATE answers SET response = ?, client_seq = ?, flagged = ?, updated_at = ? WHERE id = ?").run(
            JSON.stringify(response),
            seq,
            flagged === null || flagged === undefined ? existing.flagged : flagged ? 1 : 0,
            nowIso,
            existing.id,
          );
          applied = true;
        }

        const ansCnt = db.prepare("SELECT COUNT(*) AS c FROM answers WHERE attempt_id = ? AND response <> '{}'").get(attId) as { c: number };
        db.prepare("UPDATE attempts SET last_seen_at = ?, current_question_id = ?, answered_count = ? WHERE id = ?").run(
          nowIso,
          qId,
          Number(ansCnt.c),
          attId,
        );

        return {
          data: { ok: true, applied, seq, server_now: nowIso, deadline_at: t.deadline_at },
          error: null,
        };
      }

      case "attempt_heartbeat": {
        const attId = String(args.p_attempt ?? "");
        const curQ = args.p_current_question ? String(args.p_current_question) : null;
        let t = deserializeRow("attempts", db.prepare("SELECT * FROM attempts WHERE id = ?").get(attId));
        if (!t || t.student_id !== ctx.userId) return { data: null, error: err("forbidden", "42501") };
        if (t.status === "in_progress" && t.deadline_at && Date.now() > new Date(String(t.deadline_at)).getTime()) {
          t = finalizeAttemptRpc(ctx, attId, "timeout");
        } else if (t.status === "in_progress") {
          const order = (t.question_order as string[]) ?? [];
          const nextQ = curQ && order.includes(curQ) ? curQ : t.current_question_id;
          db.prepare("UPDATE attempts SET last_seen_at = ?, current_question_id = ? WHERE id = ?").run(nowIso, nextQ, attId);
        }
        return { data: { status: t.status, server_now: nowIso, deadline_at: t.deadline_at, submitted_at: t.submitted_at }, error: null };
      }

      case "expire_overdue_attempts": {
        const overdue = db.prepare("SELECT id FROM attempts WHERE status = 'in_progress' AND deadline_at IS NOT NULL AND deadline_at < ?").all(nowIso) as {
          id: string;
        }[];
        for (const r of overdue) finalizeAttemptRpc(ctx, r.id, "timeout");
        return { data: overdue.length, error: null };
      }

      case "claim_ocr_job": {
        const stale = new Date(Date.now() - 10 * 60000).toISOString();
        const raw = db
          .prepare(
            `SELECT * FROM ocr_jobs
             WHERE (status = 'uploaded' OR (status IN ('processing','extracting_text','generating_questions') AND locked_at < ?))
               AND tries < 3
             ORDER BY created_at ASC LIMIT 1`,
          )
          .get(stale);
        if (!raw) return { data: null, error: null };
        db.prepare("UPDATE ocr_jobs SET status = 'processing', locked_at = ?, tries = tries + 1, last_error = NULL, updated_at = ? WHERE id = ?").run(
          nowIso,
          nowIso,
          raw.id,
        );
        return { data: deserializeRow("ocr_jobs", db.prepare("SELECT * FROM ocr_jobs WHERE id = ?").get(raw.id)), error: null };
      }

      case "claim_grading_job": {
        const stale = new Date(Date.now() - 5 * 60000).toISOString();
        const raw = db
          .prepare(
            `SELECT * FROM grading_jobs
             WHERE (status = 'queued' OR (status = 'running' AND locked_at < ?))
               AND tries < 3
             ORDER BY created_at ASC LIMIT 1`,
          )
          .get(stale);
        if (!raw) return { data: null, error: null };
        db.prepare("UPDATE grading_jobs SET status = 'running', locked_at = ?, tries = tries + 1, updated_at = ? WHERE id = ?").run(nowIso, nowIso, raw.id);
        return { data: deserializeRow("grading_jobs", db.prepare("SELECT * FROM grading_jobs WHERE id = ?").get(raw.id)), error: null };
      }

      default:
        return { data: null, error: err(`Unknown RPC: ${fn}`) };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: err(msg, msg === "forbidden" ? "42501" : "P0001") };
  }
}

function buildStorageBucket(bucket: string) {
  const bucketDir = path.join(STORAGE_DIR, bucket);
  const resolveSafe = (storagePath: string) => {
    const clean = storagePath.replace(/^\/+/, "").replace(/\.\./g, "");
    return path.join(bucketDir, ...clean.split("/"));
  };

  return {
    async upload(storagePath: string, data: Uint8Array | ArrayBuffer | Buffer, opts?: { upsert?: boolean }) {
      const target = resolveSafe(storagePath);
      if (!opts?.upsert && existsSync(target)) return { data: null, error: { message: "Object already exists" } };
      mkdirSync(path.dirname(target), { recursive: true });
      const buf = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data));
      writeFileSync(target, buf);
      return { data: { path: storagePath }, error: null };
    },
    async download(storagePath: string) {
      const target = resolveSafe(storagePath);
      if (!existsSync(target)) return { data: null, error: { message: "Not found" } };
      const buf = readFileSync(target);
      return { data: new Blob([buf]), error: null };
    },
    async remove(paths: string[]) {
      for (const p of paths) {
        const target = resolveSafe(p);
        if (existsSync(target)) rmSync(target, { force: true });
      }
      return { data: paths.map((p) => ({ name: p })), error: null };
    },
    async createSignedUrl(storagePath: string, expiresInSec: number) {
      const secret = serverEnv().SESSION_SECRET;
      const exp = Math.floor(Date.now() / 1000) + expiresInSec;
      const token = await signToken({ bucket, path: storagePath, exp }, secret);
      const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
      return { data: { signedUrl: `/api/storage/${encodeURIComponent(bucket)}/${encodedPath}?token=${encodeURIComponent(token)}` }, error: null };
    },
  };
}

function toAuthUser(raw: Record<string, unknown>) {
  const uMeta = typeof raw.user_metadata === "string" ? (JSON.parse(raw.user_metadata) as Record<string, unknown>) : ((raw.user_metadata ?? {}) as Record<string, unknown>);
  const aMeta = typeof raw.app_metadata === "string" ? (JSON.parse(raw.app_metadata) as Record<string, unknown>) : ((raw.app_metadata ?? {}) as Record<string, unknown>);
  return {
    id: String(raw.id),
    email: String(raw.email),
    user_metadata: uMeta,
    app_metadata: aMeta,
    created_at: String(raw.created_at),
  };
}

export async function createLocalServerClient(cookieAdapter: CookieAdapter) {
  const db = getSqliteDb();
  const secret = serverEnv().SESSION_SECRET;
  const sessionCookie = cookieAdapter.getAll().find((c) => c.name === LOCAL_SESSION_COOKIE)?.value;
  const verified = await verifyToken<LocalSessionPayload>(sessionCookie, secret);

  let currentUserRow = verified ? db.prepare("SELECT * FROM auth_users WHERE id = ?").get(verified.sub) : undefined;
  let currentUserId = currentUserRow ? String(currentUserRow.id) : null;

  const setSessionCookie = async (userId: string, email: string) => {
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    const token = await signToken({ sub: userId, email, exp }, secret);
    try {
      cookieAdapter.set(LOCAL_SESSION_COOKIE, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 86400,
      });
    } catch {
      // Ignored inside RSC render
    }
  };

  const getCtx = () => new AuthCtx(db, currentUserId, false);

  return {
    from(table: string) {
      return new LocalQueryBuilder(getCtx(), table);
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      return Promise.resolve(executeRpc(getCtx(), fn, args));
    },
    storage: {
      from(bucket: string) {
        return buildStorageBucket(bucket);
      },
    },
    auth: {
      async getUser() {
        if (!currentUserRow) return { data: { user: null }, error: null };
        return { data: { user: toAuthUser(currentUserRow) }, error: null };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const lower = email.trim().toLowerCase();
        const u = db.prepare("SELECT * FROM auth_users WHERE email = ?").get(lower);
        if (!u || !verifyPassword(password, String(u.password_hash))) {
          return { data: { user: null, session: null }, error: { message: "Invalid login credentials", code: "invalid_credentials" } };
        }
        currentUserRow = u;
        currentUserId = String(u.id);
        await setSessionCookie(currentUserId, lower);
        const userObj = toAuthUser(u);
        return { data: { user: userObj, session: { access_token: "local", user: userObj } }, error: null };
      },
      async signUp({
        email,
        password,
        options,
      }: {
        email: string;
        password: string;
        options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
      }) {
        const lower = email.trim().toLowerCase();
        if (password.length < 8) {
          return { data: { user: null, session: null }, error: { message: "Password too short", code: "weak_password" } };
        }
        const exists = db.prepare("SELECT id FROM auth_users WHERE email = ?").get(lower);
        if (exists) {
          return { data: { user: null, session: null }, error: { message: "Email already registered", code: "email_exists" } };
        }
        const now = new Date().toISOString();
        const id = randomUUID();
        const meta = options?.data ?? {};
        const locale = meta.locale === "kk" ? "kk" : "ru";
        const fullName = String(meta.full_name ?? "").slice(0, 200);
        const login = typeof meta.login === "string" && meta.login.trim() ? meta.login.trim().toLowerCase() : null;

        db.prepare(
          `INSERT INTO auth_users (id, email, password_hash, email_confirmed_at, user_metadata, app_metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, lower, hashPassword(password), now, JSON.stringify(meta), JSON.stringify(login ? { login } : {}), now);
        db.prepare(
          `INSERT INTO profiles (id, full_name, email, locale, login, is_super_admin, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(id, fullName, lower, locale, login, now, now);

        currentUserRow = db.prepare("SELECT * FROM auth_users WHERE id = ?").get(id);
        currentUserId = id;
        await setSessionCookie(id, lower);
        const userObj = toAuthUser(currentUserRow!);
        return { data: { user: userObj, session: { access_token: "local", user: userObj } }, error: null };
      },
      async signOut() {
        currentUserRow = undefined;
        currentUserId = null;
        try {
          cookieAdapter.set(LOCAL_SESSION_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
        } catch {
          // ignore
        }
        return { error: null };
      },
      async updateUser(attrs: { password?: string; data?: Record<string, unknown> }) {
        if (!currentUserId || !currentUserRow) return { data: { user: null }, error: { message: "Not authenticated", code: "not_authenticated" } };
        if (attrs.password) {
          if (verifyPassword(attrs.password, String(currentUserRow.password_hash))) {
            return { data: { user: null }, error: { message: "Same password", code: "same_password" } };
          }
          db.prepare("UPDATE auth_users SET password_hash = ? WHERE id = ?").run(hashPassword(attrs.password), currentUserId);
        }
        if (attrs.data) {
          const prev = typeof currentUserRow.user_metadata === "string" ? JSON.parse(currentUserRow.user_metadata) : (currentUserRow.user_metadata ?? {});
          const merged = { ...prev, ...attrs.data };
          db.prepare("UPDATE auth_users SET user_metadata = ? WHERE id = ?").run(JSON.stringify(merged), currentUserId);
        }
        currentUserRow = db.prepare("SELECT * FROM auth_users WHERE id = ?").get(currentUserId);
        return { data: { user: toAuthUser(currentUserRow!) }, error: null };
      },
      async resetPasswordForEmail() {
        return { data: {}, error: null };
      },
      async exchangeCodeForSession() {
        return { data: { session: null, user: null }, error: null };
      },
      async verifyOtp() {
        return { data: { session: null, user: null }, error: null };
      },
    },
  };
}

export function createLocalAdminClient() {
  const db = getSqliteDb();
  const ctx = new AuthCtx(db, null, true);

  return {
    from(table: string) {
      return new LocalQueryBuilder(ctx, table);
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      return Promise.resolve(executeRpc(ctx, fn, args));
    },
    storage: {
      from(bucket: string) {
        return buildStorageBucket(bucket);
      },
    },
    auth: {
      admin: {
        async createUser(opts: {
          email: string;
          password: string;
          email_confirm?: boolean;
          user_metadata?: Record<string, unknown>;
          app_metadata?: Record<string, unknown>;
        }) {
          const lower = opts.email.trim().toLowerCase();
          const exists = db.prepare("SELECT id FROM auth_users WHERE email = ?").get(lower);
          if (exists) return { data: { user: null }, error: { message: "Email exists", code: "email_exists" } };
          const login = typeof opts.app_metadata?.login === "string" ? opts.app_metadata.login.trim().toLowerCase() : null;
          if (login) {
            const loginExists = db.prepare("SELECT id FROM profiles WHERE login = ?").get(login);
            if (loginExists) return { data: { user: null }, error: { message: "Login exists", code: "email_exists" } };
          }
          const now = new Date().toISOString();
          const id = randomUUID();
          const fullName = String(opts.user_metadata?.full_name ?? "").slice(0, 200);
          const locale = opts.user_metadata?.locale === "kk" ? "kk" : "ru";

          db.prepare(
            `INSERT INTO auth_users (id, email, password_hash, email_confirmed_at, user_metadata, app_metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, lower, hashPassword(opts.password), opts.email_confirm ? now : null, JSON.stringify(opts.user_metadata ?? {}), JSON.stringify(opts.app_metadata ?? {}), now);
          db.prepare(
            `INSERT INTO profiles (id, full_name, email, locale, login, is_super_admin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          ).run(id, fullName, lower, locale, login, now, now);

          return {
            data: { user: toAuthUser(db.prepare("SELECT * FROM auth_users WHERE id = ?").get(id)!) },
            error: null,
          };
        },
        async updateUserById(id: string, attrs: { password?: string }) {
          if (attrs.password) {
            db.prepare("UPDATE auth_users SET password_hash = ? WHERE id = ?").run(hashPassword(attrs.password), id);
          }
          const row = db.prepare("SELECT * FROM auth_users WHERE id = ?").get(id);
          return row ? { data: { user: toAuthUser(row) }, error: null } : { data: { user: null }, error: { message: "Not found" } };
        },
        async deleteUser(id: string) {
          db.prepare("DELETE FROM auth_users WHERE id = ?").run(id);
          return { data: { user: null }, error: null };
        },
      },
    },
  };
}
