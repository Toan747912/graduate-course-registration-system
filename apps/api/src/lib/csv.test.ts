import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraduationCsv, escapeCsvField, GRADUATION_CSV_HEADERS, toCsvRow, type GraduationCsvRow } from './csv.js';

// ---------------------------------------------------------------------------
// RFC 4180 escaping
// ---------------------------------------------------------------------------

test('escapeCsvField leaves a plain value untouched', () => {
  assert.equal(escapeCsvField('SV001'), 'SV001');
});

test('escapeCsvField quotes a value containing a comma', () => {
  assert.equal(escapeCsvField('Nguyễn, Văn A'), '"Nguyễn, Văn A"');
});

test('escapeCsvField quotes a value containing a double quote and doubles it', () => {
  assert.equal(escapeCsvField('Đề tài "AI"'), '"Đề tài ""AI"""');
});

test('escapeCsvField quotes a value containing a newline', () => {
  assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCsvField('line1\r\nline2'), '"line1\r\nline2"');
});

// ---------------------------------------------------------------------------
// CSV/spreadsheet formula injection defense
// ---------------------------------------------------------------------------

test('escapeCsvField neutralizes a leading = (formula injection)', () => {
  // The value also contains double quotes, so it is additionally
  // RFC4180-quoted (embedded quotes doubled) after the formula prefix.
  assert.equal(escapeCsvField('=cmd|"/c calc"!A1'), '"\'=cmd|""/c calc""!A1"');
  assert.equal(escapeCsvField('=1+1'), "'=1+1");
});

test('escapeCsvField neutralizes a leading +, -, and @', () => {
  assert.equal(escapeCsvField('+1+1').startsWith("'+"), true);
  assert.equal(escapeCsvField('-2+3').startsWith("'-"), true);
  assert.equal(escapeCsvField('@SUM(A1)').startsWith("'@"), true);
});

test('escapeCsvField does not touch a value that merely contains (not starts with) =/+/-/@', () => {
  assert.equal(escapeCsvField('a=b'), 'a=b');
  assert.equal(escapeCsvField('SV-001'), 'SV-001');
});

test('escapeCsvField applies the formula prefix BEFORE quote-escaping, so an injected+quoted value is still safe', () => {
  const evil = '=1+1,"gotcha"';
  const out = escapeCsvField(evil);
  assert.equal(out.startsWith('"\'='), true);
  assert.equal(out.includes('""gotcha""'), true);
});

// ---------------------------------------------------------------------------
// row/document assembly
// ---------------------------------------------------------------------------

test('toCsvRow joins escaped fields with commas', () => {
  assert.equal(toCsvRow(['a', 'b,c', 'd']), 'a,"b,c",d');
});

test('GRADUATION_CSV_HEADERS has exactly the 10 documented columns in order', () => {
  assert.deepEqual(GRADUATION_CSV_HEADERS, [
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
  ]);
});

test('buildGraduationCsv starts with a UTF-8 BOM', () => {
  const csv = buildGraduationCsv([]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('buildGraduationCsv uses CRLF line endings', () => {
  const row: GraduationCsvRow = {
    student_code: 'SV001',
    full_name: 'Nguyễn Văn A',
    program_name: 'CNTT',
    cohort_code: 'K2021',
    academic_status: 'STUDYING',
    eligibility_status: 'ELIGIBLE',
    required_credits_earned: 30,
    elective_credits_earned: 10,
    thesis_completed_at: '2026-01-01T00:00:00Z',
    reasons: [],
  };
  const csv = buildGraduationCsv([row]);
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], GRADUATION_CSV_HEADERS.join(','));
  assert.equal(lines[1], 'SV001,Nguyễn Văn A,CNTT,K2021,STUDYING,ELIGIBLE,30,10,2026-01-01T00:00:00Z,');
});

test('buildGraduationCsv renders null fields as empty strings, never "null"/"undefined"', () => {
  const row: GraduationCsvRow = {
    student_code: null,
    full_name: 'Trần Thị B',
    program_name: null,
    cohort_code: null,
    academic_status: 'STUDYING',
    eligibility_status: 'NOT_ELIGIBLE',
    required_credits_earned: null,
    elective_credits_earned: null,
    thesis_completed_at: null,
    reasons: ['required_credits_not_met', 'no_completed_thesis'],
  };
  const csv = buildGraduationCsv([row]);
  assert.equal(csv.includes('null'), false);
  assert.equal(csv.includes('undefined'), false);
  assert.equal(csv.includes('required_credits_not_met; no_completed_thesis'), true);
});

test('buildGraduationCsv neutralizes a malicious full_name across a whole export', () => {
  const row: GraduationCsvRow = {
    student_code: 'SV002',
    full_name: '=HYPERLINK("http://evil.example","click")',
    program_name: 'CNTT',
    cohort_code: 'K2021',
    academic_status: 'STUDYING',
    eligibility_status: 'ELIGIBLE',
    required_credits_earned: 30,
    elective_credits_earned: 10,
    thesis_completed_at: null,
    reasons: [],
  };
  const csv = buildGraduationCsv([row]);
  // The value contains a comma so it is also RFC4180-quoted; the formula
  // prefix must still be present right after the opening quote.
  assert.equal(csv.includes('SV002,"\'=HYPERLINK'), true);
  // And a formula-triggering value must never appear un-neutralized.
  assert.equal(/,=HYPERLINK|^=HYPERLINK|,"=HYPERLINK/.test(csv), false);
});
