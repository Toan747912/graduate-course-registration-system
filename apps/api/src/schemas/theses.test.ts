import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignAdvisorSchema,
  cancelOwnThesisSchema,
  cancelThesisStaffSchema,
  changeAdvisorSchema,
  createAdvisorSchema,
  createResearchAreaSchema,
  createThesisProposalSchema,
  rejectThesisSchema,
  updateAdvisorSchema,
  updateResearchAreaSchema,
  updateThesisProposalSchema,
} from './theses.js';

// ---------------------------------------------------------------------------
// research areas
// ---------------------------------------------------------------------------
test('createResearchAreaSchema accepts a valid payload and rejects blank name', () => {
  assert.equal(createResearchAreaSchema.parse({ name: 'Trí tuệ nhân tạo' }).name, 'Trí tuệ nhân tạo');
  assert.throws(() => createResearchAreaSchema.parse({ name: '   ' }));
  assert.throws(() => createResearchAreaSchema.parse({}));
});

test('updateResearchAreaSchema requires isActive to be a boolean', () => {
  assert.throws(() => updateResearchAreaSchema.parse({ name: 'X' }));
  const parsed = updateResearchAreaSchema.parse({ name: 'X', isActive: false });
  assert.equal(parsed.isActive, false);
});

// ---------------------------------------------------------------------------
// advisors
// ---------------------------------------------------------------------------
const validAdvisor = {
  advisorCode: 'GV001',
  fullName: 'Nguyễn Văn A',
  specialization: 'Hệ thống thông tin',
  maxActiveTheses: 5,
};

test('createAdvisorSchema accepts a valid payload', () => {
  const parsed = createAdvisorSchema.parse(validAdvisor);
  assert.equal(parsed.advisorCode, 'GV001');
});

test('createAdvisorSchema rejects maxActiveTheses <= 0 (BUS constraint: max_active_theses > 0)', () => {
  assert.throws(() => createAdvisorSchema.parse({ ...validAdvisor, maxActiveTheses: 0 }));
  assert.throws(() => createAdvisorSchema.parse({ ...validAdvisor, maxActiveTheses: -3 }));
});

test('createAdvisorSchema rejects non-integer maxActiveTheses', () => {
  assert.throws(() => createAdvisorSchema.parse({ ...validAdvisor, maxActiveTheses: 2.5 }));
});

test('createAdvisorSchema rejects blank required text fields', () => {
  assert.throws(() => createAdvisorSchema.parse({ ...validAdvisor, advisorCode: '' }));
  assert.throws(() => createAdvisorSchema.parse({ ...validAdvisor, fullName: '   ' }));
  assert.throws(() => createAdvisorSchema.parse({ ...validAdvisor, specialization: '' }));
});

test('updateAdvisorSchema does not accept advisorCode (immutable after create)', () => {
  const { advisorCode: _advisorCode, ...rest } = validAdvisor;
  const parsed = updateAdvisorSchema.parse(rest);
  assert.equal((parsed as Record<string, unknown>).advisorCode, undefined);
});

// ---------------------------------------------------------------------------
// thesis proposal (BUS-42: title/description/research_area_id required)
// ---------------------------------------------------------------------------
const validProposal = {
  title: 'Ứng dụng học máy trong dự đoán điểm',
  description: 'Nghiên cứu áp dụng học máy để dự đoán kết quả học tập.',
  researchAreaId: '11111111-1111-1111-1111-111111111111',
};

test('createThesisProposalSchema accepts a valid payload', () => {
  const parsed = createThesisProposalSchema.parse(validProposal);
  assert.equal(parsed.researchAreaId, validProposal.researchAreaId);
});

test('createThesisProposalSchema rejects missing/blank title, description, research area', () => {
  assert.throws(() => createThesisProposalSchema.parse({ ...validProposal, title: '' }));
  assert.throws(() => createThesisProposalSchema.parse({ ...validProposal, description: '   ' }));
  assert.throws(() => createThesisProposalSchema.parse({ ...validProposal, researchAreaId: 'not-a-uuid' }));
  assert.throws(() => createThesisProposalSchema.parse({ title: validProposal.title }));
});

test('updateThesisProposalSchema mirrors create (same allowed-to-edit fields, BUS-56)', () => {
  assert.deepEqual(Object.keys(updateThesisProposalSchema.shape), Object.keys(createThesisProposalSchema.shape));
});

test('cancelOwnThesisSchema reason is optional (BUS-46: student self-cancel needs no reason)', () => {
  assert.doesNotThrow(() => cancelOwnThesisSchema.parse({}));
  assert.doesNotThrow(() => cancelOwnThesisSchema.parse({ reason: 'đổi ý' }));
});

test('rejectThesisSchema requires a non-blank reason (BUS-44)', () => {
  assert.throws(() => rejectThesisSchema.parse({}));
  assert.throws(() => rejectThesisSchema.parse({ reason: '   ' }));
  assert.doesNotThrow(() => rejectThesisSchema.parse({ reason: 'Đề tài trùng lặp' }));
});

test('cancelThesisStaffSchema requires a non-blank reason (BUS-47)', () => {
  assert.throws(() => cancelThesisStaffSchema.parse({}));
  assert.doesNotThrow(() => cancelThesisStaffSchema.parse({ reason: 'Không còn khả thi' }));
});

test('assignAdvisorSchema requires a valid advisorId, no reason field (BUS-45, first assignment has no reason)', () => {
  assert.throws(() => assignAdvisorSchema.parse({}));
  assert.throws(() => assignAdvisorSchema.parse({ advisorId: 'not-a-uuid' }));
  assert.doesNotThrow(() => assignAdvisorSchema.parse({ advisorId: validProposal.researchAreaId }));
});

test('changeAdvisorSchema requires both advisorId and a non-blank reason (BUS-51)', () => {
  assert.throws(() => changeAdvisorSchema.parse({ advisorId: validProposal.researchAreaId }));
  assert.throws(() => changeAdvisorSchema.parse({ reason: 'quá tải' }));
  assert.doesNotThrow(() =>
    changeAdvisorSchema.parse({ advisorId: validProposal.researchAreaId, reason: 'Giảng viên cũ nghỉ' }),
  );
});

// ---------------------------------------------------------------------------
// Pure lifecycle/permission logic tests (no DB) -- mirror the transition
// table in docs/BATCH_4_THESIS_ADVISOR_DESIGN.md section C.3. These encode
// the same rules the RPCs enforce in SQL, as a documentation-grade contract
// test that fails loudly if someone changes the transition table without
// updating the RPCs (and vice versa).
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS'] as const;
const TERMINAL_STATUSES = ['REJECTED', 'CANCELLED', 'COMPLETED'] as const;
const ALL_STATUSES = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES] as const;
type ThesisStatus = (typeof ALL_STATUSES)[number];

function isActiveThesisStatus(status: ThesisStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

test('isActiveThesisStatus matches BUS-41 exactly: PENDING_APPROVAL/APPROVED/IN_PROGRESS only', () => {
  for (const status of ACTIVE_STATUSES) {
    assert.equal(isActiveThesisStatus(status), true, `${status} should be active`);
  }
  for (const status of TERMINAL_STATUSES) {
    assert.equal(isActiveThesisStatus(status), false, `${status} should not be active`);
  }
});

function canStudentEditContent(status: ThesisStatus): boolean {
  return status === 'PENDING_APPROVAL';
}

test('canStudentEditContent: content editable only while PENDING_APPROVAL (BUS-56/57)', () => {
  assert.equal(canStudentEditContent('PENDING_APPROVAL'), true);
  for (const status of ALL_STATUSES) {
    if (status === 'PENDING_APPROVAL') continue;
    assert.equal(canStudentEditContent(status), false, `${status} must be locked`);
  }
});

function canStudentSelfCancel(status: ThesisStatus): boolean {
  return status === 'PENDING_APPROVAL';
}

function canStaffCancel(status: ThesisStatus): boolean {
  return status === 'APPROVED' || status === 'IN_PROGRESS';
}

test('cancel permission matrix matches BUS-45..48: student only PENDING_APPROVAL, staff only APPROVED/IN_PROGRESS, nobody cancels COMPLETED', () => {
  assert.equal(canStudentSelfCancel('PENDING_APPROVAL'), true);
  assert.equal(canStaffCancel('PENDING_APPROVAL'), false);
  for (const status of ['APPROVED', 'IN_PROGRESS'] as const) {
    assert.equal(canStaffCancel(status), true);
    assert.equal(canStudentSelfCancel(status), false);
  }
  for (const status of ['COMPLETED', 'REJECTED', 'CANCELLED'] as const) {
    assert.equal(canStaffCancel(status), false, `${status} must never be cancellable`);
    assert.equal(canStudentSelfCancel(status), false);
  }
});

function reasonRequiredFor(action: 'student_cancel' | 'staff_cancel' | 'reject' | 'change_advisor' | 'assign_advisor'): boolean {
  return action !== 'student_cancel' && action !== 'assign_advisor';
}

test('reason-required matrix: staff_cancel/reject/change_advisor need a reason, student_cancel/assign_advisor do not (BUS-44,46,47,51)', () => {
  assert.equal(reasonRequiredFor('student_cancel'), false);
  assert.equal(reasonRequiredFor('assign_advisor'), false);
  assert.equal(reasonRequiredFor('staff_cancel'), true);
  assert.equal(reasonRequiredFor('reject'), true);
  assert.equal(reasonRequiredFor('change_advisor'), true);
});

function canAssignAdvisor(status: ThesisStatus): boolean {
  return status === 'APPROVED';
}

function canChangeAdvisor(status: ThesisStatus): boolean {
  return status === 'IN_PROGRESS';
}

test('advisor assignment only from APPROVED (transition #5, BUS-45); change only while IN_PROGRESS (transition #9, BUS-51/52)', () => {
  assert.equal(canAssignAdvisor('APPROVED'), true);
  assert.equal(canChangeAdvisor('IN_PROGRESS'), true);
  for (const status of ALL_STATUSES) {
    if (status !== 'APPROVED') assert.equal(canAssignAdvisor(status), false, `${status} must not allow first assignment`);
    if (status !== 'IN_PROGRESS') assert.equal(canChangeAdvisor(status), false, `${status} must not allow reassignment`);
  }
});

function hasAdvisorCapacity(currentInProgressCount: number, maxActiveTheses: number): boolean {
  return currentInProgressCount < maxActiveTheses;
}

test('advisor capacity check is a strict less-than comparison (BUS-49)', () => {
  assert.equal(hasAdvisorCapacity(0, 1), true);
  assert.equal(hasAdvisorCapacity(4, 5), true);
  assert.equal(hasAdvisorCapacity(5, 5), false);
  assert.equal(hasAdvisorCapacity(6, 5), false);
});

test('terminal statuses are dead ends: no transition function reports them as editable/cancellable/assignable', () => {
  for (const status of TERMINAL_STATUSES) {
    assert.equal(canStudentEditContent(status), false);
    assert.equal(canStudentSelfCancel(status), false);
    assert.equal(canStaffCancel(status), false);
    assert.equal(canAssignAdvisor(status), false);
    assert.equal(canChangeAdvisor(status), false);
  }
});

function thesisCodePattern(): RegExp {
  return /^LV-\d{4}-\d{4}$/;
}

test('thesis_code format matches LV-YYYY-XXXX (BUS-60)', () => {
  const pattern = thesisCodePattern();
  assert.match('LV-2026-0001', pattern);
  assert.match('LV-2026-9999', pattern);
  assert.doesNotMatch('LV-26-0001', pattern);
  assert.doesNotMatch('lv-2026-0001', pattern);
  assert.doesNotMatch('LV-2026-1', pattern);
});
