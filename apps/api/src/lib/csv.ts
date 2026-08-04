// Batch 5 CSV export (docs/BATCH_5_GRADUATION_DASHBOARD_DESIGN.md, mục J,
// BUS-77). Pure functions, no I/O, so they are unit-testable without a DB or
// an Express app.

/**
 * Escapes a single CSV field per RFC 4180 (quote when the value contains a
 * comma, double-quote, or newline; double any embedded double-quotes) and
 * defuses CSV/spreadsheet formula injection: a value beginning with
 * `=`, `+`, `-`, or `@` is opened as a formula by Excel/Sheets/LibreOffice
 * when the file is opened, so such values are prefixed with a leading
 * single quote (`'`) -- the standard "force text" marker spreadsheet
 * applications strip from display but do not execute as part of a formula.
 * This runs BEFORE quoting, so an injected value like `=cmd|...` becomes
 * `'=cmd|...` and is then quoted normally if it also needs quoting.
 */
export function escapeCsvField(value: string): string {
  let v = value;
  if (/^[=+\-@]/.test(v)) {
    v = `'${v}`;
  }
  if (/[",\n\r]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

export const GRADUATION_CSV_HEADERS = [
  'mã học viên',
  'họ tên',
  'chương trình',
  'khóa',
  'academic status',
  'eligibility status',
  'tín chỉ bắt buộc đạt',
  'tín chỉ tự chọn đạt',
  'luận văn hoàn thành',
  'điều kiện còn thiếu',
] as const;

export interface GraduationCsvRow {
  student_code: string | null;
  full_name: string;
  program_name: string | null;
  cohort_code: string | null;
  academic_status: string;
  eligibility_status: string | null;
  required_credits_earned: number | null;
  elective_credits_earned: number | null;
  thesis_completed_at: string | null;
  reasons: string[] | null;
}

/**
 * Builds the full CSV document, including a leading UTF-8 BOM (so Excel on
 * Windows renders Vietnamese diacritics correctly instead of guessing a
 * Western codepage) and CRLF line endings (RFC 4180 default, also what
 * Excel expects).
 */
export function buildGraduationCsv(rows: GraduationCsvRow[]): string {
  const BOM = '﻿';
  const lines = [toCsvRow([...GRADUATION_CSV_HEADERS])];
  for (const r of rows) {
    lines.push(
      toCsvRow([
        r.student_code ?? '',
        r.full_name,
        r.program_name ?? '',
        r.cohort_code ?? '',
        r.academic_status,
        r.eligibility_status ?? '',
        r.required_credits_earned === null ? '' : String(r.required_credits_earned),
        r.elective_credits_earned === null ? '' : String(r.elective_credits_earned),
        r.thesis_completed_at ?? '',
        (r.reasons ?? []).join('; '),
      ]),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}
