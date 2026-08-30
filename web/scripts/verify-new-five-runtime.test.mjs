import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateNewFiveRuntime } from './verify-new-five-runtime.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const runtimeFile = path.resolve(here, '../src/generated/tcim-new-five-tables.runtime.v0.2.1.json')
const baseline = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'))

function clone(value) {
  return structuredClone(value)
}

function expectError(code, mutate) {
  const fixture = clone(baseline)
  mutate(fixture)
  const result = validateNewFiveRuntime(fixture)
  assert.equal(result.ok, false, code + ' fixture 应验证失败')
  assert.ok(result.errors.some((error) => error.code === code), '应报告 ' + code)
}

assert.equal(validateNewFiveRuntime(baseline).ok, true, '真实编译 JSON 应通过验证')

expectError('dataset_id_mismatch', (fixture) => {
  fixture.datasetId = 'LEGACY_DATASET'
})
expectError('question_set_mismatch', (fixture) => {
  fixture.questions.Q11 = clone(fixture.questions.Q10)
  fixture.questions.Q11.questionId = 'Q11'
})
expectError('legacy_key_present', (fixture) => {
  fixture.questions.Q01.slots = []
})
expectError('duplicate_id', (fixture) => {
  fixture.questions.Q01.evidencePolicies[1].evidenceClaimId =
    fixture.questions.Q01.evidencePolicies[0].evidenceClaimId
})
expectError('unresolved_target_understanding', (fixture) => {
  fixture.questions.Q01.dialoguePolicies[0].targetUnderstandingIds = ['UND-NOT-FOUND']
})
expectError('unresolved_target_capability', (fixture) => {
  fixture.questions.Q01.dialoguePolicies[0].targetCapabilityIds = ['CAP-NOT-FOUND']
})
expectError('unresolved_evidence_claim', (fixture) => {
  fixture.questions.Q01.synthesisPolicies[0].requiredEvidenceClaimIds = ['CLAIM-NOT-FOUND']
})
expectError('hard_boundary_marker_mismatch', (fixture) => {
  const hard = fixture.questions.Q01.dialoguePolicies.find((policy) => policy.type === 'HARD_BOUNDARY')
  hard.runtimeUse = 'AFFORDANCE_CARD'
})
expectError('pretest_not_prior_only', (fixture) => {
  fixture.questions.Q01.pretestPrior.assessmentRelation = 'DIRECT_EVIDENCE'
})
expectError('pretest_prior_overprecise', (fixture) => {
  fixture.questions.Q01.pretestPrior.content = 'ABCD 是高分组合'
})
expectError('epistemic_routing_mismatch', (fixture) => {
  fixture.questions.Q01.contextFacts[0].epistemicStatus = 'AI_HYPOTHESIS'
})
expectError('epistemic_item_type_mismatch', (fixture) => {
  fixture.questions.Q01.contextFacts[0].type = 'SCENARIO_NARRATIVE'
})
expectError('primary_profile_capability_missing', (fixture) => {
  fixture.questions.Q01.evidencePolicies[0].primaryProfileCapabilityId = ''
})
expectError('evidence_path_capability_mismatch', (fixture) => {
  fixture.questions.Q01.evidencePolicies[0].capabilityRefs.push('C12')
})
expectError('primary_profile_capability_path_mismatch', (fixture) => {
  fixture.questions.Q01.evidencePolicies[0].capabilityRefs = ['C12']
  fixture.questions.Q01.evidencePolicies[0].primaryProfileCapabilityId = 'C12'
})
expectError('primary_profile_capability_coverage_gap', (fixture) => {
  for (const question of Object.values(fixture.questions)) {
    for (const policy of question.evidencePolicies) {
      if (policy.primaryProfileCapabilityId === 'C09') policy.primaryProfileCapabilityId = 'C10'
    }
  }
})
expectError('tevv_policy_present', (fixture) => {
  fixture.questions.Q01.synthesisPolicies.push({
    policyId: 'Q01-TEVV-FIXTURE',
    type: 'TEVV',
    runtimeUse: 'TEVV_CASE'
  })
})
expectError('evidence_path_rule_invalid', (fixture) => {
  fixture.questions.Q01.evidencePolicies[0].pathMatchRule = 'ALL_OF'
})
expectError('evidence_path_count_invalid', (fixture) => {
  fixture.questions.Q01.evidencePolicies[0].pathRefs = []
})
expectError('unresolved_evidence_path', (fixture) => {
  fixture.questions.Q01.evidencePolicies[0].pathRefs[0] = 'PATH-Q10-NOT-FOUND'
})
expectError('origin_path_refs_forbidden', (fixture) => {
  fixture.global.evidencePolicies[0].pathRefs = ['PATH-Q01-001-A']
})

console.log('新五表运行时验证器负向夹具通过：21 类违规均被确定性拒绝。')
