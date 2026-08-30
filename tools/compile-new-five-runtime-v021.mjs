import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const artifactToolModule = process.env.TCIM_ARTIFACT_TOOL_MODULE || '@oai/artifact-tool';
const { FileBlob, SpreadsheetFile } = await import(artifactToolModule);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'config', 'new-five-tables', 'source');
const targetDir = path.join(repoRoot, 'web', 'src', 'generated');
const targetPath = path.join(targetDir, 'tcim-new-five-tables.runtime.v0.2.1.json');
const specs = [
  ['t1', '01_TCIM_十题_情境深描与条件边界表_V0.2.1_唯一运行版.xlsx'],
  ['t2', '02_TCIM_十题_教师游戏支持能力多路径Ontology表_V0.2.1_唯一运行版.xlsx'],
  ['t3', '03_TCIM_十题_证据命题来源等级与反事实判据表_V0.2.1_唯一运行版.xlsx'],
  ['t4', '04_TCIM_十题_开放探询可供性与稀疏监督表_V0.2.1_唯一运行版.xlsx'],
  ['t5', '05_TCIM_十题_综合判断记忆写入与TEVV表_V0.2.1_唯一运行版.xlsx'],
];

const raw = {};
const sources = [];
for (const [key, file] of specs) {
  const fullPath = path.join(sourceDir, file);
  const bytes = await fs.readFile(fullPath);
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(fullPath));
  const values = workbook.worksheets.getItem('DATA').getUsedRange(true).values;
  const headers = values[0].map((value) => String(value ?? '').trim());
  raw[key] = values.slice(1)
    .filter((row) => row.some((value) => value !== null && value !== ''))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])))
    .filter((row) => row.active_in_simulation === true && row.release_scope === 'SIMULATION_ACTIVE');
  sources.push({ file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), records: raw[key].length });
}

const split = (value) => String(value ?? '').split('|').map((x) => x.trim()).filter(Boolean);
const compact = (record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== '' && (!Array.isArray(value) || value.length)));
const forQuestion = (rows, qid, includeAll = true) => rows.filter((row) => row.question_id === qid || (includeAll && row.question_id === 'ALL'));

function mapScenario(row) {
  return compact({
    id: row.record_id,
    type: row.item_type,
    epistemicStatus: row.epistemic_status,
    content: row.content,
    optionCode: row.option_code,
    assessmentRelation: row.assessment_relation,
    applicability: row.applicability_condition,
    changesJudgmentWhen: row.changes_judgment_when,
    plausibleInterpretation: row.plausible_interpretation,
    alternativeExplanation: row.alternative_explanation,
    missingInformation: row.missing_information,
    discriminatingObservation: row.discriminating_observation,
    relatedCapabilities: split(row.related_capability_ids),
    doNotAssume: row.do_not_assume,
    sourceRef: row.source_ref,
  });
}

function mapLens(row) {
  return compact({
    recordId: row.record_id,
    capabilityId: row.capability_concept_id,
    parentCapabilityIds: split(row.parent_concept_ids),
    name: row.capability_name,
    definition: row.capability_definition,
    pathId: row.path_id,
    pathName: row.path_name,
    pathDescription: row.path_description,
    applicability: row.applicability_conditions,
    exclusions: row.exclusion_conditions,
    tradeoffs: row.tradeoffs,
    observableOpportunities: row.observable_opportunities,
    observableIndicators: row.observable_indicators,
    alternativePathIds: split(row.alternative_path_ids),
    relatedContextIds: split(row.related_context_ids),
    notEquivalentTo: row.not_equivalent_to,
    absenceNotInterpretableWhen: row.absence_not_interpretable_when,
    prohibitedInference: row.prohibited_inference,
    autonomyNote: row.model_autonomy_note,
    scope: row.runtime_use,
    sourceRef: row.source_ref,
  });
}

function mapEvidence(row) {
  const mapped = compact({
    recordId: row.record_id,
    understandingId: row.understanding_id,
    evidenceClaimId: row.evidence_claim_id,
    claimType: row.claim_type,
    capabilityRefs: split(row.capability_refs),
    primaryProfileCapabilityId: row.primary_profile_capability_id,
    pathRefs: split(row.path_refs),
    pathRelationMode: row.path_relation_mode,
    pathMatchRule: row.path_match_rule,
    pathRelationReason: row.path_relation_reason,
    claimTemplate: row.claim_template,
    applicability: row.applicability_conditions,
    supportAnchors: row.support_anchors,
    allowedResponseOrigins: split(row.allowed_response_origins),
    independenceRequirement: row.independence_requirement,
    teacherConfirmationRequired: row.teacher_confirmation_required,
    sourceSpanRequired: row.source_span_required,
    minEvidenceLevel: row.min_evidence_level,
    counterevidence: row.counterevidence,
    pseudoEvidence: row.pseudo_evidence,
    alternativeExplanation: row.alternative_explanation,
    discriminatingObservation: row.discriminating_observation,
    contradictionRule: row.contradiction_rule,
    contextBoundary: row.context_boundary,
    maxSupportedConclusion: row.max_supported_conclusion,
    prohibitedConclusion: row.prohibited_conclusion,
    crossContextRequirement: row.cross_context_requirement,
    fairnessNote: row.fairness_note,
    memoryCandidateAllowed: row.memory_candidate_allowed,
    owner: row.canonical_write_owner,
    runtimeUse: row.runtime_use,
    sourceRef: row.source_ref,
  });
  // 空数组本身是来源政策“明确不适用路径”的契约值，不能被 compact 删除。
  mapped.pathRefs = split(row.path_refs);
  return mapped;
}

function mapDialogue(row) {
  return compact({
    recordId: row.record_id,
    policyId: row.dialogue_policy_id,
    type: row.policy_type,
    name: row.policy_name,
    targetUnderstandingIds: split(row.target_understanding_ids),
    targetCapabilityIds: split(row.target_capability_ids),
    missionRelation: row.mission_relation,
    triggerConditions: row.trigger_conditions,
    postureOptions: split(row.posture_options),
    freedomScope: row.freedom_scope,
    allowedActions: split(row.allowed_actions),
    probeIntents: split(row.probe_intents),
    prohibitedActions: split(row.prohibited_actions),
    negativeExamples: row.negative_examples,
    constraintLevel: row.constraint_level,
    rrmcSignal: row.rrmc_signal,
    eventTriggers: split(row.event_triggers),
    periodicInterval: row.periodic_interval,
    expirationTurns: row.expiration_turns,
    agentMayDecline: row.agent_may_decline,
    declineReasonCodes: split(row.decline_reason_codes),
    relationshipSignals: split(row.relationship_quality_signals),
    cognitiveLoadSignals: split(row.cognitive_load_signals),
    safetyGateRequired: row.safety_gate_required,
    runtimeUse: row.runtime_use,
    sourceRef: row.source_ref,
  });
}

function mapSynthesis(row) {
  return compact({
    recordId: row.record_id,
    policyId: row.synthesis_policy_id,
    type: row.policy_type,
    name: row.policy_name,
    triggerConditions: row.trigger_conditions,
    requiredEvidenceClaimIds: split(row.required_evidence_claim_ids),
    requiredCapabilityIds: split(row.required_capability_ids),
    minSourceDiversity: row.min_source_diversity,
    counterevidenceRequired: row.counterevidence_required,
    teacherConfirmationRequired: row.teacher_confirmation_required,
    contextBoundary: row.context_boundary,
    confidenceBands: split(row.confidence_band_allowed),
    maxPermittedClaim: row.max_permitted_claim,
    prohibitedClaim: row.prohibited_claim,
    memoryType: row.memory_type,
    memoryWriteRule: row.memory_write_rule,
    memoryExpiryRule: row.memory_expiry_rule,
    correctionRule: row.correction_rule,
    stopRecommendation: row.stop_recommendation,
    prohibitedStopCondition: row.prohibited_stop_condition,
    runtimeUse: row.runtime_use,
    sourceRef: row.source_ref,
  });
}

const questions = {};
for (let number = 1; number <= 10; number += 1) {
  const qid = `Q${String(number).padStart(2, '0')}`;
  const scenarioRows = forQuestion(raw.t1, qid, false).map(mapScenario);
  questions[qid] = {
    questionId: qid,
    scenarioId: `SCN-${qid}-01`,
    scenario: scenarioRows.find((row) => row.type === 'SCENARIO_NARRATIVE') || null,
    professionalFocus: scenarioRows.find((row) => row.type === 'PROFESSIONAL_FOCUS') || null,
    pretestOptions: scenarioRows.filter((row) => row.type === 'PRETEST_OPTION'),
    pretestPrior: scenarioRows.find((row) => row.type === 'PRETEST_PRIOR_RULE') || null,
    contextFacts: scenarioRows.filter((row) => row.epistemicStatus === 'SCENARIO_FACT'),
    importantUnknowns: scenarioRows.filter((row) => row.epistemicStatus === 'UNKNOWN'),
    workingHypotheses: scenarioRows.filter((row) => ['HUMAN_HYPOTHESIS', 'AI_HYPOTHESIS'].includes(row.epistemicStatus)),
    contextVariants: scenarioRows.filter((row) => row.epistemicStatus === 'CONTEXT_VARIANT'),
    professionalLenses: forQuestion(raw.t2, qid, false).map(mapLens),
    evidencePolicies: forQuestion(raw.t3, qid, false).map(mapEvidence),
    dialoguePolicies: forQuestion(raw.t4, qid, false).map(mapDialogue),
    synthesisPolicies: forQuestion(raw.t5, qid, false)
      .filter((row) => row.runtime_use !== 'TEVV_CASE')
      .map(mapSynthesis),
  };
}

const output = {
  schemaVersion: '0.2.1',
  datasetId: 'TCIM_NEW_FIVE_TABLES_RUNTIME_V0.2.1',
  releaseScope: 'SIMULATION_ACTIVE',
  sourceNote: 'V0.2.1聚焦修订：低精度可撤销前测先验、事实/假设分流、唯一主要画像能力与Q08题面污染隔离。AI模拟研究团队复核候选；只用于本地比较试验，不等于真人专家批准。',
  sources,
  global: {
    professionalLenses: forQuestion(raw.t2, 'ALL', false).map(mapLens),
    evidencePolicies: forQuestion(raw.t3, 'ALL', false).map(mapEvidence),
    dialoguePolicies: forQuestion(raw.t4, 'ALL', false).map(mapDialogue),
    synthesisPolicies: forQuestion(raw.t5, 'ALL', false)
      .filter((row) => row.runtime_use !== 'TEVV_CASE')
      .map(mapSynthesis),
  },
  questions,
};
output.configFingerprint = crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex');
await fs.mkdir(targetDir, { recursive: true });
await fs.writeFile(targetPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(`${targetPath}\n${output.configFingerprint}\n`);
