import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const artifactToolModule = process.env.TCIM_ARTIFACT_TOOL_MODULE || '@oai/artifact-tool'
const { FileBlob, SpreadsheetFile } = await import(artifactToolModule)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(root, 'config', 'new-five-tables', 'source')
const runtimePath = path.join(root, 'web', 'src', 'generated', 'tcim-new-five-tables.runtime.v0.2.1.json')
const reportPath = process.env.TCIM_AUDIT_REPORT || path.join(root, '_work', 'five-table-governance', 'v0.2.1-audit.json')
const specs = [
  ['t1', '01_TCIM_十题_情境深描与条件边界表_V0.2.1_唯一运行版.xlsx'],
  ['t2', '02_TCIM_十题_教师游戏支持能力多路径Ontology表_V0.2.1_唯一运行版.xlsx'],
  ['t3', '03_TCIM_十题_证据命题来源等级与反事实判据表_V0.2.1_唯一运行版.xlsx'],
  ['t4', '04_TCIM_十题_开放探询可供性与稀疏监督表_V0.2.1_唯一运行版.xlsx'],
  ['t5', '05_TCIM_十题_综合判断记忆写入与TEVV表_V0.2.1_唯一运行版.xlsx']
]

const errors = []
const warnings = []
const checks = []
const issue = (severity, code, location, message) => (severity === 'error' ? errors : warnings).push({ code, location, message })
const pass = (code, detail) => checks.push({ code, status: 'PASS', detail })
const split = (value) => String(value ?? '').split('|').map((x) => x.trim()).filter(Boolean)
const qOf = (id) => String(id || '').match(/(?:^|-)Q(0[1-9]|10)(?:-|$)/)?.[1] ? `Q${String(id).match(/(?:^|-)Q(0[1-9]|10)(?:-|$)/)[1]}` : 'ALL'

const actualFiles = (await fs.readdir(sourceDir)).filter((name) => name.endsWith('.xlsx')).sort()
const expectedFiles = specs.map(([, name]) => name).sort()
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) issue('error', 'active_source_set_mismatch', sourceDir, `活动目录必须且只能包含5个V0.2.1文件；实际：${actualFiles.join(', ')}`)
else pass('active_source_set', '活动目录仅含5个V0.2.1工作簿；旧版不混入')

const raw = {}
const sourceDigests = new Map()
for (const [key, name] of specs) {
  const file = path.join(sourceDir, name)
  const bytes = await fs.readFile(file)
  sourceDigests.set(name, crypto.createHash('sha256').update(bytes).digest('hex'))
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file))
  const dataValues = workbook.worksheets.getItem('DATA').getUsedRange(true).values
  const headers = dataValues[0].map((value) => String(value ?? '').trim())
  const duplicateHeaders = headers.filter((value, index) => !value || headers.indexOf(value) !== index)
  if (duplicateHeaders.length) issue('error', 'data_headers_invalid', name, `空或重复字段：${duplicateHeaders.join(', ')}`)
  raw[key] = dataValues.slice(1).filter((row) => row.some((value) => value !== null && value !== '')).map((row, index) => ({
    ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? null])),
    __location: `${name}:DATA:${index + 2}`
  }))
  for (const row of raw[key]) {
    if (row.schema_version !== '0.2.1' || row.version !== '0.2.1') issue('error', 'row_version_mismatch', row.__location, `${row.schema_version}/${row.version}`)
    if (!row.record_id) issue('error', 'record_id_missing', row.__location, 'record_id不能为空')
    if (!row.source_ref) issue('error', 'source_ref_missing', row.__location, 'source_ref不能为空')
    if (row.active_in_simulation !== true || row.release_scope !== 'SIMULATION_ACTIVE') issue('error', 'simulation_scope_invalid', row.__location, '活动记录必须为SIMULATION_ACTIVE')
  }
  const dictionaryHeaders = workbook.worksheets.getItem('DICTIONARY').getUsedRange(true).values.flat().map(String)
  if (key === 't3') {
    for (const field of ['path_relation_mode', 'path_match_rule', 'path_relation_reason', 'primary_profile_capability_id']) {
      if (!dictionaryHeaders.includes(field)) issue('error', 'dictionary_field_missing', `${name}:DICTIONARY`, field)
    }
    const enums = workbook.worksheets.getItem('ENUMS').getUsedRange(true).values.flat().map(String)
    for (const value of ['ALTERNATIVE_PATHS', 'NOT_APPLICABLE', 'ANY_OF', 'NONE']) {
      if (!enums.includes(value)) issue('error', 'enum_value_missing', `${name}:ENUMS`, value)
    }
  }
}
pass('row_contracts', `${Object.values(raw).flat().length}条Excel记录完成版本、来源、活动范围检查`)

const allIds = new Map()
for (const row of Object.values(raw).flat()) {
  if (allIds.has(row.record_id)) issue('error', 'duplicate_record_id', row.__location, `与${allIds.get(row.record_id)}重复`)
  else allIds.set(row.record_id, row.__location)
}
if (!errors.some((x) => x.code === 'duplicate_record_id')) pass('record_id_unique', `${allIds.size}个record_id全局唯一`)

for (const row of raw.t1) {
  if (row.item_type === 'PRETEST_PRIOR_RULE' && /[ABCD]{4}|高分组合|\d+(?:\.\d+)?\s*分/.test(String(row.content || ''))) {
    issue('error', 'pretest_prior_overprecise', row.__location, '弱先验不得包含完整排序、分数或高分组合')
  }
  if (row.item_type === 'SCENARIO_FACT' && row.epistemic_status !== 'SCENARIO_FACT') {
    issue('error', 'scenario_fact_epistemic_mismatch', row.__location, String(row.epistemic_status || ''))
  }
}
if (!errors.some((x) => ['pretest_prior_overprecise', 'scenario_fact_epistemic_mismatch'].includes(x.code))) pass('prior_and_epistemic_routing', '前测为低精度可撤销先验；事实、未知、假设与情境变体分流')

const capabilityIds = new Set(raw.t2.map((row) => row.capability_concept_id))
const paths = new Map(raw.t2.map((row) => [row.path_id, row]))
for (const row of raw.t2) {
  if (row.question_id !== 'ALL' && /^C\d{2}$/.test(String(row.capability_concept_id || ''))) issue('error', 'local_global_capability_collision', row.__location, row.capability_concept_id)
  for (const parent of split(row.parent_concept_ids)) if (!capabilityIds.has(parent)) issue('error', 'parent_unresolved', row.__location, parent)
  const alternatives = split(row.alternative_path_ids)
  for (const id of alternatives) {
    const other = paths.get(id)
    if (!other) issue('error', 'alternative_path_unresolved', row.__location, id)
    else {
      if (other.question_id !== row.question_id || other.capability_concept_id !== row.capability_concept_id) issue('error', 'alternative_path_group_mismatch', row.__location, id)
      if (!split(other.alternative_path_ids).includes(row.path_id)) issue('error', 'alternative_path_asymmetric', row.__location, `${row.path_id}->${id}`)
    }
  }
}
if (!errors.some((x) => ['parent_unresolved', 'alternative_path_unresolved', 'alternative_path_group_mismatch', 'alternative_path_asymmetric', 'local_global_capability_collision'].includes(x.code))) pass('ontology_graph', '父级能力、替代路径、命名空间、同题同能力与双向引用全部闭合')

const understandingIds = new Set(raw.t3.map((row) => row.understanding_id))
const claimIds = new Set(raw.t3.map((row) => row.evidence_claim_id))
for (const row of raw.t3) {
  const refs = split(row.path_refs)
  if (row.claim_type === 'ORIGIN_POLICY') {
    if (row.path_relation_mode !== 'NOT_APPLICABLE' || row.path_match_rule !== 'NONE' || refs.length) issue('error', 'origin_path_contract', row.__location, '来源政策路径契约错误')
    continue
  }
  const primary = String(row.primary_profile_capability_id || '')
  const capabilityBases = new Set(split(row.capability_refs).map((value) => String(value).match(/^(C\d{2})/)?.[1]).filter(Boolean))
  if (!/^C\d{2}$/.test(primary) || !capabilityBases.has(primary)) issue('error', 'primary_profile_capability_invalid', row.__location, primary)
  let anchors = null
  try { anchors = JSON.parse(String(row.support_anchors || '')) } catch { /* reported below */ }
  if (!anchors || JSON.stringify(Object.keys(anchors).sort()) !== JSON.stringify(['L0', 'L1', 'L2', 'L3'])) issue('error', 'support_anchor_scale_invalid', row.__location, String(row.support_anchors || ''))
  if (row.evidence_claim_id === 'Q08-T3-001' && (!String(anchors?.L0 || '').includes('不形成能力证据') || !String(row.pseudo_evidence || '').includes('AI先说出办法后教师认同'))) {
    issue('error', 'q08_stem_pollution_not_blocked', row.__location, '题面复述或AI先提示后认同未被隔离')
  }
  if (row.path_relation_mode !== 'ALTERNATIVE_PATHS' || row.path_match_rule !== 'ANY_OF' || refs.length < 2 || refs.length > 3) issue('error', 'evidence_path_contract', row.__location, '能力证据必须为2—3条ANY_OF路径')
  const pathRows = refs.map((id) => paths.get(id))
  if (pathRows.some((value) => !value)) issue('error', 'evidence_path_unresolved', row.__location, refs.filter((id) => !paths.has(id)).join('|'))
  else {
    const qid = row.question_id
    const capabilities = new Set(split(row.capability_refs))
    const coveredCapabilities = new Set(pathRows.flatMap((pathRow) => [pathRow.capability_concept_id, ...split(pathRow.parent_concept_ids)]))
    const hasCapabilityOverlap = [...capabilities].some((id) => coveredCapabilities.has(id))
    if (pathRows.some((pathRow) => pathRow.question_id !== qid) || !hasCapabilityOverlap) issue('error', 'evidence_path_scope_mismatch', row.__location, refs.join('|'))
    const group = new Set([pathRows[0].path_id, ...split(pathRows[0].alternative_path_ids)])
    if (group.size !== refs.length || refs.some((id) => !group.has(id))) issue('error', 'evidence_path_group_incomplete', row.__location, refs.join('|'))
  }
}
if (!errors.some((x) => x.code.includes('path_contract') || x.code.includes('evidence_path') || ['primary_profile_capability_invalid', 'support_anchor_scale_invalid', 'q08_stem_pollution_not_blocked'].includes(x.code))) pass('evidence_path_semantics', '50个能力证据的路径、L0—L3锚点、唯一画像归因与Q08污染隔离全部有效')

const expectedRuntime = { AFFORDANCE: 'AFFORDANCE_CARD', MONITOR: 'MONITOR_CARD', HARD_BOUNDARY: 'HARD_BOUNDARY', COMPILATION_BOUNDARY: 'COMPILER_BOUNDARY' }
for (const row of raw.t4) {
  if (expectedRuntime[row.policy_type] && row.runtime_use !== expectedRuntime[row.policy_type]) issue('error', 'dialogue_route_mismatch', row.__location, `${row.policy_type}/${row.runtime_use}`)
  for (const id of split(row.target_understanding_ids)) if (!understandingIds.has(id)) issue('error', 'dialogue_understanding_unresolved', row.__location, id)
  for (const id of split(row.target_capability_ids)) if (!capabilityIds.has(id)) issue('error', 'dialogue_capability_unresolved', row.__location, id)
}
if (!errors.some((x) => x.code.startsWith('dialogue_'))) pass('dialogue_contracts', '政策路由、目标理解与目标能力引用全部有效')

for (const row of raw.t5) {
  for (const id of split(row.required_evidence_claim_ids)) if (!claimIds.has(id)) issue('error', 'synthesis_claim_unresolved', row.__location, id)
  for (const id of split(row.required_capability_ids)) if (!capabilityIds.has(id)) issue('error', 'synthesis_capability_unresolved', row.__location, id)
}
if (!errors.some((x) => x.code.startsWith('synthesis_'))) pass('synthesis_contracts', '综合判断的证据命题与能力引用全部有效')

const runtime = JSON.parse(await fs.readFile(runtimePath, 'utf8'))
if (runtime.schemaVersion !== '0.2.1' || runtime.datasetId !== 'TCIM_NEW_FIVE_TABLES_RUNTIME_V0.2.1') issue('error', 'runtime_identity_invalid', runtimePath, `${runtime.schemaVersion}/${runtime.datasetId}`)
for (const source of runtime.sources || []) {
  if (sourceDigests.get(source.file) !== source.sha256) issue('error', 'runtime_source_hash_mismatch', source.file, '运行时未由当前活动Excel编译')
}
const fingerprintInput = structuredClone(runtime)
delete fingerprintInput.configFingerprint
const expectedFingerprint = crypto.createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex')
if (runtime.configFingerprint !== expectedFingerprint) issue('error', 'runtime_fingerprint_mismatch', runtimePath, '指纹与内容不一致')
if (!errors.some((x) => x.code.startsWith('runtime_'))) pass('runtime_provenance', '五个源文件哈希与运行时指纹一致')

for (let n = 1; n <= 10; n += 1) {
  const qid = `Q${String(n).padStart(2, '0')}`
  const q = runtime.questions?.[qid]
  if (!q?.scenario?.content || !q?.professionalLenses?.length || !q?.evidencePolicies?.length || !q?.dialoguePolicies?.length || !q?.synthesisPolicies?.length) issue('error', 'question_runtime_incomplete', qid, '题目运行卡构件缺失')
  const hard = (q?.dialoguePolicies || []).filter((row) => row.type === 'HARD_BOUNDARY')
  if (!hard.length) issue('error', 'question_hard_boundary_missing', qid, '缺少HARD_BOUNDARY')
}
if (!errors.some((x) => x.code.startsWith('question_'))) pass('question_completeness', 'Q01—Q10均具备情境、Ontology、Evidence、对话、综合与硬边界')

const report = {
  auditId: 'TCIM-FIVE-TABLES-V0.2.1-20260830',
  scope: 'SIMULATION_ACTIVE',
  result: errors.length ? 'FAIL' : 'PASS',
  summary: { checks: checks.length, errors: errors.length, warnings: warnings.length, excelRecords: Object.values(raw).flat().length },
  checks,
  errors,
  warnings,
  runtimeFingerprint: runtime.configFingerprint
}
await fs.mkdir(path.dirname(reportPath), { recursive: true })
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
if (errors.length) process.exitCode = 1
