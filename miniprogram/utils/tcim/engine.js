var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// tcim/modules/context/belief_state.js
var require_belief_state = __commonJS({
  "tcim/modules/context/belief_state.js"(exports, module2) {
    "use strict";
    var BELIEF_OPS = Object.freeze(["NO_CHANGE", "ADD", "STRENGTHEN", "WEAKEN", "SPLIT", "RETRACT"]);
    var BELIEF_STATUS = Object.freeze(["ACTIVE", "RETRACTED", "DIVERGED"]);
    var clamp01 = (n) => Math.max(0, Math.min(1, typeof n === "number" ? n : 0));
    var _beliefSeed = 0;
    function nextBeliefId() {
      _beliefSeed += 1;
      return `B${Date.now().toString(36).slice(-4)}${_beliefSeed}`;
    }
    function createBelief(opts = {}) {
      return {
        id: opts.id || nextBeliefId(),
        claim: opts.claim || "",
        status: opts.status || "ACTIVE",
        confidence: clamp01(opts.confidence),
        support_refs: Array.isArray(opts.support_refs) ? opts.support_refs.slice() : [],
        conflict_refs: Array.isArray(opts.conflict_refs) ? opts.conflict_refs.slice() : [],
        alternatives: Array.isArray(opts.alternatives) ? opts.alternatives.slice() : [],
        uncertainty: clamp01(opts.uncertainty),
        source_refs: Array.isArray(opts.source_refs) ? opts.source_refs.slice() : [],
        created_turn: opts.created_turn || null,
        updated_turn: opts.updated_turn || null
      };
    }
    function createBeliefState() {
      return { beliefs: {}, version: 0 };
    }
    function validateBeliefMutation2(mutation, state) {
      const errors = [];
      if (!mutation || typeof mutation !== "object") return { ok: false, errors: ["mutation \u4E0D\u662F\u5BF9\u8C61"] };
      const op = mutation.op;
      if (!BELIEF_OPS.includes(op)) errors.push(`\u975E\u6CD5 op: ${op}`);
      if (op === "ADD" && !mutation.claim) errors.push("ADD \u9700 claim");
      if (op !== "ADD" && op !== "NO_CHANGE" && !mutation.belief_id) errors.push(`${op} \u9700 belief_id`);
      if (op === "RETRACT" || op === "STRENGTHEN" || op === "WEAKEN" || op === "SPLIT") {
        if (!state.beliefs || !state.beliefs[mutation.belief_id]) errors.push(`belief_id \u4E0D\u5B58\u5728: ${mutation.belief_id}`);
      }
      if (typeof mutation.confidence === "number" && (mutation.confidence < 0 || mutation.confidence > 1)) errors.push("confidence \u8D8A\u754C");
      const judgeRe = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
      if (judgeRe.test(JSON.stringify(mutation.claim || ""))) errors.push("G05: Belief \u542B\u80FD\u529B/\u4EBA\u683C/\u52A8\u673A\u6B63\u5F0F\u5224\u5B9A");
      return { ok: errors.length === 0, errors };
    }
    function applyBeliefMutation2(state, mutation, turnId) {
      const next = JSON.parse(JSON.stringify(state));
      const beliefs = next.beliefs || {};
      const event = { op: mutation.op, belief_id: null, claim: null, before: null, after: null, turn_id: turnId };
      const baseOp = mutation.op;
      if (baseOp === "NO_CHANGE") {
        next.version += 1;
        event.op = "NO_CHANGE";
        return { state: next, event };
      }
      if (baseOp === "ADD") {
        const belief = createBelief({ claim: mutation.claim, confidence: mutation.confidence, support_refs: mutation.support_refs, alternatives: mutation.alternatives, uncertainty: mutation.uncertainty, source_refs: mutation.source_refs, created_turn: turnId, updated_turn: turnId });
        beliefs[belief.id] = belief;
        next.version += 1;
        event.belief_id = belief.id;
        event.claim = belief.claim;
        event.after = { confidence: belief.confidence, status: belief.status };
        return { state: next, event };
      }
      const b = beliefs[mutation.belief_id];
      const before = { confidence: b.confidence, status: b.status };
      if (baseOp === "STRENGTHEN") {
        b.confidence = clamp01((b.confidence || 0) + (mutation.delta != null ? mutation.delta : 0.1));
        b.updated_turn = turnId;
      } else if (baseOp === "WEAKEN") {
        b.confidence = clamp01((b.confidence || 0) - (mutation.delta != null ? mutation.delta : 0.1));
        b.updated_turn = turnId;
      } else if (baseOp === "RETRACT") {
        b.status = "RETRACTED";
        b.updated_turn = turnId;
      } else if (baseOp === "SPLIT") {
        b.status = "DIVERGED";
        const alt = createBelief({ claim: mutation.new_claim || b.claim, confidence: clamp01(mutation.new_confidence != null ? mutation.new_confidence : b.confidence), alternatives: [b.claim], source_refs: b.source_refs, created_turn: turnId, updated_turn: turnId });
        beliefs[alt.id] = alt;
        next.version += 2;
        event.belief_id = alt.id;
        event.claim = alt.claim;
        event.after = { confidence: alt.confidence, status: alt.status };
        return { state: next, event };
      }
      next.version += 1;
      event.belief_id = b.id;
      event.claim = b.claim;
      event.before = before;
      event.after = { confidence: b.confidence, status: b.status };
      return { state: next, event };
    }
    module2.exports = {
      BELIEF_OPS,
      BELIEF_STATUS,
      createBelief,
      createBeliefState,
      validateBeliefMutation: validateBeliefMutation2,
      applyBeliefMutation: applyBeliefMutation2
    };
  }
});

// tcim/modules/context/teacher_model.js
var require_teacher_model = __commonJS({
  "tcim/modules/context/teacher_model.js"(exports, module2) {
    "use strict";
    var _snapshotSeed = 0;
    var BUILDER_VERSION = "2026-08-24-teacher-model-v1";
    function nextSnapshotId() {
      _snapshotSeed += 1;
      return `CTM-${Date.now().toString(36).slice(-4)}-${_snapshotSeed}`;
    }
    function buildTeacherModelSnapshot2(opts = {}) {
      const beliefState2 = opts.beliefState || { beliefs: {} };
      const active = [];
      const competing = [];
      const uncertainty = [];
      for (const b of Object.values(beliefState2.beliefs || {})) {
        if (b.status === "RETRACTED") continue;
        if (b.status === "DIVERGED") {
          competing.push(b.id);
          continue;
        }
        active.push(b.id);
        if ((b.uncertainty || 0) >= 0.5) uncertainty.push(b.id);
      }
      return {
        snapshot_id: nextSnapshotId(),
        generated_for_turn: opts.turnId || null,
        confirmed_fact_refs: Array.isArray(opts.factRefs) ? opts.factRefs.slice() : [],
        teacher_agenda_refs: Array.isArray(opts.teacherAgendaRefs) ? opts.teacherAgendaRefs.slice() : [],
        active_belief_refs: active,
        competing_belief_refs: competing,
        uncertainty_refs: uncertainty,
        evidence_state_ref: opts.evidenceStateRef || null,
        source_refs: Array.isArray(opts.factRefs) ? opts.factRefs.slice() : [],
        builder_version: BUILDER_VERSION
      };
    }
    function buildContextInterpretationProposal2(opts = {}) {
      const factRefs = Array.isArray(opts.factRefs) ? opts.factRefs : [];
      const uncertainties = [];
      const beliefs = [];
      const alts = [];
      const hasKeyUncertainty = Boolean(
        opts.assessmentSnapshot && opts.assessmentSnapshot.open_text || Array.isArray(opts.processTags) && opts.processTags.length
      );
      if (hasKeyUncertainty) {
        beliefs.push({
          claim: "\u6559\u5E08\u5224\u65AD\u513F\u7AE5\u5F53\u524D\u53EF\u8FBE\u6C34\u5E73\u7684\u4F9D\u636E\u5C1A\u4E0D\u6E05\u695A",
          confidence: 0.61,
          alternatives: ["PROCESS_EVENT_MAY_BE_CONTEXT_SPECIFIC"],
          source_refs: factRefs.slice(0, 2)
        });
        uncertainties.push("\u6559\u5E08\u4F9D\u636E\u4EC0\u4E48\u73B0\u8C61\u5224\u65AD\u513F\u7AE5\u5C1A\u53EF\u81EA\u4E3B\u5C1D\u8BD5\u8FD8\u662F\u9700\u8981\u589E\u52A0\u652F\u6301");
      }
      return {
        proposal_type: "ContextInterpretationProposal",
        proposal_id: `A00-${Date.now().toString(36).slice(-6)}`,
        fact_refs: factRefs,
        proposed_beliefs: beliefs,
        alternatives: alts,
        uncertainty_candidates: uncertainties,
        source_refs: factRefs,
        schema_version: "context-interpretation-v0.2"
      };
    }
    module2.exports = {
      BUILDER_VERSION,
      buildTeacherModelSnapshot: buildTeacherModelSnapshot2,
      buildContextInterpretationProposal: buildContextInterpretationProposal2,
      nextSnapshotId
    };
  }
});

// tcim/core/contracts.js
var require_contracts = __commonJS({
  "tcim/core/contracts.js"(exports, module2) {
    "use strict";
    var TABLE_ALIGNMENT = Object.freeze(["SUPPORT", "PARTIAL", "CONFLICT", "OUT_OF_SCHEMA", "NO_APPLICABLE_RULE"]);
    var POLICY_CLASS = Object.freeze(["HARD", "SOFT", "PRIOR", "ADVISORY"]);
    var RISK_LEVEL = Object.freeze(["LOW", "MEDIUM", "HIGH"]);
    var ACTION_TYPES = Object.freeze([
      "PROBE",
      "CONFIRM",
      "COMPARE",
      "REFRAME",
      "SHIFT_CANDIDATE",
      "STOP_CANDIDATE",
      "CLOSE"
    ]);
    var STATE_OWNERS = Object.freeze({
      session_state: "core",
      ontology_state: "ontology",
      contextual_belief_state: "belief_manager",
      // V0.2 新增：可撤销情境信念（与 Evidence 并列）
      dialogue_state: "prdm",
      rag_runtime_state: "rag",
      teacher_state: "teacher_state",
      // future, disabled
      evaluation_state: "logger"
    });
    var STATE_NAMESPACES = Object.freeze(Object.keys(STATE_OWNERS));
    var ContractError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "ContractError";
        this.code = "CONTRACT_VIOLATION";
      }
    };
    function validateObject(value, shape, context) {
      const errors = [];
      if (!value || typeof value !== "object") {
        return { ok: false, errors: [`${context}: \u671F\u671B\u5BF9\u8C61\uFF0C\u5F97\u5230 ${typeof value}`] };
      }
      for (const [key, spec] of Object.entries(shape)) {
        const val = value[key];
        const required = !!spec.required;
        if (val === void 0 || val === null || val === "") {
          if (required) errors.push(`${context}.${key}: \u7F3A\u5C11\u5FC5\u586B\u5B57\u6BB5`);
          continue;
        }
        if (spec.type === "string" && typeof val !== "string") errors.push(`${context}.${key}: \u671F\u671B\u5B57\u7B26\u4E32`);
        if (spec.type === "array" && !Array.isArray(val)) errors.push(`${context}.${key}: \u671F\u671B\u6570\u7EC4`);
        if (spec.type === "object" && (typeof val !== "object" || Array.isArray(val))) errors.push(`${context}.${key}: \u671F\u671B\u5BF9\u8C61`);
        if (spec.type === "number" && typeof val !== "number") errors.push(`${context}.${key}: \u671F\u671B\u6570\u5B57`);
        if (spec.type === "boolean" && typeof val !== "boolean") errors.push(`${context}.${key}: \u671F\u671B\u5E03\u5C14`);
      }
      return { ok: errors.length === 0, errors };
    }
    var ModuleInputShape = Object.freeze({
      session_id: { type: "string", required: true },
      turn_id: { type: "string", required: true },
      question_id: { type: "string", required: true },
      turn_context: { type: "object", required: true },
      shared_state_snapshot: { type: "object", required: false },
      module_config: { type: "object", required: false }
    });
    var ModuleResultShape = Object.freeze({
      module_id: { type: "string", required: true },
      module_version: { type: "string", required: true },
      observations: { type: "array", required: false },
      state_updates: { type: "object", required: false },
      // { namespace: { ... } } 只允许自己的 namespace
      action_proposals: { type: "array", required: false },
      constraints: { type: "array", required: false },
      confidence: { type: "number", required: false },
      evidence_refs: { type: "array", required: false },
      decision_summary: { type: "string", required: false },
      diagnostics: { type: "array", required: false }
    });
    var ActionProposalShape = Object.freeze({
      action_type: { type: "string", required: true },
      target_slot: { type: "string", required: true },
      professional_objective: { type: "string", required: true },
      probe_strategy: { type: "string", required: false },
      priority: { type: "number", required: false },
      expected_evidence: { type: "number", required: false },
      hard_constraints: { type: "array", required: false },
      supporting_refs: { type: "array", required: false },
      confidence: { type: "number", required: false },
      rationale_code: { type: "string", required: false },
      reason_summary: { type: "string", required: false }
    });
    var ProfessionalActionPlanShape = Object.freeze({
      action_type: { type: "string", required: true },
      target_slot: { type: "string", required: true },
      professional_objective: { type: "string", required: true },
      probe_strategy: { type: "string", required: true },
      hard_constraints: { type: "array", required: true },
      supporting_refs: { type: "array", required: false },
      action_fingerprint: { type: "string", required: true },
      source_module_versions: { type: "array", required: false }
    });
    function validateModuleInput(input) {
      return validateObject(input, ModuleInputShape, "ModuleInput");
    }
    function validateModuleResult(result, moduleOwner) {
      const base = validateObject(result, ModuleResultShape, "ModuleResult");
      if (!base.ok) return base;
      const errors = [];
      if (result.state_updates) {
        for (const ns of Object.keys(result.state_updates)) {
          if (ns !== moduleOwner) {
            errors.push(`state_updates.${ns}: \u6A21\u5757 ${result.module_id} \u53EA\u80FD\u5199\u81EA\u5DF1\u7684 namespace ${moduleOwner}`);
          }
        }
      }
      if (Array.isArray(result.action_proposals)) {
        result.action_proposals.forEach((p, i) => {
          const v = validateObject(p, ActionProposalShape, `ModuleResult.action_proposals[${i}]`);
          if (!v.ok) errors.push(...v.errors);
          else if (ACTION_TYPES.indexOf(p.action_type) < 0) errors.push(`action_proposals[${i}].action_type \u975E\u6CD5: ${p.action_type}`);
        });
      }
      return { ok: errors.length === 0, errors };
    }
    function validateProfessionalActionPlan(plan) {
      const base = validateObject(plan, ProfessionalActionPlanShape, "ProfessionalActionPlan");
      if (!base.ok) return base;
      const errors = [];
      if (ACTION_TYPES.indexOf(plan.action_type) < 0) errors.push(`action_type \u975E\u6CD5: ${plan.action_type}`);
      if (!plan.action_fingerprint) errors.push("\u7F3A\u5C11 action_fingerprint");
      return { ok: errors.length === 0, errors };
    }
    function fingerprintActionPlan(plan) {
      const payload = JSON.stringify({
        action_type: plan.action_type,
        target_slot: plan.target_slot,
        professional_objective: plan.professional_objective,
        probe_strategy: plan.probe_strategy
      });
      let hash = 0;
      for (let i = 0; i < payload.length; i += 1) {
        const chr = payload.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0;
      }
      return (hash >>> 0).toString(36);
    }
    module2.exports = {
      ACTION_TYPES,
      STATE_OWNERS,
      STATE_NAMESPACES,
      TABLE_ALIGNMENT,
      POLICY_CLASS,
      RISK_LEVEL,
      ContractError,
      validateModuleInput,
      validateModuleResult,
      validateProfessionalActionPlan,
      fingerprintActionPlan,
      shapes: { ModuleInputShape, ModuleResultShape, ActionProposalShape, ProfessionalActionPlanShape }
    };
  }
});

// tcim/modules/planner/agent_planner.js
var require_agent_planner = __commonJS({
  "tcim/modules/planner/agent_planner.js"(exports, module2) {
    "use strict";
    var { TABLE_ALIGNMENT, RISK_LEVEL } = require_contracts();
    function defaultCandidateActions(item, evidence) {
      const slots = item && item.ontology && item.ontology.slots || [];
      return slots.filter((s) => s.core).map((s) => {
        const st = evidence[s.slot_id] || {};
        const level = st.level ?? 0;
        const gap = level < 2 ? 1 - level / 2 : 0;
        return {
          action_id: `C-${s.slot_id}`,
          primary_target_slot: s.slot_id,
          supporting_slot_refs: [],
          professional_objective: `\u83B7\u5F97 ${s.slot_id} \u7684\u4E13\u4E1A\u8BC1\u636E\uFF08${s.name || ""}\uFF09`,
          probe_strategy: s.allowed_actions && s.allowed_actions[0] || "\u6F84\u6E05",
          single_cognitive_task: true,
          cognitive_task_code: "EXPLAIN_ONE",
          expected_evidence_gain: gap,
          risk_level: "LOW",
          table_alignment: "SUPPORT",
          prior_disposition: "NEUTRAL",
          source_refs: [s.definition]
        };
      }).sort((a, b) => b.expected_evidence_gain - a.expected_evidence_gain);
    }
    function planDecision2(input) {
      const candidates = input.candidateActions || defaultCandidateActions(input.item || {}, input.evidence || {});
      const chosen = typeof input.chooseAction === "function" ? input.chooseAction(candidates, input) : defaultSelect(candidates, input);
      const selected = chosen.selected || candidates[0];
      const selectedId = selected.action_id || `C-${selected.primary_target_slot}`;
      return {
        proposal_type: "AgentDecisionProposal",
        proposal_id: `ADP-${Date.now().toString(36).slice(-6)}`,
        contextual_interpretation: input.teacherModel && input.teacherModel.active_belief_refs ? "PROCESS_EVENT_SHAPES_NEXT_PROBE" : "DEFAULT",
        candidate_hypotheses: input.teacherModel && input.teacherModel.active_belief_refs || [],
        candidate_actions: candidates.map((c) => c.action_id),
        selected_action_id: selectedId,
        rejected_action_ids: candidates.map((c) => c.action_id).filter((id) => id !== selectedId),
        why_this_now: chosen.why_this_now || "top_evidence_gap",
        evidence_needed: selected.evidence_needed || [],
        primary_target_slot: selected.primary_target_slot,
        supporting_slot_refs: selected.supporting_slot_refs || [],
        single_cognitive_task: selected.single_cognitive_task !== false,
        cognitive_task_code: selected.cognitive_task_code || "EXPLAIN_ONE",
        claimed_table_alignment: TABLE_ALIGNMENT.includes(selected.table_alignment) ? selected.table_alignment : "SUPPORT",
        rule_alignment_details: selected.rule_alignment_details || [],
        prior_disposition: selected.prior_disposition || "NEUTRAL",
        prior_reason: selected.prior_reason || "",
        claimed_risk_level: RISK_LEVEL.includes(selected.risk_level) ? selected.risk_level : "LOW",
        fallback_action_id: selected.fallback_action_id || null,
        exit_condition: selected.exit_condition || null,
        interpretation_confidence: chosen.interpretation_confidence != null ? chosen.interpretation_confidence : 0.7,
        action_confidence: chosen.action_confidence != null ? chosen.action_confidence : 0.8,
        source_refs: input.teacherModel && input.teacherModel.source_refs || [],
        model_prompt_schema_versions: ["agent-planner-v0.2", "agent-decision-v0.2"]
      };
    }
    function defaultSelect(candidates, input) {
      const ranked = candidates.filter((c) => c.risk_level === "LOW" || c.risk_level === void 0).slice().sort((a, b) => (b.expected_evidence_gain || 0) - (a.expected_evidence_gain || 0));
      const selected = ranked[0] || candidates[0];
      return { selected, why_this_now: selected ? "top_gap_low_risk" : "fallback" };
    }
    module2.exports = {
      planDecision: planDecision2,
      defaultCandidateActions,
      defaultSelect
    };
  }
});

// tcim/modules/gate/decision_gate.js
var require_decision_gate = __commonJS({
  "tcim/modules/gate/decision_gate.js"(exports, module2) {
    "use strict";
    var { TABLE_ALIGNMENT, POLICY_CLASS, RISK_LEVEL } = require_contracts();
    var JUDGE_RE2 = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
    var HARD_PATTERNS = [
      /得分|分数|标准答案|专家排序|评分/,
      /能力等级|你的能力/,
      /R\/P\/G/,
      JUDGE_RE2
      // G05：不得把短答/犹豫/礼貌/流畅推断为稳定能力/人格/动机
    ];
    function checkSource(prop, ctx) {
      const refs = Array.isArray(prop.source_refs) ? prop.source_refs : [];
      const allowed = ctx && ctx.allowedSourceRefs || [];
      if (allowed.length && refs.length) return refs.every((r) => allowed.includes(r));
      return true;
    }
    function checkHardConstraints(prop) {
      const joined = JSON.stringify(prop);
      for (const p of HARD_PATTERNS) if (p.test(joined)) return { pass: false, code: "hard_content_leak" };
      return { pass: true };
    }
    function checkSingleTask(prop) {
      return prop.single_cognitive_task !== false;
    }
    function validateDecision2(agentProposal, ctx) {
      const result = { proposal_id: agentProposal.proposal_id || "", decision: "REJECT", reason_codes: [], fallback_policy_id: agentProposal.fallback_action_id || null, evaluator_required: false };
      const errors = [];
      if (!agentProposal.selected_action_id) errors.push("missing_selected_action");
      if (!agentProposal.primary_target_slot) errors.push("missing_primary_target");
      if (!TABLE_ALIGNMENT.includes(agentProposal.claimed_table_alignment)) errors.push("bad_table_alignment");
      const srcOk = checkSource(agentProposal, ctx);
      if (!srcOk) errors.push("source_mismatch");
      const hard = checkHardConstraints(agentProposal);
      if (!hard.pass) errors.push(hard.code);
      if (!checkSingleTask(agentProposal)) errors.push("multi_task");
      const expected = ctx && typeof ctx.expectedStateVersion === "number" ? ctx.expectedStateVersion : null;
      if (expected !== null && (ctx.committedStateVersion != null && ctx.committedStateVersion !== expected)) errors.push("state_freshness");
      const adjudicated = TABLE_ALIGNMENT.includes(agentProposal.claimed_table_alignment) ? agentProposal.claimed_table_alignment : "NO_APPLICABLE_RULE";
      const claimedRisk = RISK_LEVEL.includes(agentProposal.claimed_risk_level) ? agentProposal.claimed_risk_level : "LOW";
      const adjudicatedRisk = claimedRisk;
      result.adjudicated_risk_level = adjudicatedRisk;
      if (adjudicatedRisk === "MEDIUM") result.evaluator_required = true;
      if (errors.length) {
        result.decision = "REJECT";
        result.reason_codes = errors;
      } else if (claimedRisk === "HIGH") {
        result.decision = "REJECT";
        result.reason_codes = ["high_risk_requires_override"];
      } else if (adjudicatedRisk === "MEDIUM" || adjudicated === "CONFLICT" || adjudicated === "OUT_OF_SCHEMA") {
        result.decision = "CLARIFY";
        result.reason_codes = ["risk_or_table_deviation"];
      } else {
        result.decision = "APPROVE";
        result.reason_codes = ["source_ok", "hard_ok", "single_task_ok"];
      }
      result.schema_check = !errors.some((e) => ["missing_selected_action", "missing_primary_target", "bad_table_alignment"].includes(e));
      result.source_check = srcOk;
      result.hard_constraint_check = hard.pass;
      result.state_freshness_check = !errors.includes("state_freshness");
      result.single_cognitive_task = checkSingleTask(agentProposal);
      result.adjudicated_table_alignment = adjudicated;
      result.approved_action_id = agentProposal.selected_action_id;
      return result;
    }
    module2.exports = {
      validateDecision: validateDecision2,
      HARD_PATTERNS
    };
  }
});

// tcim/modules/context/challenge_queue.js
var require_challenge_queue = __commonJS({
  "tcim/modules/context/challenge_queue.js"(exports, module2) {
    "use strict";
    var { TABLE_ALIGNMENT } = require_contracts();
    var _queueId = 0;
    function createChallengeQueue2() {
      return { challenges: [], version: 0 };
    }
    function nextChallengeId() {
      _queueId += 1;
      return `CHAL-${Date.now().toString(36).slice(-4)}-${_queueId}`;
    }
    function addChallenge(queue, opts = {}) {
      const candidate = {
        id: nextChallengeId(),
        challenge_type: opts.challenge_type || "TABLE_DEVIATION",
        // TABLE_DEVIATION | OUT_OF_SCHEMA | CONFLICT | EXPERT_REVIEW
        rule_id: opts.rule_id || null,
        slot_id: opts.slot_id || null,
        claimed_alignment: TABLE_ALIGNMENT.includes(opts.claimed_alignment) ? opts.claimed_alignment : "NO_APPLICABLE_RULE",
        adjudicated_alignment: TABLE_ALIGNMENT.includes(opts.adjudicated_alignment) ? opts.adjudicated_alignment : void 0,
        reason: opts.reason || "",
        source_refs: Array.isArray(opts.source_refs) ? opts.source_refs.slice() : [],
        risk_level: opts.risk_level || "LOW",
        status: "DRAFT",
        // DRAFT | IN_REVIEW | ACCEPTED | REJECTED（人工审核后决定）
        created_at: Date.now(),
        updated_at: Date.now()
      };
      queue.challenges.push(candidate);
      queue.version += 1;
      return candidate;
    }
    function challengeFromDecision2(queue, agentDecision, gateResult) {
      const claimed = agentDecision && agentDecision.claimed_table_alignment;
      const adjudicated = gateResult && gateResult.adjudicated_table_alignment;
      if (!claimed || ["SUPPORT", "PARTIAL"].includes(claimed)) return null;
      return addChallenge(queue, {
        challenge_type: claimed === "OUT_OF_SCHEMA" ? "OUT_OF_SCHEMA" : adjudicated ? "TABLE_DEVIATION" : "CONFLICT",
        rule_id: agentDecision.fallback_action_id || agentDecision.prior_reason || null,
        slot_id: agentDecision.primary_target_slot || null,
        claimed_alignment: claimed,
        adjudicated_alignment: adjudicated,
        reason: agentDecision.why_this_now || "",
        source_refs: agentDecision.source_refs || [],
        risk_level: gateResult && gateResult.adjudicated_risk_level || agentDecision.claimed_risk_level || "LOW"
      });
    }
    module2.exports = {
      createChallengeQueue: createChallengeQueue2,
      addChallenge,
      challengeFromDecision: challengeFromDecision2
    };
  }
});

// tcim/modules/ontology/evidence_updater.js
var require_evidence_updater = __commonJS({
  "tcim/modules/ontology/evidence_updater.js"(exports, module2) {
    "use strict";
    var SYNONYMS2 = {
      \u5E7C\u513F: "\u5E7C\u513F",
      \u5B69\u5B50: "\u5E7C\u513F",
      \u5C0F\u670B\u53CB: "\u5E7C\u513F",
      \u5B9D\u8D1D: "\u5E7C\u513F",
      \u6ED1: "\u6E7F\u6ED1",
      \u6E7F\u6ED1: "\u6E7F\u6ED1",
      \u5730\u9762: "\u5730\u9762",
      \u5730\u6ED1: "\u6E7F\u6ED1",
      \u8BBE\u5907: "\u5668\u68B0",
      \u5668\u6750: "\u5668\u68B0",
      \u7BEE\u7403\u67B6: "\u5668\u68B0",
      \u98CE\u9669: "\u98CE\u9669",
      \u5371\u9669: "\u98CE\u9669",
      \u5B89\u5168: "\u98CE\u9669",
      \u4ECB\u5165: "\u4ECB\u5165",
      \u5E72\u9884: "\u4ECB\u5165",
      \u5236\u6B62: "\u4ECB\u5165",
      \u63D0\u9192: "\u4ECB\u5165",
      \u6E38\u620F: "\u6E38\u620F",
      \u73A9\u6CD5: "\u6E38\u620F",
      \u73A9\u6C34: "\u7528\u6C34",
      \u63A5\u6C34: "\u7528\u6C34",
      \u704C\u6C34: "\u7528\u6C34",
      \u89C4\u5219: "\u89C4\u5219",
      \u89C4\u77E9: "\u89C4\u5219",
      \u79E9\u5E8F: "\u89C4\u5219",
      \u573A\u5730: "\u573A\u5730",
      \u5730\u65B9: "\u573A\u5730",
      \u533A\u57DF: "\u573A\u5730",
      \u4ED6\u4EBA: "\u4ED6\u4EBA",
      \u522B\u4EBA: "\u4ED6\u4EBA",
      \u5176\u4ED6: "\u4ED6\u4EBA",
      \u89C2\u5BDF: "\u89C2\u5BDF",
      \u5173\u6CE8: "\u89C2\u5BDF",
      \u8F6C\u573A: "\u8F6C\u573A",
      \u8FC1\u79FB: "\u8F6C\u573A",
      \u81EA\u4E3B: "\u81EA\u4E3B",
      \u751F\u6210: "\u751F\u6210",
      \u5C0A\u91CD: "\u5C0A\u91CD"
    };
    var STOP_BIGRAMS2 = /* @__PURE__ */ new Set(["\u6211\u4EEC", "\u4F60\u4EEC", "\u4ED6\u4EEC", "\u8FD9\u4E2A", "\u90A3\u4E2A", "\u53EF\u4EE5", "\u5E94\u8BE5", "\u5C31\u662F", "\u8FD8\u662F", "\u5982\u679C", "\u4F46\u662F", "\u56E0\u4E3A", "\u6240\u4EE5", "\u4EC0\u4E48", "\u600E\u4E48", "\u7136\u540E", "\u4EE5\u53CA", "\u6216\u8005", "\u662F\u5426", "\u8FD8\u6709", "\u6CA1\u6709", "\u4E0D\u662F", "\u4E0D\u4F1A", "\u4E00\u4E2A", "\u81EA\u5DF1", "\u89C9\u5F97", "\u7684\u8BDD", "\u65F6\u5019", "\u5F53\u65F6", "\u4E4B\u540E", "\u4E4B\u524D", "\u8FD9\u6837", "\u90A3\u6837", "\u4E8B\u60C5", "\u60C5\u51B5", "\u65B9\u9762"]);
    function splitBlocks2(text) {
      return String(text || "").replace(/[，。！？；：、""''（）()“”‘’\s]/g, "|").split("|").filter((b) => b.length >= 2);
    }
    function bigramsOf2(text) {
      const blocks = splitBlocks2(text);
      const out = /* @__PURE__ */ new Set();
      for (const block of blocks) {
        for (let i = 0; i < block.length - 1; i += 1) {
          out.add(block.slice(i, i + 2));
        }
      }
      return out;
    }
    function normalizeBigrams2(bigrams) {
      const out = /* @__PURE__ */ new Set();
      for (const bg of bigrams) {
        const canon = SYNONYMS2[bg];
        if (canon) out.add(canon);
        else if (!STOP_BIGRAMS2.has(bg)) out.add(bg);
      }
      return out;
    }
    function buildKeywords2(anchorText) {
      return normalizeBigrams2(bigramsOf2(anchorText));
    }
    function overlapCount2(text, keywords) {
      const teacherSet = normalizeBigrams2(bigramsOf2(text));
      const kwCount = keywords && typeof keywords.size === "number" ? keywords.size : Array.isArray(keywords) ? keywords.length : 0;
      if (!teacherSet.size || !kwCount) return 0;
      let hit = 0;
      for (const kw of keywords) {
        if (teacherSet.has(kw)) hit += 1;
      }
      return hit;
    }
    var RATE_MIN2 = 0.15;
    var HITS_MIN2 = 3;
    function assessSlot2(teacherTurn, anchor, currentLevel = 0) {
      if (!anchor) return { level: currentLevel, confidence: 0, matched: false, hitRates: {} };
      const levels = [
        { level: 0, text: anchor.level_0 },
        { level: 1, text: anchor.level_1 },
        { level: 2, text: anchor.level_2 },
        { level: 3, text: anchor.level_3 }
      ];
      const hitRates = {};
      let best = currentLevel;
      let bestHit = 0;
      for (const lv of levels) {
        if (lv.level === 0) continue;
        const kws = buildKeywords2(lv.text);
        const hits = overlapCount2(teacherTurn, kws);
        const kwCount = kws && typeof kws.size === "number" ? kws.size : 0;
        const rate = kwCount ? hits / kwCount : 0;
        hitRates[lv.level] = rate;
        if (rate >= RATE_MIN2 && hits >= HITS_MIN2 && lv.level > best && hits > bestHit) {
          best = lv.level;
          bestHit = hits;
        }
      }
      const matched = best > currentLevel;
      const confidence = matched ? Math.min(1, bestHit / 4 + 0.3) : currentLevel > 0 ? 0.4 : 0;
      return { level: best, confidence, matched, hitRates };
    }
    function statusFromLevel2(level) {
      if (level <= 0) return "UNKNOWN";
      if (level === 1) return "PARTIAL";
      if (level === 2) return "SUFFICIENT";
      return "HIGH_QUALITY";
    }
    function updateEvidence2(evidenceState, anchorsBySlot, teacherTurn, turnId, evaluateSlotIds) {
      const state = JSON.parse(JSON.stringify(evidenceState));
      const updates = [];
      for (const slotId of evaluateSlotIds || []) {
        const anchor = anchorsBySlot[slotId];
        if (!anchor) continue;
        const current = state[slotId];
        if (!current) continue;
        const before = JSON.parse(JSON.stringify(current));
        const { level, confidence, matched } = assessSlot2(teacherTurn, anchor, current.level);
        const conflictKeywords = buildKeywords2(anchor.conflict_evidence || "");
        const conflictCount = conflictKeywords && typeof conflictKeywords.size === "number" ? conflictKeywords.size : 0;
        const hasConflict = conflictCount > 0 && overlapCount2(teacherTurn, conflictKeywords) >= 1;
        if (matched) {
          state[slotId].level = level;
          state[slotId].status = statusFromLevel2(level);
          state[slotId].confidence = confidence;
          state[slotId].last_updated_turn = turnId;
          if (!state[slotId].supporting_spans.includes(teacherTurn)) {
            state[slotId].supporting_spans.push(teacherTurn);
          }
        } else if (level < current.level) {
          state[slotId].confidence = Math.max(0.2, current.confidence - 0.3);
          if (!state[slotId].conflicting_spans.includes(teacherTurn)) {
            state[slotId].conflicting_spans.push(teacherTurn);
          }
        } else if (hasConflict && current.level > 0) {
          state[slotId].confidence = Math.max(0.2, current.confidence - 0.2);
          if (!state[slotId].conflicting_spans.includes(teacherTurn)) {
            state[slotId].conflicting_spans.push(teacherTurn);
          }
        }
        const after = state[slotId];
        const changed = JSON.stringify(before) !== JSON.stringify(after);
        if (changed) {
          updates.push({
            slot_id: slotId,
            before: { level: before.level, confidence: before.confidence },
            after: { level: after.level, confidence: after.confidence, probe_status: after.probe_status },
            quote: teacherTurn,
            reason: matched ? `anchor_level_${level}` : level < before.level ? "conflict_downgrade" : hasConflict ? "conflict_added" : "no_change"
          });
        }
      }
      return { state, updates };
    }
    var clampLevel = (n) => Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0;
    var clamp01 = (n) => Math.max(0, Math.min(1, typeof n === "number" ? n : 0));
    function validateProposal(proposal, ctx) {
      const teacherTurn = ctx && ctx.teacherTurn || "";
      const validSlotIds = ctx && ctx.validSlotIds || null;
      const anchorsBySlot = ctx && ctx.anchorsBySlot || {};
      const acceptedUpdates = [];
      const rejected = [];
      const errors = [];
      const sps = Array.isArray(proposal && proposal.slot_evidence_proposals) ? proposal.slot_evidence_proposals : [];
      for (const sp of sps) {
        const slotId = sp && sp.slot_id;
        if (!slotId) {
          errors.push("slot_evidence_proposal \u7F3A slot_id");
          continue;
        }
        if (validSlotIds && !validSlotIds.has(slotId)) {
          rejected.push({ slot_id: slotId, reason: "not_in_item" });
          continue;
        }
        if (Object.keys(anchorsBySlot).length && !anchorsBySlot[slotId]) {
          rejected.push({ slot_id: slotId, reason: "no_anchor" });
          continue;
        }
        const proposed = clampLevel(sp.proposed_level);
        if (proposed < 0 || proposed > 3 || !Number.isInteger(sp.proposed_level)) {
          rejected.push({ slot_id: slotId, reason: "illegal_level" });
          continue;
        }
        const supporting = (Array.isArray(sp.supporting_spans) ? sp.supporting_spans : []).filter((t) => t && teacherTurn.includes(t));
        if (Array.isArray(sp.supporting_spans) && sp.supporting_spans.length && supporting.length === 0) {
          rejected.push({ slot_id: slotId, reason: "no_backref", detail: sp.supporting_spans });
          continue;
        }
        acceptedUpdates.push({
          slot_id: slotId,
          proposed_level: proposed,
          confidence: clamp01(sp.confidence),
          supporting_spans: supporting
        });
      }
      const judgeRe = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
      if (judgeRe.test(JSON.stringify(proposal || {}))) {
        errors.push("G05: \u51FA\u73B0\u80FD\u529B/\u4EBA\u683C/\u52A8\u673A\u76F4\u63A5\u5224\u5B9A\u8BCD");
      }
      return { acceptedUpdates, rejected, errors };
    }
    function commitProposal(evidenceState, acceptedUpdates, teacherTurn, turnId) {
      const state = JSON.parse(JSON.stringify(evidenceState));
      const updates = [];
      for (const u of acceptedUpdates || []) {
        const st = state[u.slot_id];
        if (!st) continue;
        const before = { level: st.level, confidence: st.confidence };
        if (u.proposed_level > st.level) {
          st.level = u.proposed_level;
          st.status = statusFromLevel2(u.proposed_level);
          st.confidence = Math.max(st.confidence, u.confidence);
          st.last_updated_turn = turnId;
          for (const s of u.supporting_spans || []) {
            if (!st.supporting_spans.includes(s)) st.supporting_spans.push(s);
          }
        }
        const after = { level: st.level, confidence: st.confidence };
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          updates.push({ slot_id: u.slot_id, before, after, quote: teacherTurn, reason: u.proposed_level > before.level ? `anchor_level_${u.proposed_level}` : "no_change" });
        }
      }
      return { state, updates };
    }
    function bigramFallback(teacherTurn, anchorsBySlot, evaluateSlotIds) {
      const slotEvidence = [];
      const candidateSpans = [];
      for (const slotId of evaluateSlotIds || []) {
        const anchor = anchorsBySlot[slotId];
        if (!anchor) continue;
        const { level, confidence, matched } = assessSlot2(teacherTurn, anchor, 0);
        if (level > 0) {
          slotEvidence.push({
            slot_id: slotId,
            proposed_level: level,
            confidence,
            supporting_spans: teacherTurn ? [teacherTurn] : []
          });
          candidateSpans.push({ text: teacherTurn, candidate_slots: [slotId] });
        }
      }
      return {
        proposal_type: "EvidenceAnalysisProposal",
        candidate_spans: candidateSpans,
        slot_evidence_proposals: slotEvidence,
        conflict_candidates: [],
        false_evidence_flags: [],
        uncertainty: [],
        no_change_reasons: [],
        source_turn: teacherTurn || null,
        provider_version: "bigram-fallback-v1"
      };
    }
    module2.exports = { assessSlot: assessSlot2, updateEvidence: updateEvidence2, buildKeywords: buildKeywords2, overlapCount: overlapCount2, statusFromLevel: statusFromLevel2, extractKeywords: (t) => Array.from(normalizeBigrams2(bigramsOf2(t))), validateProposal, commitProposal, bigramFallback };
  }
});

// tcim/modules/prdm/prdm_v2.js
var require_prdm_v2 = __commonJS({
  "tcim/modules/prdm/prdm_v2.js"(exports, module2) {
    "use strict";
    var VERSION = "2026-08-24-prdm-v0.2";
    var FORBIDDEN_OBS = ["next_target_slot", "recommended_action_type", "stop_decision", "personality_label", "ability_label", "psychological_diagnosis"];
    function isRepairSignal(text) {
      const s = String(text || "").replace(/\s+/g, "");
      return /(?:我不是这个意思|你理解错了|你误会了|不是这样|我说的是|你没听懂|我纠正一下|重新说)/.test(s);
    }
    function isFrustration(text) {
      const s = String(text || "").replace(/\s+/g, "");
      return /(?:烦|别问了|不要再问|不想继续|不回答了|结束吧|到这里吧)/.test(s);
    }
    function isLowCertainty(text) {
      const s = String(text || "");
      return /(?:不太确定|可能|也许|说不准|我也说不清|我不太清楚|没想好)/.test(s);
    }
    function responseDepth(text) {
      const s = String(text || "").trim();
      if (!s) return 0;
      const clauses = (s.match(/[。，；、！？]/g) || []).length;
      const hasDetail = /(?:因为|所以|先|然后|如果|当|看情况|根据|条件|具体|比如|例如)/.test(s);
      return { clauses, hasDetail, depth: hasDetail && clauses >= 2 ? 2 : hasDetail ? 1 : 0 };
    }
    function observe(opts) {
      const teacherTurn = opts.teacherTurn || "";
      const recentTurns = opts.recentTurns || [];
      const depth = responseDepth(teacherTurn);
      const signals = {
        // 只用可观察字段；低置信不推断稳定标签
        repair: isRepairSignal(teacherTurn),
        frustration: isFrustration(teacherTurn),
        low_certainty: isLowCertainty(teacherTurn),
        response_depth: depth.depth,
        clauses: depth.clauses,
        engagement: (function() {
          const cur = String(teacherTurn || "").length;
          const prev = recentTurns.length ? String(recentTurns[recentTurns.length - 1]).length : 0;
          return prev > cur ? "FADING" : cur > prev + 4 ? "DEEPENING" : "STABLE";
        })(),
        support_request: /(?:帮帮我|教教我|该怎么做|不太会|能不能告诉我)/.test(teacherTurn),
        UNKNOWN: teacherTurn ? false : true
      };
      const local_progress = localProgress(opts.evidenceUpdates, signals);
      return {
        snapshot_id: "OBS-" + Date.now().toString(36).slice(-6),
        mode: "observe",
        turn_id: opts.turnId || null,
        observed_action_fingerprint: opts.observedActionFingerprint || "",
        pragmatic_move: signals.repair ? "REPAIR" : signals.frustration ? "DISENGAGE" : "INQUIRE",
        repair: signals.repair,
        frustration: signals.frustration,
        low_certainty: signals.low_certainty,
        response_depth: signals.response_depth,
        engagement: signals.engagement,
        support_request: signals.support_request,
        local_progress,
        source_spans: teacherTurn ? [{ span_ref: "raw_turn", quote: teacherTurn.slice(0, 60) }] : [],
        confidence_by_field: { repair: signals.repair ? 0.9 : 0.5, response_depth: 0.6, engagement: 0.5 },
        unknown_fields: teacherTurn ? [] : ["response_depth", "engagement"],
        // 保证不含 forbidden：手动断言掉
        ...(() => {
          const o = {};
          for (const f of FORBIDDEN_OBS) o[f] = void 0;
          return o;
        })(),
        policy_version: VERSION
      };
    }
    function localProgress(evidenceUpdates, signals) {
      if (evidenceUpdates && evidenceUpdates.some((u) => /anchor_level_2|anchor_level_3/.test(u.reason))) return { status: "ADVANCING", progress_tactic: "continue", counts: { advance: 1 } };
      if (evidenceUpdates && evidenceUpdates.length) return { status: "ADVANCING", progress_tactic: "continue", counts: { advance: 1 } };
      if (signals.frustration) return { status: "STUCK", progress_tactic: "support", counts: { stuck: 1 } };
      if (signals.repair) return { status: "ADVANCING", progress_tactic: "repair", counts: {} };
      if (signals.response_depth === 0) return { status: "SLOW", progress_tactic: "narrow", counts: { slow: 1 } };
      return { status: "ADVANCING", progress_tactic: "continue", counts: {} };
    }
    function plan(opts) {
      const action = opts.protectedAction || {};
      const fingerprint = opts.actionFingerprint || action.action_fingerprint || "";
      if (!fingerprint) {
        return null;
      }
      const teacherTurn = opts.teacherTurn || "";
      const recentTurns = opts.recentTurns || [];
      const obs = observe({ teacherTurn, recentTurns, evidenceUpdates: opts.evidenceUpdates, observedActionFingerprint: fingerprint });
      const sm = stanceAndMove(obs.local_progress, obs, opts.allowedChallenge);
      const cal = calibrate(obs, sm.challenge_level);
      return {
        module_id: "prdm",
        module_version: VERSION,
        protected_action_fingerprint: fingerprint,
        target_slot: action.target_slot || null,
        // 只读引用（不改变）
        professional_objective: action.professional_objective || "",
        probe_strategy: action.probe_strategy || "",
        uptake_mode: obs.repair ? "BRIEF" : "NONE",
        stance: sm.stance,
        dialogue_move: sm.move,
        challenge_level: cal.challenge_level,
        question_load: cal.question_load,
        response_dose: cal.response_dose,
        max_questions: 1,
        max_chars: cal.max_chars,
        selection_reason: `progress=${obs.local_progress.status}, move=${sm.move}, challenge=${cal.challenge_level}`
      };
    }
    function stanceAndMove(progress, signals, challengeAllowed) {
      if (signals.repair) return { stance: "LISTEN", move: "REPAIR", challenge_level: 0 };
      if (signals.frustration) return { stance: "LISTEN", move: "BRIEF_UPTAKE_PROBE", challenge_level: 0 };
      if (progress.status === "STUCK") return { stance: "CO_INQUIRE", move: "NOTICE_AND_PROBE", challenge_level: 0 };
      if (progress.status === "SLOW") return { stance: "CO_INQUIRE", move: "BRIEF_UPTAKE_PROBE", challenge_level: Math.min(1, challengeAllowed) };
      if (signals.low_certainty) return { stance: "CO_INQUIRE", move: "DIRECT_PROBE", challenge_level: Math.min(1, challengeAllowed) };
      if (challengeAllowed >= 2) return { stance: "GENTLY_CHALLENGE", move: "GENTLE_CHALLENGE", challenge_level: 2 };
      return { stance: "CO_INQUIRE", move: "DIRECT_PROBE", challenge_level: 1 };
    }
    function calibrate(signals, challengeLevel) {
      let challenge = challengeLevel;
      if (signals.low_certainty) challenge = Math.min(challenge, 1);
      if (signals.frustration) challenge = 0;
      if (signals.repair) challenge = 0;
      if (signals.response_depth === 0) challenge = 0;
      const load = signals.frustration || signals.response_depth === 0 ? "LIGHT" : "STANDARD";
      const dose = signals.frustration ? "LOW" : signals.response_depth === 0 ? "MEDIUM" : "STANDARD";
      return { challenge_level: challenge, question_load: load, response_dose: dose, max_chars: signals.frustration ? 40 : 80 };
    }
    module2.exports = {
      id: "prdm",
      version: VERSION,
      ownerNamespace: "dialogue_state",
      observe,
      plan,
      FORBIDDEN_OBS,
      VERSION
    };
  }
});

// tcim/modules/rag/knowledge_need.js
var require_knowledge_need = __commonJS({
  "tcim/modules/rag/knowledge_need.js"(exports, module2) {
    "use strict";
    var ROUTES = ["R0", "R1", "R2", "R3"];
    var PHASE_TEACHER_FACING = { DIAGNOSE_INTERNAL: false, REFLECT: true, SUPPORT: true };
    var EMPTY_PROPOSAL = Object.freeze({
      proposal_type: "KnowledgeNeedProposal",
      need: false,
      gap: "",
      expected_use: "",
      intent: "",
      phase: "DIAGNOSE_INTERNAL",
      route_ceiling: "R0",
      budget: { max_refs: 3, query_terms: 3 },
      fallback_without_rag: true,
      source_refs: []
    });
    function decideKnowledgeNeed(ctx) {
      const evidence = ctx.evidence || {};
      const item = ctx.item || {};
      const turnNo = ctx.turnNo || 0;
      const core = (item.ontology && item.ontology.slots || []).filter((s) => s.core);
      const zeroLevel = core.filter((s) => {
        const st = evidence[s.slot_id];
        return st && (st.level === null || st.level === 0) && st.probe_status !== "PRUNED";
      }).length;
      const canQuery = Boolean(item.ontology && item.ontology.diagnostic_focus);
      const need = zeroLevel >= 3 && turnNo >= 3 && canQuery;
      if (!need) {
        return { ...EMPTY_PROPOSAL, fallback_without_rag: true, source_refs: [item.item_id] };
      }
      return {
        proposal_type: "KnowledgeNeedProposal",
        need: true,
        gap: `core slots \u6750\u6599/\u673A\u5236\u591A\u5904\u672A\u8FBE level_2 (zero=${zeroLevel}/${core.length})`,
        expected_use: "\u4E3A\u4E0B\u4E00\u884C\u52A8\u5019\u9009\u63D0\u4F9B\u53EF\u8FFD\u6EAF\u7684\u4E13\u4E1A\u53C2\u8003\uFF0C\u964D\u4F4E\u4E0D\u786E\u5B9A\u6027",
        intent: item.ontology.diagnostic_focus || "\u5224\u65AD",
        phase: "SUPPORT",
        // 知识用于支撑下一步探查
        route_ceiling: "R2",
        budget: { max_refs: 3, query_terms: 3 },
        fallback_without_rag: true,
        source_refs: [item.item_id, ...core.slice(0, 2).map((s) => s.slot_id)]
      };
    }
    function validateProposal(proposal) {
      const errors = [];
      const p = proposal && typeof proposal === "object" ? proposal : EMPTY_PROPOSAL;
      if (typeof p.need !== "boolean") errors.push("need \u5E94\u4E3A\u5E03\u5C14");
      if (p.need && !p.gap) errors.push("need=true \u9700 gap");
      if (p.need && !p.expected_use) errors.push("need=true \u9700 expected_use");
      if (!ROUTES.includes(p.route_ceiling)) errors.push(`route_ceiling \u975E\u6CD5: ${p.route_ceiling}`);
      if (!Object.keys(PHASE_TEACHER_FACING).includes(p.phase)) errors.push(`phase \u975E\u6CD5: ${p.phase}`);
      return { ok: errors.length === 0, errors, proposal: p };
    }
    module2.exports = {
      ROUTES,
      PHASE_TEACHER_FACING,
      EMPTY_PROPOSAL,
      decideKnowledgeNeed,
      validateProposal
    };
  }
});

// web/src/core/tcim/engine.js
var engine_exports = {};
__export(engine_exports, {
  checkConstraints: () => checkConstraints,
  firstQuestion: () => firstQuestion,
  getSemanticMode: () => getSemanticMode,
  initTcisSession: () => initTcisSession,
  isV2Enabled: () => isV2Enabled,
  processTeacherTurn: () => processTeacherTurn,
  setSemanticMode: () => setSemanticMode,
  setSemanticProvider: () => setSemanticProvider,
  setV2Enabled: () => setV2Enabled,
  tcimData: () => tcimData
});
module.exports = __toCommonJS(engine_exports);

// web/src/generated/tcim-data.js
var TCIM_DATA = {
  "version": "2026-08-21-tcim-v0.1-ai-draft",
  "common": {
    "ability_framework": {
      "version": "2026-08-21-tcim-v0.1-ai-draft",
      "framework": {
        "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3": [
          "\u5BF9\u6E38\u620F\u4EF7\u503C\u5B9E\u73B0\u7684\u8BA4\u8BC6",
          "\u5BF9\u6E38\u620F\u4EF7\u503C\u7684\u7406\u89E3\uFF08\u6E38\u620F\u4E2D\u7684\u5B66\u4E60\uFF09",
          "\u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3"
        ],
        "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC": [
          "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94",
          "\u6E38\u620F\u4E2D\u7684\u89C2\u5BDF"
        ],
        "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C": [
          "\u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272",
          "\u6E38\u620F\u73AF\u5883\u521B\u8BBE"
        ]
      }
    },
    "item_capability_mapping": {
      "version": "2026-08-21-tcim-v0.1-ai-draft",
      "mapping": [
        {
          "item_id": "Q1",
          "title": "\u7BEE\u7403\u67B6\u73A9\u6C34",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          },
          "secondary": {
            "hierarchy": [
              "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3",
              "\u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3"
            ],
            "detail": "\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3",
            "raw": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3\uFF5C\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3"
          }
        },
        {
          "item_id": "Q2",
          "title": "\u9891\u7E41\u6C42\u52A9",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          },
          "secondary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u6E38\u620F\u4E2D\u7684\u89C2\u5BDF"
            ],
            "detail": "\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B"
          }
        },
        {
          "item_id": "Q3",
          "title": "\u533A\u57DF\u505C\u7559\u77ED",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u6E38\u620F\u4E2D\u7684\u89C2\u5BDF"
            ],
            "detail": "\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B"
          },
          "secondary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1"
          }
        },
        {
          "item_id": "Q4",
          "title": "\u672A\u53C2\u4E0E\u5C0F\u7EC4\u5EFA\u6784",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          },
          "secondary": {
            "hierarchy": [
              "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C",
              "\u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272"
            ],
            "detail": "\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005",
            "raw": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\uFF5C\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005"
          }
        },
        {
          "item_id": "Q5",
          "title": "\u6D88\u9632\u5458\u6551\u706B\u5F00\u5FC3",
          "primary": {
            "hierarchy": [
              "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3",
              "\u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3"
            ],
            "detail": "\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3",
            "raw": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3\uFF5C\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3"
          },
          "secondary": {
            "hierarchy": [
              "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3",
              "\u5BF9\u6E38\u620F\u4EF7\u503C\u5B9E\u73B0\u7684\u8BA4\u8BC6"
            ],
            "detail": "\u5BF9\u6E38\u620F\u4EF7\u503C\u53D1\u6325\u673A\u5236\u548C\u89C4\u5F8B\u7684\u8BA4\u8BC6",
            "raw": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u4EF7\u503C\u5B9E\u73B0\u7684\u8BA4\u8BC6\uFF5C\u5BF9\u6E38\u620F\u4EF7\u503C\u53D1\u6325\u673A\u5236\u548C\u89C4\u5F8B\u7684\u8BA4\u8BC6"
          }
        },
        {
          "item_id": "Q6",
          "title": "\u6750\u6599\u9009\u62E9\u65E0\u5C42\u6B21",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C",
              "\u6E38\u620F\u73AF\u5883\u521B\u8BBE"
            ],
            "detail": "\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E",
            "raw": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6E38\u620F\u73AF\u5883\u521B\u8BBE\uFF5C\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E"
          },
          "secondary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          }
        },
        {
          "item_id": "Q7",
          "title": "\u827E\u838E\u516C\u4E3B\u4E0D\u8FD0\u52A8",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          },
          "secondary": {
            "hierarchy": [
              "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3",
              "\u5BF9\u6E38\u620F\u4EF7\u503C\u7684\u7406\u89E3\uFF08\u6E38\u620F\u4E2D\u7684\u5B66\u4E60\uFF09"
            ],
            "detail": "\u5BF9\u6E38\u620F\u72EC\u7279\u7684\u5B66\u4E60\u548C\u53D1\u5C55\u4EF7\u503C\u7684\u8BA4\u8BC6",
            "raw": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u4EF7\u503C\u7684\u7406\u89E3\uFF08\u6E38\u620F\u4E2D\u7684\u5B66\u4E60\uFF09\uFF5C\u5BF9\u6E38\u620F\u72EC\u7279\u7684\u5B66\u4E60\u548C\u53D1\u5C55\u4EF7\u503C\u7684\u8BA4\u8BC6"
          }
        },
        {
          "item_id": "Q8",
          "title": "\u5F15\u6C34\u96BE\u9898\u672A\u89E3",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          },
          "secondary": {
            "hierarchy": [
              "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C",
              "\u6E38\u620F\u73AF\u5883\u521B\u8BBE"
            ],
            "detail": "\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E",
            "raw": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6E38\u620F\u73AF\u5883\u521B\u8BBE\uFF5C\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E"
          }
        },
        {
          "item_id": "Q9",
          "title": "\u98DE\u884C\u68CB\u5404\u8D70\u5404\u7684",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          },
          "secondary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u6E38\u620F\u4E2D\u7684\u89C2\u5BDF"
            ],
            "detail": "\u5BF9\u5E7C\u513F\u6E38\u620F\u6846\u67B6\u7684\u89C2\u5BDF\u4E0E\u7406\u89E3",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u6846\u67B6\u7684\u89C2\u5BDF\u4E0E\u7406\u89E3"
          }
        },
        {
          "item_id": "Q10",
          "title": "\u8DF3\u7EF3\u79E9\u5E8F\u6DF7\u4E71",
          "primary": {
            "hierarchy": [
              "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC",
              "\u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94"
            ],
            "detail": "\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
            "raw": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027"
          },
          "secondary": {
            "hierarchy": [
              "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C",
              "\u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272"
            ],
            "detail": "\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005",
            "raw": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\uFF5C\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005"
          }
        }
      ]
    },
    "empirical_scoring_rules": {
      "version": "2026-08-21-tcim-v0.1-ai-draft",
      "empirical": {
        "Q1": {
          "0": [
            "BDCA",
            "DACB",
            "DBAC",
            "DBCA",
            "DCAB",
            "DCBA"
          ],
          "1": [
            "ADBC",
            "ADCB",
            "BADC",
            "BCDA",
            "BDAC",
            "CBDA",
            "CDBA",
            "DABC"
          ],
          "2": [
            "ACDB",
            "BACD",
            "CADB",
            "CDAB"
          ],
          "3": [
            "ABDC",
            "BCAD",
            "CBAD"
          ],
          "4": [
            "ABCD",
            "ACBD",
            "CABD"
          ]
        },
        "Q2": {
          "0": [
            "BDCA"
          ],
          "1": [
            "BADC",
            "BCAD",
            "BCDA",
            "BDAC",
            "CBDA",
            "DBAC",
            "DBCA",
            "DCBA"
          ],
          "2": [
            "ABCD",
            "ABDC",
            "ADBC",
            "BACD",
            "CABD",
            "CBAD",
            "CDAB",
            "CDBA",
            "DABC"
          ],
          "3": [
            "ACBD",
            "ADCB",
            "CADB",
            "DCAB"
          ],
          "4": [
            "ACDB",
            "DACB"
          ]
        },
        "Q3": {
          "0": [
            "ABCD",
            "ABDC",
            "ADCB",
            "BACD",
            "BADC",
            "BDCA"
          ],
          "1": [
            "ACBD",
            "ADBC",
            "BCAD",
            "BCDA",
            "CABD",
            "CBDA",
            "DABC",
            "DACB"
          ],
          "2": [
            "ACDB",
            "BDAC",
            "CBAD",
            "DBAC"
          ],
          "3": [
            "CADB",
            "CDBA",
            "DCAB"
          ],
          "4": [
            "CDAB",
            "DBCA",
            "DCBA"
          ]
        },
        "Q4": {
          "0": [
            "CDAB",
            "DCAB"
          ],
          "1": [
            "ACDB",
            "ADCB",
            "CADB",
            "CBDA",
            "CDBA",
            "DABC",
            "DACB",
            "DCBA"
          ],
          "2": [
            "ACBD",
            "ADBC",
            "BCDA",
            "BDAC",
            "BDCA",
            "CABD",
            "CBAD",
            "DBAC",
            "DBCA"
          ],
          "3": [
            "ABCD",
            "ABDC",
            "BADC",
            "BCAD"
          ],
          "4": [
            "BACD"
          ]
        },
        "Q5": {
          "0": [
            "ADCB",
            "CADB",
            "CBAD",
            "DCAB"
          ],
          "1": [
            "ACDB",
            "ADBC",
            "BCDA",
            "CABD",
            "CBDA",
            "CDAB",
            "CDBA",
            "DBCA"
          ],
          "2": [
            "ABCD",
            "ABDC",
            "ACBD",
            "BCAD",
            "DABC",
            "DACB",
            "DCBA"
          ],
          "3": [
            "BACD",
            "BADC",
            "BDCA",
            "DBAC"
          ],
          "4": [
            "BDAC"
          ]
        },
        "Q6": {
          "0": [
            "ABCD",
            "ABDC",
            "ACBD",
            "ACDB",
            "ADBC",
            "BACD",
            "BADC"
          ],
          "1": [
            "ADCB",
            "BCAD",
            "CABD",
            "CADB"
          ],
          "2": [
            "BDAC",
            "CBAD",
            "CDAB",
            "DACB"
          ],
          "3": [
            "BCDA",
            "BDCA",
            "CDBA",
            "DABC",
            "DBAC",
            "DCAB"
          ],
          "4": [
            "CBDA",
            "DBCA",
            "DCBA"
          ]
        },
        "Q7": {
          "0": [
            "ADBC",
            "DBAC",
            "DBCA"
          ],
          "1": [
            "ADCB",
            "BADC",
            "BCDA",
            "BDCA",
            "CBDA",
            "CDAB",
            "DABC",
            "DCBA"
          ],
          "2": [
            "ABCD",
            "ABDC",
            "ACDB",
            "BACD",
            "BCAD",
            "BDAC",
            "CBAD",
            "DACB",
            "DCAB"
          ],
          "3": [
            "ACBD",
            "CABD",
            "CDBA"
          ],
          "4": [
            "CADB"
          ]
        },
        "Q8": {
          "0": [
            "ACDB",
            "ADCB",
            "CADB",
            "DACB"
          ],
          "1": [
            "ABCD",
            "ABDC",
            "ACBD",
            "ADBC",
            "CABD",
            "CDAB",
            "DABC",
            "DCAB"
          ],
          "2": [
            "BACD",
            "BADC",
            "BDAC",
            "CDBA",
            "DBAC",
            "DBCA",
            "DCBA"
          ],
          "3": [
            "BCAD",
            "BDCA",
            "CBAD",
            "CBDA"
          ],
          "4": [
            "BCDA"
          ]
        },
        "Q9": {
          "0": [
            "ABDC",
            "ACBD",
            "ADBC",
            "BDAC",
            "BDCA",
            "DABC"
          ],
          "1": [
            "ABCD",
            "ACDB",
            "ADCB",
            "DACB",
            "DBAC"
          ],
          "2": [
            "BACD",
            "BADC",
            "BCAD",
            "CABD",
            "CADB",
            "CBDA"
          ],
          "3": [
            "BCDA",
            "CBAD",
            "CDAB",
            "CDBA",
            "DBCA"
          ],
          "4": [
            "DCAB",
            "DCBA"
          ]
        },
        "Q10": {
          "0": [
            "ABCD"
          ],
          "1": [
            "ACBD",
            "ACDB",
            "ADBC",
            "BACD",
            "CABD",
            "CADB",
            "CBDA",
            "DABC",
            "DACB"
          ],
          "2": [
            "ABDC",
            "ADCB",
            "BCAD",
            "CBAD",
            "CDAB",
            "DCAB"
          ],
          "3": [
            "BCDA",
            "CDBA",
            "DBAC",
            "DBCA",
            "DCBA"
          ],
          "4": [
            "BADC",
            "BDAC",
            "BDCA"
          ]
        }
      }
    }
  },
  "items": {
    "Q1": {
      "item_id": "Q1",
      "title": "\u7BEE\u7403\u67B6\u73A9\u6C34",
      "ontology": {
        "item_id": "Q1",
        "title": "\u7BEE\u7403\u67B6\u73A9\u6C34",
        "stem": "\u64CD\u573A\u4E0A\u65B0\u5B89\u88C5\u4E86\u4E00\u4E9B\u7BEE\u7403\u67B6\uFF0C\u5E7C\u513F\u7ECF\u5E38\u5728\u8FD9\u91CC\u6295\u7BEE\u3002\u67D0\u5929\u6237\u5916\u6D3B\u52A8\u65F6\uFF0C\u51E0\u540D\u5E7C\u513F\u5E26\u7740\u753B\u7B14\u548C\u6C34\u6876\u6765\u5230\u8FD9\u91CC\uFF0C\u4ED6\u4EEC\u5148\u662F\u5FEB\u4E50\u5730\u7C89\u5237\u7BEE\u7403\u67B6\uFF0C\u4E4B\u540E\u5F00\u59CB\u5F80\u7BEE\u6846\u91CC\u704C\u6C34\uFF0C\u6709\u7684\u4ECE\u4E0A\u9762\u704C\uFF0C\u6709\u7684\u5728\u4E0B\u9762\u63A5\uFF0C\u5FD9\u7684\u4E0D\u4EA6\u4E50\u4E4E\uFF0C\u4FE8\u7136\u8FD9\u91CC\u6210\u4E3A\u4E86\u73A9\u6C34\u7684\u573A\u5730\u3002",
        "options": {
          "A": "\u770B\u5230\u5E7C\u513F\u73A9\u5F97\u5F88\u5F00\u5FC3\uFF0C\u4E0D\u5E72\u9884\u4ED6\u4EEC\u7684\u73A9\u6C34\u884C\u4E3A\uFF0C\u5F85\u5174\u8DA3\u51CF\u5F31\u540E\u518D\u8BA8\u8BBA\u73A9\u6C34\u7684\u9002\u5B9C\u6027\u3002",
          "B": "\u8868\u626C\u5E7C\u513F\u7684\u65B0\u53D1\u73B0\uFF0C\u5E76\u8BE2\u95EE\u5728\u7BEE\u7403\u67B6\u65C1\u73A9\u6C34\u662F\u5426\u5408\u9002\uFF0C\u63D0\u8BAE\u5E7C\u513F\u53EF\u4EE5\u6362\u4E2A\u5730\u65B9\u73A9\u6C34\u3002",
          "C": "\u53C2\u4E0E\u5230\u5E7C\u513F\u7684\u201C\u7C89\u5237\u201D\u6E38\u620F\u4E2D\uFF0C\u9010\u6B65\u5F15\u5BFC\u5E7C\u513F\u5230\u9002\u5B9C\u73A9\u6C34\u7684\u5730\u65B9\u7EE7\u7EED\u5F00\u5C55\u6E38\u620F\u3002",
          "D": "\u63D0\u9192\u5E7C\u513F\u7BEE\u7403\u67B6\u662F\u7528\u4E8E\u5F00\u5C55\u8FD0\u52A8\u7684\uFF0C\u4E0E\u5176\u4ED6\u5E7C\u513F\u4E00\u8D77\u53EC\u5524\u4ED6\u4EEC\u6253\u7BEE\u7403\uFF0C\u8F6C\u79FB\u4ED6\u4EEC\u7684\u5173\u6CE8\u70B9\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3\uFF5C\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u5728\u5E7C\u513F\u81EA\u4E3B\u751F\u6210\u7684\u73A9\u6C34\u6E38\u620F\u4E0E\u89C4\u5219\u3001\u5B89\u5168\u3001\u573A\u5730\u9002\u5B9C\u6027\u4E4B\u95F4\u4F5C\u51FA\u4E13\u4E1A\u5224\u65AD\uFF1A\u65E2\u4E0D\u7B80\u5355\u7981\u6B62\uFF0C\u4E5F\u4E0D\u653E\u4EFB\u98CE\u9669\uFF0C\u800C\u662F\u987A\u5E94\u6E38\u620F\u5174\u8DA3\u5E76\u4EE5\u9002\u5B9C\u65B9\u5F0F\u56DE\u5E94\u3002",
        "slots": [
          {
            "slot_id": "Q1-S1",
            "dimension": "C2 \u4ECB\u5165\u65F6\u673A",
            "name": "\u81EA\u4E3B\u6E38\u620F\u610F\u4E49\u8BC6\u522B",
            "definition": "\u8BC6\u522B\u2018\u7C89\u5237\u2014\u704C\u6C34\u2014\u63A5\u6C34\u2019\u662F\u5E7C\u513F\u81EA\u4E3B\u751F\u6210\u5E76\u6301\u7EED\u53D1\u5C55\u7684\u6E38\u620F\u60C5\u8282\uFF0C\u4E0D\u56E0\u573A\u5730\u539F\u7528\u9014\u4E0D\u540C\u5C31\u76F4\u63A5\u5426\u5B9A\u3002",
            "diagnostic_meaning": "\u5224\u65AD\u6559\u5E08\u80FD\u5426\u4ECE\u6E38\u620F\u6846\u67B6\u800C\u975E\u6210\u4EBA\u7528\u9014\u903B\u8F91\u7406\u89E3\u884C\u4E3A\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u6F84\u6E05/\u7406\u7531\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u76F4\u63A5\u8981\u6C42\u56DE\u7BEE\u7403\u6D3B\u52A8"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u5BF9\u5E94A/B/C\u80FD\u4FDD\u7559\u6E38\u620F\u610F\u4E49\uFF1BD\u4E3B\u8981\u628A\u6CE8\u610F\u91CD\u65B0\u62C9\u56DE\u6210\u4EBA\u9884\u8BBE\u7528\u9014\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q1-S2",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u573A\u5730\u9002\u5B9C\u6027\u4E0E\u98CE\u9669\u5224\u65AD",
            "definition": "\u540C\u65F6\u8BC4\u4F30\u7BEE\u7403\u67B6\u8BBE\u5907\u3001\u5730\u9762\u6E7F\u6ED1\u3001\u5176\u4ED6\u5E7C\u513F\u4F7F\u7528\u6743\u3001\u7528\u6C34\u8303\u56F4\u7B49\u5B9E\u9645\u98CE\u9669\uFF0C\u533A\u5206\u2018\u89C4\u5219\u4E0D\u7B26\u2019\u4E0E\u2018\u9700\u8981\u7ACB\u5373\u5904\u7406\u7684\u5B89\u5168/\u516C\u5171\u6027\u95EE\u9898\u2019\u3002",
            "diagnostic_meaning": "\u51B3\u5B9A\u662F\u53EF\u77ED\u6682\u7EE7\u7EED\u3001\u534F\u5546\u8F6C\u573A\u8FD8\u662F\u5FC5\u987B\u7ACB\u5373\u4E2D\u6B62\u3002",
            "core": true,
            "prerequisites": [
              "Q1-S1"
            ],
            "allowed_actions": [
              "\u8BC1\u636E\u8FFD\u95EE/\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u62BD\u8C61\u8BF4\u2018\u89C4\u5219\u5C31\u662F\u89C4\u5219\u2019"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u662F\u89E3\u91CAA/B/C\u5148\u540E\u5DEE\u5F02\u7684\u5173\u952ESlot\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q1-S3",
            "dimension": "C2 \u4ECB\u5165\u65F6\u673A",
            "name": "\u4ECB\u5165\u65F6\u673A\u7684\u6761\u4EF6\u5316\u5224\u65AD",
            "definition": "\u82E5\u98CE\u9669\u53EF\u63A7\uFF0C\u53EF\u5141\u8BB8\u6E38\u620F\u7EE7\u7EED\u4E00\u6BB5\u5E76\u62E9\u673A\u8BA8\u8BBA\uFF1B\u82E5\u5730\u9762\u6E7F\u6ED1\u3001\u8BBE\u5907\u53D7\u635F\u6216\u59A8\u788D\u4ED6\u4EBA\uFF0C\u5219\u5E94\u53CA\u65F6\u8F7B\u4ECB\u5165\u3002",
            "diagnostic_meaning": "\u628A\u2018\u4E0D\u5E72\u9884\u2019\u4E0E\u2018\u53CA\u65F6\u5E72\u9884\u2019\u90FD\u4ECE\u56FA\u5B9A\u7ACB\u573A\u8F6C\u4E3A\u60C5\u5883\u5224\u65AD\u3002",
            "core": true,
            "prerequisites": [
              "Q1-S2"
            ],
            "allowed_actions": [
              "\u6761\u4EF6\u8FB9\u754C/\u53CD\u4F8B"
            ],
            "forbidden_actions": [
              "\u9ED8\u8BA4\u8D8A\u5C11\u4ECB\u5165\u8D8A\u4E13\u4E1A"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u5B9E\u8BC14\u5206\u5141\u8BB8A\u6216C\u5C45\u9996\uFF0C\u8BF4\u660E\u9AD8\u6C34\u5E73\u4E0D\u5BF9\u5E94\u5355\u4E00\u56FA\u5B9A\u65F6\u673A\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q1-S4",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u4FDD\u6301\u6E38\u620F\u8FDE\u7EED\u6027\u7684\u8F6C\u573A\u652F\u6301",
            "definition": "\u4ECB\u5165\u65F6\u627F\u63A5\u2018\u7C89\u5237/\u73A9\u6C34\u2019\u60C5\u8282\uFF0C\u901A\u8FC7\u53C2\u4E0E\u3001\u534F\u5546\u3001\u5171\u540C\u5BFB\u627E\u9002\u5B9C\u5730\u70B9\u7B49\u65B9\u5F0F\u628A\u6E38\u620F\u8FC1\u79FB\uFF0C\u800C\u4E0D\u662F\u7A81\u7136\u53D6\u6D88\u6E38\u620F\u4E3B\u9898\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u6559\u5E08\u80FD\u5426\u4EE5\u4F4E\u63A7\u5236\u65B9\u5F0F\u540C\u65F6\u7EF4\u62A4\u89C4\u5219/\u5B89\u5168\u4E0E\u6E38\u620F\u8FDE\u7EED\u6027\u3002",
            "core": true,
            "prerequisites": [
              "Q1-S1",
              "Q1-S2"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210/\u8BDD\u672F"
            ],
            "forbidden_actions": [
              "\u8F6C\u79FB\u6CE8\u610F\u3001\u547D\u4EE4\u505C\u6B62"
            ],
            "default_priority": "P1",
            "empirical_relation": "C\u6700\u76F4\u63A5\u4F53\u73B0\uFF1BB\u4E5F\u53EF\u80FD\u505A\u5230\uFF0C\u53D6\u51B3\u4E8E\u95EE\u6CD5\u548C\u513F\u7AE5\u53C2\u4E0E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q1-S5",
            "dimension": "A1 \u6E38\u620F\u7279\u70B9",
            "name": "\u89C4\u5219\u4E0E\u81EA\u4E3B\u6027\u7684\u534F\u8C03",
            "definition": "\u80FD\u5411\u5E7C\u513F\u8BF4\u660E\u573A\u5730\u8FB9\u754C\u7684\u7406\u7531\uFF0C\u5E76\u5141\u8BB8\u5E7C\u513F\u53C2\u4E0E\u5BFB\u627E\u66FF\u4EE3\u5730\u70B9/\u65B9\u5F0F\uFF1B\u89C4\u5219\u670D\u52A1\u4E8E\u5171\u540C\u5B89\u5168\u548C\u6301\u7EED\u6E38\u620F\uFF0C\u800C\u975E\u6062\u590D\u6210\u4EBA\u539F\u5B9A\u7528\u9014\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u6559\u5E08\u5BF9\u6E38\u620F\u81EA\u4E3B\u6027\u4E0E\u516C\u5171\u89C4\u5219\u5173\u7CFB\u7684\u7406\u89E3\u3002",
            "core": true,
            "prerequisites": [
              "Q1-S2",
              "Q1-S4"
            ],
            "allowed_actions": [
              "\u6BD4\u8F83\u6743\u8861/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u628A\u81EA\u4E3B\u7B49\u540C\u5B8C\u5168\u653E\u4EFB"
            ],
            "default_priority": "P2",
            "empirical_relation": "\u5B9E\u8BC1\u4F4E\u5206\u96C6\u4E2D\u4E8ED\u524D\u7F6E\uFF0C\u63D0\u793A\u2018\u4EE5\u7528\u9014\u538B\u5236\u81EA\u4E3B\u751F\u6210\u2019\u662F\u91CD\u8981\u4F4E\u6C34\u5E73\u7279\u5F81\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q1-S6",
            "dimension": "C2 \u52A8\u6001\u56DE\u5E94",
            "name": "\u4ECB\u5165\u540E\u7684\u89C2\u5BDF\u4E0E\u518D\u8C03\u6574",
            "definition": "\u89C2\u5BDF\u8F6C\u573A\u540E\u6E38\u620F\u662F\u5426\u5EF6\u7EED\u3001\u5E7C\u513F\u662F\u5426\u7406\u89E3\u7406\u7531\u3001\u662F\u5426\u51FA\u73B0\u65B0\u7684\u5B89\u5168\u95EE\u9898\uFF0C\u5E76\u636E\u6B64\u8C03\u6574\u652F\u6301\u3002",
            "diagnostic_meaning": "\u5F62\u6210\u56DE\u5E94\u95ED\u73AF\uFF0C\u907F\u514D\u4E00\u6B21\u6027\u5904\u7406\u3002",
            "core": false,
            "prerequisites": [
              "Q1-S4"
            ],
            "allowed_actions": [
              "\u53CD\u601D/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u53EA\u770B\u662F\u5426\u670D\u4ECE"
            ],
            "default_priority": "P3",
            "empirical_relation": "\u7528\u4E8E\u9AD8\u6C34\u5E73\u6269\u5C55\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q1",
        "anchors": [
          {
            "slot_id": "Q1-S1",
            "level_0": "\u628A\u704C\u6C34\u89C6\u4E3A\u8FDD\u89C4/\u4E71\u73A9\uFF0C\u53EA\u60F3\u8BA9\u5E7C\u513F\u56DE\u53BB\u6295\u7BEE\u3002",
            "level_1": "\u627F\u8BA4\u5E7C\u513F\u73A9\u5F97\u5F00\u5FC3\u6216\u6709\u65B0\u53D1\u73B0\uFF0C\u4F46\u6E38\u620F\u610F\u4E49\u7406\u89E3\u8F83\u6D45\u3002",
            "level_2": "\u80FD\u8BF4\u51FA\u5E7C\u513F\u6B63\u5728\u628A\u7BEE\u7403\u67B6\u8F6C\u5316\u4E3A\u2018\u7C89\u5237\u3001\u8F93\u6C34\u3001\u63A5\u6C34\u2019\u7684\u81EA\u4E3B\u6E38\u620F\uFF0C\u5E76\u8BA4\u4E3A\u56DE\u5E94\u5E94\u627F\u63A5\u8FD9\u4E00\u60C5\u8282\u3002",
            "level_3": "\u8FD8\u80FD\u533A\u5206\u2018\u5C0A\u91CD\u6E38\u620F\u751F\u6210\u2019\u4E0E\u2018\u4EFB\u4F55\u884C\u4E3A\u90FD\u53EF\u7EE7\u7EED\u2019\uFF0C\u4E3B\u52A8\u628A\u6E38\u620F\u610F\u4E49\u4E0E\u573A\u5730/\u98CE\u9669\u5224\u65AD\u540C\u65F6\u7EB3\u5165\u3002",
            "false_evidence": "\u53EA\u8BF4\u2018\u5C0A\u91CD\u5E7C\u513F\u2019\u3002",
            "conflict_evidence": "\u53E3\u5934\u80AF\u5B9A\u65B0\u53D1\u73B0\u540E\u7ACB\u5373\u7528\u7BEE\u7403\u6D3B\u52A8\u66FF\u4EE3\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q1-S2",
            "level_0": "\u53EA\u8BF4\u89C4\u5219\u4E0D\u5141\u8BB8\uFF0C\u6216\u5B8C\u5168\u4E0D\u8003\u8651\u5730\u9762\u3001\u8BBE\u5907\u3001\u4ED6\u4EBA\u3002",
            "level_1": "\u80FD\u610F\u8BC6\u5230\u53EF\u80FD\u4E0D\u5408\u9002\uFF0C\u4F46\u5224\u65AD\u6807\u51C6\u6A21\u7CCA\u3002",
            "level_2": "\u80FD\u5177\u4F53\u68C0\u67E5\u6E7F\u6ED1\u3001\u8BBE\u5907\u3001\u4ED6\u4EBA\u4F7F\u7528\u3001\u7528\u6C34\u8303\u56F4\u7B49\uFF0C\u5E76\u636E\u98CE\u9669\u7A0B\u5EA6\u51B3\u5B9A\u5904\u7406\u3002",
            "level_3": "\u80FD\u533A\u5206\u53EF\u534F\u5546\u7684\u4E0D\u9002\u5B9C\u4E0E\u5FC5\u987B\u5373\u65F6\u5904\u7406\u7684\u98CE\u9669\uFF0C\u5E76\u8BF4\u660E\u8BC1\u636E\u5982\u4F55\u6539\u53D8\u4ECB\u5165\u5F3A\u5EA6\u3002",
            "false_evidence": "\u6CDB\u79F0\u2018\u6CE8\u610F\u5B89\u5168\u2019\u3002",
            "conflict_evidence": "\u65E0\u98CE\u9669\u8BC1\u636E\u5374\u4E00\u5F8B\u7ACB\u5373\u5236\u6B62\uFF0C\u6216\u660E\u663E\u98CE\u9669\u4E0B\u4ECD\u65E0\u9650\u7B49\u5F85\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q1-S3",
            "level_0": "\u56FA\u5B9A\u4E3B\u5F20\u4E0D\u4ECB\u5165\u6216\u7ACB\u5373\u5236\u6B62\u3002",
            "level_1": "\u77E5\u9053\u8981\u770B\u60C5\u51B5\uFF0C\u4F46\u8BF4\u4E0D\u51FA\u4F55\u65F6\u6539\u53D8\u505A\u6CD5\u3002",
            "level_2": "\u80FD\u7ED9\u51FA\u81F3\u5C112\u4E2A\u4ECB\u5165\u9608\u503C\uFF0C\u5982\u5730\u9762\u660E\u663E\u6E7F\u6ED1/\u59A8\u788D\u4ED6\u4EBA\u65F6\u53CA\u65F6\u4ECB\u5165\uFF0C\u98CE\u9669\u53EF\u63A7\u65F6\u53EF\u77ED\u6682\u4FDD\u7559\u6E38\u620F\u3002",
            "level_3": "\u80FD\u628A\u9608\u503C\u3001\u6E38\u620F\u6295\u5165\u548C\u66FF\u4EE3\u652F\u6301\u8FDE\u6210\u52A8\u6001\u8DEF\u5F84\uFF1A\u89C2\u5BDF\u2014\u8F7B\u4ECB\u5165\u2014\u5FC5\u8981\u5347\u7EA7\u2014\u6062\u590D\u81EA\u4E3B\u3002",
            "false_evidence": "\u2018\u968F\u673A\u5E94\u53D8\u2019\u3002",
            "conflict_evidence": "\u628AA\u6216C\u673A\u68B0\u5F53\u552F\u4E00\u6B63\u786E\u7B54\u6848\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q1-S4",
            "level_0": "\u76F4\u63A5\u8F6C\u79FB\u5230\u7BEE\u7403\u6216\u547D\u4EE4\u6362\u5730\u65B9\u3002",
            "level_1": "\u4F1A\u5EFA\u8BAE\u6362\u5730\u65B9\uFF0C\u4F46\u7531\u6559\u5E08\u5355\u65B9\u9762\u51B3\u5B9A\uFF0C\u6E38\u620F\u60C5\u8282\u5BB9\u6613\u4E2D\u65AD\u3002",
            "level_2": "\u80FD\u627F\u63A5\u7C89\u5237/\u73A9\u6C34\u4E3B\u9898\uFF0C\u4E0E\u5E7C\u513F\u5546\u91CF\u6216\u5171\u540C\u8FDB\u5165\u65B0\u5730\u70B9\u7EE7\u7EED\u6E38\u620F\u3002",
            "level_3": "\u80FD\u8BA9\u5E7C\u513F\u53C2\u4E0E\u5224\u65AD\u2018\u54EA\u91CC\u66F4\u9002\u5408\u3001\u9700\u8981\u5E26\u4EC0\u4E48\u3001\u600E\u6837\u7EE7\u7EED\u2019\uFF0C\u4F7F\u89C4\u5219\u7406\u89E3\u548C\u6E38\u620F\u5EF6\u7EED\u540C\u65F6\u53D1\u751F\u3002",
            "false_evidence": "\u53EA\u662F\u628A\u547D\u4EE4\u6362\u6210\u6E29\u548C\u8BED\u6C14\u3002",
            "conflict_evidence": "\u8F6C\u573A\u540E\u539F\u6E38\u620F\u5B8C\u5168\u6D88\u5931\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q1-S5",
            "level_0": "\u89C4\u5219=\u6210\u4EBA\u89C4\u5B9A\u7528\u9014\uFF0C\u5E7C\u513F\u5E94\u670D\u4ECE\u3002",
            "level_1": "\u627F\u8BA4\u81EA\u4E3B\uFF0C\u4F46\u89C4\u5219\u8BF4\u660E\u4ECD\u4EE5\u2018\u7BEE\u7403\u67B6\u5C31\u662F\u6253\u7BEE\u7403\u2019\u4E3A\u4E3B\u3002",
            "level_2": "\u80FD\u89E3\u91CA\u89C4\u5219/\u573A\u5730\u8FB9\u754C\u670D\u52A1\u4E8E\u5B89\u5168\u3001\u5171\u540C\u4F7F\u7528\u548C\u6750\u6599\u4FDD\u62A4\uFF0C\u540C\u65F6\u4FDD\u7559\u5E7C\u513F\u81EA\u4E3B\u751F\u6210\u73A9\u6CD5\u3002",
            "level_3": "\u80FD\u8FDB\u4E00\u6B65\u652F\u6301\u5E7C\u513F\u5171\u540C\u8BA8\u8BBA\u9002\u5B9C\u573A\u5730\u548C\u89C4\u5219\uFF0C\u628A\u5916\u90E8\u9650\u5236\u8F6C\u5316\u4E3A\u53EF\u7406\u89E3\u3001\u53EF\u53C2\u4E0E\u7684\u5171\u540C\u89C4\u8303\u3002",
            "false_evidence": "\u5B8C\u5168\u653E\u4EFB\u4E5F\u53EB\u5C0A\u91CD\u81EA\u4E3B\u3002",
            "conflict_evidence": "\u89C4\u5219\u7406\u7531\u4E0E\u5B9E\u9645\u98CE\u9669\u65E0\u5173\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q1-S6",
            "level_0": "\u4ECB\u5165\u6216\u8F6C\u573A\u540E\u4E0D\u518D\u89C2\u5BDF\uFF0C\u53EA\u770B\u5E7C\u513F\u662F\u5426\u670D\u4ECE\u3002",
            "level_1": "\u4F1A\u770B\u6E38\u620F\u662F\u5426\u7EE7\u7EED\uFF0C\u4F46\u672A\u5173\u6CE8\u5E7C\u513F\u7406\u89E3\u3001\u65B0\u98CE\u9669\u6216\u662F\u5426\u9700\u8981\u8C03\u6574\u3002",
            "level_2": "\u80FD\u89C2\u5BDF\u8F6C\u573A\u540E\u6E38\u620F\u662F\u5426\u5EF6\u7EED\u3001\u5E7C\u513F\u662F\u5426\u7406\u89E3\u7406\u7531\u53CA\u662F\u5426\u51FA\u73B0\u65B0\u98CE\u9669\uFF0C\u5E76\u636E\u6B64\u8C03\u6574\u652F\u6301\u3002",
            "level_3": "\u80FD\u4F9D\u636E\u8FDE\u7EED\u53CD\u9988\u5728\u653E\u5BBD\u3001\u63D0\u9192\u3001\u5347\u7EA7\u4E0E\u9000\u51FA\u4E4B\u95F4\u6821\u51C6\uFF0C\u4F7F\u5B89\u5168\u3001\u89C4\u5219\u7406\u89E3\u548C\u6E38\u620F\u8FDE\u7EED\u6027\u5F62\u6210\u95ED\u73AF\u3002",
            "false_evidence": "\u53EA\u95EE\u2018\u542C\u61C2\u4E86\u5417\u2019\u3002",
            "conflict_evidence": "\u65B0\u573A\u5730\u4ECD\u6709\u98CE\u9669\u6216\u6E38\u620F\u5DF2\u7ECF\u4E2D\u65AD\uFF0C\u5374\u4E0D\u518D\u8C03\u6574\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q1",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1AABCD/ACBD/CABD",
            "hypothesis": "\u603B\u4F53\u5224\u65AD\u8F83\u6210\u719F\uFF1AA/C\u53EF\u5C45\u9996\u3001D\u7A33\u5B9A\u5C45\u672B\uFF1B\u53EF\u80FD\u5DF2\u7406\u89E3\u81EA\u4E3B\u6E38\u620F\u548C\u4F4E\u63A7\u5236\u56DE\u5E94\u3002",
            "target_slots": [
              "Q1-S2",
              "Q1-S3",
              "Q1-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FB9\u754C\u53CD\u4F8B",
            "forbidden_question": "\u201C\u65E2\u71364\u5206\uFF0C\u5C31\u4E0D\u9700\u8981\u518D\u95EE\u4E86\u3002\u201D",
            "rationale": "\u91CD\u70B9\u9A8C\u8BC1\uFF1A\u6559\u5E08\u628AA\u6216C\u653E\u524D\u662F\u57FA\u4E8E\u98CE\u9669\u5224\u65AD\uFF0C\u8FD8\u662F\u4EC5\u51ED\u2018\u5C11\u5E72\u9884\u2019\u76F4\u89C9\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206\uFF1AABDC/BCAD/CBAD",
            "hypothesis": "\u5DF2\u6709\u8F83\u597D\u5224\u65AD\uFF0C\u4F46A/B/C\u4E4B\u95F4\u7684\u4ECB\u5165\u65F6\u673A\u6216\u8F6C\u573A\u65B9\u5F0F\u53EF\u80FD\u4E0D\u591F\u7A33\u5B9A\u3002",
            "target_slots": [
              "Q1-S3",
              "Q1-S4",
              "Q1-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u6BD4\u8F83\u6743\u8861",
            "forbidden_question": "\u201CA\u3001B\u3001C\u8C01\u7EDD\u5BF9\u6700\u597D\uFF1F\u201D",
            "rationale": "\u7528\u98CE\u9669\u53D8\u5316\u60C5\u5883\u770B\u6392\u5E8F\u7406\u7531\u80FD\u5426\u52A8\u6001\u8C03\u6574\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u90E8\u5206\u7406\u89E3\u81EA\u4E3B\u6027\uFF0C\u4F46\u53EF\u80FD\u5728\u2018\u8BA8\u8BBA\u89C4\u5219\u3001\u8F6C\u573A\u3001\u7B49\u5F85\u2019\u4E4B\u95F4\u7F3A\u5C11\u6E05\u6670\u6761\u4EF6\u3002",
            "target_slots": [
              "Q1-S2",
              "Q1-S3"
            ],
            "priority": "P1",
            "preferred_action": "\u6761\u4EF6\u8FB9\u754C",
            "forbidden_question": "\u201C\u73A9\u5F97\u5F00\u5FC3\u5C31\u5E94\u8BE5\u7EE7\u7EED\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "rationale": "\u5148\u67E5\u98CE\u9669\u2014\u65F6\u673A\u903B\u8F91\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u4E14D\u6392\u524D",
            "hypothesis": "\u53EF\u80FD\u4EE5\u6210\u4EBA\u573A\u5730\u7528\u9014/\u8F6C\u79FB\u6CE8\u610F\u4E3A\u4E3B\u8981\u7BA1\u7406\u624B\u6BB5\uFF0C\u6E38\u620F\u6846\u67B6\u7406\u89E3\u4E0D\u8DB3\u3002",
            "target_slots": [
              "Q1-S1",
              "Q1-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u6E38\u620F\u610F\u4E49\u6F84\u6E05\uFF0B\u53CD\u4F8B",
            "forbidden_question": "\u201C\u7BEE\u7403\u67B6\u5F53\u7136\u53EA\u80FD\u6253\u7BEE\u7403\u5427\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u8BCA\u65AD\u4F4E\u63A7\u5236\u56DE\u5E94\u4E0E\u6E38\u620F\u81EA\u4E3B\u6027\u3002",
            "calibration_note": ""
          },
          {
            "condition": "A\u5C45\u9996\u4F46\u6559\u5E08\u4F4E\u786E\u4FE1/\u53CD\u590D\u4FEE\u6539",
            "hypothesis": "\u53EF\u80FD\u76F4\u89C9\u652F\u6301\u2018\u4E0D\u5E72\u9884\u2019\uFF0C\u4F46\u4E0D\u6E05\u695A\u5EF6\u540E\u8BA8\u8BBA\u7684\u5B89\u5168\u8FB9\u754C\u3002",
            "target_slots": [
              "Q1-S2",
              "Q1-S3"
            ],
            "priority": "P1",
            "preferred_action": "\u8FB9\u754C\u8FFD\u95EE",
            "forbidden_question": "\u201CA\u65E2\u7136\u5C0A\u91CD\u81EA\u4E3B\uFF0C\u5C31\u4E00\u5B9A\u6700\u597D\u5417\uFF1F\u201D",
            "rationale": "\u907F\u514D\u628A\u5B9E\u8BC1\u9AD8\u5206\u6392\u5217\u7B80\u5355\u7B49\u540C\u4E13\u4E1A\u7406\u7531\u5145\u5206\u3002",
            "calibration_note": ""
          },
          {
            "condition": "D\u5C45\u672B\u4F46A/B/C\u7406\u7531\u51E0\u4E4E\u76F8\u540C",
            "hypothesis": "\u53EF\u80FD\u53EA\u77E5\u9053\u2018\u4E0D\u8981\u76F4\u63A5\u5236\u6B62\u2019\uFF0C\u4F46\u7F3A\u5C11\u5DEE\u5F02\u5316\u5206\u6790\u3002",
            "target_slots": [
              "Q1-S2",
              "Q1-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u5BF9\u6BD4",
            "forbidden_question": "\u201CB\u548CC\u7684\u4E13\u4E1A\u5DEE\u522B\u5728\u54EA\u91CC\uFF1F\u201D",
            "rationale": "\u68C0\u9A8C\u662F\u5426\u771F\u6B63\u638C\u63E1\u4ECB\u5165\u65B9\u5F0F\u5C42\u7EA7\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q1",
        "probes": [
          {
            "slot_id": "Q1-S1",
            "allowed_actions": [
              "\u6F84\u6E05\u3001\u6E38\u620F\u6846\u67B6\u8FFD\u95EE"
            ],
            "preferred_action": "\u6F84\u6E05",
            "typical_question": "\u201C\u60A8\u600E\u4E48\u770B\u5E7C\u513F\u628A\u7BEE\u7403\u67B6\u6162\u6162\u73A9\u6210\u4E00\u4E2A\u2018\u73A9\u6C34\u573A\u5730\u2019\u8FD9\u4EF6\u4E8B\uFF1F\u201D",
            "followup_question": "\u201C\u8FD9\u4E2A\u53D8\u5316\u91CC\uFF0C\u54EA\u4E9B\u662F\u60A8\u89C9\u5F97\u503C\u5F97\u4FDD\u7559\u7684\uFF1F\u201D",
            "forbidden_actions": [
              "\u7ACB\u5373\u8BC4\u4EF7\u89C4\u5219\u5BF9\u9519"
            ],
            "forbidden_question": "\u201C\u7BEE\u7403\u67B6\u4E0D\u662F\u73A9\u6C34\u7684\uFF0C\u6240\u4EE5\u8981\u4E0D\u8981\u9A6C\u4E0A\u53EB\u505C\uFF1F\u201D",
            "non_inducing_boundary": "\u5148\u83B7\u53D6\u6559\u5E08\u5BF9\u81EA\u4E3B\u6E38\u620F\u751F\u6210\u7684\u89E3\u91CA\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q1-S2",
            "allowed_actions": [
              "\u8BC1\u636E\u8FFD\u95EE\u3001\u98CE\u9669\u5206\u5C42"
            ],
            "preferred_action": "\u8BC1\u636E\u8FFD\u95EE",
            "typical_question": "\u201C\u5728\u51B3\u5B9A\u8981\u4E0D\u8981\u9A6C\u4E0A\u4ECB\u5165\u524D\uFF0C\u60A8\u4F1A\u5148\u770B\u54EA\u4E9B\u5177\u4F53\u60C5\u51B5\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u5730\u9762\u5DF2\u7ECF\u5F88\u6ED1\uFF0C\u548C\u53EA\u662F\u5C11\u91CF\u63A5\u6C34\uFF0C\u60A8\u7684\u505A\u6CD5\u4F1A\u4E00\u6837\u5417\uFF1F\u201D",
            "forbidden_actions": [
              "\u6CDB\u5316\u5B89\u5168\u63D0\u793A"
            ],
            "forbidden_question": "\u201C\u662F\u4E0D\u662F\u6709\u6C34\u5C31\u4E0D\u5B89\u5168\uFF1F\u201D",
            "non_inducing_boundary": "\u7528\u5177\u4F53\u98CE\u9669\u6539\u53D8\u60C5\u5883\uFF0C\u907F\u514D\u56FA\u5B9A\u7B54\u6848\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q1-S3",
            "allowed_actions": [
              "\u6761\u4EF6\u8FB9\u754C\u3001\u53CD\u4F8B"
            ],
            "preferred_action": "\u6761\u4EF6\u8FB9\u754C",
            "typical_question": "\u201C\u4EC0\u4E48\u60C5\u51B5\u4E0B\u60A8\u4F1A\u5141\u8BB8\u4ED6\u4EEC\u518D\u73A9\u4E00\u4F1A\u513F\uFF0C\u4EC0\u4E48\u60C5\u51B5\u4E0B\u4F1A\u73B0\u5728\u5C31\u4ECB\u5165\uFF1F\u201D",
            "followup_question": "\u201C\u60A8\u4F1A\u600E\u6837\u5224\u65AD\u5DF2\u7ECF\u5230\u4E86\u8BE5\u8F6C\u573A\u7684\u65F6\u5019\uFF1F\u201D",
            "forbidden_actions": [
              "\u6697\u793AA/C\u56FA\u5B9A\u4F18\u5148"
            ],
            "forbidden_question": "\u201C\u5148\u4E0D\u5E72\u9884\u662F\u4E0D\u662F\u66F4\u5C0A\u91CD\u5E7C\u513F\uFF1F\u201D",
            "non_inducing_boundary": "\u76EE\u6807\u662F\u83B7\u5F97\u4ECB\u5165\u9608\u503C\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q1-S4",
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210\u3001\u89D2\u8272\u8FDB\u5165"
            ],
            "preferred_action": "\u7B56\u7565\u751F\u6210",
            "typical_question": "\u201C\u5982\u679C\u60A8\u65E2\u60F3\u4FDD\u7559\u8FD9\u4E2A\u73A9\u6C34\u6E38\u620F\uFF0C\u53C8\u89C9\u5F97\u7BEE\u7403\u67B6\u65C1\u4E0D\u592A\u5408\u9002\uFF0C\u60A8\u4F1A\u600E\u4E48\u63A5\u8FDB\u53BB\uFF1F\u201D",
            "followup_question": "\u201C\u600E\u6837\u8BF4\u80FD\u8BA9\u6362\u5730\u65B9\u4E0D\u662F\u4E00\u6B21\u4E2D\u65AD\uFF1F\u201D",
            "forbidden_actions": [
              "\u76F4\u63A5\u63D0\u4F9BC\u5F0F\u7B54\u6848"
            ],
            "forbidden_question": "\u201C\u60A8\u4F1A\u4E0D\u4F1A\u626E\u6210\u7C89\u5237\u5DE5\u628A\u4ED6\u4EEC\u5E26\u8D70\uFF1F\u201D",
            "non_inducing_boundary": "\u5148\u8BA9\u6559\u5E08\u81EA\u4E3B\u751F\u6210\u8F6C\u573A\u652F\u67B6\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q1-S5",
            "allowed_actions": [
              "\u4EF7\u503C\u6743\u8861\u3001\u8FC1\u79FB"
            ],
            "preferred_action": "\u6BD4\u8F83\u6743\u8861",
            "typical_question": "\u201C\u8FD9\u91CC\u7684\u89C4\u5219\u60A8\u89C9\u5F97\u8981\u8BA9\u5E7C\u513F\u7406\u89E3\u7684\u7A76\u7ADF\u662F\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u6362\u6210\u4E00\u4E2A\u5B8C\u5168\u4E0D\u5F71\u54CD\u5B89\u5168\u548C\u4ED6\u4EBA\u7684\u65B0\u73A9\u6CD5\uFF0C\u60A8\u8FD8\u4F1A\u8981\u6C42\u56DE\u5230\u539F\u7528\u9014\u5417\uFF1F\u201D",
            "forbidden_actions": [
              "\u6210\u4EBA\u7528\u9014\u7EDD\u5BF9\u5316"
            ],
            "forbidden_question": "\u201C\u5668\u6750\u7528\u9014\u5C31\u662F\u89C4\u5219\uFF0C\u5BF9\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u533A\u5206\u516C\u5171\u8FB9\u754C\u4E0E\u6210\u4EBA\u9884\u8BBE\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q1-S6",
            "allowed_actions": [
              "\u53CD\u601D\uFF0C\u53CD\u9988\u6821\u51C6"
            ],
            "preferred_action": "\u8FC7\u7A0B\u56DE\u987E",
            "typical_question": "\u201C\u6362\u5230\u65B0\u5730\u65B9\u4EE5\u540E\uFF0C\u60A8\u4F1A\u7EE7\u7EED\u89C2\u5BDF\u54EA\u4E9B\u53D8\u5316\uFF0C\u600E\u6837\u51B3\u5B9A\u8981\u4E0D\u8981\u518D\u8C03\u6574\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u6E38\u620F\u4E2D\u65AD\u4E86\uFF0C\u6216\u65B0\u573A\u5730\u4ECD\u6709\u98CE\u9669\uFF0C\u60A8\u5206\u522B\u4F1A\u600E\u4E48\u505A\uFF1F\u201D",
            "forbidden_actions": [
              "\u670D\u4ECE\u68C0\u67E5"
            ],
            "forbidden_question": "\u201C\u5B69\u5B50\u542C\u8BDD\u6362\u5730\u65B9\u4E86\uFF0C\u5C31\u8BF4\u660E\u5904\u7406\u6210\u529F\u4E86\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u8FFD\u95EE\u6E38\u620F\u8FDE\u7EED\u6027\u3001\u7406\u7531\u7406\u89E3\u4E0E\u65B0\u98CE\u9669\uFF0C\u4E0D\u9884\u8BBE\u4ECB\u5165\u5DF2\u7ECF\u6210\u529F\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q1",
        "rules": [
          {
            "scope": "Q1-S1~S2 \u6E38\u620F\u610F\u4E49/\u98CE\u9669",
            "sufficient_condition": "\u80FD\u540C\u65F6\u8BC6\u522B\u81EA\u4E3B\u751F\u6210\u6E38\u620F\u7684\u4EF7\u503C\u4E0E\u5177\u4F53\u573A\u5730\u98CE\u9669\uFF0C\u5E76\u8BF4\u660E\u4E8C\u8005\u90FD\u8981\u770B\u3002",
            "no_gain_threshold": "\u8FDE\u7EED1\u8F6E\u53EA\u8BF4\u2018\u5C0A\u91CD+\u5B89\u5168\u2019\u65E0\u5177\u4F53\u8BC1\u636E\uFF0C\u6362\u53CD\u4F8B1\u6B21\uFF1B\u4ECD\u65E0\u589E\u76CA\u5219\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u51FA\u73B0\u5B8C\u5168\u653E\u4EFB\u6216\u7528\u9014\u63A7\u5236\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ1-S3\u65F6\u673A\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u53EA\u6709\u4EF7\u503C\u53E3\u53F7\u6CA1\u6709\u98CE\u9669\u5224\u65AD\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q1-S3~S4 \u65F6\u673A/\u8F6C\u573A",
            "sufficient_condition": "\u80FD\u7ED9\u51FA\u660E\u786E\u4ECB\u5165\u9608\u503C\uFF0C\u5E76\u751F\u6210\u4FDD\u6301\u6E38\u620F\u8FDE\u7EED\u6027\u7684\u4F4E\u63A7\u5236\u8F6C\u573A\u65B9\u5F0F\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u91CD\u590D\u2018\u770B\u60C5\u51B5/\u6362\u5730\u65B9\u2019\uFF0C\u65E0\u6761\u4EF6\u6216\u7B56\u7565\u7EC6\u8282\u5219\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u98CE\u9669\u60C5\u5883\u4F7F\u539F\u7B56\u7565\u5931\u914D\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ1-S5\u89C4\u5219\u534F\u8C03\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u65F6\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u53EA\u80FD\u2018\u4E0D\u7BA1\u2019\u6216\u2018\u53EB\u505C\u2019\u4E8C\u9009\u4E00\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q1-S5 \u89C4\u5219\u4E0E\u81EA\u4E3B",
            "sufficient_condition": "\u80FD\u89E3\u91CA\u89C4\u5219\u7684\u5B89\u5168/\u5171\u540C\u4F7F\u7528\u7406\u7531\uFF0C\u5E76\u4FDD\u7559\u5E7C\u513F\u53C2\u4E0E\u548C\u81EA\u4E3B\u751F\u6210\u7A7A\u95F4\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u5373\u53EF\u526A\u679D\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u53C8\u4EE5\u5668\u6750\u539F\u7528\u9014\u4F5C\u4E3A\u552F\u4E00\u7406\u7531\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ1-S6\uFF08\u6709\u4ECB\u5165/\u8F6C\u573A\u89E6\u53D1\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u4E0E\u6838\u5FC3Slot\u5171\u540C\u6EE1\u8DB3\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u628A\u5C0A\u91CD\u81EA\u4E3B\u7B49\u540C\u5B8C\u5168\u653E\u4EFB\u65F6\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q1-S6 \u89C2\u5BDF/\u518D\u8C03\u6574",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u4ECB\u5165\u6216\u8F6C\u573A\u540E\u7EE7\u7EED\u89C2\u5BDF\u6E38\u620F\u8FDE\u7EED\u6027\u3001\u7406\u7531\u7406\u89E3\u4E0E\u65B0\u98CE\u9669\uFF0C\u5E76\u6839\u636E\u53CD\u9988\u518D\u8C03\u6574\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u662F\u5426\u670D\u4ECE\u3001\u65E0\u65B0\u589E\u8BC1\u636E\u5219\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u672C\u8F6E\u65E0\u4ECB\u5165/\u8F6C\u573A\u4E14\u8BE5\u5206\u652F\u4E0D\u9002\u7528\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u51FA\u73B0\u6E38\u620F\u4E2D\u65AD\u3001\u65B0\u98CE\u9669\u6216\u5E7C\u513F\u4E0D\u7406\u89E3\u7406\u7531\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u4E0D\u5F97\u628A\u2018\u670D\u4ECE/\u6362\u573A\u5B8C\u6210\u2019\u5F53\u4F5C\u56DE\u5E94\u95ED\u73AF\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q1-S1~S5\u81F3\u5C114\u4E2A\u8FBE\u52302\u7EA7\uFF0C\u4E14\u80FD\u5F62\u6210\u2018\u7406\u89E3\u6E38\u620F\u2014\u8BC4\u4F30\u98CE\u9669\u2014\u9009\u62E9\u65F6\u673A\u2014\u4F4E\u63A7\u5236\u56DE\u5E94\u2014\u89C2\u5BDF\u53CD\u9988\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u8BC1\u636E\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u5168\u90E8\u526A\u679D\u3002",
            "reopen_condition": "\u51FA\u73B0\u65B0\u7684\u6838\u5FC3\u51B2\u7A81\u8BC1\u636E\u624D\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6761\u4EF6\u6216\u65F6\u95F4\u4E0A\u9650\u4E14\u8FB9\u9645\u589E\u76CA\u4F4E\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u65E0\u6CD5\u89E3\u91CAA/C\u4E3A\u4F55\u53EF\u56E0\u98CE\u9669\u6761\u4EF6\u4E92\u6362\u65F6\u4E0D\u5B9C\u8FC7\u65E9\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q1",
        "title": "\u7BEE\u7403\u67B6\u73A9\u6C34",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3\uFF5C\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u5728\u5E7C\u513F\u81EA\u4E3B\u751F\u6210\u7684\u73A9\u6C34\u6E38\u620F\u4E0E\u89C4\u5219\u3001\u5B89\u5168\u3001\u573A\u5730\u9002\u5B9C\u6027\u4E4B\u95F4\u4F5C\u51FA\u4E13\u4E1A\u5224\u65AD\uFF1A\u65E2\u4E0D\u7B80\u5355\u7981\u6B62\uFF0C\u4E5F\u4E0D\u653E\u4EFB\u98CE\u9669\uFF0C\u800C\u662F\u987A\u5E94\u6E38\u620F\u5174\u8DA3\u5E76\u4EE5\u9002\u5B9C\u65B9\u5F0F\u56DE\u5E94\u3002",
        "empirical": {
          "0": [
            "BDCA",
            "DACB",
            "DBAC",
            "DBCA",
            "DCAB",
            "DCBA"
          ],
          "1": [
            "ADBC",
            "ADCB",
            "BADC",
            "BCDA",
            "BDAC",
            "CBDA",
            "CDBA",
            "DABC"
          ],
          "2": [
            "ACDB",
            "BACD",
            "CADB",
            "CDAB"
          ],
          "3": [
            "ABDC",
            "BCAD",
            "CBAD"
          ],
          "4": [
            "ABCD",
            "ACBD",
            "CABD"
          ]
        },
        "scoring_note": "4\u5206\u7EC4\u5408\u96C6\u4E2D\u8868\u73B0\u4E3AA/C\u5C45\u524D\u3001D\u5C45\u672B\uFF1B3\u5206\u4E5F\u591A\u7531A/B/C\u5C45\u524D\u30020\u5206\u7EC4\u5408\u5927\u591A\u628AD\u653E\u5728\u524D\u90E8\u3002\u5B9E\u8BC1\u4E0A\u6700\u6E05\u695A\u7684\u533A\u5206\u4E0D\u662FA/B/C\u7684\u552F\u4E00\u5148\u540E\uFF0C\u800C\u662F\u80FD\u5426\u907F\u514D\u7528\u2018\u8F6C\u79FB\u56DE\u7BEE\u7403\u2019\u76F4\u63A5\u8986\u76D6\u5E7C\u513F\u81EA\u4E3B\u751F\u6210\u7684\u73A9\u6C34\u6E38\u620F\uFF0C\u5E76\u5728\u5B89\u5168/\u573A\u5730\u9002\u5B9C\u6027\u4E0E\u6E38\u620F\u8FDE\u7EED\u6027\u4E4B\u95F4\u4F5C\u5224\u65AD\u3002",
        "review_note": "\u5B9E\u8BC1\u8D4B\u5206\u5BF9A\u5C45\u9996\u7684\u5BB9\u5FCD\u5EA6\u5F88\u9AD8\u3002\u82E5\u7BEE\u7403\u67B6\u3001\u5730\u9762\u73A9\u6C34\u5728\u771F\u5B9E\u6D4B\u9A8C\u8BBE\u5B9A\u4E2D\u88AB\u8BA4\u4E3A\u5177\u6709\u660E\u786E\u5B89\u5168/\u8BBE\u5907\u98CE\u9669\uFF0CA\u7684\u9AD8\u5206\u53EF\u80FD\u4E0E\u4E00\u822C\u5B89\u5168\u5224\u65AD\u5B58\u5728\u5F20\u529B\uFF0C\u5EFA\u8BAE\u4E13\u5BB6\u91CD\u70B9\u590D\u6838\u672C\u9898\u5BF9\u2018\u98CE\u9669\u53EF\u63A7\u2019\u7684\u9690\u542B\u524D\u63D0\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q2": {
      "item_id": "Q2",
      "title": "\u9891\u7E41\u6C42\u52A9",
      "ontology": {
        "item_id": "Q2",
        "title": "\u9891\u7E41\u6C42\u52A9",
        "stem": "\u4E2D\u73ED\u533A\u57DF\u6D3B\u52A8\u65F6\uFF0C\u5C0F\u660E\u9009\u62E9\u4E86\u5EFA\u6784\u533A\u3002\u73A9\u4E86\u4E00\u4F1A\u513F\uFF0C\u4ED6\u8DD1\u5230\u8001\u5E08\u9762\u524D\u8BF4\u201C\u8001\u5E08\uFF0C\u6211\u4E0D\u4F1A\u642D\u2026\u2026\u5E2E\u5E2E\u6211\u5427\u201D\uFF0C\u6559\u5E08\u95EE\u4ED6\u9700\u8981\u4EC0\u4E48\u5E2E\u52A9\u65F6\uFF0C\u4ED6\u4E00\u8FB9\u8BF4\u6211\u4E0D\u4F1A\u642D\uFF0C\u4E00\u8FB9\u5374\u5F88\u5FEB\u5730\u5C06\u623F\u5B50\u4ECE\u4E00\u5C42\u79EF\u6728\u52A0\u9AD8\u5230\u4E86\u4E24\u5C42\u3002\u770B\u5C0F\u660E\u4E13\u6CE8\u642D\u5EFA\u540E\uFF0C\u8001\u5E08\u5C31\u79BB\u5F00\u5EFA\u6784\u533A\u4E86\u3002\u53EF\u662F\u6CA1\u4E00\u4F1A\uFF0C\u5C0F\u660E\u53C8\u627E\u4E86\u8001\u5E08\u597D\u51E0\u6B21\uFF0C\u8BF4\u201C\u8001\u5E08\uFF0C\u5E2E\u5E2E\u6211\u5427\uFF0C\u6211\u4E0D\u4F1A\u642D\u201D\u3002",
        "options": {
          "A": "\u9F13\u52B1\u5C0F\u660E\u72EC\u7ACB\u642D\u5EFA\uFF0C\u5F15\u5BFC\u4ED6\u601D\u8003\u63A5\u4E0B\u6765\u5982\u4F55\u642D\u5EFA\uFF0C\u53CA\u65F6\u8868\u626C\u4ED6\u7684\u52AA\u529B\u3002",
          "B": "\u5148\u793A\u8303\u642D\u5EFA\u5173\u952E\u90E8\u5206\uFF0C\u8BF7\u5C0F\u660E\u89C2\u5BDF\u65B9\u6CD5\uFF0C\u518D\u9F13\u52B1\u4ED6\u7167\u7740\u7EE7\u7EED\u642D\u5EFA\u3002",
          "C": "\u5728\u65C1\u89C2\u5BDF\u5C0F\u660E\u7684\u642D\u5EFA\u8FC7\u7A0B\uFF0C\u5E76\u9002\u65F6\u53CD\u9988\uFF0C\u5E2E\u52A9\u4ED6\u7406\u6E05\u642D\u5EFA\u6B65\u9AA4\u3002",
          "D": "\u5E2E\u5C0F\u660E\u56DE\u987E\u5DF2\u642D\u5EFA\u5B8C\u6210\u7684\u90E8\u5206\uFF0C\u6307\u5BFC\u4ED6\u8BBE\u5B9A\u5C0F\u76EE\u6807\uFF0C\u5C1D\u8BD5\u81EA\u5DF1\u5B9E\u73B0\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u900F\u8FC7\u201C\u6211\u4E0D\u4F1A\u3001\u5E2E\u5E2E\u6211\u201D\u7684\u8868\u9762\u6C42\u52A9\uFF0C\u5224\u65AD\u5E7C\u513F\u771F\u5B9E\u9700\u8981\uFF0C\u5E76\u4EE5\u5C0F\u76EE\u6807\u3001\u63D0\u95EE\u6216\u6750\u6599\u652F\u67B6\u652F\u6301\u5176\u81EA\u4E3B\u5C1D\u8BD5\uFF0C\u800C\u4E0D\u662F\u76F4\u63A5\u4EE3\u505A\u6216\u8FC7\u5EA6\u793A\u8303\u3002",
        "slots": [
          {
            "slot_id": "Q2-S1",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u8868\u9762\u6C42\u52A9\u4E0E\u771F\u5B9E\u80FD\u529B\u533A\u5206",
            "definition": "\u4ECE\u2018\u6211\u4E0D\u4F1A\u3001\u5E2E\u5E2E\u6211\u2019\u4E0E\u5E7C\u513F\u5B9E\u9645\u80FD\u8FC5\u901F\u52A0\u9AD8\u623F\u5B50\u7684\u77DB\u76FE\u4E2D\uFF0C\u5224\u65AD\u6C42\u52A9\u4E0D\u5FC5\u7136\u7B49\u4E8E\u6280\u80FD\u4E0D\u4F1A\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u6559\u5E08\u662F\u5426\u80FD\u900F\u8FC7\u8BED\u8A00\u8868\u9762\u8BC6\u522B\u771F\u5B9E\u9700\u8981\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u8BC1\u636E\u8FFD\u95EE/\u5BF9\u6BD4"
            ],
            "forbidden_actions": [
              "\u76F4\u63A5\u793A\u8303"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u9AD8\u5206\u7EC4\u5408\u628AB\u7A33\u5B9A\u653E\u540E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q2-S2",
            "dimension": "C1 \u89C2\u5BDF",
            "name": "\u6301\u7EED\u89C2\u5BDF\u6C42\u52A9\u6A21\u5F0F",
            "definition": "\u89C2\u5BDF\u5E7C\u513F\u4F55\u65F6\u6C42\u52A9\u3001\u6C42\u52A9\u540E\u80FD\u5426\u72EC\u7ACB\u7EE7\u7EED\u3001\u9047\u5230\u4EC0\u4E48\u8282\u70B9\u518D\u6B21\u6C42\u52A9\u3001\u662F\u5426\u5BFB\u6C42\u786E\u8BA4/\u966A\u4F34/\u8BA1\u5212\u652F\u6301\u3002",
            "diagnostic_meaning": "\u5EFA\u7ACB\u5173\u4E8E\u6C42\u52A9\u529F\u80FD\u7684\u8BC1\u636E\uFF0C\u800C\u975E\u4E00\u6B21\u5224\u65AD\u3002",
            "core": true,
            "prerequisites": [
              "Q2-S1"
            ],
            "allowed_actions": [
              "\u8FC7\u7A0B\u8FFD\u95EE/\u5177\u4F53\u5316"
            ],
            "forbidden_actions": [
              "\u53EA\u770B\u4F5C\u54C1\u5B8C\u6210\u7ED3\u679C"
            ],
            "default_priority": "P1",
            "empirical_relation": "C\u4F53\u73B0\u8FC7\u7A0B\u89C2\u5BDF\u548C\u9002\u65F6\u53CD\u9988\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q2-S3",
            "dimension": "C2 \u5206\u6790\u56DE\u5E94",
            "name": "\u6C42\u52A9\u529F\u80FD\u4E0E\u5B66\u4E60\u9700\u8981\u5224\u65AD",
            "definition": "\u533A\u5206\u6280\u80FD\u7F3A\u5931\u3001\u4EFB\u52A1\u89C4\u5212\u56F0\u96BE\u3001\u4FE1\u5FC3\u4E0D\u8DB3\u3001\u4F9D\u8D56\u6210\u4EBA\u786E\u8BA4\u3001\u9700\u8981\u5171\u540C\u5173\u6CE8\u7B49\u53EF\u80FD\u529F\u80FD\u3002",
            "diagnostic_meaning": "\u51B3\u5B9A\u652F\u67B6\u7C7B\u578B\u548C\u5F3A\u5EA6\u3002",
            "core": true,
            "prerequisites": [
              "Q2-S1",
              "Q2-S2"
            ],
            "allowed_actions": [
              "\u5047\u8BBE\u6BD4\u8F83/\u7406\u7531\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u7ED9\u5FC3\u7406\u6807\u7B7E"
            ],
            "default_priority": "P1",
            "empirical_relation": "A/D\u9AD8\u5206\u6F5C\u529B\u6765\u81EA\u5BF9\u81EA\u4E3B\u5C1D\u8BD5\u548C\u76EE\u6807\u5206\u89E3\u7684\u652F\u6301\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q2-S4",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u5C0F\u76EE\u6807\u4E0E\u81EA\u6211\u8C03\u8282\u652F\u67B6",
            "definition": "\u901A\u8FC7\u56DE\u987E\u5DF2\u6709\u6210\u679C\u3001\u8BBE\u5B9A\u4E0B\u4E00\u5C0F\u76EE\u6807\u3001\u81EA\u6211\u63D0\u95EE\u3001\u6B65\u9AA4\u6574\u7406\u7B49\uFF0C\u628A\u89E3\u51B3\u6743\u8FD8\u7ED9\u5E7C\u513F\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u662F\u5426\u4FC3\u8FDB\u81EA\u4E3B\u95EE\u9898\u89E3\u51B3\u800C\u975E\u4EE3\u66FF\u5B8C\u6210\u3002",
            "core": true,
            "prerequisites": [
              "Q2-S3"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u76F4\u63A5\u5B8C\u6210\u5173\u952E\u90E8\u5206"
            ],
            "default_priority": "P1",
            "empirical_relation": "D\u57284\u5206\u7EC4\u5408\u4E2D\u53EF\u5C45\u9996\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q2-S5",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u53CD\u9988\u4E0E\u6E10\u9000",
            "definition": "\u63D0\u4F9B\u8FC7\u7A0B\u6027\u53CD\u9988\u3001\u786E\u8BA4\u52AA\u529B\u548C\u7B56\u7565\uFF0C\u5728\u5E7C\u513F\u91CD\u65B0\u8FDB\u5165\u81EA\u4E3B\u642D\u5EFA\u540E\u9010\u6B65\u9000\u51FA\uFF0C\u907F\u514D\u5F62\u6210\u53CD\u590D\u6C42\u52A9\u2014\u6210\u4EBA\u56DE\u5E94\u5FAA\u73AF\u3002",
            "diagnostic_meaning": "\u5224\u65AD\u652F\u67B6\u662F\u5426\u771F\u6B63\u51CF\u5C11\u4F9D\u8D56\u3001\u589E\u5F3A\u6548\u80FD\u611F\u3002",
            "core": true,
            "prerequisites": [
              "Q2-S4"
            ],
            "allowed_actions": [
              "\u8FC7\u7A0B\u8FFD\u95EE/\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u6CDB\u5316\u8868\u626C\u6216\u6301\u7EED\u966A\u540C"
            ],
            "default_priority": "P2",
            "empirical_relation": "A/C\u7684\u4EF7\u503C\u9700\u843D\u5230\u53CD\u9988\u8D28\u91CF\u548C\u9000\u51FA\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q2-S6",
            "dimension": "C2 \u8FB9\u754C",
            "name": "\u793A\u8303\u7684\u6700\u5C0F\u5FC5\u8981\u8FB9\u754C",
            "definition": "\u53EA\u6709\u5728\u786E\u8BA4\u5177\u4F53\u6280\u80FD\u7F3A\u53E3\u4E14\u66F4\u4F4E\u5F3A\u5EA6\u652F\u67B6\u65E0\u6548\u65F6\uFF0C\u624D\u8003\u8651\u5C40\u90E8\u793A\u8303\uFF1B\u793A\u8303\u540E\u4ECD\u8BA9\u5E7C\u513F\u81EA\u5DF1\u64CD\u4F5C\u3002",
            "diagnostic_meaning": "\u907F\u514D\u628A\u6C42\u52A9\u81EA\u52A8\u8F6C\u6210\u6559\u5E08\u793A\u8303\u3002",
            "core": false,
            "prerequisites": [
              "Q2-S3"
            ],
            "allowed_actions": [
              "\u53CD\u4F8B/\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u628AB\u7EDD\u5BF9\u5224\u9519"
            ],
            "default_priority": "P2",
            "empirical_relation": "\u5B9E\u8BC1B\u57284\u5206\u7EC4\u5408\u5747\u5C45\u672B\uFF0C\u63D0\u793A\u793A\u8303\u4E0D\u5B9C\u4F5C\u4E3A\u9996\u9009\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q2",
        "anchors": [
          {
            "slot_id": "Q2-S1",
            "level_0": "\u542C\u5230\u2018\u4E0D\u4F1A\u2019\u5C31\u8BA4\u5B9A\u4E0D\u4F1A\uFF0C\u9700\u8981\u6559\u5E08\u6559\u3002",
            "level_1": "\u6CE8\u610F\u5230\u5E7C\u513F\u5176\u5B9E\u80FD\u642D\uFF0C\u4F46\u6CA1\u6709\u8FDB\u4E00\u6B65\u89E3\u91CA\u77DB\u76FE\u3002",
            "level_2": "\u660E\u786E\u6307\u51FA\u6C42\u52A9\u8BED\u8A00\u4E0E\u5B9E\u9645\u80FD\u529B\u4E0D\u4E00\u81F4\uFF0C\u9700\u8981\u7EE7\u7EED\u5224\u65AD\u4ED6\u771F\u6B63\u9700\u8981\u4EC0\u4E48\u3002",
            "level_3": "\u80FD\u628A\u8BED\u8A00\u3001\u884C\u4E3A\u3001\u6C42\u52A9\u9891\u7387\u548C\u72EC\u7ACB\u5B8C\u6210\u7247\u6BB5\u6574\u5408\uFF0C\u5F62\u6210\u53EF\u9A8C\u8BC1\u5047\u8BBE\u800C\u975E\u7B80\u5355\u5F52\u56E0\u3002",
            "false_evidence": "\u8BF4\u2018\u4ED6\u5176\u5B9E\u4F1A\u2019\u5C31\u7ED3\u675F\u3002",
            "conflict_evidence": "\u77E5\u9053\u4ED6\u4F1A\u4ECD\u7ACB\u5373\u793A\u8303\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q2-S2",
            "level_0": "\u4E0D\u89C2\u5BDF\uFF0C\u76F4\u63A5\u56DE\u5E94\u6BCF\u6B21\u6C42\u52A9\u3002",
            "level_1": "\u4F1A\u5728\u65C1\u770B\uFF0C\u4F46\u53EA\u5173\u6CE8\u4F5C\u54C1\u662F\u5426\u642D\u5BF9\u3002",
            "level_2": "\u80FD\u89C2\u5BDF\u6C42\u52A9\u53D1\u751F\u70B9\u3001\u72EC\u7ACB\u6301\u7EED\u65F6\u95F4\u3001\u9047\u5230\u7684\u5177\u4F53\u96BE\u70B9\u548C\u6210\u4EBA\u53CD\u9988\u540E\u7684\u53D8\u5316\u3002",
            "level_3": "\u80FD\u8DE8\u591A\u6B21\u6C42\u52A9\u6BD4\u8F83\u6A21\u5F0F\uFF0C\u5E76\u636E\u65B0\u8BC1\u636E\u4FEE\u6B63\u5BF9\u6C42\u52A9\u529F\u80FD\u7684\u5224\u65AD\u3002",
            "false_evidence": "\u2018\u6211\u4F1A\u89C2\u5BDF\u2019\u65E0\u89C2\u5BDF\u7EF4\u5EA6\u3002",
            "conflict_evidence": "\u89C2\u5BDF\u540E\u4E0D\u6539\u53D8\u652F\u67B6\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q2-S3",
            "level_0": "\u5355\u4E00\u89E3\u91CA\u4E3A\u4E0D\u4F1A\u6216\u4F9D\u8D56\u3002",
            "level_1": "\u80FD\u63D0\u51FA\u4E00\u4E2A\u53EF\u80FD\uFF0C\u5982\u7F3A\u4FE1\u5FC3\uFF0C\u4F46\u65E0\u8BC1\u636E\u3002",
            "level_2": "\u80FD\u63D0\u51FA\u81F3\u5C112\u20143\u79CD\u529F\u80FD\u5047\u8BBE\uFF0C\u5E76\u8BF4\u660E\u5982\u4F55\u533A\u5206\u3002",
            "level_3": "\u80FD\u628A\u4E0D\u540C\u529F\u80FD\u4E0E\u4E0D\u540C\u652F\u67B6\u76F8\u8FDE\uFF0C\u5982\u6280\u80FD\u7F3A\u53E3\u2192\u5C40\u90E8\u793A\u8303\uFF0C\u8BA1\u5212\u56F0\u96BE\u2192\u5C0F\u76EE\u6807\uFF0C\u786E\u8BA4\u9700\u6C42\u2192\u8FC7\u7A0B\u53CD\u9988\u3002",
            "false_evidence": "\u7ED9\u5E7C\u513F\u8D34\u4F9D\u8D56\u578B\u6807\u7B7E\u3002",
            "conflict_evidence": "\u6240\u6709\u5047\u8BBE\u6700\u540E\u90FD\u7528\u540C\u4E00\u7B56\u7565\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q2-S4",
            "level_0": "\u6210\u4EBA\u544A\u8BC9\u63A5\u4E0B\u6765\u600E\u4E48\u642D\u6216\u4EE3\u505A\u3002",
            "level_1": "\u4F1A\u9F13\u52B1\u81EA\u5DF1\u60F3\uFF0C\u4F46\u652F\u67B6\u8F83\u6CDB\u3002",
            "level_2": "\u80FD\u56DE\u987E\u5DF2\u5B8C\u6210\u90E8\u5206\uFF0C\u5E2E\u52A9\u8BBE\u4E00\u4E2A\u53EF\u8FBE\u6210\u7684\u4E0B\u4E00\u6B65\uFF0C\u8BA9\u5E7C\u513F\u81EA\u5DF1\u5C1D\u8BD5\u5E76\u68C0\u67E5\u3002",
            "level_3": "\u80FD\u9010\u6E10\u628A\u76EE\u6807\u8BBE\u5B9A\u3001\u6B65\u9AA4\u68C0\u67E5\u8F6C\u6210\u5E7C\u513F\u81EA\u5DF1\u7684\u81EA\u6211\u63D0\u95EE\u548C\u8BA1\u5212\u4E60\u60EF\u3002",
            "false_evidence": "\u76EE\u6807\u7531\u6559\u5E08\u5B8C\u5168\u89C4\u5B9A\u3002",
            "conflict_evidence": "\u5E7C\u513F\u6CA1\u6709\u9009\u62E9\u548C\u53CD\u601D\u673A\u4F1A\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q2-S5",
            "level_0": "\u6301\u7EED\u966A\u4F34\u6216\u53CD\u590D\u8868\u626C\u2018\u771F\u68D2\u2019\u3002",
            "level_1": "\u4F1A\u8868\u626C\u52AA\u529B\uFF0C\u4F46\u53CD\u9988\u4E0E\u7B56\u7565\u5173\u7CFB\u5F31\u3002",
            "level_2": "\u53CD\u9988\u805A\u7126\u5177\u4F53\u7B56\u7565/\u8FDB\u6B65\uFF0C\u5E76\u5728\u5E7C\u513F\u91CD\u65B0\u6295\u5165\u540E\u51CF\u5C11\u5E2E\u52A9\u3002",
            "level_3": "\u80FD\u89C2\u5BDF\u6C42\u52A9\u9891\u7387\u662F\u5426\u4E0B\u964D\u3001\u5E7C\u513F\u662F\u5426\u4E3B\u52A8\u89C4\u5212\uFF0C\u5E76\u636E\u6B64\u8FDB\u4E00\u6B65\u6E10\u9000\u6216\u8C03\u6574\u652F\u67B6\u3002",
            "false_evidence": "\u9891\u7E41\u8868\u626C\u88AB\u5F53\u4F5C\u72EC\u7ACB\u6027\u652F\u6301\u3002",
            "conflict_evidence": "\u6210\u4EBA\u53CD\u9988\u8D8A\u591A\u6C42\u52A9\u8D8A\u9891\u7E41\u4ECD\u4E0D\u8C03\u6574\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q2-S6",
            "level_0": "\u53EA\u8981\u5E7C\u513F\u6C42\u52A9\u5C31\u7ACB\u5373\u5B8C\u6574\u793A\u8303\uFF0C\u6216\u575A\u6301\u4EFB\u4F55\u60C5\u51B5\u4E0B\u90FD\u4E0D\u80FD\u793A\u8303\u3002",
            "level_1": "\u77E5\u9053\u793A\u8303\u5E94\u5C11\uFF0C\u4F46\u8BF4\u4E0D\u6E05\u4F55\u65F6\u9700\u8981\u3001\u793A\u8303\u4EC0\u4E48\u6216\u600E\u6837\u9000\u51FA\u3002",
            "level_2": "\u4EC5\u5728\u786E\u8BA4\u5177\u4F53\u6280\u80FD\u7F3A\u53E3\u4E14\u4F4E\u5F3A\u5EA6\u652F\u67B6\u65E0\u6548\u65F6\u8FDB\u884C\u5C40\u90E8\u793A\u8303\uFF0C\u5E76\u628A\u64CD\u4F5C\u6743\u4EA4\u8FD8\u5E7C\u513F\u3002",
            "level_3": "\u80FD\u4F9D\u636E\u89C2\u5BDF\u786E\u5B9A\u6700\u5C0F\u5FC5\u8981\u5185\u5BB9\u3001\u65F6\u957F\u4E0E\u9000\u51FA\u4FE1\u53F7\uFF0C\u793A\u8303\u540E\u68C0\u9A8C\u8FC1\u79FB\u5E76\u8FDB\u4E00\u6B65\u6E10\u9000\u3002",
            "false_evidence": "\u628A\u2018\u793A\u8303\u4E00\u904D\u2019\u79F0\u4E3A\u6700\u5C0F\u652F\u67B6\u3002",
            "conflict_evidence": "\u672A\u8BCA\u65AD\u6280\u80FD\u7F3A\u53E3\u5373\u793A\u8303\uFF0C\u6216\u793A\u8303\u540E\u53EA\u8BA9\u5E7C\u513F\u7167\u6284\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q2",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1AACDB/DACB",
            "hypothesis": "A\u6216D\u5C45\u9996\u3001B\u5C45\u672B\uFF1B\u603B\u4F53\u5DF2\u504F\u5411\u81EA\u4E3B\u652F\u6301\u548C\u76EE\u6807\u5206\u89E3\u3002",
            "target_slots": [
              "Q2-S1",
              "Q2-S3",
              "Q2-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB/\u53CD\u4F8B",
            "forbidden_question": "\u201C4\u5206\u8BF4\u660E\u5B8C\u5168\u4E0D\u9700\u8981\u518D\u95EE\u3002\u201D",
            "rationale": "\u9A8C\u8BC1A/D\u6392\u5E8F\u662F\u5426\u57FA\u4E8E\u771F\u5B9E\u6C42\u52A9\u529F\u80FD\uFF0C\u800C\u975E\u56FA\u5B9A\u504F\u597D\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206",
            "hypothesis": "\u591A\u6570\u628AB\u653E\u540E\uFF0C\u4F46A/C/D\u7684\u5148\u540E\u4E0D\u7A33\u5B9A\u3002",
            "target_slots": [
              "Q2-S2",
              "Q2-S4",
              "Q2-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC7\u7A0B\u6BD4\u8F83",
            "forbidden_question": "\u201C\u53EA\u8981\u4E0D\u793A\u8303\u5C31\u7B97\u9AD8\u6C34\u5E73\u3002\u201D",
            "rationale": "\u67E5\u89C2\u5BDF\u3001\u53CD\u9988\u3001\u5C0F\u76EE\u6807\u4E09\u8005\u7684\u5173\u7CFB\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u5177\u5907\u90E8\u5206\u81EA\u4E3B\u652F\u6301\u610F\u8BC6\uFF0C\u4F46\u5BF9\u6C42\u52A9\u529F\u80FD\u3001\u53CD\u9988\u6216\u9000\u51FA\u65F6\u673A\u53EF\u80FD\u4E0D\u6E05\u695A\u3002",
            "target_slots": [
              "Q2-S1",
              "Q2-S3",
              "Q2-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u8BC1\u636E\u8FFD\u95EE",
            "forbidden_question": "\u201C\u4ED6\u660E\u660E\u4F1A\uFF0C\u4E3A\u4EC0\u4E48\u8FD8\u6C42\u52A9\uFF1F\u201D",
            "rationale": "\u907F\u514D\u76F4\u63A5\u7ED9\u2018\u4F9D\u8D56\u2019\u7ED3\u8BBA\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216B\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u6C42\u52A9\u81EA\u52A8\u7B49\u540C\u6280\u80FD\u7F3A\u5931\uFF0C\u504F\u5411\u793A\u8303\u3002",
            "target_slots": [
              "Q2-S1",
              "Q2-S3",
              "Q2-S6"
            ],
            "priority": "P1",
            "preferred_action": "\u53CD\u4F8B\uFF0B\u8FB9\u754C",
            "forbidden_question": "\u201C\u5B69\u5B50\u6C42\u52A9\u65F6\u5148\u793A\u8303\u4E0D\u662F\u6700\u6709\u6548\u5417\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u67E5\u6700\u5C0F\u5FC5\u8981\u652F\u67B6\u3002",
            "calibration_note": ""
          },
          {
            "condition": "D\u5C45\u9996\u4F46\u8FC7\u7A0B\u6570\u636E\u72B9\u8C6B\u5927",
            "hypothesis": "\u53EF\u80FD\u77E5\u9053\u5C0F\u76EE\u6807\u6CD5\u662F\u7406\u60F3\u8868\u8FF0\uFF0C\u4F46\u4E0D\u6E05\u695A\u5982\u4F55\u4ECE\u89C2\u5BDF\u8BC1\u636E\u51B3\u5B9A\u5C0F\u76EE\u6807\u3002",
            "target_slots": [
              "Q2-S2",
              "Q2-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u5177\u4F53\u5316",
            "forbidden_question": "\u201C\u8BBE\u5C0F\u76EE\u6807\u4E00\u5B9A\u9002\u5408\u6240\u6709\u6C42\u52A9\u5417\uFF1F\u201D",
            "rationale": "\u9A8C\u8BC1\u7B56\u7565\u4E0D\u662F\u8BB0\u5FC6\u7B54\u6848\u3002",
            "calibration_note": ""
          },
          {
            "condition": "A\u5C45\u9996\u4E14\u6559\u5E08\u53EA\u8C08\u2018\u72EC\u7ACB\u6027\u2019",
            "hypothesis": "\u53EF\u80FD\u8FC7\u5EA6\u5F3A\u8C03\u72EC\u7ACB\uFF0C\u5FFD\u7565\u5E7C\u513F\u5BF9\u966A\u4F34/\u5171\u540C\u5173\u6CE8\u7684\u771F\u5B9E\u9700\u8981\u3002",
            "target_slots": [
              "Q2-S3",
              "Q2-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u53CD\u4F8B",
            "forbidden_question": "\u201C\u5982\u679C\u4ED6\u771F\u6B63\u9700\u8981\u7684\u662F\u786E\u8BA4\u548C\u966A\u4F34\uFF0C\u4ECD\u53EA\u9F13\u52B1\u72EC\u7ACB\u5417\uFF1F\u201D",
            "rationale": "\u9632\u6B62\u628A\u9AD8\u5206\u7B56\u7565\u50F5\u5316\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q2",
        "probes": [
          {
            "slot_id": "Q2-S1",
            "allowed_actions": [
              "\u77DB\u76FE\u8BC1\u636E\u6F84\u6E05"
            ],
            "preferred_action": "\u5BF9\u6BD4",
            "typical_question": "\u201C\u4ED6\u8BF4\u81EA\u5DF1\u4E0D\u4F1A\uFF0C\u4F46\u53C8\u5F88\u5FEB\u628A\u623F\u5B50\u52A0\u9AD8\u4E86\uFF0C\u60A8\u4F1A\u600E\u4E48\u7406\u89E3\u8FD9\u4E2A\u53CD\u5DEE\uFF1F\u201D",
            "followup_question": "\u201C\u8FD9\u4F1A\u4E0D\u4F1A\u6539\u53D8\u60A8\u5BF9\u2018\u5E2E\u5E2E\u6211\u2019\u8FD9\u53E5\u8BDD\u7684\u7406\u89E3\uFF1F\u201D",
            "forbidden_actions": [
              "\u76F4\u63A5\u8BF4\u2018\u4ED6\u5176\u5B9E\u4F1A\u2019"
            ],
            "forbidden_question": "\u201C\u4ED6\u660E\u663E\u53EA\u662F\u4F9D\u8D56\u8001\u5E08\uFF0C\u5BF9\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u8BA9\u6559\u5E08\u81EA\u5DF1\u89E3\u91CA\u884C\u4E3A\u2014\u8BED\u8A00\u77DB\u76FE\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q2-S2",
            "allowed_actions": [
              "\u8FC7\u7A0B\u8FFD\u95EE"
            ],
            "preferred_action": "\u5177\u4F53\u5316",
            "typical_question": "\u201C\u5982\u679C\u60A8\u5728\u65C1\u8FB9\u89C2\u5BDF\u4E00\u4F1A\u513F\uFF0C\u60A8\u6700\u60F3\u770B\u4ED6\u5728\u4EC0\u4E48\u65F6\u523B\u53C8\u6765\u6C42\u52A9\uFF1F\u201D",
            "followup_question": "\u201C\u6210\u4EBA\u56DE\u5E94\u4EE5\u540E\uFF0C\u4ED6\u80FD\u81EA\u5DF1\u6301\u7EED\u591A\u4E45\uFF1F\u201D",
            "forbidden_actions": [
              "\u53EA\u95EE\u4F5C\u54C1\u7ED3\u679C"
            ],
            "forbidden_question": "\u201C\u6700\u540E\u642D\u6210\u529F\u4E86\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u5173\u6CE8\u6C42\u52A9\u6A21\u5F0F\u800C\u975E\u4F5C\u54C1\u5BF9\u9519\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q2-S3",
            "allowed_actions": [
              "\u5047\u8BBE\u6BD4\u8F83"
            ],
            "preferred_action": "\u529F\u80FD\u8FA8\u522B",
            "typical_question": "\u201C\u8FD9\u79CD\u53CD\u590D\u6C42\u52A9\u53EF\u80FD\u5206\u522B\u610F\u5473\u7740\u4EC0\u4E48\uFF1F\u60A8\u4F1A\u600E\u4E48\u533A\u5206\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u662F\u4E0D\u4F1A\u505A\u548C\u53EA\u662F\u6CA1\u628A\u63E1\uFF0C\u60A8\u7684\u5E2E\u52A9\u4F1A\u4E00\u6837\u5417\uFF1F\u201D",
            "forbidden_actions": [
              "\u5FC3\u7406\u6807\u7B7E"
            ],
            "forbidden_question": "\u201C\u4ED6\u662F\u4E0D\u662F\u4F9D\u8D56\u6027\u5F3A\uFF1F\u201D",
            "non_inducing_boundary": "\u7528\u53EF\u89C2\u5BDF\u8BC1\u636E\u533A\u5206\u4E0D\u540C\u529F\u80FD\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q2-S4",
            "allowed_actions": [
              "\u652F\u67B6\u751F\u6210"
            ],
            "preferred_action": "\u5C0F\u76EE\u6807",
            "typical_question": "\u201C\u5982\u679C\u4E0D\u76F4\u63A5\u544A\u8BC9\u4ED6\u600E\u4E48\u642D\uFF0C\u60A8\u4F1A\u600E\u6837\u5E2E\u4ED6\u628A\u4E0B\u4E00\u6B65\u53D8\u5F97\u81EA\u5DF1\u80FD\u505A\uFF1F\u201D",
            "followup_question": "\u201C\u8FD9\u4E2A\u5C0F\u76EE\u6807\u7531\u8C01\u6765\u5B9A\uFF0C\u600E\u6837\u77E5\u9053\u96BE\u5EA6\u5408\u9002\uFF1F\u201D",
            "forbidden_actions": [
              "\u628AD\u7B54\u6848\u76F4\u63A5\u585E\u7ED9\u6559\u5E08"
            ],
            "forbidden_question": "\u201C\u662F\u4E0D\u662F\u5E94\u8BE5\u8BA9\u4ED6\u8BBE\u5C0F\u76EE\u6807\uFF1F\u201D",
            "non_inducing_boundary": "\u770B\u6559\u5E08\u80FD\u5426\u81EA\u4E3B\u751F\u6210\u5E76\u89E3\u91CA\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q2-S5",
            "allowed_actions": [
              "\u53CD\u9988/\u6E10\u9000"
            ],
            "preferred_action": "\u8FC7\u7A0B\u8FFD\u95EE",
            "typical_question": "\u201C\u5F53\u4ED6\u53C8\u81EA\u5DF1\u642D\u8D77\u6765\u4EE5\u540E\uFF0C\u60A8\u4F1A\u600E\u4E48\u56DE\u5E94\uFF0C\u53C8\u5728\u4EC0\u4E48\u65F6\u5019\u79BB\u5F00\uFF1F\u201D",
            "followup_question": "\u201C\u600E\u6837\u5224\u65AD\u60A8\u7684\u5E2E\u52A9\u6CA1\u6709\u8BA9\u4ED6\u66F4\u4F9D\u8D56\uFF1F\u201D",
            "forbidden_actions": [
              "\u6CDB\u5316\u8868\u626C"
            ],
            "forbidden_question": "\u201C\u591A\u8868\u626C\u5C31\u80FD\u589E\u5F3A\u72EC\u7ACB\u6027\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u91CD\u70B9\u662F\u53CD\u9988\u5185\u5BB9\u4E0E\u6E10\u9000\u6761\u4EF6\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q2-S6",
            "allowed_actions": [
              "\u8FB9\u754C\u5224\u65AD\uFF0C\u6700\u5C0F\u793A\u8303"
            ],
            "preferred_action": "\u53CD\u4F8B/\u9608\u503C",
            "typical_question": "\u201C\u5728\u4EC0\u4E48\u8BC1\u636E\u51FA\u73B0\u540E\uFF0C\u60A8\u624D\u4F1A\u8003\u8651\u793A\u8303\uFF1B\u5982\u679C\u793A\u8303\uFF0C\u6700\u5C11\u793A\u8303\u54EA\u4E00\u90E8\u5206\uFF1F\u201D",
            "followup_question": "\u201C\u793A\u8303\u540E\u600E\u6837\u786E\u8BA4\u5B69\u5B50\u80FD\u81EA\u5DF1\u7EE7\u7EED\uFF0C\u800C\u4E0D\u662F\u7167\u7740\u60A8\u505A\uFF1F\u201D",
            "forbidden_actions": [
              "\u793A\u8303\u9ED8\u8BA4"
            ],
            "forbidden_question": "\u201C\u4ED6\u53CD\u590D\u6C42\u52A9\uFF0C\u5C31\u5148\u793A\u8303\u4E00\u904D\u6700\u6709\u6548\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5148\u786E\u8BA4\u6280\u80FD\u7F3A\u53E3\u548C\u4F4E\u5F3A\u5EA6\u652F\u67B6\u65E0\u6548\uFF0C\u4FDD\u7559\u4E0D\u793A\u8303\u4E0E\u5C40\u90E8\u793A\u8303\u4E24\u79CD\u53EF\u80FD\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q2",
        "rules": [
          {
            "scope": "Q2-S1~S3 \u6C42\u52A9\u8BCA\u65AD",
            "sufficient_condition": "\u80FD\u8BC6\u522B\u8BED\u8A00\u2014\u884C\u4E3A\u77DB\u76FE\uFF0C\u63D0\u51FA\u81F3\u5C112\u7C7B\u6C42\u52A9\u529F\u80FD\u5E76\u8BF4\u660E\u533A\u5206\u8BC1\u636E\u3002",
            "no_gain_threshold": "\u8FDE\u7EED1\u6B21\u53EA\u8BF4\u2018\u4ED6\u4F1A/\u4ED6\u4F9D\u8D56\u2019\u65E0\u8BC1\u636E\uFF0C\u6362\u53CD\u4F8B1\u6B21\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u7B56\u7565\u4E0E\u5176\u8BCA\u65AD\u4E0D\u4E00\u81F4\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ2-S4\u652F\u67B6\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u53EA\u7ED9\u6807\u7B7E\u4E0D\u505A\u8BC1\u636E\u5224\u65AD\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q2-S4~S5 \u652F\u67B6/\u6E10\u9000",
            "sufficient_condition": "\u80FD\u63D0\u4F9B\u5C0F\u76EE\u6807\u3001\u6B65\u9AA4\u6574\u7406\u6216\u8FC7\u7A0B\u53CD\u9988\uFF0C\u5E76\u8BF4\u660E\u5E7C\u513F\u81EA\u4E3B\u540E\u5982\u4F55\u51CF\u5C11\u5E2E\u52A9\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u7ED9\u6CDB\u5316\u9F13\u52B1\uFF0C\u65E0\u652F\u67B6\u7EC6\u8282\u5219\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u6C42\u52A9\u9891\u7387\u672A\u4E0B\u964D\u7684\u53CD\u4F8B\u51FA\u73B0\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ2-S6\uFF08\u51FA\u73B0\u6280\u80FD\u7F3A\u53E3/\u793A\u8303\u5224\u65AD\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u65F6\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u6CA1\u6709\u9000\u51FA\u673A\u5236\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q2-S6 \u793A\u8303\u8FB9\u754C",
            "sufficient_condition": "\u80FD\u8BF4\u51FA\u81F3\u5C111\u4E2A\u771F\u6B63\u9700\u8981\u5C40\u90E8\u793A\u8303\u7684\u6761\u4EF6\uFF0C\u5E76\u8BF4\u660E\u6700\u5C0F\u793A\u8303\u5185\u5BB9\u53CA\u793A\u8303\u540E\u5982\u4F55\u5F52\u8FD8\u64CD\u4F5C\u6743\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u8BC1\u636E\u5373\u53EF\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u786E\u8BA4\u6CA1\u6709\u793A\u8303\u9700\u8981\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u4F4E\u5F3A\u5EA6\u652F\u67B6\u5931\u8D25\uFF0C\u6216\u6559\u5E08\u53C8\u628A\u6C42\u52A9\u81EA\u52A8\u8F6C\u6210\u793A\u8303\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u628A\u2018\u7EDD\u4E0D\u793A\u8303\u2019\u6216\u2018\u5148\u793A\u8303\u518D\u8BF4\u2019\u5F53\u4F5C\u539F\u5219\uFF0C\u90FD\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q2-S1~S5\u81F3\u5C114\u4E2A\u8FBE\u52302\u7EA7\uFF0C\u5F62\u6210\u2018\u89C2\u5BDF\u6C42\u52A9\u2014\u5224\u65AD\u529F\u80FD\u2014\u5339\u914D\u652F\u67B6\u2014\u53CD\u9988\u6E10\u9000\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u8BC1\u636E\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u8BC1\u636E\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6761\u4EF6\u6216\u65F6\u95F4\u4E0A\u9650\u4E14\u8FB9\u9645\u589E\u76CA\u4F4E\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u4E0D\u6E05\u695A\u4E3A\u4F55B\u5E94\u9760\u540E\u65F6\u4E0D\u5B9C\u8FC7\u65E9\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q2",
        "title": "\u9891\u7E41\u6C42\u52A9",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u900F\u8FC7\u201C\u6211\u4E0D\u4F1A\u3001\u5E2E\u5E2E\u6211\u201D\u7684\u8868\u9762\u6C42\u52A9\uFF0C\u5224\u65AD\u5E7C\u513F\u771F\u5B9E\u9700\u8981\uFF0C\u5E76\u4EE5\u5C0F\u76EE\u6807\u3001\u63D0\u95EE\u6216\u6750\u6599\u652F\u67B6\u652F\u6301\u5176\u81EA\u4E3B\u5C1D\u8BD5\uFF0C\u800C\u4E0D\u662F\u76F4\u63A5\u4EE3\u505A\u6216\u8FC7\u5EA6\u793A\u8303\u3002",
        "empirical": {
          "0": [
            "BDCA"
          ],
          "1": [
            "BADC",
            "BCAD",
            "BCDA",
            "BDAC",
            "CBDA",
            "DBAC",
            "DBCA",
            "DCBA"
          ],
          "2": [
            "ABCD",
            "ABDC",
            "ADBC",
            "BACD",
            "CABD",
            "CBAD",
            "CDAB",
            "CDBA",
            "DABC"
          ],
          "3": [
            "ACBD",
            "ADCB",
            "CADB",
            "DCAB"
          ],
          "4": [
            "ACDB",
            "DACB"
          ]
        },
        "scoring_note": "4\u5206\u4EC5ACDB\u3001DACB\uFF0CA\u6216D\u5C45\u9996\u3001B\uFF08\u6559\u5E08\u5148\u793A\u8303\uFF09\u5C45\u672B\uFF1B3\u5206\u4E5F\u5927\u591A\u4FDD\u6301B\u9760\u540E\u3002\u8BF4\u660E\u9AD8\u6C34\u5E73\u66F4\u91CD\u89C6\u81EA\u4E3B\u5C1D\u8BD5\u3001\u76EE\u6807\u5206\u89E3\u3001\u8FC7\u7A0B\u89C2\u5BDF\u4E0E\u53CD\u9988\uFF0C\u800C\u4E0D\u662F\u628A\u2018\u6C42\u52A9\u2019\u76F4\u63A5\u7406\u89E3\u4E3A\u6280\u80FD\u4E0D\u8DB3\u5E76\u9A6C\u4E0A\u793A\u8303\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q3": {
      "item_id": "Q3",
      "title": "\u533A\u57DF\u505C\u7559\u77ED",
      "ontology": {
        "item_id": "Q3",
        "title": "\u533A\u57DF\u505C\u7559\u77ED",
        "stem": "\u5C0F\u73ED\u5E7C\u513F\u7476\u7476\u5728\u533A\u57DF\u6D3B\u52A8\u65F6\uFF0C\u4E00\u4F1A\u513F\u5728\u5A03\u5A03\u5BB6\u5207\u5207\u83DC\uFF0C\u4E00\u4F1A\u513F\u5230\u7F8E\u5DE5\u533A\u6413\u6413\u6A61\u76AE\u6CE5\uFF0C\u4E00\u4F1A\u513F\u53C8\u5F00\u5FC3\u5730\u8DD1\u5230\u5176\u5B83\u533A\u57DF\u6E38\u620F\uFF0C\u5728\u4EFB\u4F55\u4E00\u4E2A\u533A\u57DF\u505C\u7559\u65F6\u95F4\u90FD\u4E0D\u8D85\u8FC7\u4E09\u5206\u949F\u3002",
        "options": {
          "A": "\u63D0\u8BAE\u7476\u7476\u5B8C\u6210\u67D0\u9879\u6E38\u620F\u4EFB\u52A1\uFF0C\u5982\u5728\u5A03\u5A03\u5BB6\u505A\u83DC\uFF0C\u8BF7\u4ED6\u6D3B\u52A8\u5C0F\u7ED3\u65F6\u5206\u4EAB\u3002",
          "B": "\u6E38\u620F\u524D\u63D0\u9192\u533A\u57DF\u6D3B\u52A8\u89C4\u5219\uFF0C\u6D3B\u52A8\u7ED3\u675F\u540E\u8868\u626C\u533A\u57DF\u6E38\u620F\u89C4\u5219\u9075\u5B88\u5F97\u597D\u7684\u5C0F\u670B\u53CB\u3002",
          "C": "\u4ED4\u7EC6\u89C2\u5BDF\u7476\u7476\u5728\u4E0D\u540C\u533A\u57DF\u7684\u6E38\u620F\u60C5\u51B5\uFF0C\u5206\u6790\u4ED6\u53D1\u751F\u8FC5\u901F\u8F6C\u79FB\u7684\u539F\u56E0\u3002",
          "D": "\u4EE5\u540C\u4F34\u7684\u8EAB\u4EFD\u966A\u4F34\u7476\u7476\u5728\u67D0\u4E00\u533A\u57DF\u6E38\u620F\uFF0C\u5F85\u4ED6\u4E13\u6CE8\u6E38\u620F\u540E\u518D\u79BB\u5F00\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u6301\u7EED\u89C2\u5BDF\u5E7C\u513F\u9891\u7E41\u8F6C\u6362\u533A\u57DF\u80CC\u540E\u7684\u539F\u56E0\uFF0C\u8BC6\u522B\u5176\u662F\u5426\u771F\u6B63\u6295\u5165\u3001\u6709\u65E0\u6E38\u620F\u76EE\u6807\u6216\u6750\u6599\u56F0\u96BE\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u9700\u8981\u966A\u4F34\u3001\u4EFB\u52A1\u652F\u67B6\u6216\u73AF\u5883\u8C03\u6574\u3002",
        "slots": [
          {
            "slot_id": "Q3-S1",
            "dimension": "C1 \u89C2\u5BDF",
            "name": "\u77ED\u505C\u7559\u7684\u4E13\u4E1A\u8868\u5F81",
            "definition": "\u628A\u9891\u7E41\u6362\u533A\u89C6\u4E3A\u9700\u8981\u6301\u7EED\u89C2\u5BDF\u548C\u89E3\u91CA\u7684\u6E38\u620F\u72B6\u6001\uFF0C\u800C\u975E\u76F4\u63A5\u89C6\u4E3A\u89C4\u5219\u6216\u4E13\u6CE8\u95EE\u9898\u3002",
            "diagnostic_meaning": "\u4E3B\u6307\u6807\u76F4\u63A5\u5BF9\u5E94\u2018\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\u2019\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u6F84\u6E05/\u7406\u7531\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u89C4\u5219\u7EA0\u6B63"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u9AD8\u5206C/D\u5C45\u524D\uFF0C\u4F4E\u5206A/B\u5C45\u524D\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q3-S2",
            "dimension": "C1 \u6E38\u620F\u72B6\u6001",
            "name": "\u8DE8\u533A\u57DF\u8FDE\u7EED\u89C2\u5BDF",
            "definition": "\u89C2\u5BDF\u8FDB\u5165/\u79BB\u5F00\u89E6\u53D1\u3001\u6D3B\u52A8\u5185\u5BB9\u3001\u540C\u4F34\u3001\u60C5\u7EEA\u3001\u64CD\u4F5C\u6DF1\u5EA6\u3001\u8DE8\u533A\u4E3B\u9898\u8FDE\u7EED\u6027\u3002",
            "diagnostic_meaning": "\u5224\u65AD\u5E7C\u513F\u662F\u5426\u771F\u6B63\u6CA1\u6709\u6295\u5165\uFF0C\u8FD8\u662F\u4EE5\u6D41\u52A8\u65B9\u5F0F\u63A2\u7D22\u3002",
            "core": true,
            "prerequisites": [
              "Q3-S1"
            ],
            "allowed_actions": [
              "\u5177\u4F53\u5316/\u8BC1\u636E\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u53EA\u8BB0\u5F55\u505C\u7559\u65F6\u95F4"
            ],
            "default_priority": "P1",
            "empirical_relation": "C\u7684\u6838\u5FC3\u4EF7\u503C\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q3-S3",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u591A\u91CD\u539F\u56E0\u5047\u8BBE",
            "definition": "\u533A\u5206\u5174\u8DA3\u5E7F\u6CDB\u3001\u6750\u6599\u4E0D\u5339\u914D\u3001\u6E38\u620F\u7ECF\u9A8C\u4E0D\u8DB3\u3001\u540C\u4F34\u5438\u5F15\u3001\u523A\u6FC0\u8FC7\u591A\u7B49\u539F\u56E0\u3002",
            "diagnostic_meaning": "\u4ECE\u89C2\u5BDF\u8D70\u5411\u4E13\u4E1A\u5224\u65AD\u3002",
            "core": true,
            "prerequisites": [
              "Q3-S2"
            ],
            "allowed_actions": [
              "\u5047\u8BBE\u6BD4\u8F83"
            ],
            "forbidden_actions": [
              "\u8D34\u4E13\u6CE8\u529B\u6807\u7B7E"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u51B3\u5B9AD\u662F\u5426\u9002\u5B9C\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q3-S4",
            "dimension": "C2 \u4ECB\u5165\u65F6\u673A",
            "name": "\u89C2\u5BDF\u4E0E\u53C2\u4E0E\u7684\u52A8\u6001\u8F6C\u6362",
            "definition": "\u53EF\u4EE5\u5148\u89C2\u5BDF\uFF0C\u4E5F\u53EF\u4EE5\u5728\u4F4E\u63A7\u5236\u5171\u540C\u6E38\u620F\u4E2D\u8FB9\u53C2\u4E0E\u8FB9\u89C2\u5BDF\uFF1B\u5173\u952E\u662F\u4ECB\u5165\u6709\u4F9D\u636E\u3001\u80FD\u83B7\u5F97\u65B0\u8BC1\u636E\u4E14\u4E0D\u63A5\u7BA1\u3002",
            "diagnostic_meaning": "\u4E0E\u5B9E\u8BC1C/D\u5747\u53EF\u5C45\u524D\u76F8\u4E00\u81F4\u3002",
            "core": true,
            "prerequisites": [
              "Q3-S2",
              "Q3-S3"
            ],
            "allowed_actions": [
              "\u8FB9\u754C/\u53CD\u4F8B"
            ],
            "forbidden_actions": [
              "\u628A\u2018\u5148\u89C2\u5BDF\u2019\u673A\u68B0\u5316"
            ],
            "default_priority": "P1",
            "empirical_relation": "4\u5206\u5305\u62ECC\u9996\u548CD\u9996\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q3-S5",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u5339\u914D\u539F\u56E0\u7684\u652F\u67B6\u4E0E\u6E10\u9000",
            "definition": "\u82E5\u7F3A\u6E38\u620F\u7EBF\u7D22\u53EF\u966A\u73A9/\u793A\u8303\u60C5\u8282\uFF1B\u82E5\u6750\u6599\u4E0D\u9002\u53EF\u8C03\u6574\uFF1B\u8FDB\u5165\u72B6\u6001\u540E\u9010\u6B65\u9000\u51FA\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u4F4E\u63A7\u5236\u5EA6\u652F\u67B6\u53CA\u539F\u56E0\u2014\u7B56\u7565\u5339\u914D\u3002",
            "core": true,
            "prerequisites": [
              "Q3-S3"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u7EDF\u4E00\u5B89\u6392\u4EFB\u52A1"
            ],
            "default_priority": "P1",
            "empirical_relation": "D\u9AD8\u5206\u6F5C\u529B\u6765\u81EA\u966A\u4F34+\u6E10\u9000\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q3-S6",
            "dimension": "C2 \u8FB9\u754C",
            "name": "\u4EFB\u52A1/\u89C4\u5219\u7BA1\u7406\u8FB9\u754C",
            "definition": "\u4EFB\u52A1\u548C\u89C4\u5219\u53EF\u6709\u5C40\u90E8\u4F5C\u7528\uFF0C\u4F46\u4E0D\u80FD\u66FF\u4EE3\u5BF9\u539F\u56E0\u548C\u6E38\u620F\u8D28\u91CF\u7684\u5224\u65AD\uFF0C\u4E5F\u4E0D\u5E94\u628A\u505C\u7559\u65F6\u957F\u4F5C\u4E3A\u552F\u4E00\u76EE\u6807\u3002",
            "diagnostic_meaning": "\u89E3\u91CAA/B\u4E3A\u4F55\u5728\u9AD8\u5206\u7EC4\u5408\u4E2D\u9760\u540E\u3002",
            "core": false,
            "prerequisites": [
              "Q3-S1"
            ],
            "allowed_actions": [
              "\u5BF9\u6BD4"
            ],
            "forbidden_actions": [
              "\u628AA/B\u7EDD\u5BF9\u5224\u9519"
            ],
            "default_priority": "P2",
            "empirical_relation": "\u7528\u4E8E\u8FA8\u522B\u6559\u5E08\u662F\u5426\u8FC7\u5EA6\u7BA1\u7406\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q3",
        "anchors": [
          {
            "slot_id": "Q3-S1",
            "level_0": "\u76F4\u63A5\u8BF4\u4E0D\u5B88\u89C4\u5219\u3001\u6CE8\u610F\u529B\u5DEE\u3001\u5E94\u56FA\u5B9A\u5728\u4E00\u4E2A\u533A\u3002",
            "level_1": "\u77E5\u9053\u8981\u89C2\u5BDF\uFF0C\u4F46\u4ECD\u628A\u76EE\u6807\u5B9A\u4E3A\u8BA9\u5E7C\u513F\u5F85\u4E45\u3002",
            "level_2": "\u660E\u786E\u77ED\u505C\u7559\u53EA\u662F\u73B0\u8C61\uFF0C\u9700\u8981\u5148\u7406\u89E3\u5176\u6E38\u620F\u72B6\u6001\u548C\u539F\u56E0\u3002",
            "level_3": "\u8FDB\u4E00\u6B65\u6307\u51FA\u77ED\u505C\u7559\u53EF\u80FD\u4ECD\u5305\u542B\u6709\u610F\u4E49\u7684\u8DE8\u533A\u63A2\u7D22\uFF0C\u8BC4\u4EF7\u5E94\u770B\u6E38\u620F\u8FDE\u7EED\u6027\u3001\u6295\u5165\u548C\u7ECF\u9A8C\uFF0C\u800C\u975E\u5206\u949F\u6570\u3002",
            "false_evidence": "\u53EA\u8BF4\u5C0A\u91CD\u3002",
            "conflict_evidence": "\u8FB9\u8BF4\u89C2\u5BDF\u8FB9\u7ACB\u5373\u5B89\u6392\u4EFB\u52A1\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q3-S2",
            "level_0": "\u53EA\u770B\u5F85\u591A\u4E45\u3002",
            "level_1": "\u770B\u6D3B\u52A8\u533A\u548C\u65F6\u95F4\uFF0C\u4F46\u89C2\u5BDF\u7EF4\u5EA6\u6709\u9650\u3002",
            "level_2": "\u80FD\u89C2\u5BDF\u8FDB\u5165/\u79BB\u5F00\u89E6\u53D1\u3001\u5185\u5BB9\u3001\u540C\u4F34\u3001\u60C5\u7EEA\u3001\u6750\u6599\u548C\u8DE8\u533A\u8FDE\u7EED\u6027\u3002",
            "level_3": "\u80FD\u8DE8\u65F6\u6BB5\u6BD4\u8F83\u5E76\u7528\u65B0\u8BC1\u636E\u4FEE\u6B63\u5224\u65AD\u3002",
            "false_evidence": "\u8BB0\u5F55\u5F88\u591A\u5374\u4E0D\u89E3\u91CA\u3002",
            "conflict_evidence": "\u53EA\u7528\u505C\u7559\u65F6\u957F\u505A\u7ED3\u8BBA\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q3-S3",
            "level_0": "\u5355\u4E00\u5F52\u56E0\u89C4\u5219/\u4E13\u6CE8\u3002",
            "level_1": "\u63D0\u51FA1\u4E2A\u975E\u63A7\u5236\u539F\u56E0\u4F46\u65E0\u8BC1\u636E\u3002",
            "level_2": "\u63D0\u51FA\u81F3\u5C112\u20143\u79CD\u539F\u56E0\u53CA\u533A\u5206\u8BC1\u636E\u3002",
            "level_3": "\u80FD\u628A\u539F\u56E0\u5047\u8BBE\u4E0E\u540E\u7EED\u652F\u6301\u7B56\u7565\u4E00\u4E00\u8FDE\u63A5\u3002",
            "false_evidence": "\u7F57\u5217\u539F\u56E0\u4E0D\u9A8C\u8BC1\u3002",
            "conflict_evidence": "\u65E0\u8BC1\u636E\u8D34\u6807\u7B7E\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q3-S4",
            "level_0": "\u56FA\u5B9A\u4E0D\u4ECB\u5165\u6216\u56FA\u5B9A\u7ACB\u523B\u966A\u73A9\u3002",
            "level_1": "\u77E5\u9053\u770B\u60C5\u51B5\u4F46\u65E0\u9608\u503C\u3002",
            "level_2": "\u80FD\u8BF4\u660E\u4F55\u65F6\u7EE7\u7EED\u89C2\u5BDF\u3001\u4F55\u65F6\u4EE5\u4F19\u4F34\u8EAB\u4EFD\u8F7B\u4ECB\u5165\uFF0C\u5E76\u628A\u4ECB\u5165\u4F5C\u4E3A\u8FDB\u4E00\u6B65\u4E86\u89E3\u5E7C\u513F\u7684\u673A\u4F1A\u3002",
            "level_3": "\u80FD\u5728\u53C2\u4E0E\u4E2D\u4FDD\u6301\u89C2\u5BDF\u8005\u610F\u8BC6\uFF0C\u6839\u636E\u513F\u7AE5\u53CD\u9988\u5373\u65F6\u51CF\u5F31/\u589E\u5F3A\u652F\u67B6\u3002",
            "false_evidence": "D\u6C38\u8FDC\u4F18\u4E8EC\u6216\u76F8\u53CD\u3002",
            "conflict_evidence": "\u4ECB\u5165\u540E\u63A5\u7BA1\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q3-S5",
            "level_0": "\u7EDF\u4E00\u4EFB\u52A1\u3001\u89C4\u5219\u6216\u5F3A\u5236\u505C\u7559\u3002",
            "level_1": "\u4F1A\u966A\u73A9/\u52A0\u6750\u6599\u4F46\u65E0\u539F\u56E0\u4F9D\u636E\u3002",
            "level_2": "\u4E0D\u540C\u539F\u56E0\u4F7F\u7528\u4E0D\u540C\u652F\u67B6\uFF0C\u5E76\u5728\u5E7C\u513F\u81EA\u4E3B\u6295\u5165\u540E\u9000\u51FA\u3002",
            "level_3": "\u80FD\u7528\u6E38\u620F\u8D28\u91CF\u53D8\u5316\u8BC4\u4F30\u652F\u6301\uFF0C\u800C\u975E\u53EA\u770B\u505C\u7559\u65F6\u95F4\u3002",
            "false_evidence": "\u7B56\u7565\u6E05\u5355\u3002",
            "conflict_evidence": "\u6240\u6709\u513F\u7AE5\u540C\u4E00\u652F\u67B6\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q3-S6",
            "level_0": "\u628A\u5B8C\u6210\u4EFB\u52A1\u3001\u9075\u5B88\u533A\u57DF\u89C4\u5219\u6216\u5EF6\u957F\u505C\u7559\u4F5C\u4E3A\u552F\u4E00\u76EE\u6807\u3002",
            "level_1": "\u77E5\u9053\u4EFB\u52A1\u6216\u89C4\u5219\u53EF\u80FD\u6709\u7528\uFF0C\u4F46\u4ECD\u4E3B\u8981\u7528\u505C\u7559\u65F6\u95F4\u5224\u65AD\u662F\u5426\u6539\u5584\u3002",
            "level_2": "\u80FD\u8BF4\u660E\u4EFB\u52A1\u6216\u89C4\u5219\u53EA\u5728\u7279\u5B9A\u539F\u56E0\u4E0B\u5C40\u90E8\u9002\u7528\uFF0C\u4E14\u4EE5\u6E38\u620F\u6295\u5165\u3001\u8FDE\u7EED\u6027\u548C\u8D28\u91CF\u800C\u975E\u4EC5\u4EE5\u65F6\u957F\u8BC4\u4EF7\u3002",
            "level_3": "\u80FD\u533A\u5206\u9700\u8981\u7ED3\u6784\u652F\u6301\u4E0E\u6709\u610F\u4E49\u7684\u8DE8\u533A\u63A2\u7D22\uFF0C\u5E76\u4F9D\u636E\u65B0\u8BC1\u636E\u8C03\u6574\u6216\u64A4\u9664\u7BA1\u7406\u652F\u67B6\u3002",
            "false_evidence": "\u5E03\u7F6E\u4EFB\u52A1\u540E\u5F85\u5F97\u66F4\u4E45\u5C31\u7B97\u6709\u6548\u3002",
            "conflict_evidence": "\u539F\u56E0\u4E0D\u660E\u5373\u7EDF\u4E00\u4F7F\u7528\u4EFB\u52A1\u6216\u89C4\u5219\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q3",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ACDAB/DBCA/DCBA",
            "hypothesis": "C/D\u5C45\u524D\u3001A/B\u5C45\u540E\uFF1B\u603B\u4F53\u5DF2\u6293\u4F4F\u89C2\u5BDF\u548C\u4F4E\u63A7\u5236\u53C2\u4E0E\u3002",
            "target_slots": [
              "Q3-S3",
              "Q3-S4",
              "Q3-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u8FB9\u754C/\u8FC1\u79FB",
            "forbidden_question": "\u201CC\u4E00\u5B9A\u5FC5\u987B\u7B2C\u4E00\u5417\uFF1F\u201D",
            "rationale": "\u9A8C\u8BC1\u6559\u5E08\u662F\u5426\u7406\u89E3C/D\u53EF\u56E0\u8BC1\u636E\u548C\u4ECB\u5165\u65F6\u673A\u4E92\u6362\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206",
            "hypothesis": "C/D\u4ECD\u591A\u5728\u524D\uFF0C\u4F46A/B\u4F4D\u7F6E\u8F83\u9AD8\uFF0C\u53EF\u80FD\u5BF9\u4EFB\u52A1/\u89C4\u5219\u8FB9\u754C\u4E0D\u7A33\u5B9A\u3002",
            "target_slots": [
              "Q3-S4",
              "Q3-S6"
            ],
            "priority": "P2",
            "preferred_action": "\u5BF9\u6BD4",
            "forbidden_question": "\u201C\u89C4\u5219\u7BA1\u7406\u5B8C\u5168\u4E0D\u80FD\u7528\u5417\uFF1F\u201D",
            "rationale": "\u770B\u662F\u5426\u80FD\u8BF4\u660E\u9002\u7528\u6761\u4EF6\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u90E8\u5206\u89C2\u5BDF\u610F\u8BC6\uFF0C\u4F46\u539F\u56E0\u2014\u652F\u67B6\u95ED\u73AF\u4E0D\u8DB3\u3002",
            "target_slots": [
              "Q3-S2",
              "Q3-S3",
              "Q3-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u5177\u4F53\u5316",
            "forbidden_question": "\u201C\u89C2\u5BDF\u4E00\u4E0B\u4E4B\u540E\u5462\uFF1F\u201D",
            "rationale": "\u63A8\u52A8\u4ECE\u89C2\u5BDF\u53E3\u53F7\u5230\u8BC1\u636E/\u56DE\u5E94\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216A/B\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u77ED\u505C\u7559\u76F4\u63A5\u89C6\u4E3A\u9700\u7EA0\u6B63\u7684\u884C\u4E3A\u3002",
            "target_slots": [
              "Q3-S1",
              "Q3-S3",
              "Q3-S6"
            ],
            "priority": "P1",
            "preferred_action": "\u6E38\u620F\u72B6\u6001\u53CD\u4F8B",
            "forbidden_question": "\u201C\u505C\u7559\u77ED\u5C31\u7B49\u4E8E\u6CA1\u6709\u6295\u5165\u5417\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u8BCA\u65AD\u6210\u4EBA\u89C4\u8303\u903B\u8F91\u3002",
            "calibration_note": ""
          },
          {
            "condition": "D\u5C45\u9996\u4F46C\u9760\u540E",
            "hypothesis": "\u53EF\u80FD\u628A\u966A\u4F34\u5F53\u901A\u7528\u7B54\u6848\uFF0C\u539F\u56E0\u8BCA\u65AD\u4E0D\u8DB3\u3002",
            "target_slots": [
              "Q3-S2",
              "Q3-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u8FB9\u754C",
            "forbidden_question": "\u201C\u4EC0\u4E48\u65F6\u5019\u966A\u4F34\u53CD\u800C\u4E0D\u9700\u8981\uFF1F\u201D",
            "rationale": "\u9A8C\u8BC1D\u4E0D\u662F\u673A\u68B0\u7B56\u7565\u3002",
            "calibration_note": ""
          },
          {
            "condition": "C\u5C45\u9996\u4F46\u6559\u5E08\u65E0\u6CD5\u751F\u6210\u540E\u7EED\u652F\u6301",
            "hypothesis": "\u89C2\u5BDF\u80FD\u529B\u4E0E\u56DE\u5E94\u80FD\u529B\u8131\u8282\u3002",
            "target_slots": [
              "Q3-S3",
              "Q3-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u7B56\u7565\u751F\u6210",
            "forbidden_question": "\u201C\u5982\u679C\u89C2\u5BDF\u53D1\u73B0\u5979\u4E0D\u77E5\u9053\u600E\u4E48\u73A9\uFF0C\u60A8\u63A5\u4E0B\u6765\u600E\u4E48\u505A\uFF1F\u201D",
            "rationale": "\u67E5\u4ECE\u89C2\u5BDF\u5230\u652F\u6301\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q3",
        "probes": [
          {
            "slot_id": "Q3-S1",
            "allowed_actions": [
              "\u6F84\u6E05"
            ],
            "preferred_action": "\u95EE\u9898\u8868\u5F81",
            "typical_question": "\u201C\u770B\u5230\u5979\u6BCF\u4E2A\u533A\u57DF\u90FD\u5F85\u5F97\u5F88\u77ED\uFF0C\u60A8\u6700\u60F3\u5148\u5224\u65AD\u7684\u662F\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u60A8\u4F1A\u4E0D\u4F1A\u76F4\u63A5\u628A\u5B83\u770B\u6210\u89C4\u5219\u6216\u4E13\u6CE8\u95EE\u9898\uFF1F\u201D",
            "forbidden_actions": [
              "\u8BF1\u5BFC\u6807\u51C6\u7B54\u6848"
            ],
            "forbidden_question": "\u201C\u662F\u4E0D\u662F\u5E94\u8BE5\u5148\u89C2\u5BDF\uFF1F\u201D",
            "non_inducing_boundary": "\u63A2\u67E5\u6559\u5E08\u5982\u4F55\u5B9A\u4E49\u73B0\u8C61\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q3-S2",
            "allowed_actions": [
              "\u5177\u4F53\u5316"
            ],
            "preferred_action": "\u89C2\u5BDF",
            "typical_question": "\u201C\u60A8\u5982\u679C\u8DDF\u7740\u5979\u770B\u5341\u5206\u949F\uFF0C\u4F1A\u7279\u522B\u8BB0\u4E0B\u54EA\u4E9B\u4E8B\u60C5\uFF1F\u201D",
            "followup_question": "\u201C\u5979\u79BB\u5F00\u524D\u53D1\u751F\u4E86\u4EC0\u4E48\uFF0C\u5BF9\u60A8\u5224\u65AD\u6709\u5E2E\u52A9\u5417\uFF1F\u201D",
            "forbidden_actions": [
              "\u6E05\u5355\u63D0\u793A"
            ],
            "forbidden_question": "\u201C\u60A8\u4F1A\u770B\u540C\u4F34\u3001\u6750\u6599\u3001\u60C5\u7EEA\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5148\u81EA\u4E3B\u751F\u6210\u89C2\u5BDF\u7EF4\u5EA6\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q3-S3",
            "allowed_actions": [
              "\u5047\u8BBE\u6BD4\u8F83"
            ],
            "preferred_action": "\u539F\u56E0",
            "typical_question": "\u201C\u540C\u6837\u662F\u4E09\u5206\u949F\u5C31\u8D70\uFF0C\u53EF\u80FD\u6709\u54EA\u4E9B\u4E0D\u540C\u539F\u56E0\uFF1F\u201D",
            "followup_question": "\u201C\u54EA\u79CD\u8BC1\u636E\u4F1A\u8BA9\u60A8\u6539\u53D8\u539F\u6765\u7684\u731C\u6D4B\uFF1F\u201D",
            "forbidden_actions": [
              "\u8D34\u6807\u7B7E"
            ],
            "forbidden_question": "\u201C\u5979\u662F\u4E0D\u662F\u6CE8\u610F\u529B\u5DEE\uFF1F\u201D",
            "non_inducing_boundary": "\u5F3A\u8C03\u53EF\u68C0\u9A8C\u6027\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q3-S4",
            "allowed_actions": [
              "\u65F6\u673A\u8FB9\u754C"
            ],
            "preferred_action": "\u89C2\u5BDF/\u53C2\u4E0E\u8F6C\u6362",
            "typical_question": "\u201C\u4EC0\u4E48\u60C5\u51B5\u4E0B\u60A8\u4F1A\u7EE7\u7EED\u770B\uFF0C\u4EC0\u4E48\u60C5\u51B5\u4E0B\u4F1A\u8FDB\u53BB\u966A\u5979\u73A9\u4E00\u4F1A\u513F\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u8FDB\u53BB\u4EE5\u540E\u53D1\u73B0\u5979\u5176\u5B9E\u6709\u81EA\u5DF1\u7684\u8DE8\u533A\u73A9\u6CD5\uFF0C\u60A8\u4F1A\u600E\u4E48\u8C03\u6574\uFF1F\u201D",
            "forbidden_actions": [
              "\u56FA\u5B9A\u987A\u5E8F"
            ],
            "forbidden_question": "\u201C\u4E00\u5B9A\u5148\u89C2\u5BDF\u518D\u4ECB\u5165\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u5141\u8BB8C/D\u6761\u4EF6\u6027\u4E92\u6362\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q3-S5",
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210"
            ],
            "preferred_action": "\u5339\u914D\u652F\u67B6",
            "typical_question": "\u201C\u5982\u679C\u539F\u56E0\u5206\u522B\u662F\u2018\u4E0D\u77E5\u9053\u600E\u4E48\u7EE7\u7EED\u2019\u548C\u2018\u6750\u6599\u592A\u7B80\u5355\u2019\uFF0C\u60A8\u7684\u652F\u6301\u4F1A\u4E00\u6837\u5417\uFF1F\u201D",
            "followup_question": "\u201C\u5979\u5F00\u59CB\u81EA\u5DF1\u73A9\u8D77\u6765\u540E\uFF0C\u60A8\u4F1A\u600E\u6837\u9000\u51FA\uFF1F\u201D",
            "forbidden_actions": [
              "\u7B56\u7565\u83DC\u5355"
            ],
            "forbidden_question": "\u201C\u966A\u73A9\u8FD8\u662F\u52A0\u6750\u6599\uFF1F\u201D",
            "non_inducing_boundary": "\u8981\u6C42\u539F\u56E0\u2014\u7B56\u7565\u5BF9\u5E94\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q3-S6",
            "allowed_actions": [
              "\u5BF9\u6BD4\uFF0C\u8FB9\u754C"
            ],
            "preferred_action": "\u7BA1\u7406\u8FB9\u754C",
            "typical_question": "\u201C\u4EFB\u52A1\u6216\u533A\u57DF\u89C4\u5219\u5728\u4EC0\u4E48\u539F\u56E0\u4E0B\u53EF\u80FD\u6709\u5E2E\u52A9\uFF0C\u53C8\u5728\u4EC0\u4E48\u60C5\u51B5\u4E0B\u4F1A\u63A9\u76D6\u771F\u6B63\u95EE\u9898\uFF1F\u201D",
            "followup_question": "\u201C\u9664\u4E86\u5F85\u5F97\u66F4\u4E45\uFF0C\u60A8\u8FD8\u4F1A\u7528\u4EC0\u4E48\u5224\u65AD\u652F\u6301\u662F\u5426\u6709\u6548\uFF1F\u201D",
            "forbidden_actions": [
              "\u65F6\u957F\u552F\u4E00"
            ],
            "forbidden_question": "\u201C\u53EA\u8981\u4ED6\u80FD\u5728\u4E00\u4E2A\u533A\u5F85\u4E45\u4E00\u4E9B\uFF0C\u5C31\u8BF4\u660E\u65B9\u6CD5\u6709\u6548\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5141\u8BB8\u4EFB\u52A1\u548C\u89C4\u5219\u6709\u5C40\u90E8\u4EF7\u503C\uFF0C\u4E0D\u628AA/B\u7EDD\u5BF9\u5224\u9519\uFF0C\u4E5F\u4E0D\u628A\u505C\u7559\u65F6\u957F\u5F53\u552F\u4E00\u76EE\u6807\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q3",
        "rules": [
          {
            "scope": "Q3-S1~S3 \u8868\u5F81/\u89C2\u5BDF/\u539F\u56E0",
            "sufficient_condition": "\u80FD\u628A\u77ED\u505C\u7559\u89C6\u4E3A\u5F85\u89E3\u91CA\u73B0\u8C61\uFF0C\u63D0\u51FA\u591A\u539F\u56E0\u5E76\u8BF4\u660E\u5177\u4F53\u89C2\u5BDF\u8BC1\u636E\u3002",
            "no_gain_threshold": "\u8FDE\u7EED1\u8F6E\u53EA\u8BF4\u2018\u89C2\u5BDF\u2019\u65E0\u65B0\u589E\uFF0C\u6362\u53CD\u4F8B1\u6B21\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u53C8\u56DE\u5230\u89C4\u5219/\u4E13\u6CE8\u5355\u4E00\u5F52\u56E0\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ3-S4\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u6CA1\u6709\u539F\u56E0\u8BC1\u636E\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q3-S4~S5 \u65F6\u673A/\u652F\u67B6",
            "sufficient_condition": "\u80FD\u8BF4\u660EC/D\u5F0F\u89C2\u5BDF\u4E0E\u53C2\u4E0E\u7684\u6761\u4EF6\uFF0C\u5E76\u5F62\u6210\u539F\u56E0\u2014\u652F\u67B6\u2014\u6E10\u9000\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u6709\u7B56\u7565\u540D\u65E0\u6761\u4EF6\uFF0C\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u539F\u56E0\u4F7F\u7B56\u7565\u5931\u914D\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ3-S6\uFF08\u51FA\u73B0\u4EFB\u52A1/\u89C4\u5219\u5224\u65AD\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u65F6\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u628A\u966A\u4F34\u6216\u89C2\u5BDF\u7EDD\u5BF9\u5316\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q3-S6 \u7BA1\u7406\u8FB9\u754C",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u4EFB\u52A1\u6216\u89C4\u5219\u7684\u6709\u9650\u9002\u7528\u6761\u4EF6\uFF0C\u540C\u65F6\u4E0D\u628A\u505C\u7559\u65F6\u957F\u4F5C\u4E3A\u552F\u4E00\u76EE\u6807\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u8BC1\u636E\u5373\u53EF\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u786E\u8BA4\u7BA1\u7406\u5206\u652F\u4E0D\u9002\u7528\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u53C8\u4EE5\u4EFB\u52A1\u6216\u89C4\u5219\u4E3A\u9996\u8981\u5904\u7406\u3001\u5FFD\u7565\u539F\u56E0\u4E0E\u6E38\u620F\u8D28\u91CF\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "A/B\u4EF7\u503C\u5B8C\u5168\u672A\u5206\u5316\u4E14\u6838\u5FC3\u8BCA\u65AD\u4ECD\u4E0D\u6E05\u65F6\uFF0C\u4E0D\u5B9C\u505C\u6B62\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q3-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u6301\u7EED\u89C2\u5BDF\u2014\u539F\u56E0\u5224\u65AD\u2014\u6761\u4EF6\u5316\u4ECB\u5165\u2014\u652F\u67B6\u6E10\u9000\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4E14\u8FB9\u9645\u589E\u76CA\u4F4E\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u65E0\u6CD5\u89E3\u91CAC/D\u9AD8\u5206\u903B\u8F91\u65F6\u4E0D\u5F97\u8FC7\u65E9\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q3",
        "title": "\u533A\u57DF\u505C\u7559\u77ED",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u89C2\u5BDF\u6E38\u620F\u7684\u610F\u8BC6\u548C\u89D2\u5EA6\uFF1B\u5BF9\u5E7C\u513F\u6E38\u620F\u72B6\u6001\u7684\u89C2\u5BDF\u4E0E\u8BC6\u522B",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u6301\u7EED\u89C2\u5BDF\u5E7C\u513F\u9891\u7E41\u8F6C\u6362\u533A\u57DF\u80CC\u540E\u7684\u539F\u56E0\uFF0C\u8BC6\u522B\u5176\u662F\u5426\u771F\u6B63\u6295\u5165\u3001\u6709\u65E0\u6E38\u620F\u76EE\u6807\u6216\u6750\u6599\u56F0\u96BE\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u9700\u8981\u966A\u4F34\u3001\u4EFB\u52A1\u652F\u67B6\u6216\u73AF\u5883\u8C03\u6574\u3002",
        "empirical": {
          "0": [
            "ABCD",
            "ABDC",
            "ADCB",
            "BACD",
            "BADC",
            "BDCA"
          ],
          "1": [
            "ACBD",
            "ADBC",
            "BCAD",
            "BCDA",
            "CABD",
            "CBDA",
            "DABC",
            "DACB"
          ],
          "2": [
            "ACDB",
            "BDAC",
            "CBAD",
            "DBAC"
          ],
          "3": [
            "CADB",
            "CDBA",
            "DCAB"
          ],
          "4": [
            "CDAB",
            "DBCA",
            "DCBA"
          ]
        },
        "scoring_note": "4\u5206\u5747\u7531C/D\u5C45\u524D\u3001A/B\u5C45\u540E\uFF1B0\u5206\u591A\u4E3AA/B\u5C45\u524D\u3002\u8BF4\u660E\u5B9E\u8BC1\u533A\u5206\u975E\u5E38\u6E05\u695A\uFF1A\u9AD8\u6C34\u5E73\u4EE5\u89C2\u5BDF\u539F\u56E0\u3001\u4F4E\u63A7\u5236\u5EA6\u966A\u4F34\u4E3A\u6838\u5FC3\uFF0C\u4F4E\u6C34\u5E73\u66F4\u6613\u4EE5\u4EFB\u52A1\u548C\u89C4\u5219\u7BA1\u7406\u76F4\u63A5\u5904\u7406\u2018\u505C\u7559\u77ED\u2019\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q4": {
      "item_id": "Q4",
      "title": "\u672A\u53C2\u4E0E\u5C0F\u7EC4\u5EFA\u6784",
      "ontology": {
        "item_id": "Q4",
        "title": "\u672A\u53C2\u4E0E\u5C0F\u7EC4\u5EFA\u6784",
        "stem": "\u5927\u73ED\u5EFA\u6784\u6D3B\u52A8\u4E2D\uFF0C\u777F\u777F\u548C\u5176\u4ED6\u5E7C\u513F\u8BA1\u5212\u4E00\u8D77\u642D\u79EF\u6728\u5927\u6865\uFF0C\u4ED6\u4EEC\u8BA8\u8BBA\u4E86\u642D\u5EFA\u65B9\u6CD5\uFF0C\u5E76\u8FDB\u5165\u533A\u57DF\u5F00\u59CB\u642D\u5EFA\u3002\u5C31\u5728\u5176\u4ED6\u5E7C\u513F\u5728\u8BA4\u771F\u642D\u5EFA\u65F6\uFF0C\u777F\u777F\u53D1\u73B0\u4E86\u4E00\u5757\u957F\u6761\u6728\u677F\uFF0C\u4ED6\u4E00\u4F1A\u513F\u5728\u5730\u4E0A\u63A8\u7740\u8D70\uFF0C\u4E00\u4F1A\u513F\u5F53\u67AA\u4F7F\uFF0C\u6CA1\u6709\u518D\u53C2\u4E0E\u5C0F\u7EC4\u7684\u642D\u5EFA\u3002",
        "options": {
          "A": "\u7EE7\u7EED\u89C2\u5BDF\uFF0C\u540E\u7EED\u5206\u4EAB\u4E2D\u652F\u6301\u777F\u777F\u601D\u8003\u5982\u4F55\u628A\u957F\u6761\u6728\u677F\u878D\u5165\u5C0F\u7EC4\u7684\u5EFA\u6784\u4E2D\u3002",
          "B": "\u80AF\u5B9A\u777F\u777F\u7684\u521B\u9020\u6027\u73A9\u6CD5\uFF0C\u8BE2\u95EE\u4ED6\u957F\u6761\u677F\u80FD\u5426\u5F53\u6865\u9762\uFF0C\u5F15\u5BFC\u4ED6\u53C2\u4E0E\u5230\u642D\u6865\u4EFB\u52A1\u4E2D\u3002",
          "C": "\u5F15\u5BFC\u777F\u777F\u56DE\u987E\u8BA1\u5212\uFF0C\u5EFA\u8BAE\u4ED6\u5148\u5B8C\u6210\u5171\u540C\u4EFB\u52A1\uFF0C\u957F\u6761\u6728\u677F\u53EF\u4EE5\u7B49\u81EA\u7531\u6E38\u620F\u65F6\u518D\u73A9\u3002",
          "D": "\u770B\u5230\u777F\u777F\u73A9\u5F97\u5F00\u5FC3\uFF0C\u6682\u4E0D\u4ECB\u5165\uFF0C\u7B49\u4E0B\u4E00\u6B21\u6D3B\u52A8\u65F6\u518D\u63D0\u9192\u4ED6\u6839\u636E\u8BA1\u5212\u5F00\u5C55\u6E38\u620F\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\uFF5C\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u7406\u89E3\u5E7C\u513F\u4E2A\u4F53\u5174\u8DA3\u4E0E\u5C0F\u7EC4\u5171\u540C\u4EFB\u52A1\u4E4B\u95F4\u7684\u5173\u7CFB\uFF0C\u5E76\u4EE5\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u7684\u65B9\u5F0F\u628A\u4E2A\u4EBA\u53D1\u73B0\u8F6C\u5316\u4E3A\u5171\u540C\u5EFA\u6784\u8D44\u6E90\u3002",
        "slots": [
          {
            "slot_id": "Q4-S1",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u4E2A\u4F53\u63A2\u7D22\u4E0E\u5171\u540C\u8BA1\u5212\u53CC\u91CD\u7406\u89E3",
            "definition": "\u540C\u65F6\u770B\u89C1\u957F\u6728\u677F\u7684\u65B0\u7528\u9014\u63A2\u7D22\u4E0E\u777F\u777F\u5DF2\u7ECF\u53C2\u4E0E\u5171\u540C\u642D\u6865\u8BA1\u5212\u3002",
            "diagnostic_meaning": "\u907F\u514D\u628A\u884C\u4E3A\u7B80\u5316\u4E3A\u4E0D\u5408\u4F5C\u6216\u7EAF\u521B\u9020\u6027\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u53CC\u9762\u8BC1\u636E/\u6F84\u6E05"
            ],
            "forbidden_actions": [
              "\u8D34\u6807\u7B7E"
            ],
            "default_priority": "P1",
            "empirical_relation": "B\u9AD8\u5206\u6838\u5FC3\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q4-S2",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u5174\u8DA3\u6865\u63A5\u5171\u540C\u5EFA\u6784",
            "definition": "\u5229\u7528\u957F\u6728\u677F\u7684\u65B0\u610F\u4E49\uFF0C\u901A\u8FC7\u63D0\u95EE/\u5171\u540C\u60F3\u8C61\u628A\u5B83\u53D8\u6210\u5171\u540C\u4F5C\u54C1\u8D44\u6E90\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u5C06\u4E2A\u4F53\u751F\u6210\u5185\u5BB9\u8F6C\u5316\u4E3A\u5408\u4F5C\u8D44\u6E90\u7684\u80FD\u529B\u3002",
            "core": true,
            "prerequisites": [
              "Q4-S1"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210/\u5177\u4F53\u5316"
            ],
            "forbidden_actions": [
              "\u76F4\u63A5\u8981\u6C42\u5148\u5B8C\u6210\u4EFB\u52A1"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u5B9E\u8BC1\u552F\u4E004\u5206B\u9996\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q4-S3",
            "dimension": "B2 \u6559\u5E08\u89D2\u8272",
            "name": "\u4F4E\u63A7\u5236\u652F\u6301\u8005/\u5408\u4F5C\u8005\u89D2\u8272",
            "definition": "\u4EE5\u9080\u8BF7\u3001\u95EE\u9898\u3001\u540C\u4F34\u534F\u5546\u652F\u6301\u777F\u777F\u91CD\u65B0\u8FDE\u63A5\u5C0F\u7EC4\uFF0C\u4E0D\u7531\u6559\u5E08\u6307\u5B9A\u552F\u4E00\u7528\u9014\u3002",
            "diagnostic_meaning": "\u5BF9\u5E94\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005\u3002",
            "core": true,
            "prerequisites": [
              "Q4-S2"
            ],
            "allowed_actions": [
              "\u8BDD\u672F\u6BD4\u8F83"
            ],
            "forbidden_actions": [
              "\u6210\u4EBA\u6307\u5B9A\u73A9\u6CD5"
            ],
            "default_priority": "P1",
            "empirical_relation": "B\u672C\u8EAB\u5E26\u4E00\u5B9A\u6307\u5411\uFF0C\u8BBF\u8C08\u9700\u770B\u6559\u5E08\u80FD\u5426\u8FDB\u4E00\u6B65\u5F00\u653E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q4-S4",
            "dimension": "C2 \u4ECB\u5165\u65F6\u673A",
            "name": "\u5373\u65F6\u8F7B\u4ECB\u5165\u4E0E\u540E\u7EED\u5206\u4EAB\u534F\u8C03",
            "definition": "\u5224\u65AD\u4F55\u65F6\u5F53\u4E0B\u6865\u63A5\u3001\u4F55\u65F6\u7EE7\u7EED\u89C2\u5BDF\u3001\u4F55\u65F6\u7528\u5206\u4EAB\u56DE\u987E\uFF1B\u4E0D\u80FD\u628A\u652F\u6301\u6574\u4F53\u5EF6\u540E\u5230\u4E0B\u4E00\u6B21\u3002",
            "diagnostic_meaning": "\u89E3\u91CAA\u6709\u4EF7\u503C\u800CD\u504F\u4F4E\u3002",
            "core": true,
            "prerequisites": [
              "Q4-S1"
            ],
            "allowed_actions": [
              "\u65F6\u673A\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u4E00\u5F8B\u5EF6\u540E"
            ],
            "default_priority": "P2",
            "empirical_relation": "A\u901A\u5E38\u4E2D\u9AD8\uFF0CD\u8F83\u5F31\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q4-S5",
            "dimension": "C2/\u5408\u4F5C",
            "name": "\u5171\u540C\u8BA1\u5212\u7684\u53EF\u4FEE\u8BA2\u6027\u4E0E\u540C\u4F34\u89C6\u89D2",
            "definition": "\u5171\u540C\u8BA1\u5212\u4E0D\u662F\u6210\u4EBA\u4EFB\u52A1\u6E05\u5355\uFF0C\u53EF\u5728\u540C\u4F34\u534F\u5546\u4E2D\u5438\u7EB3\u65B0\u6750\u6599\u548C\u65B0\u60F3\u6CD5\uFF0C\u5E76\u5173\u6CE8\u4F19\u4F34\u5206\u5DE5\u4E0E\u611F\u53D7\u3002",
            "diagnostic_meaning": "\u628A\u5408\u4F5C\u7406\u89E3\u4E3A\u5171\u540C\u5EFA\u6784\u800C\u975E\u670D\u4ECE\u8BA1\u5212\u3002",
            "core": true,
            "prerequisites": [
              "Q4-S1",
              "Q4-S2"
            ],
            "allowed_actions": [
              "\u89C6\u89D2\u8F6C\u6362/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u5F3A\u8C03\u5148\u5B8C\u6210\u8BA1\u5212"
            ],
            "default_priority": "P2",
            "empirical_relation": "C\u7684\u4E3B\u8981\u5C40\u9650\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q4-S6",
            "dimension": "C2 \u53CD\u601D",
            "name": "\u5206\u4EAB\u4E2D\u7684\u8BA1\u5212\u53CD\u601D",
            "definition": "\u540E\u7EED\u5206\u4EAB\u5E2E\u52A9\u5E7C\u513F\u56DE\u770B\u8BA1\u5212\u600E\u6837\u53D8\u5316\u3001\u65B0\u6750\u6599\u600E\u6837\u8FDB\u5165\u5171\u540C\u4F5C\u54C1\uFF0C\u800C\u975E\u53EA\u7528\u6765\u7EA0\u6B63\u504F\u79BB\u3002",
            "diagnostic_meaning": "\u4FDD\u7559A\u7684\u4E13\u4E1A\u4EF7\u503C\u3002",
            "core": false,
            "prerequisites": [
              "Q4-S4"
            ],
            "allowed_actions": [
              "\u53CD\u601D"
            ],
            "forbidden_actions": [
              "\u628A\u5206\u4EAB\u66FF\u4EE3\u5373\u65F6\u652F\u6301"
            ],
            "default_priority": "P3",
            "empirical_relation": "\u9AD8\u6C34\u5E73\u6269\u5C55\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q4",
        "anchors": [
          {
            "slot_id": "Q4-S1",
            "level_0": "\u53EA\u8BF4\u4E0D\u5408\u4F5C\u6216\u53EA\u8BF4\u6709\u521B\u9020\u6027\u3002",
            "level_1": "\u770B\u5230\u5176\u4E2D\u4E00\u9762\uFF0C\u53E6\u4E00\u9762\u8F83\u5F31\u3002",
            "level_2": "\u540C\u65F6\u8BC6\u522B\u521B\u9020\u6027\u63A2\u7D22\u4E0E\u5171\u540C\u8BA1\u5212\u8D23\u4EFB\uFF0C\u5E76\u63D0\u51FA\u9700\u770B\u6301\u7EED\u65F6\u95F4\u548C\u540C\u4F34\u5F71\u54CD\u3002",
            "level_3": "\u80FD\u5224\u65AD\u504F\u79BB\u662F\u751F\u6210\u6027\u521B\u65B0\u3001\u53EF\u6865\u63A5\u63A2\u7D22\u8FD8\u662F\u6301\u7EED\u8131\u79BB\u5171\u540C\u6D3B\u52A8\uFF0C\u5E76\u636E\u6B64\u8C03\u6574\u4ECB\u5165\u3002",
            "false_evidence": "\u2018\u90FD\u8981\u517C\u987E\u2019\u65E0\u5224\u65AD\u3002",
            "conflict_evidence": "\u8BA1\u5212\u4E00\u65E6\u5236\u5B9A\u4E0D\u80FD\u53D8\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q4-S2",
            "level_0": "\u53EA\u63D0\u9192\u56DE\u8BA1\u5212\u6216\u653E\u4EFB\u5230\u7ED3\u675F\u3002",
            "level_1": "\u80FD\u60F3\u5230\u628A\u6728\u677F\u653E\u56DE\u5927\u6865\uFF0C\u4F46\u7531\u6210\u4EBA\u6307\u5B9A\u3002",
            "level_2": "\u80FD\u7528\u5F00\u653E\u63D0\u95EE/\u5171\u540C\u60F3\u8C61\u8BA9\u777F\u777F\u548C\u540C\u4F34\u81EA\u5DF1\u51B3\u5B9A\u6728\u677F\u600E\u6837\u8FDB\u5165\u5171\u540C\u5EFA\u6784\u3002",
            "level_3": "\u80FD\u751F\u6210\u591A\u79CD\u6865\u63A5\u53EF\u80FD\u5E76\u6839\u636E\u4F19\u4F34\u56DE\u5E94\u5171\u540C\u4FEE\u8BA2\u4F5C\u54C1\u548C\u8BA1\u5212\u3002",
            "false_evidence": "\u76F4\u63A5\u8BF4\u2018\u5F53\u6865\u9762\u2019\u3002",
            "conflict_evidence": "\u6865\u63A5\u53EA\u662F\u547D\u4EE4\u5305\u88C5\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q4-S3",
            "level_0": "\u547D\u4EE4\u3001\u8BC4\u5224\u6216\u5B8C\u5168\u65C1\u89C2\u3002",
            "level_1": "\u4F1A\u7528\u63D0\u95EE\uFF0C\u4F46\u95EE\u9898\u53EA\u6709\u4E00\u4E2A\u6B63\u786E\u7B54\u6848\u3002",
            "level_2": "\u6559\u5E08\u4EE5\u9080\u8BF7/\u5171\u540C\u63A2\u7D22\u652F\u6301\u513F\u7AE5\u51B3\u7B56\uFF0C\u4FDD\u6301\u64CD\u4F5C\u548C\u65B9\u6848\u6743\u5728\u5E7C\u513F\u3002",
            "level_3": "\u80FD\u6839\u636E\u4E92\u52A8\u9700\u8981\u5728\u53C2\u4E0E\u2014\u9000\u51FA\u95F4\u8C03\u8282\uFF0C\u5E76\u8BA9\u540C\u4F34\u6210\u4E3A\u4E3B\u8981\u534F\u5546\u8005\u3002",
            "false_evidence": "\u6E29\u548C\u8BED\u6C14\u7684\u6307\u4EE4\u3002",
            "conflict_evidence": "\u6559\u5E08\u6210\u4E3A\u9879\u76EE\u8D1F\u8D23\u4EBA\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q4-S4",
            "level_0": "\u4E00\u5F8B\u9A6C\u4E0A\u7EA0\u6B63\u6216\u4E00\u5F8B\u7B49\u4E0B\u6B21\u3002",
            "level_1": "\u77E5\u9053\u53EF\u89C2\u5BDF/\u5206\u4EAB\uFF0C\u4F46\u65E0\u65F6\u673A\u6807\u51C6\u3002",
            "level_2": "\u4F9D\u636E\u540C\u4F34\u9700\u8981\u3001\u504F\u79BB\u6301\u7EED\u3001\u53EF\u6865\u63A5\u673A\u4F1A\u51B3\u5B9A\u8F7B\u4ECB\u5165\uFF0C\u5E76\u628A\u540E\u7EED\u5206\u4EAB\u4F5C\u4E3A\u53CD\u601D\u8865\u5145\u3002",
            "level_3": "\u80FD\u7528\u6700\u5C0F\u4ECB\u5165\u4FDD\u6301\u6E38\u620F\u6D41\uFF0C\u540C\u65F6\u628A\u5F53\u4E0B\u548C\u540E\u7EED\u5206\u4EAB\u7EC4\u6210\u8FDE\u7EED\u652F\u6301\u3002",
            "false_evidence": "\u7B49\u5F85\u672C\u8EAB\u88AB\u5F53\u5C0A\u91CD\u3002",
            "conflict_evidence": "\u5171\u540C\u6D3B\u52A8\u5DF2\u53D7\u5F71\u54CD\u4ECD\u5B8C\u5168\u4E0D\u4ECB\u5165\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q4-S5",
            "level_0": "\u628A\u8BA1\u5212\u89C6\u4E3A\u5FC5\u987B\u6267\u884C\u7684\u4EFB\u52A1\u5355\u3002",
            "level_1": "\u627F\u8BA4\u53EF\u4EE5\u53D8\uFF0C\u4F46\u7531\u6559\u5E08\u51B3\u5B9A\u5982\u4F55\u53D8\u3002",
            "level_2": "\u8BA4\u4E3A\u8BA1\u5212\u53EF\u7531\u5E7C\u513F\u5171\u540C\u4FEE\u8BA2\uFF0C\u5E76\u628A\u4F19\u4F34\u610F\u89C1/\u5206\u5DE5\u7EB3\u5165\u3002",
            "level_3": "\u80FD\u652F\u6301\u5C0F\u7EC4\u534F\u5546\u4E2A\u4F53\u521B\u610F\u4E0E\u5171\u540C\u76EE\u6807\uFF0C\u4F7F\u65B0\u60F3\u6CD5\u771F\u6B63\u6210\u4E3A\u5171\u540C\u51B3\u7B56\u3002",
            "false_evidence": "\u53EA\u95EE\u777F\u777F\uFF0C\u4E0D\u95EE\u4F19\u4F34\u3002",
            "conflict_evidence": "\u4EE5\u5408\u4F5C\u540D\u4E49\u538B\u5236\u4E2A\u4F53\u751F\u6210\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q4-S6",
            "level_0": "\u628A\u5206\u4EAB\u5F53\u6210\u552F\u4E00\u652F\u6301\uFF0C\u6216\u53EA\u7528\u5206\u4EAB\u7EA0\u6B63\u5E7C\u513F\u6CA1\u6709\u6309\u539F\u8BA1\u5212\u505A\u3002",
            "level_1": "\u4F1A\u5728\u5206\u4EAB\u4E2D\u56DE\u987E\uFF0C\u4F46\u4E3B\u8981\u7531\u6559\u5E08\u8BC4\u4EF7\u504F\u79BB\u6216\u7ED9\u51FA\u6B63\u786E\u6574\u5408\u65B9\u5F0F\u3002",
            "level_2": "\u80FD\u5F15\u5BFC\u5E7C\u513F\u56DE\u770B\u8BA1\u5212\u600E\u6837\u53D8\u5316\u3001\u65B0\u6750\u6599\u600E\u6837\u8FDB\u5165\u5171\u540C\u4F5C\u54C1\uFF0C\u5E76\u7EB3\u5165\u540C\u4F34\u89C6\u89D2\u3002",
            "level_3": "\u80FD\u628A\u5F53\u4E0B\u8F7B\u652F\u6301\u4E0E\u540E\u7EED\u5171\u540C\u53CD\u601D\u4E32\u8054\uFF0C\u4FC3\u6210\u5C0F\u7EC4\u57FA\u4E8E\u8BC1\u636E\u4FEE\u8BA2\u8BA1\u5212\uFF0C\u800C\u975E\u6062\u590D\u6210\u4EBA\u8BA4\u53EF\u7684\u539F\u6848\u3002",
            "false_evidence": "\u6D3B\u52A8\u540E\u63D0\u9192\u4E0B\u6B21\u6309\u8BA1\u5212\u3002",
            "conflict_evidence": "\u7528\u5206\u4EAB\u66FF\u4EE3\u5171\u540C\u6D3B\u52A8\u5DF2\u53D7\u5F71\u54CD\u65F6\u7684\u5373\u65F6\u652F\u6301\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q4",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ABACD",
            "hypothesis": "B\u9996\u3001A\u6B21\u3001C\u4E09\u3001D\u672B\uFF0C\u8868\u73B0\u51FA\u5373\u65F6\u6865\u63A5\u6700\u4F18\u5148\u3002",
            "target_slots": [
              "Q4-S2",
              "Q4-S3",
              "Q4-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB/\u5F00\u653E\u5316",
            "forbidden_question": "\u201CB\u5C31\u662F\u552F\u4E00\u6B63\u786E\u95EE\u6CD5\u5417\uFF1F\u201D",
            "rationale": "\u9A8C\u8BC1\u662F\u5426\u7406\u89E3B\u80CC\u540E\u7684\u6865\u63A5\u673A\u5236\uFF0C\u800C\u975E\u8BB0\u5FC6\u6865\u9762\u7B54\u6848\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206",
            "hypothesis": "\u591A\u4EE5B/A\u5C45\u524D\uFF0C\u6574\u4F53\u8F83\u6210\u719F\u4F46C\u4E0EA\u8FB9\u754C\u53EF\u80FD\u4E0D\u7A33\u3002",
            "target_slots": [
              "Q4-S4",
              "Q4-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u5BF9\u6BD4",
            "forbidden_question": "\u201C\u5148\u5B8C\u6210\u5171\u540C\u4EFB\u52A1\u5230\u5E95\u4EC0\u4E48\u65F6\u5019\u5408\u7406\uFF1F\u201D",
            "rationale": "\u5398\u6E05\u8BA1\u5212\u8D23\u4EFB\u4E0E\u7075\u6D3B\u6027\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u90E8\u5206\u91CD\u89C6\u521B\u9020/\u5408\u4F5C\uFF0C\u4F46\u6865\u63A5\u65B9\u5F0F\u6216\u65F6\u673A\u4E0D\u8DB3\u3002",
            "target_slots": [
              "Q4-S1",
              "Q4-S2"
            ],
            "priority": "P1",
            "preferred_action": "\u5177\u4F53\u5316",
            "forbidden_question": "\u201C\u600E\u4E48\u628A\u957F\u6728\u677F\u53D8\u6210\u5171\u540C\u8D44\u6E90\uFF1F\u201D",
            "rationale": "\u67E5\u4ECE\u4EF7\u503C\u53E3\u53F7\u5230\u7B56\u7565\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216D\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u2018\u4E0D\u4ECB\u5165\u2019\u7B49\u540C\u5C0A\u91CD\uFF0C\u6216\u8005\u652F\u6301\u5EF6\u8FDF\u3002",
            "target_slots": [
              "Q4-S1",
              "Q4-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u65F6\u673A\u53CD\u4F8B",
            "forbidden_question": "\u201C\u5982\u679C\u4F19\u4F34\u6B63\u7B49\u4ED6\u8D1F\u8D23\u7684\u4E00\u90E8\u5206\uFF0C\u8FD8\u7B49\u5230\u4E0B\u6B21\u5417\uFF1F\u201D",
            "rationale": "\u68C0\u9A8C\u540C\u4F34\u4E0E\u5373\u65F6\u5B66\u4E60\u673A\u4F1A\u3002",
            "calibration_note": ""
          },
          {
            "condition": "C\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u5171\u540C\u8BA1\u5212\u7406\u89E3\u6210\u6210\u4EBA\u4EFB\u52A1\u5B8C\u6210\u3002",
            "target_slots": [
              "Q4-S5",
              "Q4-S3"
            ],
            "priority": "P1",
            "preferred_action": "\u4EF7\u503C\u6743\u8861",
            "forbidden_question": "\u201C\u8BA1\u5212\u53EF\u4EE5\u88AB\u5E7C\u513F\u81EA\u5DF1\u6539\u5417\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u67E5\u5408\u4F5C\u2260\u670D\u4ECE\u3002",
            "calibration_note": ""
          },
          {
            "condition": "B\u5C45\u9996\u4F46\u7406\u7531\u662F\u2018\u8001\u5E08\u8981\u628A\u4ED6\u62C9\u56DE\u6765\u2019",
            "hypothesis": "\u8868\u9762\u9AD8\u5206\u4F46\u4ECD\u53EF\u80FD\u9AD8\u63A7\u5236\u3002",
            "target_slots": [
              "Q4-S2",
              "Q4-S3"
            ],
            "priority": "P1",
            "preferred_action": "\u8BDD\u672F\u6BD4\u8F83",
            "forbidden_question": "\u201C\u76F4\u63A5\u544A\u8BC9\u4ED6\u5F53\u6865\u9762\u662F\u4E0D\u662F\u6700\u5FEB\uFF1F\u201D",
            "rationale": "\u8BC6\u522B\u9AD8\u5206\u6392\u5E8F\u4E0B\u7684\u4E0D\u540C\u4E13\u4E1A\u6C34\u5E73\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q4",
        "probes": [
          {
            "slot_id": "Q4-S1",
            "allowed_actions": [
              "\u53CC\u9762\u6F84\u6E05"
            ],
            "preferred_action": "\u6F84\u6E05",
            "typical_question": "\u201C\u777F\u777F\u73A9\u957F\u6728\u677F\u8FD9\u4EF6\u4E8B\uFF0C\u60A8\u89C9\u5F97\u65E2\u8BF4\u660E\u4E86\u4EC0\u4E48\uFF0C\u53C8\u5E26\u6765\u4E86\u4EC0\u4E48\u95EE\u9898\uFF1F\u201D",
            "followup_question": "\u201C\u4ED6\u4E4B\u524D\u548C\u4F19\u4F34\u4E00\u8D77\u505A\u8FC7\u8BA1\u5212\uFF0C\u8FD9\u4E00\u70B9\u4F1A\u600E\u6837\u8FDB\u5165\u60A8\u7684\u5224\u65AD\uFF1F\u201D",
            "forbidden_actions": [
              "\u5355\u4E00\u6807\u7B7E"
            ],
            "forbidden_question": "\u201C\u4ED6\u662F\u4E0D\u662F\u4E0D\u5408\u4F5C\uFF1F\u201D",
            "non_inducing_boundary": "\u8BA9\u4E24\u7C7B\u4EF7\u503C\u540C\u65F6\u51FA\u73B0\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q4-S2",
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210"
            ],
            "preferred_action": "\u6865\u63A5",
            "typical_question": "\u201C\u5982\u679C\u987A\u7740\u4ED6\u5BF9\u6728\u677F\u7684\u65B0\u5174\u8DA3\uFF0C\u628A\u5B83\u53D8\u6210\u5C0F\u7EC4\u8D44\u6E90\uFF0C\u60A8\u4F1A\u600E\u4E48\u505A\uFF1F\u201D",
            "followup_question": "\u201C\u9664\u4E86\u6865\u9762\uFF0C\u8FD8\u53EF\u80FD\u600E\u6837\u8BA9\u4ED6\u548C\u4F19\u4F34\u4E00\u8D77\u51B3\u5B9A\uFF1F\u201D",
            "forbidden_actions": [
              "\u76F4\u63A5\u7ED9B\u7B54\u6848"
            ],
            "forbidden_question": "\u201C\u95EE\u4ED6\u80FD\u4E0D\u80FD\u5F53\u6865\u9762\u5C31\u884C\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u907F\u514D\u8BA9\u9898\u9762\u7B54\u6848\u4EE3\u66FF\u6559\u5E08\u751F\u6210\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q4-S3",
            "allowed_actions": [
              "\u8BDD\u672F\u6BD4\u8F83"
            ],
            "preferred_action": "\u4F4E\u63A7\u5236",
            "typical_question": "\u201C\u600E\u6837\u95EE\uFF0C\u65E2\u80FD\u63D0\u9192\u5171\u540C\u5EFA\u6784\uFF0C\u53C8\u4E0D\u628A\u6728\u677F\u7528\u9014\u66FF\u4ED6\u51B3\u5B9A\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u4ED6\u63D0\u51FA\u5B8C\u5168\u4E0D\u540C\u7684\u7528\u9014\uFF0C\u60A8\u600E\u4E48\u56DE\u5E94\uFF1F\u201D",
            "forbidden_actions": [
              "\u547D\u4EE4\u5F0F\u95EE\u53E5"
            ],
            "forbidden_question": "\u201C\u5148\u628A\u4EFB\u52A1\u5B8C\u6210\u518D\u73A9\uFF0C\u53EF\u4EE5\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u68C0\u67E5\u9009\u62E9\u6743\u548C\u540C\u4F34\u534F\u5546\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q4-S4",
            "allowed_actions": [
              "\u65F6\u673A\u8FB9\u754C"
            ],
            "preferred_action": "\u65F6\u673A",
            "typical_question": "\u201C\u4EC0\u4E48\u60C5\u51B5\u4E0B\u60A8\u4F1A\u73B0\u5728\u4ECB\u5165\uFF0C\u4EC0\u4E48\u60C5\u51B5\u4E0B\u4F1A\u7559\u5230\u5206\u4EAB\u65F6\u518D\u8C08\uFF1F\u201D",
            "followup_question": "\u201C\u4F19\u4F34\u5DF2\u7ECF\u660E\u663E\u53D7\u5F71\u54CD\u65F6\u4F1A\u53D8\u5316\u5417\uFF1F\u201D",
            "forbidden_actions": [
              "\u4E00\u5F8B\u5EF6\u540E"
            ],
            "forbidden_question": "\u201C\u7B49\u5206\u4EAB\u6700\u5C0A\u91CD\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5373\u65F6\u652F\u6301\u4E0E\u53CD\u601D\u4E92\u8865\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q4-S5",
            "allowed_actions": [
              "\u89C6\u89D2\u8F6C\u6362"
            ],
            "preferred_action": "\u5408\u4F5C/\u8BA1\u5212",
            "typical_question": "\u201C\u5982\u679C\u628A\u8FD9\u4EF6\u4E8B\u95EE\u53E6\u5916\u51E0\u4E2A\u642D\u6865\u7684\u5E7C\u513F\uFF0C\u4ED6\u4EEC\u7684\u9700\u8981\u4F1A\u5F71\u54CD\u60A8\u7684\u505A\u6CD5\u5417\uFF1F\u201D",
            "followup_question": "\u201C\u5171\u540C\u8BA1\u5212\u80FD\u4E0D\u80FD\u5728\u6E38\u620F\u4E2D\u88AB\u6539\uFF1F\u201D",
            "forbidden_actions": [
              "\u6210\u4EBA\u4EFB\u52A1\u5316"
            ],
            "forbidden_question": "\u201C\u8BA1\u5212\u5B9A\u4E86\u5C31\u5E94\u8BE5\u5B8C\u6210\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u68C0\u9A8C\u5171\u540C\u5EFA\u6784\u903B\u8F91\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q4-S6",
            "allowed_actions": [
              "\u53CD\u601D\uFF0C\u65F6\u673A\u8FDE\u63A5"
            ],
            "preferred_action": "\u8BA1\u5212\u53CD\u601D",
            "typical_question": "\u201C\u5982\u679C\u5728\u540E\u7EED\u5206\u4EAB\u4E2D\u56DE\u770B\u8FD9\u4EF6\u4E8B\uFF0C\u60A8\u4F1A\u600E\u6837\u5E2E\u52A9\u5B69\u5B50\u4EEC\u7406\u89E3\u8BA1\u5212\u662F\u600E\u6837\u53D8\u5316\u7684\uFF1F\u201D",
            "followup_question": "\u201C\u5F53\u4E0B\u5DF2\u7ECF\u9700\u8981\u8F7B\u4ECB\u5165\u65F6\uFF0C\u5206\u4EAB\u8FD8\u80FD\u627F\u62C5\u4EC0\u4E48\u3001\u4E0D\u80FD\u66FF\u4EE3\u4EC0\u4E48\uFF1F\u201D",
            "forbidden_actions": [
              "\u5EF6\u540E\u66FF\u4EE3"
            ],
            "forbidden_question": "\u201C\u7B49\u5206\u4EAB\u65F6\u518D\u7EA0\u6B63\u4ED6\u6CA1\u6309\u8BA1\u5212\u505A\u5C31\u53EF\u4EE5\u4E86\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5206\u4EAB\u7528\u4E8E\u5171\u540C\u56DE\u770B\u4E0E\u4FEE\u8BA2\uFF0C\u4E0D\u66FF\u4EE3\u5FC5\u8981\u7684\u5373\u65F6\u652F\u6301\uFF0C\u4E5F\u4E0D\u6062\u590D\u6210\u4EBA\u9884\u8BBE\u7684\u539F\u6848\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q4",
        "rules": [
          {
            "scope": "Q4-S1 \u53CC\u91CD\u7406\u89E3",
            "sufficient_condition": "\u80FD\u540C\u65F6\u8BC6\u522B\u4E2A\u4F53\u63A2\u7D22\u548C\u5171\u540C\u8BA1\u5212/\u540C\u4F34\u9700\u8981\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u5355\u4E00\u4EF7\u503C\u5219\u6362\u53CD\u4F8B\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u7B56\u7565\u53EA\u987E\u4E00\u7AEF\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ4-S2\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u2018\u517C\u987E\u2019\u65E0\u5177\u4F53\u673A\u5236\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q4-S2~S3 \u6865\u63A5/\u89D2\u8272",
            "sufficient_condition": "\u80FD\u751F\u6210\u81F3\u5C111\u4E2A\u5F00\u653E\u6865\u63A5\u65B9\u5F0F\uFF0C\u5E76\u4FDD\u6301\u513F\u7AE5/\u540C\u4F34\u51B3\u7B56\u6743\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u590D\u8FF0B\u9009\u9879\u5219\u8BB0\u5F55\u4F9D\u8D56\u9898\u9762\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u540C\u4F34\u53CD\u5E94\u4F7F\u65B9\u6848\u5931\u6548\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ4-S4\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u6865\u9762\u7531\u6559\u5E08\u6307\u5B9A\u3001\u513F\u7AE5\u65E0\u9009\u62E9\u65F6\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q4-S4~S5 \u65F6\u673A/\u8BA1\u5212",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u5373\u65F6\u8F7B\u4ECB\u5165\u4E0E\u540E\u7EED\u53CD\u601D\u5404\u81EA\u529F\u80FD\uFF0C\u4E14\u8BA1\u5212\u53EF\u7531\u5C0F\u7EC4\u534F\u5546\u4FEE\u8BA2\u3002",
            "no_gain_threshold": "1\u20142\u8F6E\u65E0\u65B0\u589E\u526A\u679D\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u51FA\u73B0\u2018\u5FC5\u987B\u5148\u5B8C\u6210\u2019\u6216\u2018\u5B8C\u5168\u4E0D\u7BA1\u2019\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ4-S6\uFF08\u9700\u8981\u540E\u7EED\u5206\u4EAB\u53CD\u601D\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u4E0E\u6838\u5FC3\u5171\u540C\u6EE1\u8DB3\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u5FFD\u89C6\u540C\u4F34\u5F71\u54CD\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q4-S6 \u5206\u4EAB\u53CD\u601D",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u5206\u4EAB\u7528\u4E8E\u56DE\u770B\u8BA1\u5212\u53D8\u5316\u3001\u65B0\u6750\u6599\u8FDB\u5165\u5171\u540C\u4F5C\u54C1\u4E0E\u540C\u4F34\u534F\u5546\uFF0C\u5E76\u4E14\u4E0D\u66FF\u4EE3\u5FC5\u8981\u7684\u5373\u65F6\u652F\u6301\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u2018\u5206\u4EAB\u65F6\u7EA0\u6B63\u2019\u3001\u65E0\u65B0\u589E\u8BC1\u636E\u5219\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u5F53\u524D\u60C5\u5883\u6CA1\u6709\u540E\u7EED\u5206\u4EAB\u9700\u8981\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u53C8\u7528\u5206\u4EAB\u7EA0\u504F\u3001\u6062\u590D\u539F\u8BA1\u5212\u6216\u628A\u5168\u90E8\u652F\u6301\u5EF6\u540E\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u4E0D\u5F97\u7528\u540E\u7EED\u5206\u4EAB\u66FF\u4EE3\u5171\u540C\u6D3B\u52A8\u5DF2\u53D7\u5F71\u54CD\u65F6\u7684\u5373\u65F6\u652F\u6301\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q4-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u53CC\u91CD\u7406\u89E3\u2014\u5174\u8DA3\u6865\u63A5\u2014\u4F4E\u63A7\u5236\u534F\u5546\u2014\u5373\u65F6/\u540E\u7EED\u534F\u8C03\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4F4E\u589E\u76CA\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u65E0\u6CD5\u89E3\u91CAB\u9AD8\u5206\u7684\u4E13\u4E1A\u673A\u5236\u65F6\u4E0D\u5B9C\u8FC7\u65E9\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q4",
        "title": "\u672A\u53C2\u4E0E\u5C0F\u7EC4\u5EFA\u6784",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\uFF5C\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u7406\u89E3\u5E7C\u513F\u4E2A\u4F53\u5174\u8DA3\u4E0E\u5C0F\u7EC4\u5171\u540C\u4EFB\u52A1\u4E4B\u95F4\u7684\u5173\u7CFB\uFF0C\u5E76\u4EE5\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u7684\u65B9\u5F0F\u628A\u4E2A\u4EBA\u53D1\u73B0\u8F6C\u5316\u4E3A\u5171\u540C\u5EFA\u6784\u8D44\u6E90\u3002",
        "empirical": {
          "0": [
            "CDAB",
            "DCAB"
          ],
          "1": [
            "ACDB",
            "ADCB",
            "CADB",
            "CBDA",
            "CDBA",
            "DABC",
            "DACB",
            "DCBA"
          ],
          "2": [
            "ACBD",
            "ADBC",
            "BCDA",
            "BDAC",
            "BDCA",
            "CABD",
            "CBAD",
            "DBAC",
            "DBCA"
          ],
          "3": [
            "ABCD",
            "ABDC",
            "BADC",
            "BCAD"
          ],
          "4": [
            "BACD"
          ]
        },
        "scoring_note": "\u552F\u4E004\u5206\u4E3ABACD\uFF0C3\u5206\u4E5F\u591A\u4EE5B\u6216A\u5C45\u524D\uFF1BD\u901A\u5E38\u9760\u540E\u3002\u8BF4\u660E\u9AD8\u6C34\u5E73\u6700\u91CD\u89C6\u628A\u5E7C\u513F\u5BF9\u957F\u6728\u677F\u7684\u65B0\u5174\u8DA3\u5373\u65F6\u6865\u63A5\u56DE\u5171\u540C\u5EFA\u6784\uFF0C\u540C\u65F6\u4FDD\u7559\u89C2\u5BDF/\u540E\u7EED\u5206\u4EAB\u4EF7\u503C\uFF1B\u5355\u7EAF\u5EF6\u540E\u5230\u4E0B\u4E00\u6B21\u6D3B\u52A8\u7684\u652F\u6301\u4EF7\u503C\u8F83\u4F4E\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q5": {
      "item_id": "Q5",
      "title": "\u6D88\u9632\u5458\u6551\u706B\u5F00\u5FC3",
      "ontology": {
        "item_id": "Q5",
        "title": "\u6D88\u9632\u5458\u6551\u706B\u5F00\u5FC3",
        "stem": "\u8FD1\u51E0\u5929\uFF0C\u4E2D\u73ED\u7684\u5E7C\u513F\u5341\u5206\u70ED\u8877\u4E8E\u5728\u533A\u57DF\u6E38\u620F\u65F6\u95F4\u73A9\u201C\u6D88\u9632\u5458\u6551\u706B\u201D\u7684\u6E38\u620F\u3002\u6E38\u620F\u7ED3\u675F\u540E\u7684\u4EA4\u6D41\u6D3B\u52A8\u4E2D\uFF0C\u8001\u5E08\u95EE\u5E7C\u513F\u6700\u60F3\u5206\u4EAB\u4EC0\u4E48\u65F6\uFF0C\u9633\u9633\u8BF4\u201C\u5A03\u5A03\u5BB6\u7740\u706B\u4E86\uFF0C\u597D\u5F00\u5FC3\u554A\uFF01\u201D\u3002",
        "options": {
          "A": "\u6293\u4F4F\u6559\u80B2\u5951\u673A\uFF0C\u5411\u5E7C\u513F\u8010\u5FC3\u89E3\u91CA\u771F\u5B9E\u7684\u706B\u707E\u4F1A\u9020\u6210\u7269\u54C1\u635F\u5931\u548C\u4EBA\u5458\u4F24\u4EA1\u3002",
          "B": "\u8BE2\u95EE\u5E7C\u513F\u5F00\u5FC3\u7684\u662F\u201C\u7740\u706B\u201D\u672C\u8EAB\uFF0C\u8FD8\u662F\u6D88\u9632\u5458\u6210\u529F\u6551\u706B\u3001\u5A03\u5A03\u5BB6\u7684\u4EBA\u5F97\u6551\uFF1F",
          "C": "\u5F15\u5BFC\u5E7C\u513F\u601D\u8003\u201C\u5A03\u5A03\u5BB6\u7740\u706B\u201D\u503C\u4E0D\u503C\u5F97\u5F00\u5FC3\uFF0C\u5E2E\u52A9\u4ED6\u4EEC\u8BA4\u8BC6\u771F\u5B9E\u706B\u707E\u662F\u5371\u9669\u7684\u3002",
          "D": "\u8BF7\u9633\u9633\u8BB2\u8BB2\u5A03\u5A03\u5BB6\u7740\u706B\u540E\u53D1\u751F\u4E86\u4EC0\u4E48\u3001\u4E3A\u4EC0\u4E48\u5F00\u5FC3\uFF0C\u501F\u6B64\u7406\u89E3\u5E7C\u513F\u7684\u6E38\u620F\u4F53\u9A8C\u3002"
        },
        "primary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3\uFF5C\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3",
        "secondary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u4EF7\u503C\u5B9E\u73B0\u7684\u8BA4\u8BC6\uFF5C\u5BF9\u6E38\u620F\u4EF7\u503C\u53D1\u6325\u673A\u5236\u548C\u89C4\u5F8B\u7684\u8BA4\u8BC6",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u533A\u5206\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\u4F53\u9A8C\u3001\u60C5\u8282\u8868\u8FBE\u4E0E\u6210\u4EBA\u73B0\u5B9E\u4EF7\u503C\u5224\u65AD\uFF0C\u5148\u7406\u89E3\u6E38\u620F\u610F\u4E49\uFF0C\u518D\u4EE5\u53D1\u5C55\u9002\u5B9C\u7684\u65B9\u5F0F\u8FDB\u884C\u5B89\u5168\u548C\u4EF7\u503C\u6F84\u6E05\u3002",
        "slots": [
          {
            "slot_id": "Q5-S1",
            "dimension": "A1 \u6E38\u620F\u7279\u70B9",
            "name": "\u6E38\u620F\u6846\u67B6\u4E0E\u73B0\u5B9E\u903B\u8F91\u533A\u5206",
            "definition": "\u628A\u2018\u7740\u706B\u597D\u5F00\u5FC3\u2019\u653E\u5728\u6D88\u9632\u5458\u89D2\u8272\u6E38\u620F\u3001\u60C5\u8282\u5F20\u529B\u548C\u6551\u63F4\u6210\u529F\u7684\u6E38\u620F\u6846\u67B6\u4E2D\u7406\u89E3\uFF0C\u4E0D\u76F4\u63A5\u7B49\u540C\u73B0\u5B9E\u4EF7\u503C\u5224\u65AD\u3002",
            "diagnostic_meaning": "\u5BF9\u5E94\u4E3B\u6307\u6807\u2018\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7406\u89E3\u2019\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u6F84\u6E05/\u53CD\u4F8B"
            ],
            "forbidden_actions": [
              "\u7ACB\u5373\u9053\u5FB7\u7EA0\u504F"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u5B9E\u8BC1B/D\u5C45\u524D\u3001C\u9760\u540E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q5-S2",
            "dimension": "A1/C1 \u7406\u89E3",
            "name": "\u6709\u9488\u5BF9\u6027\u7684\u610F\u4E49\u6F84\u6E05",
            "definition": "\u53EF\u4EE5\u7528B\u5F0F\u5BF9\u6BD4\u5E2E\u52A9\u533A\u5206\u5F00\u5FC3\u5BF9\u8C61\uFF0C\u4F46\u5E94\u5141\u8BB8\u5E7C\u513F\u8BF4\u2018\u90FD\u4E0D\u662F\u2019\u6216\u63D0\u51FA\u7B2C\u4E09\u79CD\u89E3\u91CA\uFF0C\u907F\u514D\u628A\u5BF9\u6BD4\u53D8\u6210\u6B63\u786E\u7B54\u6848\u63D0\u793A\u3002",
            "diagnostic_meaning": "\u5C0A\u91CD\u5B9E\u8BC1B\u9996\u4F18\u52BF\uFF0C\u540C\u65F6\u4FDD\u7559\u975E\u8BF1\u5BFC\u539F\u5219\u3002",
            "core": true,
            "prerequisites": [
              "Q5-S1"
            ],
            "allowed_actions": [
              "\u805A\u7126\u6F84\u6E05/\u590D\u8FF0\u786E\u8BA4"
            ],
            "forbidden_actions": [
              "\u5F3A\u5236\u4E8C\u9009\u4E00"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u552F\u4E004\u5206BDAC\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q5-S3",
            "dimension": "C1 \u6E38\u620F\u7406\u89E3",
            "name": "\u5F00\u653E\u53D9\u4E8B\u7406\u89E3",
            "definition": "\u901A\u8FC7\u2018\u53D1\u751F\u4E86\u4EC0\u4E48\u3001\u4E3A\u4EC0\u4E48\u5F00\u5FC3\u3001\u6700\u559C\u6B22\u54EA\u6BB5\u2019\u7B49\u95EE\u9898\u83B7\u53D6\u5E7C\u513F\u89D2\u8272\u3001\u60C5\u8282\u3001\u540C\u4F34\u4E92\u52A8\u548C\u6210\u529F\u611F\u8BC1\u636E\u3002",
            "diagnostic_meaning": "\u8865\u5145B\u5F0F\u5FEB\u901F\u6F84\u6E05\u7684\u5F00\u653E\u6027\u3002",
            "core": true,
            "prerequisites": [
              "Q5-S1"
            ],
            "allowed_actions": [
              "\u53D9\u4E8B\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u5148\u89E3\u91CA\u513F\u7AE5\u4F53\u9A8C"
            ],
            "default_priority": "P1",
            "empirical_relation": "D\u7A33\u5B9A\u5904\u4E8E\u9AD8\u5206\u524D\u90E8\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q5-S4",
            "dimension": "A3 \u4EF7\u503C\u5B9E\u73B0",
            "name": "\u5B89\u5168/\u4EF7\u503C\u652F\u6301\u7684\u8BC1\u636E\u4E0E\u65F6\u673A",
            "definition": "\u53EA\u6709\u5728\u53D1\u73B0\u5E7C\u513F\u786E\u5B9E\u6DF7\u6DC6\u73B0\u5B9E\u706B\u707E\u5371\u9669\u65F6\uFF0C\u518D\u505A\u5FC5\u8981\u4E8B\u5B9E\u6F84\u6E05\uFF1B\u53EF\u901A\u8FC7\u6E38\u620F\u5EF6\u4F38\u5B9E\u73B0\uFF0C\u800C\u975E\u6BCF\u6B21\u90FD\u7ACB\u5373\u4E0A\u5B89\u5168\u8BFE\u3002",
            "diagnostic_meaning": "\u5BF9\u5E94\u6B21\u6307\u6807\u2018\u6E38\u620F\u4EF7\u503C\u5B9E\u73B0\u7684\u89C4\u5F8B\u2019\u3002",
            "core": true,
            "prerequisites": [
              "Q5-S2",
              "Q5-S3"
            ],
            "allowed_actions": [
              "\u6761\u4EF6\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u6559\u80B2\u5951\u673A\u81EA\u52A8\u5316"
            ],
            "default_priority": "P1",
            "empirical_relation": "A\u901A\u5E38\u4E2D\u4F4D\uFF0CC\u4EF7\u503C\u5224\u65AD\u66F4\u4F4E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q5-S5",
            "dimension": "A1/\u5173\u7CFB\u4F26\u7406",
            "name": "\u975E\u8BC4\u4EF7\u6027\u4EF7\u503C\u6C9F\u901A",
            "definition": "\u4E0D\u8981\u6C42\u5E7C\u513F\u627F\u8BA4\u2018\u5F00\u5FC3\u662F\u4E0D\u5BF9\u7684\u2019\uFF0C\u4E0D\u7F9E\u8FB1\u3001\u4E0D\u8D34\u6807\u7B7E\uFF1B\u8BA8\u8BBA\u73B0\u5B9E\u5371\u9669\u9488\u5BF9\u4E8B\u5B9E\u800C\u975E\u60C5\u7EEA\u548C\u4EBA\u683C\u3002",
            "diagnostic_meaning": "\u4FDD\u8BC1\u771F\u5B9E\u8868\u8FBE\u548C\u6E38\u620F\u5206\u4EAB\u7684\u6301\u7EED\u6027\u3002",
            "core": true,
            "prerequisites": [
              "Q5-S4"
            ],
            "allowed_actions": [
              "\u8BDD\u672F\u6BD4\u8F83"
            ],
            "forbidden_actions": [
              "\u2018\u503C\u4E0D\u503C\u5F97\u5F00\u5FC3\u2019\u5F0F\u5BA1\u5224"
            ],
            "default_priority": "P2",
            "empirical_relation": "C\u57280\u5206\u7EC4\u5408\u9891\u7E41\u51FA\u73B0\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q5-S6",
            "dimension": "A3 \u6E38\u620F\u5EF6\u4F38",
            "name": "\u628A\u5B89\u5168\u7ECF\u9A8C\u8F6C\u5316\u4E3A\u6E38\u620F\u53D1\u5C55",
            "definition": "\u5728\u7406\u89E3\u513F\u7AE5\u5174\u8DA3\u540E\uFF0C\u53EF\u6269\u5C55\u62A5\u8B66\u3001\u758F\u6563\u3001\u6551\u63F4\u3001\u7167\u987E\u4F24\u5458\u3001\u91CD\u5EFA\u7B49\u60C5\u8282\uFF0C\u8BA9\u5B89\u5168\u7ECF\u9A8C\u8FDB\u5165\u6E38\u620F\u800C\u4E0D\u66FF\u4EE3\u6E38\u620F\u3002",
            "diagnostic_meaning": "\u4F53\u73B0\u6E38\u620F\u4EF7\u503C\u7684\u6E10\u8FDB\u5B9E\u73B0\u3002",
            "core": false,
            "prerequisites": [
              "Q5-S3",
              "Q5-S4"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u628A\u6E38\u620F\u53D8\u77E5\u8BC6\u8BFE"
            ],
            "default_priority": "P3",
            "empirical_relation": "\u9AD8\u6C34\u5E73\u6269\u5C55\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q5",
        "anchors": [
          {
            "slot_id": "Q5-S1",
            "level_0": "\u76F4\u63A5\u8BA4\u4E3A\u5E7C\u513F\u4E3A\u706B\u707E\u5F00\u5FC3\uFF0C\u4EF7\u503C\u89C2\u6709\u95EE\u9898\u3002",
            "level_1": "\u77E5\u9053\u662F\u5728\u6E38\u620F\uFF0C\u4F46\u4ECD\u6025\u4E8E\u7EA0\u6B63\u73B0\u5B9E\u5371\u9669\u3002",
            "level_2": "\u660E\u786E\u533A\u5206\u5047\u88C5\u6E38\u620F\u4F53\u9A8C\u4E0E\u73B0\u5B9E\u6001\u5EA6\uFF0C\u5148\u7406\u89E3\u89D2\u8272/\u60C5\u8282\u610F\u4E49\u3002",
            "level_3": "\u80FD\u8BF4\u660E\u5371\u9669\u60C5\u8282\u53EF\u4EA7\u751F\u6E38\u620F\u5F20\u529B\uFF0C\u5E76\u7528\u540E\u7EED\u8868\u8FBE\u5224\u65AD\u662F\u5426\u5B58\u5728\u73B0\u5B9E\u6982\u5FF5\u8BEF\u89E3\u3002",
            "false_evidence": "\u6E38\u620F\u5C31\u662F\u6E38\u620F\u3001\u5B8C\u5168\u4E0D\u7528\u7BA1\u5B89\u5168\u3002",
            "conflict_evidence": "\u627F\u8BA4\u662F\u5047\u88C5\u53C8\u7ACB\u523B\u9053\u5FB7\u7EA0\u504F\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q5-S2",
            "level_0": "\u76F4\u63A5\u544A\u8BC9\u5E7C\u513F\u6B63\u786E\u7406\u89E3\uFF0C\u6216\u7528\u5F3A\u5236\u4E8C\u9009\u4E00\u6697\u793A\u3002",
            "level_1": "\u80FD\u7528B\u5F0F\u5BF9\u6BD4\uFF0C\u4F46\u4E0D\u5141\u8BB8\u7B2C\u4E09\u79CD\u89E3\u91CA\u3002",
            "level_2": "\u7528\u2018\u7740\u706B\u672C\u8EAB/\u6551\u63F4\u6210\u529F/\u8FD8\u6709\u522B\u7684\u539F\u56E0\u5417\u2019\u4F5C\u805A\u7126\u6F84\u6E05\uFF0C\u5E76\u5141\u8BB8\u5E7C\u513F\u4FEE\u6B63\u6559\u5E08\u7406\u89E3\u3002",
            "level_3": "\u80FD\u6839\u636E\u513F\u7AE5\u524D\u4E00\u8F6E\u53D9\u4E8B\u51B3\u5B9A\u662F\u5426\u9700\u8981\u5BF9\u6BD4\uFF0C\u4F18\u5148\u4F7F\u7528\u513F\u7AE5\u81EA\u5DF1\u7684\u8BCD\u8BED\u505A\u590D\u8FF0\u786E\u8BA4\u3002",
            "false_evidence": "\u8FDE\u7EED\u662F\u4E0D\u662F\u5F0F\u63D0\u95EE\u3002",
            "conflict_evidence": "\u513F\u7AE5\u5426\u8BA4\u540E\u4ECD\u575A\u6301\u6559\u5E08\u89E3\u91CA\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q5-S3",
            "level_0": "\u4E0D\u95EE\u539F\u56E0\uFF0C\u76F4\u63A5\u6559\u80B2\u3002",
            "level_1": "\u4F1A\u95EE\u4E3A\u4EC0\u4E48\uFF0C\u4F46\u5F88\u5FEB\u8F6C\u56DE\u6210\u4EBA\u89E3\u91CA\u3002",
            "level_2": "\u80FD\u901A\u8FC7\u4E8B\u4EF6\u8FC7\u7A0B\u3001\u89D2\u8272\u884C\u4E3A\u3001\u6700\u559C\u6B22\u90E8\u5206\u7B49\u5F00\u653E\u95EE\u9898\u83B7\u5F97\u5E7C\u513F\u53D9\u4E8B\u3002",
            "level_3": "\u80FD\u4ECE\u53D9\u4E8B\u4E2D\u8BC6\u522B\u89D2\u8272\u3001\u6551\u63F4\u6210\u529F\u3001\u523A\u6FC0\u3001\u540C\u4F34\u5408\u4F5C\u7B49\u6765\u6E90\uFF0C\u5E76\u636E\u6B64\u51B3\u5B9A\u4E0B\u4E00\u6B65\u3002",
            "false_evidence": "\u5F00\u653E\u95EE\u540E\u4E0D\u542C\u56DE\u7B54\u3002",
            "conflict_evidence": "\u7406\u8BBA\u672F\u8BED\u66FF\u4EE3\u513F\u7AE5\u8BC1\u636E\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q5-S4",
            "level_0": "\u65E0\u8BBA\u513F\u7AE5\u7406\u89E3\u5982\u4F55\u90FD\u9A6C\u4E0A\u8BB2\u5371\u5BB3\u3002",
            "level_1": "\u5148\u542C\u4E00\u542C\uFF0C\u4F46\u9ED8\u8BA4\u6700\u540E\u5FC5\u987B\u7EA0\u6B63\u3002",
            "level_2": "\u4F9D\u636E\u513F\u7AE5\u662F\u5426\u771F\u6B63\u8BEF\u89E3\u73B0\u5B9E\u5371\u9669\u51B3\u5B9A\u662F\u5426\u6F84\u6E05\uFF0C\u5E76\u5C3D\u91CF\u5D4C\u5165\u6E38\u620F\u6216\u5171\u540C\u8BA8\u8BBA\u3002",
            "level_3": "\u80FD\u533A\u5206\u559C\u6B22\u5371\u9669\u60C5\u8282\u4E0E\u4E0D\u4E86\u89E3\u73B0\u5B9E\u5371\u9669\uFF0C\u53EA\u5BF9\u540E\u8005\u63D0\u4F9B\u6700\u5C0F\u5FC5\u8981\u4E8B\u5B9E\u652F\u6301\u3002",
            "false_evidence": "\u5B8C\u5168\u56DE\u907F\u5B89\u5168\u3002",
            "conflict_evidence": "\u4EFB\u4F55\u6D88\u9632\u6E38\u620F\u90FD\u53D8\u5B89\u5168\u8BFE\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q5-S5",
            "level_0": "\u4F7F\u7528\u2018\u4E0D\u5E94\u8BE5\u5F00\u5FC3\u3001\u503C\u4E0D\u503C\u5F97\u5F00\u5FC3\u2019\u7B49\u8BC4\u4EF7\u3002",
            "level_1": "\u8BED\u6C14\u6E29\u548C\u4F46\u4ECD\u8981\u6C42\u513F\u7AE5\u7ED9\u51FA\u6210\u4EBA\u671F\u5F85\u7B54\u6848\u3002",
            "level_2": "\u9488\u5BF9\u73B0\u5B9E\u4E8B\u5B9E\u8BF4\u660E\u5371\u9669\uFF0C\u4E0D\u8BC4\u4EF7\u513F\u7AE5\u7684\u6E38\u620F\u60C5\u7EEA\uFF0C\u5141\u8BB8\u7EE7\u7EED\u8868\u8FBE\u3002",
            "level_3": "\u5B89\u5168\u652F\u6301\u540E\u4ECD\u80FD\u4FDD\u6301\u513F\u7AE5\u5206\u4EAB\u610F\u613F\uFF0C\u5E76\u628A\u65B0\u7406\u89E3\u5E26\u56DE\u6E38\u620F\u53D1\u5C55\u3002",
            "false_evidence": "\u67D4\u548C\u8BED\u6C14\u7684\u9053\u5FB7\u5BA1\u5224\u3002",
            "conflict_evidence": "\u8981\u6C42\u627F\u8BA4\u2018\u6211\u9519\u4E86\u2019\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q5-S6",
            "level_0": "\u628A\u6D88\u9632\u6E38\u620F\u6539\u9020\u6210\u6210\u4EBA\u8BB2\u6388\u7684\u5B89\u5168\u77E5\u8BC6\u8BFE\u3002",
            "level_1": "\u80FD\u589E\u52A0\u5B89\u5168\u60C5\u8282\uFF0C\u4F46\u4E3B\u8981\u7531\u6559\u5E08\u9884\u8BBE\uFF0C\u513F\u7AE5\u5174\u8DA3\u4E0E\u53D9\u4E8B\u6CA1\u6709\u8FDB\u5165\u3002",
            "level_2": "\u5728\u7406\u89E3\u5E7C\u513F\u5174\u8DA3\u540E\uFF0C\u628A\u62A5\u8B66\u3001\u758F\u6563\u3001\u6551\u63F4\u6216\u7167\u987E\u4F24\u5458\u7B49\u5B89\u5168\u7ECF\u9A8C\u5D4C\u5165\u6E38\u620F\uFF0C\u5E76\u7531\u5E7C\u513F\u9009\u62E9\u5982\u4F55\u53D1\u5C55\u3002",
            "level_3": "\u80FD\u4F9D\u636E\u5E7C\u513F\u65B0\u7684\u6E38\u620F\u8868\u73B0\u6301\u7EED\u751F\u6210\u548C\u8C03\u6574\u60C5\u8282\uFF0C\u4F7F\u5B89\u5168\u7406\u89E3\u3001\u89D2\u8272\u5408\u4F5C\u4E0E\u6E38\u620F\u53D1\u5C55\u76F8\u4E92\u4FC3\u8FDB\u3002",
            "false_evidence": "\u591A\u8BB2\u6D88\u9632\u77E5\u8BC6\u5C31\u662F\u5EF6\u4F38\u3002",
            "conflict_evidence": "\u5E7C\u513F\u4E0D\u518D\u4E3B\u5BFC\uFF0C\u6E38\u620F\u88AB\u95EE\u7B54\u3001\u6F14\u7EC3\u6216\u8BF4\u6559\u53D6\u4EE3\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q5",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ABDAC",
            "hypothesis": "B\u9996\u3001D\u6B21\u3001A\u4E09\u3001C\u672B\u3002",
            "target_slots": [
              "Q5-S1",
              "Q5-S2",
              "Q5-S3"
            ],
            "priority": "P2",
            "preferred_action": "\u95EE\u6CD5\u8D28\u91CF/\u8FC1\u79FB",
            "forbidden_question": "\u201CB\u65E2\u71364\u5206\uFF0C\u5C31\u53EA\u80FD\u7528\u4E8C\u9009\u4E00\u3002\u201D",
            "rationale": "\u9A8C\u8BC1\u805A\u7126\u6F84\u6E05\u662F\u5426\u4ECD\u4FDD\u7559\u7B2C\u4E09\u89E3\u91CA\u548C\u513F\u7AE5\u4FEE\u6B63\u6743\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206\uFF1ABACD/BADC/BDCA/DBAC",
            "hypothesis": "B/D\u7A33\u5B9A\u5C45\u524D\uFF0CA/C\u5148\u540E\u6709\u5DEE\u5F02\u3002",
            "target_slots": [
              "Q5-S2",
              "Q5-S4",
              "Q5-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u6761\u4EF6\u8FB9\u754C",
            "forbidden_question": "\u201C\u6700\u540E\u90FD\u8981\u8BB2\u771F\u5B9E\u706B\u707E\u5371\u9669\u5417\uFF1F\u201D",
            "rationale": "\u67E5\u5B89\u5168\u6559\u80B2\u662F\u5426\u8BC1\u636E\u9A71\u52A8\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u5DF2\u6709\u90E8\u5206\u6E38\u620F\u6846\u67B6\u7406\u89E3\uFF0C\u4F46\u805A\u7126\u6F84\u6E05\u3001\u5F00\u653E\u53D9\u4E8B\u6216\u4EF7\u503C\u8FB9\u754C\u4E0D\u7A33\u5B9A\u3002",
            "target_slots": [
              "Q5-S1",
              "Q5-S3",
              "Q5-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u5177\u4F53\u5316",
            "forbidden_question": "\u201C\u60A8\u600E\u4E48\u77E5\u9053\u4ED6\u5230\u5E95\u5728\u5F00\u5FC3\u4EC0\u4E48\uFF1F\u201D",
            "rationale": "\u4ECE\u76F4\u89C9\u8F6C\u8BC1\u636E\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u4E14C\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u6210\u4EBA\u73B0\u5B9E\u4EF7\u503C\u5224\u65AD\u76F4\u63A5\u538B\u5230\u6E38\u620F\u8868\u8FBE\u4E0A\u3002",
            "target_slots": [
              "Q5-S1",
              "Q5-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u6E38\u620F\u6846\u67B6\u53CD\u4F8B",
            "forbidden_question": "\u201C\u5B69\u5B50\u559C\u6B22\u73A9\u6D88\u9632\u5458\uFF0C\u662F\u5426\u5C31\u8BF4\u660E\u559C\u6B22\u771F\u5B9E\u706B\u707E\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u7EA0\u6B63\u6210\u4EBA\u73B0\u5B9E\u903B\u8F91\u3002",
            "calibration_note": ""
          },
          {
            "condition": "A\u5C45\u9996",
            "hypothesis": "\u53EF\u80FD\u628A\u2018\u6559\u80B2\u5951\u673A\u2019\u7406\u89E3\u4E3A\u5148\u8BB2\u77E5\u8BC6\u3002",
            "target_slots": [
              "Q5-S1",
              "Q5-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u65F6\u5E8F\u6BD4\u8F83",
            "forbidden_question": "\u201C\u5982\u679C\u5B69\u5B50\u672C\u6765\u5C31\u77E5\u9053\u771F\u5B9E\u706B\u707E\u5F88\u5371\u9669\uFF0C\u8FD8\u9700\u8981\u5148\u8BB2\u5417\uFF1F\u201D",
            "rationale": "\u67E5\u7406\u89E3\u2014\u6559\u80B2\u65F6\u5E8F\u3002",
            "calibration_note": ""
          },
          {
            "condition": "B\u5C45\u9996\u4F46\u6559\u5E08\u4E0D\u7ED9\u5E7C\u513F\u5426\u5B9A\u7A7A\u95F4",
            "hypothesis": "\u6392\u5E8F\u9AD8\u4F46\u8C08\u8BDD\u7B56\u7565\u4ECD\u53EF\u80FD\u8BF1\u5BFC\u3002",
            "target_slots": [
              "Q5-S2"
            ],
            "priority": "P1",
            "preferred_action": "\u8BDD\u672F\u91CD\u6784",
            "forbidden_question": "\u201C\u9664\u4E86\u8FD9\u4E24\u4E2A\u89E3\u91CA\uFF0C\u5B69\u5B50\u8FD8\u80FD\u4E0D\u80FD\u8BF4\u522B\u7684\uFF1F\u201D",
            "rationale": "\u628A\u5B9E\u8BC1B\u4F18\u52BF\u8F6C\u6210\u975E\u8BF1\u5BFC\u6F84\u6E05\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q5",
        "probes": [
          {
            "slot_id": "Q5-S1",
            "allowed_actions": [
              "\u6E38\u620F\u6846\u67B6\u6F84\u6E05"
            ],
            "preferred_action": "\u6F84\u6E05",
            "typical_question": "\u201C\u60A8\u542C\u5230\u2018\u7740\u706B\u4E86\uFF0C\u597D\u5F00\u5FC3\u2019\u65F6\uFF0C\u7B2C\u4E00\u6B65\u4F1A\u600E\u6837\u7406\u89E3\u8FD9\u53E5\u8BDD\uFF1F\u201D",
            "followup_question": "\u201C\u6E38\u620F\u91CC\u7684\u2018\u5F00\u5FC3\u2019\u548C\u73B0\u5B9E\u91CC\u8D5E\u6210\u706B\u707E\uFF0C\u662F\u4E00\u56DE\u4E8B\u5417\uFF1F\u201D",
            "forbidden_actions": [
              "\u4EF7\u503C\u5224\u5B9A"
            ],
            "forbidden_question": "\u201C\u8FD9\u53E5\u8BDD\u662F\u4E0D\u662F\u4E0D\u6B63\u786E\uFF1F\u201D",
            "non_inducing_boundary": "\u5148\u83B7\u53D6\u6E38\u620F\u6846\u67B6\u7406\u89E3\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q5-S2",
            "allowed_actions": [
              "\u805A\u7126\u6F84\u6E05"
            ],
            "preferred_action": "\u5BF9\u6BD4\uFF0B\u5F00\u653E\u51FA\u53E3",
            "typical_question": "\u201C\u5982\u679C\u60A8\u60F3\u5F88\u5FEB\u5F04\u6E05\u2018\u5F00\u5FC3\u2019\u6307\u4EC0\u4E48\uFF0C\u60A8\u4F1A\u600E\u4E48\u95EE\uFF0C\u540C\u65F6\u7ED9\u5B69\u5B50\u7559\u51FA\u522B\u7684\u89E3\u91CA\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u5B69\u5B50\u8BF4\u4E24\u4E2A\u90FD\u4E0D\u662F\uFF0C\u60A8\u63A5\u4E0B\u6765\u600E\u4E48\u95EE\uFF1F\u201D",
            "forbidden_actions": [
              "\u5F3A\u5236\u4E8C\u9009\u4E00"
            ],
            "forbidden_question": "\u201C\u4F60\u662F\u56E0\u4E3A\u6551\u4EBA\u624D\u5F00\u5FC3\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u5C0A\u91CD\u5B9E\u8BC1B\uFF0C\u4F46\u9632\u6B62\u8BF1\u5BFC\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q5-S3",
            "allowed_actions": [
              "\u5F00\u653E\u53D9\u4E8B"
            ],
            "preferred_action": "\u53D9\u4E8B\u8FFD\u95EE",
            "typical_question": "\u201C\u5982\u679C\u8BA9\u9633\u9633\u628A\u8FD9\u4E2A\u6E38\u620F\u8BB2\u4E0B\u53BB\uFF0C\u60A8\u6700\u60F3\u5148\u542C\u54EA\u4E00\u6BB5\uFF1F\u201D",
            "followup_question": "\u201C\u54EA\u4E9B\u7EC6\u8282\u80FD\u5E2E\u52A9\u60A8\u7406\u89E3\u4ED6\u7684\u4F53\u9A8C\uFF1F\u201D",
            "forbidden_actions": [
              "\u6210\u4EBA\u4EE3\u89E3\u91CA"
            ],
            "forbidden_question": "\u201C\u4F60\u4E00\u5B9A\u662F\u6D88\u9632\u5458\u6551\u4EBA\u6210\u529F\u624D\u5F00\u5FC3\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u4ECE\u513F\u7AE5\u53D9\u4E8B\u53D6\u8BC1\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q5-S4",
            "allowed_actions": [
              "\u6559\u80B2\u65F6\u673A"
            ],
            "preferred_action": "\u6761\u4EF6\u8FB9\u754C",
            "typical_question": "\u201C\u4EC0\u4E48\u8BC1\u636E\u4F1A\u8BA9\u60A8\u89C9\u5F97\u73B0\u5728\u786E\u5B9E\u9700\u8981\u8C08\u771F\u5B9E\u706B\u707E\u7684\u5371\u9669\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u5B69\u5B50\u5F88\u6E05\u695A\u73B0\u5B9E\u5371\u9669\uFF0C\u60A8\u8FD8\u4F1A\u600E\u6837\u652F\u6301\u8FD9\u4E2A\u6E38\u620F\uFF1F\u201D",
            "forbidden_actions": [
              "\u56FA\u5B9A\u6559\u80B2\u811A\u672C"
            ],
            "forbidden_question": "\u201C\u5206\u4EAB\u65F6\u5FC5\u987B\u6293\u4F4F\u6559\u80B2\u5951\u673A\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u4EF7\u503C\u652F\u6301\u7531\u8BC1\u636E\u51B3\u5B9A\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q5-S5",
            "allowed_actions": [
              "\u8BDD\u672F\u6BD4\u8F83"
            ],
            "preferred_action": "\u975E\u8BC4\u4EF7\u6C9F\u901A",
            "typical_question": "\u201C\u5982\u679C\u786E\u5B9E\u8981\u8C08\u73B0\u5B9E\u5371\u9669\uFF0C\u600E\u6837\u8BF4\u65E2\u8BB2\u6E05\u4E8B\u5B9E\uFF0C\u53C8\u4E0D\u8BA9\u5B69\u5B50\u89C9\u5F97\u521A\u624D\u7684\u5206\u4EAB\u662F\u2018\u8BF4\u9519\u4E86\u2019\uFF1F\u201D",
            "followup_question": "\u201C\u60A8\u4F1A\u907F\u514D\u54EA\u4E9B\u8BCD\uFF1F\u201D",
            "forbidden_actions": [
              "\u7F9E\u8FB1/\u9053\u5FB7\u5BA1\u5224"
            ],
            "forbidden_question": "\u201C\u5A03\u5A03\u5BB6\u7740\u706B\u503C\u5F97\u5F00\u5FC3\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u4FDD\u62A4\u8868\u8FBE\u5173\u7CFB\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q5-S6",
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210\uFF0C\u8FC1\u79FB"
            ],
            "preferred_action": "\u6E38\u620F\u5EF6\u4F38",
            "typical_question": "\u201C\u5728\u7406\u89E3\u5B69\u5B50\u4E3A\u4EC0\u4E48\u5F00\u5FC3\u4EE5\u540E\uFF0C\u60A8\u4F1A\u600E\u6837\u628A\u5B89\u5168\u7ECF\u9A8C\u81EA\u7136\u5E26\u56DE\u6D88\u9632\u6E38\u620F\uFF1F\u201D",
            "followup_question": "\u201C\u54EA\u4E9B\u65B0\u60C5\u8282\u7531\u5E7C\u513F\u51B3\u5B9A\uFF0C\u60A8\u4F1A\u89C2\u5BDF\u4EC0\u4E48\u518D\u8C03\u6574\uFF1F\u201D",
            "forbidden_actions": [
              "\u77E5\u8BC6\u8BFE\u5316"
            ],
            "forbidden_question": "\u201C\u63A5\u4E0B\u6765\u7CFB\u7EDF\u8BB2\u4E00\u904D\u6D88\u9632\u77E5\u8BC6\u6700\u7A33\u59A5\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u4EE5\u513F\u7AE5\u53D9\u4E8B\u4E3A\u8D77\u70B9\uFF0C\u5B89\u5168\u7ECF\u9A8C\u670D\u52A1\u4E8E\u6E38\u620F\u53D1\u5C55\u800C\u4E0D\u662F\u66FF\u4EE3\u6E38\u620F\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q5",
        "rules": [
          {
            "scope": "Q5-S1~S3 \u6E38\u620F\u7406\u89E3/\u6F84\u6E05",
            "sufficient_condition": "\u80FD\u533A\u5206\u6E38\u620F\u4E0E\u73B0\u5B9E\uFF0C\u517C\u5177\u805A\u7126\u6F84\u6E05\u548C\u5F00\u653E\u53D9\u4E8B\uFF0C\u5E76\u4FDD\u7559\u513F\u7AE5\u4FEE\u6B63\u6743\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u76F4\u63A5\u4EF7\u503C\u5224\u65AD\u5219\u6362\u53CD\u4F8B1\u6B21\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u8BED\u8A00\u51FA\u73B0\u5F3A\u8BF1\u5BFC\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ5-S4\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u53EA\u4F1AB\u5F0F\u4E8C\u9009\u4E00\u4F46\u65E0\u5F00\u653E\u51FA\u53E3\u65F6\u4E0D\u5B9C\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q5-S4~S5 \u4EF7\u503C\u8FB9\u754C",
            "sufficient_condition": "\u80FD\u4F9D\u636E\u771F\u5B9E\u8BEF\u89E3\u8BC1\u636E\u51B3\u5B9A\u662F\u5426\u5B89\u5168\u6559\u80B2\uFF0C\u5E76\u4FDD\u6301\u975E\u8BC4\u4EF7\u6C9F\u901A\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u4ECD\u575A\u6301\u2018\u6700\u540E\u5FC5\u987B\u7EA0\u6B63\u2019\uFF0C\u8BB0\u5F55\u51B2\u7A81\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u51FA\u73B0\u5BA1\u5224\u5F0F\u8BED\u8A00\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ5-S6\uFF08\u9700\u8981\u6E38\u620F\u5EF6\u4F38\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u65E0\u6CD5\u533A\u5206\u6E38\u620F\u5174\u8DA3\u4E0E\u73B0\u5B9E\u4EF7\u503C\u8BEF\u89E3\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q5-S6 \u6E38\u620F\u5EF6\u4F38",
            "sufficient_condition": "\u80FD\u4E3E\u51FA\u81F3\u5C111\u79CD\u628A\u5B89\u5168\u7ECF\u9A8C\u5E26\u56DE\u6E38\u620F\u3001\u540C\u65F6\u4FDD\u7559\u5E7C\u513F\u60C5\u8282\u9009\u62E9\u6743\u7684\u65B9\u5F0F\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u8BC1\u636E\u5373\u53EF\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u786E\u8BA4\u5F53\u524D\u4E0D\u9700\u8981\u6E38\u620F\u5EF6\u4F38\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u51FA\u73B0\u65B0\u7684\u73B0\u5B9E\u8BEF\u89E3\uFF0C\u6216\u6E38\u620F\u88AB\u77E5\u8BC6\u8BB2\u6388\u53D6\u4EE3\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u4E0D\u5F97\u7528\u6E38\u620F\u5EF6\u4F38\u66FF\u4EE3\u524D\u9762\u7684\u6E38\u620F\u6846\u67B6\u8BCA\u65AD\u4E0E\u8BC1\u636E\u6F84\u6E05\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q5-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u7406\u89E3\u6E38\u620F\u2014\u805A\u7126/\u5F00\u653E\u6F84\u6E05\u2014\u6309\u8BC1\u636E\u51B3\u5B9A\u4EF7\u503C\u652F\u6301\u2014\u4FDD\u6301\u8868\u8FBE\u5173\u7CFB\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4F4E\u589E\u76CA\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u628AC\u5F0F\u4EF7\u503C\u5BA1\u5224\u89C6\u4E3A\u5FC5\u8981\u6B65\u9AA4\u65F6\u4E0D\u5F97\u63D0\u524D\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q5",
        "title": "\u6D88\u9632\u5458\u6551\u706B\u5F00\u5FC3",
        "primary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u7279\u70B9\u7684\u7406\u89E3\uFF5C\u5BF9\u6E38\u620F\u672C\u8D28\u7279\u5F81\u7684\u7406\u89E3",
        "secondary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u4EF7\u503C\u5B9E\u73B0\u7684\u8BA4\u8BC6\uFF5C\u5BF9\u6E38\u620F\u4EF7\u503C\u53D1\u6325\u673A\u5236\u548C\u89C4\u5F8B\u7684\u8BA4\u8BC6",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u533A\u5206\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\u4F53\u9A8C\u3001\u60C5\u8282\u8868\u8FBE\u4E0E\u6210\u4EBA\u73B0\u5B9E\u4EF7\u503C\u5224\u65AD\uFF0C\u5148\u7406\u89E3\u6E38\u620F\u610F\u4E49\uFF0C\u518D\u4EE5\u53D1\u5C55\u9002\u5B9C\u7684\u65B9\u5F0F\u8FDB\u884C\u5B89\u5168\u548C\u4EF7\u503C\u6F84\u6E05\u3002",
        "empirical": {
          "0": [
            "ADCB",
            "CADB",
            "CBAD",
            "DCAB"
          ],
          "1": [
            "ACDB",
            "ADBC",
            "BCDA",
            "CABD",
            "CBDA",
            "CDAB",
            "CDBA",
            "DBCA"
          ],
          "2": [
            "ABCD",
            "ABDC",
            "ACBD",
            "BCAD",
            "DABC",
            "DACB",
            "DCBA"
          ],
          "3": [
            "BACD",
            "BADC",
            "BDCA",
            "DBAC"
          ],
          "4": [
            "BDAC"
          ]
        },
        "scoring_note": "\u552F\u4E004\u5206\u4E3ABDAC\uFF1B3\u5206\u4E3ABACD\u3001BADC\u3001BDCA\u3001DBAC\u3002B/D\u7A33\u5B9A\u5C45\u524D\uFF0CC\u5E38\u5C45\u540E\u3002\u5B9E\u8BC1\u66F4\u652F\u6301\u2018\u6709\u9488\u5BF9\u6027\u7684\u610F\u4E49\u6F84\u6E05\uFF0B\u5F00\u653E\u7406\u89E3\u6E38\u620F\u4F53\u9A8C\u2019\uFF0C\u800C\u4E0D\u662F\u5148\u505A\u4EF7\u503C\u5224\u65AD\uFF1BA\u5F0F\u73B0\u5B9E\u5B89\u5168\u89E3\u91CA\u53EF\u6709\u4F4D\u7F6E\uFF0C\u4F46\u901A\u5E38\u4E0D\u5E94\u65E9\u4E8E\u7406\u89E3\u5E7C\u513F\u7684\u6E38\u620F\u610F\u4E49\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q6": {
      "item_id": "Q6",
      "title": "\u6750\u6599\u9009\u62E9\u65E0\u5C42\u6B21",
      "ontology": {
        "item_id": "Q6",
        "title": "\u6750\u6599\u9009\u62E9\u65E0\u5C42\u6B21",
        "stem": "\u5927\u73ED\u4E0A\u5B66\u671F\uFF0C\u5F20\u8001\u5E08\u5728\u5EFA\u6784\u533A\u6295\u653E\u4E86\u6309\u56FE\u642D\u5EFA\u7684\u6E38\u620F\u6750\u6599\uFF0C\u5E76\u63D0\u4F9B\u4E86\u4E0D\u540C\u661F\u7EA7\u96BE\u5EA6\u7684\u4EFB\u52A1\u5361\u4F9B\u5E7C\u513F\u9009\u62E9\uFF0C\u4F46\u6709\u7684\u5E7C\u513F\u4E00\u4E0A\u6765\u5C31\u9009\u62E9\u9AD8\u96BE\u5EA6\u7684\u4E09\u661F\u7EA7\u4EFB\u52A1\u5361\uFF0C\u7ED3\u679C\u4E0D\u80FD\u987A\u5229\u5B8C\u6210\u4EFB\u52A1\uFF1B\u800C\u6709\u7684\u5E7C\u513F\u59CB\u7EC8\u9009\u62E9\u4F4E\u96BE\u5EA6\u7684\u4E00\u661F\u7EA7\u4EFB\u52A1\u5361\u3002\u8FD9\u5929\uFF0C\u6D69\u6D69\u53C8\u8FDE\u7EED\u9009\u62E9\u4E86\u51E0\u5F20\u4E00\u661F\u7EA7\u4EFB\u52A1\u5361\uFF0C\u5F88\u5FEB\u5C31\u5B8C\u6210\u4E86\u4EFB\u52A1\u3002",
        "options": {
          "A": "\u8C03\u6574\u4EFB\u52A1\u5361\u63D0\u4F9B\u65B9\u5F0F\uFF0C\u5728\u6E38\u620F\u5F00\u59CB\u524D\u6839\u636E\u5E7C\u513F\u7684\u80FD\u529B\u6C34\u5E73\u6709\u9488\u5BF9\u6027\u5730\u53D1\u653E\u4EFB\u52A1\u5361\u3002",
          "B": "\u6682\u4E0D\u4ECB\u5165\uFF0C\u5C0A\u91CD\u5E7C\u513F\u7684\u81EA\u4E3B\u9009\u62E9\u548C\u6E38\u620F\u4F53\u9A8C\uFF0C\u53EA\u8981\u5B8C\u6210\u4EFB\u52A1\u5C31\u662F\u4E00\u79CD\u7ECF\u9A8C\u79EF\u7D2F\u3002",
          "C": "\u8C03\u6574\u4EFB\u52A1\u5361\u5448\u73B0\u65B9\u5F0F\uFF0C\u5982\u589E\u52A0\u201C\u6211\u60F3\u6311\u6218\u201D\u7B49\u63D0\u793A\uFF0C\u9F13\u52B1\u5E7C\u513F\u9009\u62E9\u4E0D\u540C\u661F\u7EA7\u7684\u6311\u6218\u3002",
          "D": "\u548C\u6D69\u6D69\u56DE\u987E\u5DF2\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u6BD4\u8F83\u4E0D\u540C\u661F\u7EA7\u7684\u96BE\u5EA6\uFF0C\u9080\u8BF7\u4ED6\u9009\u62E9\u7A0D\u6709\u6311\u6218\u7684\u4EFB\u52A1\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6E38\u620F\u73AF\u5883\u521B\u8BBE\uFF5C\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u4ECE\u5E7C\u513F\u53D1\u5C55\u548C\u5B66\u4E60\u7ECF\u9A8C\u89D2\u5EA6\u5206\u6790\u4EFB\u52A1\u6750\u6599\u7684\u5C42\u6B21\uFF0C\u52A8\u6001\u8C03\u6574\u6750\u6599\u5448\u73B0\u65B9\u5F0F\uFF0C\u5E76\u901A\u8FC7\u9002\u5EA6\u6311\u6218\u652F\u6301\u5E7C\u513F\u5728\u6E38\u620F\u4E2D\u7EE7\u7EED\u53D1\u5C55\u3002",
        "slots": [
          {
            "slot_id": "Q6-S1",
            "dimension": "B1 \u6750\u6599\u5206\u6790",
            "name": "\u4EFB\u52A1\u96BE\u5EA6\u5C42\u6B21\u4E0E\u6750\u6599\u529F\u80FD\u5224\u65AD",
            "definition": "\u7406\u89E3\u661F\u7EA7\u4EFB\u52A1\u5361\u4E0D\u4EC5\u662F\u6750\u6599\u5206\u7C7B\uFF0C\u800C\u662F\u652F\u6301\u5E7C\u513F\u5728\u9002\u5B9C\u6311\u6218\u4E2D\u9010\u6B65\u53D1\u5C55\uFF1B\u9700\u8981\u7ED3\u5408\u80FD\u529B\u3001\u6210\u529F\u7ECF\u9A8C\u3001\u9009\u62E9\u4E60\u60EF\u52A8\u6001\u770B\u96BE\u5EA6\u3002",
            "diagnostic_meaning": "\u5BF9\u5E94\u4E3B\u6307\u6807\u2018\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E\u2019\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u6F84\u6E05/\u8BC1\u636E\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u6309\u80FD\u529B\u76F4\u63A5\u5206\u914D"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u5B9E\u8BC1A\u57284\u5206\u7EC4\u5408\u5747\u5C45\u672B\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q6-S2",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u9009\u62E9\u884C\u4E3A\u80CC\u540E\u7684\u53D1\u5C55\u72B6\u6001",
            "definition": "\u533A\u5206\u2018\u603B\u9009\u4E00\u661F\u2019\u53EF\u80FD\u6765\u81EA\u4FE1\u5FC3\u4E0D\u8DB3\u3001\u504F\u597D\u6210\u529F\u3001\u4E0D\u4E86\u89E3\u96BE\u5EA6\u3001\u7F3A\u4E4F\u6311\u6218\u610F\u8BC6\u7B49\uFF1B\u2018\u4E00\u4E0A\u6765\u9009\u4E09\u661F\u2019\u4E5F\u53EF\u80FD\u662F\u81EA\u6211\u5224\u65AD\u4E0D\u8DB3\u6216\u8FFD\u6C42\u523A\u6FC0\u3002",
            "diagnostic_meaning": "\u51B3\u5B9A\u6750\u6599\u8C03\u6574\u4E0E\u6559\u5E08\u56DE\u5E94\u3002",
            "core": true,
            "prerequisites": [
              "Q6-S1"
            ],
            "allowed_actions": [
              "\u5047\u8BBE\u6BD4\u8F83"
            ],
            "forbidden_actions": [
              "\u628A\u4F4E\u96BE\u5EA6\u9009\u62E9\u7B49\u540C\u80FD\u529B\u4F4E"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u9700\u8981\u4ECE\u884C\u4E3A\u89E3\u91CA\u53D1\u5C55\u9700\u8981\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q6-S3",
            "dimension": "B1 \u6750\u6599\u5448\u73B0",
            "name": "\u73AF\u5883\u63D0\u793A\u4FC3\u8FDB\u81EA\u6211\u9009\u62E9",
            "definition": "\u901A\u8FC7\u2018\u6211\u60F3\u6311\u6218\u2019\u3001\u5206\u5C42\u5C55\u793A\u3001\u8FDB\u9636\u8DEF\u5F84\u3001\u5B8C\u6210\u8BB0\u5F55\u7B49\u65B9\u5F0F\u63D0\u9AD8\u96BE\u5EA6\u53EF\u89C1\u6027\u548C\u6311\u6218\u610F\u613F\uFF0C\u800C\u4E0D\u5265\u593A\u9009\u62E9\u6743\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u6750\u6599\u73AF\u5883\u80FD\u5426\u652F\u6301\u81EA\u6211\u8C03\u8282\u3002",
            "core": true,
            "prerequisites": [
              "Q6-S1",
              "Q6-S2"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210/\u6BD4\u8F83"
            ],
            "forbidden_actions": [
              "\u6309\u80FD\u529B\u9884\u5148\u53D1\u5361"
            ],
            "default_priority": "P1",
            "empirical_relation": "C\u5728\u9AD8\u5206\u7EC4\u5408\u4E2D\u7A33\u5B9A\u5C45\u524D\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q6-S4",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u56DE\u987E\u2014\u6BD4\u8F83\u2014\u9080\u8BF7\u9002\u5EA6\u6311\u6218",
            "definition": "\u548C\u5E7C\u513F\u56DE\u987E\u5DF2\u5B8C\u6210\u4EFB\u52A1\u3001\u6BD4\u8F83\u96BE\u5EA6\u548C\u81EA\u5DF1\u7684\u8868\u73B0\uFF0C\u9080\u8BF7\u9009\u62E9\u2018\u6BD4\u73B0\u5728\u7A0D\u96BE\u4E00\u70B9\u2019\u7684\u4EFB\u52A1\u3002",
            "diagnostic_meaning": "\u628A\u6559\u5E08\u652F\u6301\u843D\u5230\u6700\u8FD1\u53D1\u5C55\u533A\u548C\u81EA\u6211\u8BC4\u4EF7\u3002",
            "core": true,
            "prerequisites": [
              "Q6-S2"
            ],
            "allowed_actions": [
              "\u53CD\u601D/\u5C0F\u76EE\u6807"
            ],
            "forbidden_actions": [
              "\u76F4\u63A5\u547D\u4EE4\u5347\u661F"
            ],
            "default_priority": "P1",
            "empirical_relation": "D\u57284\u5206\u7EC4\u5408\u4E2D\u53EF\u5C45\u9996\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q6-S5",
            "dimension": "C2/A1 \u81EA\u4E3B\u6027",
            "name": "\u81EA\u4E3B\u9009\u62E9\u4E0E\u6311\u6218\u53D1\u5C55\u7684\u5E73\u8861",
            "definition": "\u5C0A\u91CD\u81EA\u4E3B\u9009\u62E9\uFF0C\u4F46\u4E0D\u628A\u2018\u53EA\u8981\u5B8C\u6210\u5C31\u662F\u7ECF\u9A8C\u79EF\u7D2F\u2019\u4F5C\u4E3A\u957F\u671F\u4E0D\u4ECB\u5165\u7406\u7531\uFF1B\u6559\u5E08\u53EF\u4EE5\u901A\u8FC7\u73AF\u5883\u548C\u5BF9\u8BDD\u6269\u5C55\u9009\u62E9\u7A7A\u95F4\u3002",
            "diagnostic_meaning": "\u89E3\u91CAB\u4E2D\u2018\u5C0A\u91CD\u2019\u7684\u4EF7\u503C\u4E0E\u5C40\u9650\u3002",
            "core": true,
            "prerequisites": [
              "Q6-S2",
              "Q6-S3"
            ],
            "allowed_actions": [
              "\u6BD4\u8F83\u6743\u8861"
            ],
            "forbidden_actions": [
              "\u628A\u81EA\u4E3B\u7B49\u540C\u5B8C\u5168\u4E0D\u652F\u6301"
            ],
            "default_priority": "P2",
            "empirical_relation": "\u5B9E\u8BC1B\u591A\u4F4D\u4E8E\u4E2D\u95F4\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q6-S6",
            "dimension": "B1/C2 \u52A8\u6001\u8C03\u6574",
            "name": "\u6839\u636E\u9009\u62E9\u7ED3\u679C\u6301\u7EED\u6821\u51C6",
            "definition": "\u89C2\u5BDF\u5E7C\u513F\u662F\u5426\u9010\u6B65\u5C1D\u8BD5\u66F4\u9AD8\u96BE\u5EA6\u3001\u5931\u8D25\u540E\u5982\u4F55\u8C03\u6574\uFF0C\u5E76\u636E\u6B64\u6539\u8FDB\u4EFB\u52A1\u5361\u5C42\u6B21\u3001\u63D0\u793A\u548C\u652F\u67B6\u3002",
            "diagnostic_meaning": "\u5F62\u6210\u6750\u6599\u2014\u884C\u4E3A\u2014\u518D\u6295\u653E\u95ED\u73AF\u3002",
            "core": false,
            "prerequisites": [
              "Q6-S3",
              "Q6-S4"
            ],
            "allowed_actions": [
              "\u53CD\u601D/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u4E00\u6B21\u8C03\u6574\u540E\u4E0D\u518D\u89C2\u5BDF"
            ],
            "default_priority": "P3",
            "empirical_relation": "\u9AD8\u6C34\u5E73\u6269\u5C55\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q6",
        "anchors": [
          {
            "slot_id": "Q6-S1",
            "level_0": "\u53EA\u628A\u661F\u7EA7\u770B\u6210\u6559\u5E08\u5206\u7EC4\u5DE5\u5177\uFF0C\u6309\u80FD\u529B\u53D1\u5361\u3002",
            "level_1": "\u77E5\u9053\u8981\u6709\u96BE\u6613\uFF0C\u4F46\u4E3B\u8981\u5173\u6CE8\u5B8C\u6210\u7387\u3002",
            "level_2": "\u7406\u89E3\u6750\u6599\u5C42\u6B21\u8981\u652F\u6301\u2018\u9002\u5EA6\u6311\u6218\u2019\uFF0C\u5E76\u7ED3\u5408\u5E7C\u513F\u5F53\u524D\u8868\u73B0\u548C\u9009\u62E9\u5386\u53F2\u5224\u65AD\u3002",
            "level_3": "\u80FD\u8FDB\u4E00\u6B65\u5206\u6790\u4E0D\u540C\u5E7C\u513F\u5BF9\u96BE\u5EA6\u6807\u7B7E\u7684\u7406\u89E3\u3001\u6210\u529F/\u5931\u8D25\u7ECF\u9A8C\u548C\u81EA\u6211\u8BC4\u4EF7\uFF0C\u52A8\u6001\u8C03\u6574\u6750\u6599\u7CFB\u7EDF\u3002",
            "false_evidence": "\u96BE\u5EA6\u8D8A\u9AD8\u8D8A\u597D\u3002",
            "conflict_evidence": "\u4E3A\u4E86\u907F\u514D\u5931\u8D25\u76F4\u63A5\u5265\u593A\u81EA\u4E3B\u9009\u62E9\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q6-S2",
            "level_0": "\u628A\u9009\u4E00\u661F=\u80FD\u529B\u5F31\uFF0C\u9009\u4E09\u661F=\u80FD\u529B\u5F3A\u6216\u597D\u80DC\u3002",
            "level_1": "\u80FD\u63D0\u51FA\u4E00\u4E2A\u53EF\u80FD\u539F\u56E0\uFF0C\u4F46\u65E0\u8BC1\u636E\u3002",
            "level_2": "\u80FD\u63D0\u51FA\u81F3\u5C112\u20143\u79CD\u89E3\u91CA\u5E76\u8BF4\u660E\u5982\u4F55\u4ECE\u8FDE\u7EED\u9009\u62E9\u3001\u5B8C\u6210\u8FC7\u7A0B\u3001\u60C5\u7EEA\u548C\u81EA\u8BC4\u4E2D\u533A\u5206\u3002",
            "level_3": "\u80FD\u5206\u522B\u89E3\u91CA\u4F4E\u6311\u6218\u4E0E\u8FC7\u9AD8\u6311\u6218\u4E24\u7C7B\u5E7C\u513F\uFF0C\u5E76\u628A\u5224\u65AD\u4E0E\u4E0D\u540C\u652F\u6301\u76F8\u8FDE\u3002",
            "false_evidence": "\u53EA\u7ED9\u6027\u683C\u6807\u7B7E\u3002",
            "conflict_evidence": "\u4E0D\u540C\u539F\u56E0\u90FD\u7528\u540C\u4E00\u5E72\u9884\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q6-S3",
            "level_0": "\u6559\u5E08\u76F4\u63A5\u5206\u914D\u4EFB\u52A1\u5361\u3002",
            "level_1": "\u4F1A\u589E\u52A0\u63D0\u793A\uFF0C\u4F46\u53EA\u662F\u5956\u52B1\u9AD8\u661F\u6216\u5236\u9020\u7ADE\u4E89\u3002",
            "level_2": "\u901A\u8FC7\u8FDB\u9636\u8DEF\u5F84\u3001\u6311\u6218\u63D0\u793A\u3001\u53EF\u89C6\u5316\u96BE\u5EA6\u7B49\u8BA9\u5E7C\u513F\u66F4\u5BB9\u6613\u81EA\u4E3B\u9009\u62E9\u7A0D\u6709\u6311\u6218\u7684\u4EFB\u52A1\u3002",
            "level_3": "\u80FD\u6839\u636E\u5B9E\u9645\u9009\u62E9\u6570\u636E\u4E0D\u65AD\u8C03\u6574\u5448\u73B0\u65B9\u5F0F\uFF0C\u65E2\u652F\u6301\u6311\u6218\u53C8\u4E0D\u628A\u661F\u7EA7\u53D8\u6210\u5916\u90E8\u6392\u540D\u3002",
            "false_evidence": "\u2018\u4E09\u661F\u6700\u68D2\u2019\u3002",
            "conflict_evidence": "\u6750\u6599\u63D0\u793A\u6F14\u53D8\u4E3A\u6210\u4EBA\u547D\u4EE4\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q6-S4",
            "level_0": "\u53EA\u8BF4\u2018\u4F60\u5E94\u8BE5\u9009\u96BE\u4E00\u70B9\u2019\u3002",
            "level_1": "\u4F1A\u56DE\u987E\u5B8C\u6210\u60C5\u51B5\uFF0C\u4F46\u6559\u5E08\u76F4\u63A5\u51B3\u5B9A\u4E0B\u4E00\u5F20\u3002",
            "level_2": "\u5E2E\u52A9\u5E7C\u513F\u6BD4\u8F83\u5DF2\u5B8C\u6210\u4EFB\u52A1\u548C\u4E0D\u540C\u96BE\u5EA6\uFF0C\u9080\u8BF7\u5176\u9009\u62E9\u6BD4\u5F53\u524D\u7A0D\u6709\u6311\u6218\u7684\u4E0B\u4E00\u6B65\u3002",
            "level_3": "\u80FD\u9010\u6B65\u8BA9\u5E7C\u513F\u81EA\u5DF1\u5224\u65AD\u2018\u8FD9\u4E2A\u5BF9\u6211\u592A\u5BB9\u6613/\u592A\u96BE/\u521A\u597D\u2019\uFF0C\u5F62\u6210\u81EA\u6211\u8C03\u8282\u3002",
            "false_evidence": "\u628A\u2018\u5C0F\u76EE\u6807\u2019\u53D8\u6210\u6559\u5E08\u5E03\u7F6E\u3002",
            "conflict_evidence": "\u5931\u8D25\u540E\u7ACB\u5373\u964D\u5230\u6700\u4F4E\u96BE\u5EA6\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q6-S5",
            "level_0": "\u8981\u4E48\u5B8C\u5168\u653E\u4EFB\uFF0C\u8981\u4E48\u5B8C\u5168\u5206\u914D\u3002",
            "level_1": "\u77E5\u9053\u65E2\u8981\u81EA\u4E3B\u53C8\u8981\u6311\u6218\uFF0C\u4F46\u6CA1\u6709\u5B9E\u73B0\u673A\u5236\u3002",
            "level_2": "\u901A\u8FC7\u73AF\u5883\u63D0\u793A\u3001\u56DE\u987E\u5BF9\u8BDD\u548C\u53EF\u9009\u62E9\u7684\u8FDB\u9636\u8DEF\u5F84\uFF0C\u5728\u4E0D\u53D6\u6D88\u9009\u62E9\u6743\u7684\u60C5\u51B5\u4E0B\u589E\u52A0\u6311\u6218\u3002",
            "level_3": "\u80FD\u63A5\u53D7\u5E7C\u513F\u5076\u5C14\u9009\u62E9\u719F\u6089\u4EFB\u52A1\uFF0C\u540C\u65F6\u6839\u636E\u957F\u671F\u6A21\u5F0F\u5224\u65AD\u4F55\u65F6\u9700\u8981\u4ECB\u5165\uFF0C\u907F\u514D\u6025\u4E8E\u6C42\u6210\u3002",
            "false_evidence": "\u81EA\u4E3B=\u4ECE\u4E0D\u4ECB\u5165\u3002",
            "conflict_evidence": "\u6311\u6218=\u5FC5\u987B\u5347\u661F\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q6-S6",
            "level_0": "\u8C03\u6574\u4E00\u6B21\u6750\u6599\u540E\u4E0D\u518D\u89C2\u5BDF\uFF0C\u6216\u53EA\u770B\u4EFB\u52A1\u5B8C\u6210\u6570\u91CF\u3002",
            "level_1": "\u4F1A\u770B\u5E7C\u513F\u662F\u5426\u9009\u62E9\u66F4\u9AD8\u661F\u7EA7\uFF0C\u4F46\u672A\u5173\u6CE8\u5931\u8D25\u3001\u7B56\u7565\u548C\u6750\u6599\u9002\u914D\u3002",
            "level_2": "\u80FD\u89C2\u5BDF\u9009\u62E9\u96BE\u5EA6\u3001\u5C1D\u8BD5\u8FC7\u7A0B\u3001\u5931\u8D25\u540E\u8C03\u6574\u4E0E\u81EA\u8BC4\u53D8\u5316\uFF0C\u5E76\u636E\u6B64\u6539\u8FDB\u4EFB\u52A1\u5C42\u6B21\u3001\u63D0\u793A\u548C\u652F\u67B6\u3002",
            "level_3": "\u80FD\u7528\u8DE8\u65F6\u6BB5\u8BC1\u636E\u6821\u51C6\u6750\u6599\u7CFB\u7EDF\u4E0E\u4E2A\u522B\u652F\u6301\uFF0C\u4F7F\u5E7C\u513F\u9010\u6B65\u5F62\u6210\u2018\u592A\u6613\u3001\u592A\u96BE\u3001\u521A\u597D\u2019\u7684\u81EA\u4E3B\u5224\u65AD\u3002",
            "false_evidence": "\u5347\u661F\u5C31\u662F\u8FDB\u6B65\u3002",
            "conflict_evidence": "\u63D0\u793A\u9020\u6210\u7ADE\u4E89\u6216\u632B\u8D25\u3001\u9009\u62E9\u4ECD\u56FA\u5316\uFF0C\u5374\u4E0D\u518D\u8C03\u6574\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q6",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ACBDA/DBCA/DCBA",
            "hypothesis": "C/D\u5C45\u524D\u3001A\u5C45\u672B\uFF1B\u603B\u4F53\u5DF2\u504F\u5411\u73AF\u5883\u63D0\u793A\u548C\u4E2A\u522B\u5316\u6311\u6218\u9080\u8BF7\u3002",
            "target_slots": [
              "Q6-S2",
              "Q6-S3",
              "Q6-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB/\u8FB9\u754C",
            "forbidden_question": "\u201C4\u5206\u8BF4\u660E\u9009C\u6216D\u5C31\u591F\u4E86\u3002\u201D",
            "rationale": "\u9A8C\u8BC1\u662F\u5426\u771F\u6B63\u57FA\u4E8E\u5E7C\u513F\u9009\u62E9\u5386\u53F2\u800C\u975E\u56FA\u5B9A\u7B56\u7565\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206",
            "hypothesis": "\u591A\u6570C/D/B\u5C45\u524D\uFF0C\u4F46\u6750\u6599\u63D0\u793A\u3001\u5C0A\u91CD\u9009\u62E9\u4E0E\u4E2A\u522B\u5BF9\u8BDD\u7684\u5148\u540E\u4E0D\u7A33\u3002",
            "target_slots": [
              "Q6-S3",
              "Q6-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u6BD4\u8F83\u6743\u8861",
            "forbidden_question": "\u201C\u5C0A\u91CD\u81EA\u4E3B\u662F\u4E0D\u662F\u610F\u5473\u7740\u6682\u4E0D\u4ECB\u5165\uFF1F\u201D",
            "rationale": "\u67E5B\u7684\u8FB9\u754C\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u6709\u90E8\u5206\u5C42\u6B21\u610F\u8BC6\uFF0C\u4F46\u53EF\u80FD\u91CD\u5B8C\u6210\u7387\u6216\u53EA\u4F1A\u4E00\u822C\u6027\u9F13\u52B1\u6311\u6218\u3002",
            "target_slots": [
              "Q6-S1",
              "Q6-S2",
              "Q6-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u8BC1\u636E\u8FFD\u95EE",
            "forbidden_question": "\u201C\u6D69\u6D69\u4E00\u76F4\u9009\u4E00\u661F\uFF0C\u60A8\u600E\u4E48\u5224\u65AD\u539F\u56E0\uFF1F\u201D",
            "rationale": "\u4ECE\u6750\u6599\u7BA1\u7406\u8F6C\u5411\u53D1\u5C55\u8BCA\u65AD\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216A\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u4E2A\u4F53\u5DEE\u5F02\u7B80\u5355\u8F6C\u6210\u6559\u5E08\u5206\u914D\uFF0C\u524A\u5F31\u5E7C\u513F\u81EA\u6211\u9009\u62E9\u548C\u81EA\u8BC4\u3002",
            "target_slots": [
              "Q6-S1",
              "Q6-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u53CD\u4F8B/\u4EF7\u503C\u6743\u8861",
            "forbidden_question": "\u201C\u6309\u80FD\u529B\u53D1\u4EFB\u52A1\u5361\u867D\u7136\u6709\u6548\u7387\uFF0C\u4F1A\u5931\u53BB\u4EC0\u4E48\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u67E5\u6750\u6599\u652F\u6301\u4E0E\u81EA\u4E3B\u6027\u3002",
            "calibration_note": ""
          },
          {
            "condition": "D\u5C45\u9996\u4F46\u6559\u5E08\u53EA\u8BF4\u2018\u9F13\u52B1\u6311\u6218\u2019",
            "hypothesis": "\u53EF\u80FD\u7F3A\u5C11\u6750\u6599\u73AF\u5883\u5C42\u9762\u7684\u7CFB\u7EDF\u8C03\u6574\u3002",
            "target_slots": [
              "Q6-S3",
              "Q6-S6"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB",
            "forbidden_question": "\u201C\u5982\u679C\u73ED\u91CC\u5F88\u591A\u5E7C\u513F\u90FD\u6709\u7C7B\u4F3C\u9009\u62E9\uFF0C\u5355\u72EC\u8C08\u8BDD\u591F\u5417\uFF1F\u201D",
            "rationale": "\u68C0\u9A8C\u4E2A\u4F53\u56DE\u5E94\u4E0E\u73AF\u5883\u8BBE\u8BA1\u7ED3\u5408\u3002",
            "calibration_note": ""
          },
          {
            "condition": "C\u5C45\u9996\u4F46\u628A\u2018\u6211\u60F3\u6311\u6218\u2019\u53D8\u6210\u7ADE\u4E89\u6392\u540D",
            "hypothesis": "\u73AF\u5883\u63D0\u793A\u53EF\u80FD\u4EA7\u751F\u5916\u5728\u6BD4\u8F83\u3002",
            "target_slots": [
              "Q6-S3",
              "Q6-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u8FB9\u754C",
            "forbidden_question": "\u201C\u600E\u6837\u907F\u514D\u661F\u7EA7\u63D0\u793A\u53D8\u6210\u2018\u8D8A\u9AD8\u8D8A\u597D\u2019\uFF1F\u201D",
            "rationale": "\u4FDD\u62A4\u9002\u5EA6\u6311\u6218\u800C\u975E\u96BE\u5EA6\u5D07\u62DC\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q6",
        "probes": [
          {
            "slot_id": "Q6-S1",
            "allowed_actions": [
              "\u6750\u6599\u529F\u80FD\u6F84\u6E05"
            ],
            "preferred_action": "\u6F84\u6E05",
            "typical_question": "\u201C\u8FD9\u4E9B\u4E00\u661F\u3001\u4E8C\u661F\u3001\u4E09\u661F\u4EFB\u52A1\u5361\uFF0C\u60A8\u89C9\u5F97\u6700\u91CD\u8981\u7684\u6559\u80B2\u4F5C\u7528\u662F\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u53EA\u662F\u6309\u80FD\u529B\u53D1\u7ED9\u5E7C\u513F\uFF0C\u4F1A\u6709\u4EC0\u4E48\u5F97\u5931\uFF1F\u201D",
            "forbidden_actions": [
              "\u76F4\u63A5\u80AF\u5B9AC/D"
            ],
            "forbidden_question": "\u201C\u6559\u5E08\u5F53\u7136\u4E0D\u80FD\u5206\u914D\u4EFB\u52A1\u5361\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u5148\u67E5\u6750\u6599\u89C2\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q6-S2",
            "allowed_actions": [
              "\u539F\u56E0\u5047\u8BBE"
            ],
            "preferred_action": "\u8BC1\u636E\u8FFD\u95EE",
            "typical_question": "\u201C\u6D69\u6D69\u8FDE\u7EED\u9009\u4E00\u661F\uFF0C\u53EF\u80FD\u5206\u522B\u610F\u5473\u7740\u4EC0\u4E48\uFF1F\u60A8\u4F1A\u770B\u4EC0\u4E48\u6765\u533A\u5206\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u53E6\u4E00\u4E2A\u5B69\u5B50\u603B\u9009\u4E09\u661F\u5374\u9891\u7E41\u5931\u8D25\uFF0C\u60A8\u4F1A\u600E\u4E48\u5224\u65AD\uFF1F\u201D",
            "forbidden_actions": [
              "\u80FD\u529B\u8D34\u6807\u7B7E"
            ],
            "forbidden_question": "\u201C\u4ED6\u662F\u4E0D\u662F\u80FD\u529B\u5F31\u3001\u6CA1\u4FE1\u5FC3\uFF1F\u201D",
            "non_inducing_boundary": "\u8981\u6C42\u53EF\u89C2\u5BDF\u8BC1\u636E\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q6-S3",
            "allowed_actions": [
              "\u73AF\u5883\u7B56\u7565"
            ],
            "preferred_action": "\u7B56\u7565\u751F\u6210",
            "typical_question": "\u201C\u5982\u679C\u4E0D\u76F4\u63A5\u7ED9\u4ED6\u6307\u5B9A\u661F\u7EA7\uFF0C\u60A8\u4F1A\u600E\u4E48\u6539\u4EFB\u52A1\u5361\u7684\u5448\u73B0\uFF0C\u8BA9\u4ED6\u66F4\u613F\u610F\u8BD5\u4E00\u70B9\u6311\u6218\uFF1F\u201D",
            "followup_question": "\u201C\u600E\u6837\u907F\u514D\u53D8\u6210\u6BD4\u8C01\u661F\u7EA7\u9AD8\uFF1F\u201D",
            "forbidden_actions": [
              "\u63D0\u4F9BC\u539F\u8BDD"
            ],
            "forbidden_question": "\u201C\u52A0\u2018\u6211\u60F3\u6311\u6218\u2019\u5C31\u53EF\u4EE5\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u770B\u6559\u5E08\u80FD\u5426\u5F62\u6210\u73AF\u5883\u673A\u5236\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q6-S4",
            "allowed_actions": [
              "\u56DE\u987E\u4E0E\u6311\u6218\u9080\u8BF7"
            ],
            "preferred_action": "\u53CD\u601D",
            "typical_question": "\u201C\u60A8\u4F1A\u600E\u6837\u548C\u6D69\u6D69\u56DE\u770B\u521A\u624D\u7684\u4E00\u661F\u4EFB\u52A1\uFF0C\u518D\u51B3\u5B9A\u4E0B\u4E00\u5F20\u9009\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u600E\u6837\u8BA9\u8FD9\u4E2A\u51B3\u5B9A\u8D8A\u6765\u8D8A\u53D8\u6210\u4ED6\u81EA\u5DF1\u4F1A\u505A\u7684\u5224\u65AD\uFF1F\u201D",
            "forbidden_actions": [
              "\u76F4\u63A5\u547D\u4EE4\u5347\u661F"
            ],
            "forbidden_question": "\u201C\u4E0B\u4E00\u5F20\u5FC5\u987B\u4E8C\u661F\u3002\u201D",
            "non_inducing_boundary": "\u76EE\u6807\u662F\u81EA\u6211\u8BC4\u4EF7\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q6-S5",
            "allowed_actions": [
              "\u4EF7\u503C\u6743\u8861"
            ],
            "preferred_action": "\u6BD4\u8F83",
            "typical_question": "\u201C\u5C0A\u91CD\u4ED6\u53CD\u590D\u9009\u4E00\u661F\uFF0C\u548C\u652F\u6301\u4ED6\u5F80\u524D\u6311\u6218\uFF0C\u60A8\u4F1A\u600E\u6837\u627E\u5230\u5E73\u8861\uFF1F\u201D",
            "followup_question": "\u201C\u5076\u5C14\u91CD\u590D\u719F\u6089\u4EFB\u52A1\u662F\u4E0D\u662F\u4E5F\u53EF\u4EE5\uFF1F\u201D",
            "forbidden_actions": [
              "\u6781\u7AEF\u5316"
            ],
            "forbidden_question": "\u201C\u53EA\u8981\u81EA\u4E3B\u9009\u62E9\u5C31\u4E0D\u8981\u4ECB\u5165\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u68C0\u9A8C\u957F\u671F\u53D1\u5C55\u89C6\u89D2\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q6-S6",
            "allowed_actions": [
              "\u53CD\u601D\uFF0C\u52A8\u6001\u6821\u51C6"
            ],
            "preferred_action": "\u7ED3\u679C\u56DE\u770B",
            "typical_question": "\u201C\u8C03\u6574\u4EFB\u52A1\u5361\u540E\uFF0C\u60A8\u4F1A\u7EE7\u7EED\u770B\u54EA\u4E9B\u9009\u62E9\u548C\u5C1D\u8BD5\uFF0C\u6765\u5224\u65AD\u4E0B\u4E00\u6B65\u662F\u5426\u8FD8\u8981\u6539\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u5E7C\u513F\u5347\u4E86\u661F\u5374\u9891\u7E41\u632B\u8D25\uFF0C\u6216\u4ECD\u53EA\u9009\u4E00\u661F\uFF0C\u60A8\u4F1A\u600E\u4E48\u8C03\u6574\uFF1F\u201D",
            "forbidden_actions": [
              "\u4E00\u6B21\u5B9A\u6848"
            ],
            "forbidden_question": "\u201C\u4EFB\u52A1\u5361\u6539\u8FC7\u4E00\u6B21\uFF0C\u5C31\u53EF\u4EE5\u6309\u8FD9\u4E2A\u5C42\u6B21\u4E00\u76F4\u7528\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u7528\u8FDE\u7EED\u884C\u4E3A\u8BC1\u636E\u6821\u51C6\u6750\u6599\u4E0E\u652F\u67B6\uFF0C\u4E0D\u628A\u5347\u661F\u672C\u8EAB\u5F53\u4F5C\u76EE\u6807\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q6",
        "rules": [
          {
            "scope": "Q6-S1~S2 \u6750\u6599/\u9009\u62E9\u8BCA\u65AD",
            "sufficient_condition": "\u80FD\u628A\u6750\u6599\u5C42\u6B21\u4E0E\u9002\u5EA6\u6311\u6218\u76F8\u8FDE\uFF0C\u5E76\u63D0\u51FA\u591A\u79CD\u9009\u62E9\u884C\u4E3A\u89E3\u91CA\u548C\u8BC1\u636E\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u80FD\u529B\u9AD8\u4F4E\uFF0C\u6362\u53CD\u4F8B1\u6B21\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u7B56\u7565\u53C8\u53D8\u6210\u6309\u80FD\u529B\u5206\u914D\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ6-S3\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u6CA1\u6709\u884C\u4E3A\u89E3\u91CA\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q6-S3~S4 \u73AF\u5883/\u4E2A\u522B\u652F\u67B6",
            "sufficient_condition": "\u80FD\u751F\u6210\u4E0D\u5265\u593A\u9009\u62E9\u6743\u7684\u6750\u6599\u5448\u73B0\u548C\u56DE\u987E\u2014\u9080\u8BF7\u7B56\u7565\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u8BF4\u2018\u9F13\u52B1\u6311\u6218\u2019\u65E0\u673A\u5236\uFF0C\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u51FA\u73B0\u7ADE\u4E89\u5316/\u5F3A\u5236\u5347\u661F\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ6-S5\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u53EA\u6709\u53E3\u53F7\u6CA1\u6709\u5177\u4F53\u73AF\u5883/\u5BF9\u8BDD\u652F\u67B6\u65F6\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q6-S5 \u81EA\u4E3B/\u6311\u6218\u5E73\u8861",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u5C0A\u91CD\u91CD\u590D\u9009\u62E9\u7684\u5408\u7406\u6027\u4E0E\u957F\u671F\u6A21\u5F0F\u4E0B\u4ECB\u5165\u9608\u503C\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u526A\u679D\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u628A\u81EA\u4E3B\u7B49\u540C\u653E\u4EFB\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ6-S6\uFF08\u51FA\u73B0\u540E\u7EED\u9009\u62E9\u7ED3\u679C\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u4E0E\u6838\u5FC3\u5171\u540C\u6EE1\u8DB3\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u8D5E\u6210\u6309\u80FD\u529B\u76F4\u63A5\u53D1\u5361\u4F5C\u4E3A\u5E38\u89C4\u505A\u6CD5\u65F6\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q6-S6 \u6301\u7EED\u6821\u51C6",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u5982\u4F55\u628A\u9009\u62E9\u3001\u5C1D\u8BD5\u3001\u5931\u8D25\u4E0E\u81EA\u8BC4\u7ED3\u679C\u53CD\u9988\u5230\u4EFB\u52A1\u5361\u5C42\u6B21\u3001\u63D0\u793A\u548C\u4E2A\u522B\u652F\u67B6\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u2018\u770B\u662F\u5426\u5347\u661F\u2019\u3001\u65E0\u65B0\u589E\u8BC1\u636E\u5219\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u5F53\u524D\u6682\u65E0\u540E\u7EED\u884C\u4E3A\u6570\u636E\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u9009\u62E9\u4ECD\u56FA\u5316\uFF0C\u6216\u51FA\u73B0\u660E\u663E\u632B\u8D25\u3001\u7ADE\u4E89\u5316\u4E0E\u6750\u6599\u5931\u914D\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u4E0D\u5F97\u53EA\u4EE5\u5347\u661F\u6216\u5B8C\u6210\u7387\u5224\u5B9A\u6821\u51C6\u6210\u529F\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q6-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u5206\u6790\u6750\u6599\u2014\u8BC6\u522B\u9009\u62E9\u6A21\u5F0F\u2014\u73AF\u5883\u63D0\u793A/\u4E2A\u522B\u5BF9\u8BDD\u2014\u652F\u6301\u81EA\u6211\u8C03\u8282\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4F4E\u589E\u76CA\u505C\u6B62\u3002",
            "forbidden_stop": "\u65E0\u6CD5\u89E3\u91CAA\u4E3A\u4F55\u5B9E\u8BC1\u4F4E\u65F6\u4E0D\u5B9C\u8FC7\u65E9\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q6",
        "title": "\u6750\u6599\u9009\u62E9\u65E0\u5C42\u6B21",
        "primary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6E38\u620F\u73AF\u5883\u521B\u8BBE\uFF5C\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u4ECE\u5E7C\u513F\u53D1\u5C55\u548C\u5B66\u4E60\u7ECF\u9A8C\u89D2\u5EA6\u5206\u6790\u4EFB\u52A1\u6750\u6599\u7684\u5C42\u6B21\uFF0C\u52A8\u6001\u8C03\u6574\u6750\u6599\u5448\u73B0\u65B9\u5F0F\uFF0C\u5E76\u901A\u8FC7\u9002\u5EA6\u6311\u6218\u652F\u6301\u5E7C\u513F\u5728\u6E38\u620F\u4E2D\u7EE7\u7EED\u53D1\u5C55\u3002",
        "empirical": {
          "0": [
            "ABCD",
            "ABDC",
            "ACBD",
            "ACDB",
            "ADBC",
            "BACD",
            "BADC"
          ],
          "1": [
            "ADCB",
            "BCAD",
            "CABD",
            "CADB"
          ],
          "2": [
            "BDAC",
            "CBAD",
            "CDAB",
            "DACB"
          ],
          "3": [
            "BCDA",
            "BDCA",
            "CDBA",
            "DABC",
            "DBAC",
            "DCAB"
          ],
          "4": [
            "CBDA",
            "DBCA",
            "DCBA"
          ]
        },
        "scoring_note": "4\u5206\u4E3ACBDA\u3001DBCA\u3001DCBA\uFF0CA\u5747\u5C45\u672B\uFF1B3\u5206\u4E5F\u591A\u7531C/D/B\u5C45\u524D\u3002\u8BF4\u660E\u9AD8\u6C34\u5E73\u503E\u5411\u901A\u8FC7\u6750\u6599\u5448\u73B0\u3001\u56DE\u987E\u6BD4\u8F83\u548C\u9080\u8BF7\u6311\u6218\u6765\u5E2E\u52A9\u5E7C\u513F\u5F62\u6210\u9002\u5B9C\u96BE\u5EA6\u9009\u62E9\uFF0C\u800C\u4E0D\u662F\u6559\u5E08\u6309\u80FD\u529B\u76F4\u63A5\u5206\u914D\u4EFB\u52A1\u5361\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q7": {
      "item_id": "Q7",
      "title": "\u827E\u838E\u516C\u4E3B\u4E0D\u8FD0\u52A8",
      "ontology": {
        "item_id": "Q7",
        "title": "\u827E\u838E\u516C\u4E3B\u4E0D\u8FD0\u52A8",
        "stem": "\u5C0F\u73ED\u7684\u4E00\u6B21\u6237\u5916\u8FD0\u52A8\uFF0C\u6709\u51E0\u4E2A\u5973\u5B69\u5B50\u4ECE\u4E00\u5F00\u59CB\u5C31\u6CA1\u6709\u9009\u62E9\u4EFB\u4F55\u4F53\u80B2\u6D3B\u52A8\u9879\u76EE\uFF0C\u800C\u662F\u805A\u5728\u4E00\u8D77\u5750\u5728\u5730\u4E0A\u73A9\u201C\u827E\u838E\u516C\u4E3B\u201D\u7684\u6E38\u620F\uFF0C\u6BD4\u4E00\u6BD4\u8C01\u7684\u978B\u5B50\u6700\u6F02\u4EAE\uFF0C\u8C01\u7684\u9B54\u6CD5\u6700\u5389\u5BB3\u3002",
        "options": {
          "A": "\u8BE2\u95EE\u5E7C\u513F\u6CA1\u6709\u53C2\u4E0E\u8FD0\u52A8\u7684\u539F\u56E0\uFF0C\u63D0\u4F9B\u4E30\u5BCC\u7684\u6D3B\u52A8\u6750\u6599\u5438\u5F15\u5E7C\u513F\u53C2\u4E0E\u8FD0\u52A8\u6D3B\u52A8\u3002",
          "B": "\u63D0\u9192\u5E7C\u513F\u73B0\u5728\u662F\u8FD0\u52A8\u65F6\u95F4\uFF0C\u8BF7\u4ED6\u4EEC\u7B49\u81EA\u7531\u6E38\u620F\u65F6\u95F4\u518D\u4E00\u8D77\u73A9\u201C\u827E\u838E\u516C\u4E3B\u201D\u7684\u6E38\u620F\u3002",
          "C": "\u5229\u7528\u827E\u838E\u516C\u4E3B\u7684\u978B\u5B50\u8BBE\u8BA1\u8D70\u3001\u8DD1\u3001\u8DF3\u7B49\u6D3B\u52A8\uFF0C\u5E76\u4EE5\u53C2\u4E0E\u8005\u7684\u8EAB\u4EFD\u9080\u8BF7\u5E7C\u513F\u4E00\u8D77\u53C2\u4E0E\u8FD0\u52A8\u3002",
          "D": "\u80AF\u5B9A\u5E7C\u513F\u81EA\u4E3B\u6E38\u620F\u7684\u884C\u4E3A\uFF0C\u8A00\u8BED\u5F15\u5BFC\u5E7C\u513F\u7A7F\u7740\u201C\u6F02\u4EAE\u7684\u978B\u5B50\u201D\u53C2\u4E0E\u8FD0\u52A8\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u4EF7\u503C\u7684\u7406\u89E3\uFF08\u6E38\u620F\u4E2D\u7684\u5B66\u4E60\uFF09\uFF5C\u5BF9\u6E38\u620F\u72EC\u7279\u7684\u5B66\u4E60\u548C\u53D1\u5C55\u4EF7\u503C\u7684\u8BA4\u8BC6",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u7406\u89E3\u5E7C\u513F\u89D2\u8272\u5174\u8DA3\u548C\u5BA1\u7F8E\u7ECF\u9A8C\uFF0C\u5E76\u628A\u201C\u827E\u838E\u516C\u4E3B\u201D\u7684\u6E38\u620F\u5174\u8DA3\u8F6C\u5316\u4E3A\u7B26\u5408\u5E74\u9F84\u7279\u70B9\u7684\u8FD0\u52A8\u53C2\u4E0E\uFF0C\u800C\u4E0D\u662F\u7B80\u5355\u8981\u6C42\u513F\u7AE5\u56DE\u5230\u8FD0\u52A8\u4EFB\u52A1\u3002",
        "slots": [
          {
            "slot_id": "Q7-S1",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u672A\u53C2\u4E0E\u8FD0\u52A8\u7684\u539F\u56E0\u5224\u65AD",
            "definition": "\u4E0D\u628A\u5750\u7740\u73A9\u516C\u4E3B\u7B80\u5355\u7B49\u540C\u4E0D\u914D\u5408\u8FD0\u52A8\uFF0C\u8003\u8651\u5174\u8DA3\u3001\u8EAB\u4F53\u72B6\u6001\u3001\u6D3B\u52A8\u96BE\u5EA6\u3001\u670D\u9970\u3001\u540C\u4F34\u548C\u7A7A\u95F4\u7B49\u539F\u56E0\u3002",
            "diagnostic_meaning": "\u51B3\u5B9A\u652F\u6301\u662F\u5426\u771F\u6B63\u9002\u914D\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u539F\u56E0\u5047\u8BBE/\u8BC1\u636E\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u6027\u522B\u523B\u677F\u5F52\u56E0"
            ],
            "default_priority": "P1",
            "empirical_relation": "A\u6709\u539F\u56E0\u8BE2\u95EE\u4EF7\u503C\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q7-S2",
            "dimension": "A2 \u6E38\u620F\u4EF7\u503C",
            "name": "\u628A\u89D2\u8272\u5174\u8DA3\u89C6\u4E3A\u8FD0\u52A8\u5B66\u4E60\u8D44\u6E90",
            "definition": "\u8BC6\u522B\u827E\u838E\u3001\u516C\u4E3B\u978B\u3001\u9B54\u6CD5\u3001\u540C\u4F34\u60C5\u8282\u7B49\u53EF\u4EE5\u751F\u6210\u8EAB\u4F53\u6D3B\u52A8\uFF0C\u800C\u4E0D\u662F\u628A\u89D2\u8272\u6E38\u620F\u89C6\u4E3A\u8FD0\u52A8\u4E4B\u5916\u7684\u5E72\u6270\u3002",
            "diagnostic_meaning": "\u5BF9\u5E94\u6B21\u6307\u6807\u2018\u6E38\u620F\u4E2D\u7684\u5B66\u4E60\u2019\u3002",
            "core": true,
            "prerequisites": [
              "Q7-S1"
            ],
            "allowed_actions": [
              "\u8D44\u6E90\u63D0\u53D6/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u628A\u5174\u8DA3\u4F5C\u4E3A\u8BF1\u9975\u540E\u7ACB\u5373\u53D6\u6D88"
            ],
            "default_priority": "P1",
            "empirical_relation": "C\u552F\u4E004\u5206\u9996\u4F4D\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q7-S3",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u5174\u8DA3\u2014\u8FD0\u52A8\u76EE\u6807\u878D\u5408",
            "definition": "\u628A\u8D70\u3001\u8DD1\u3001\u8DF3\u3001\u5E73\u8861\u7B49\u52A8\u4F5C\u81EA\u7136\u5D4C\u5165\u89D2\u8272\u6E38\u620F\uFF0C\u65E2\u6709\u771F\u5B9E\u8EAB\u4F53\u6D3B\u52A8\u53C8\u4FDD\u7559\u6E38\u620F\u610F\u4E49\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u4ECE\u5174\u8DA3\u751F\u6210\u8BFE\u7A0B\u7684\u80FD\u529B\u3002",
            "core": true,
            "prerequisites": [
              "Q7-S2"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210"
            ],
            "forbidden_actions": [
              "\u53EA\u7ED9\u52A8\u4F5C\u6E05\u5355"
            ],
            "default_priority": "P1",
            "empirical_relation": "C\u6838\u5FC3\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q7-S4",
            "dimension": "B2 \u6559\u5E08\u89D2\u8272",
            "name": "\u4EE5\u53C2\u4E0E\u8005\u8EAB\u4EFD\u4F4E\u538B\u529B\u9080\u8BF7",
            "definition": "\u6559\u5E08\u8FDB\u5165\u89D2\u8272\u3001\u5171\u540C\u6E38\u620F\u3001\u793A\u8303\u6216\u53D1\u8D77\u4EFB\u52A1\uFF0C\u5E76\u9010\u6B65\u9000\u51FA\uFF0C\u800C\u975E\u7AD9\u5728\u5916\u90E8\u529D\u8BF4\u3002",
            "diagnostic_meaning": "\u4F53\u73B0\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u89D2\u8272\u3002",
            "core": true,
            "prerequisites": [
              "Q7-S2",
              "Q7-S3"
            ],
            "allowed_actions": [
              "\u89D2\u8272\u8FC1\u79FB/\u8BDD\u672F"
            ],
            "forbidden_actions": [
              "\u547D\u4EE4\u505C\u6B62\u539F\u6E38\u620F"
            ],
            "default_priority": "P2",
            "empirical_relation": "C\u4F18\u4E8ED\u7684\u91CD\u8981\u539F\u56E0\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q7-S5",
            "dimension": "C2/A2 \u4EF7\u503C\u6743\u8861",
            "name": "\u8FD0\u52A8\u76EE\u6807\u4E0E\u81EA\u4E3B\u9009\u62E9\u5E73\u8861",
            "definition": "\u6237\u5916\u8FD0\u52A8\u6709\u8EAB\u4F53\u6D3B\u52A8\u76EE\u6807\uFF0C\u4F46\u8FDB\u5165\u65B9\u5F0F\u53EF\u4EE5\u5F39\u6027\uFF1B\u5728\u7406\u89E3\u539F\u56E0\u548C\u5174\u8DA3\u57FA\u7840\u4E0A\u652F\u6301\u53C2\u4E0E\uFF0C\u800C\u975E\u7528\u65F6\u95F4\u89C4\u5219\u538B\u5236\u3002",
            "diagnostic_meaning": "\u89E3\u91CAB\u4E3A\u4F55\u4F4E\u5206\u3002",
            "core": true,
            "prerequisites": [
              "Q7-S1"
            ],
            "allowed_actions": [
              "\u6BD4\u8F83\u6743\u8861"
            ],
            "forbidden_actions": [
              "\u628A\u81EA\u4E3B\u7B49\u540C\u4E0D\u7BA1"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u5B9E\u8BC1B/D\u9760\u540E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q7-S6",
            "dimension": "B1 \u73AF\u5883\u652F\u6301",
            "name": "\u6750\u6599\u4E0E\u7A7A\u95F4\u7684\u529F\u80FD\u6027\u8C03\u6574",
            "definition": "\u6309\u539F\u56E0\u548C\u6E38\u620F\u60C5\u8282\u8865\u5145\u8DEF\u7EBF\u3001\u89D2\u8272\u9053\u5177\u3001\u8F7B\u5668\u68B0\u7B49\uFF0C\u5E76\u89C2\u5BDF\u662F\u5426\u771F\u6B63\u589E\u52A0\u8FD0\u52A8\u6295\u5165\u3002",
            "diagnostic_meaning": "\u652F\u6301\u52A8\u6001\u73AF\u5883\u8C03\u6574\u3002",
            "core": false,
            "prerequisites": [
              "Q7-S3"
            ],
            "allowed_actions": [
              "\u5177\u4F53\u5316/\u53CD\u601D"
            ],
            "forbidden_actions": [
              "\u6750\u6599\u8D8A\u591A\u8D8A\u597D"
            ],
            "default_priority": "P3",
            "empirical_relation": "A\u9700\u5177\u4F53\u5316\u624D\u6709\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q7",
        "anchors": [
          {
            "slot_id": "Q7-S1",
            "level_0": "\u5F52\u56E0\u4E0D\u542C\u8BDD/\u4E0D\u7231\u8FD0\u52A8\u3002",
            "level_1": "\u4F1A\u95EE\u539F\u56E0\u4F46\u4E0D\u6839\u636E\u56DE\u7B54\u8C03\u6574\u3002",
            "level_2": "\u80FD\u8003\u8651\u8EAB\u4F53\u3001\u5174\u8DA3\u3001\u96BE\u5EA6\u3001\u670D\u9970\u3001\u540C\u4F34\u7B49\uFF0C\u5E76\u7528\u89C2\u5BDF/\u8BE2\u95EE\u786E\u8BA4\u3002",
            "level_3": "\u80FD\u5BF9\u4E0D\u540C\u5E7C\u513F\u5206\u522B\u5224\u65AD\uFF0C\u5141\u8BB8\u540C\u4E00\u5C0F\u7EC4\u4E2D\u539F\u56E0\u4E0D\u540C\u3001\u8FDB\u5165\u65B9\u5F0F\u4E0D\u540C\u3002",
            "false_evidence": "\u5F62\u5F0F\u8BE2\u95EE\u540E\u4ECD\u7EDF\u4E00\u8981\u6C42\u53C2\u52A0\u3002",
            "conflict_evidence": "\u6027\u522B\u523B\u677F\u5370\u8C61\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q7-S2",
            "level_0": "\u628A\u827E\u838E\u6E38\u620F\u89C6\u4E3A\u5E94\u505C\u6B62\u7684\u65E0\u5173\u6D3B\u52A8\u3002",
            "level_1": "\u77E5\u9053\u53EF\u501F\u5174\u8DA3\uFF0C\u4F46\u53EA\u4F1A\u53E3\u5934\u5438\u5F15\u3002",
            "level_2": "\u80FD\u63D0\u53D6\u89D2\u8272\u3001\u9B54\u6CD5\u3001\u978B\u5B50\u3001\u6311\u6218\u7B49\u5143\u7D20\u8F6C\u4E3A\u8FD0\u52A8\u60C5\u8282\u3002",
            "level_3": "\u80FD\u548C\u5E7C\u513F\u5171\u540C\u751F\u6210\u8FD0\u52A8\u60C5\u8282\uFF0C\u800C\u975E\u6210\u4EBA\u9884\u5236\u8D34\u6807\u7B7E\u3002",
            "false_evidence": "\u7ED9\u8FD0\u52A8\u9879\u76EE\u6362\u827E\u838E\u540D\u79F0\u3002",
            "conflict_evidence": "\u5174\u8DA3\u53EA\u505A\u8BF1\u9975\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q7-S3",
            "level_0": "\u53EA\u8981\u6C42\u8FD0\u52A8\u6216\u53EA\u966A\u5750\u7740\u73A9\u3002",
            "level_1": "\u8BBE\u8BA1\u4E00\u4E2A\u52A8\u4F5C\uFF0C\u4F46\u6E38\u620F\u6027/\u8FD0\u52A8\u6027\u4E0D\u8DB3\u3002",
            "level_2": "\u628A\u8D70\u8DD1\u8DF3\u3001\u5E73\u8861\u7B49\u81EA\u7136\u5D4C\u5165\u89D2\u8272\u6E38\u620F\uFF0C\u5141\u8BB8\u9009\u62E9\u53C2\u4E0E\u3002",
            "level_3": "\u6839\u636E\u6295\u5165\u3001\u8D1F\u8377\u548C\u80FD\u529B\u52A8\u6001\u6269\u5C55\u52A8\u4F5C\u6311\u6218\uFF0C\u517C\u987E\u5B89\u5168\u3002",
            "false_evidence": "\u53EA\u6709\u53E3\u5934\u60F3\u8C61\u3002",
            "conflict_evidence": "\u4E3A\u4E86\u8FD0\u52A8\u91CF\u7834\u574F\u6E38\u620F\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q7-S4",
            "level_0": "\u547D\u4EE4\u505C\u6B62/\u53C2\u52A0\u3002",
            "level_1": "\u53E3\u5934\u529D\u8BF4\uFF0C\u4F46\u6559\u5E08\u5728\u6E38\u620F\u5916\u3002",
            "level_2": "\u6559\u5E08\u4EE5\u89D2\u8272/\u4F19\u4F34\u8EAB\u4EFD\u52A0\u5165\uFF0C\u9080\u8BF7\u5171\u540C\u5B8C\u6210\u6709\u8EAB\u4F53\u6D3B\u52A8\u7684\u4EFB\u52A1\u3002",
            "level_3": "\u9010\u6E10\u628A\u4E3B\u5BFC\u6743\u4EA4\u8FD8\u5E7C\u513F\uFF0C\u6559\u5E08\u9000\u51FA\u540E\u6E38\u620F\u4ECD\u80FD\u6301\u7EED\u3002",
            "false_evidence": "\u626E\u89D2\u8272\u4F46\u5168\u7A0B\u53D1\u53F7\u65BD\u4EE4\u3002",
            "conflict_evidence": "\u516C\u5F00\u6BD4\u8F83\u8C01\u66F4\u542C\u8BDD\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q7-S5",
            "level_0": "\u8FD0\u52A8\u65F6\u95F4\u5FC5\u987B\u6309\u6210\u4EBA\u9879\u76EE\uFF0C\u6216\u5B8C\u5168\u4E0D\u7BA1\u3002",
            "level_1": "\u77E5\u9053\u4E24\u8005\u90FD\u91CD\u8981\u4F46\u5904\u7406\u6A21\u7CCA\u3002",
            "level_2": "\u8BF4\u660E\u8EAB\u4F53\u6D3B\u52A8\u76EE\u6807\u9700\u8981\u5B9E\u73B0\uFF0C\u4F46\u53EF\u901A\u8FC7\u5174\u8DA3\u5316\u65B9\u5F0F\u3001\u4E0D\u540C\u5F3A\u5EA6\u548C\u8FDB\u5165\u65F6\u673A\u5B9E\u73B0\u3002",
            "level_3": "\u80FD\u8003\u8651\u8EAB\u4F53\u72B6\u6001\u548C\u4E2A\u4F53\u5DEE\u5F02\uFF0C\u5141\u8BB8\u5408\u7406\u4F8B\u5916\u5E76\u6301\u7EED\u63D0\u4F9B\u53EF\u8FDB\u5165\u673A\u4F1A\u3002",
            "false_evidence": "\u81EA\u7531\u9009\u62E9\u56DE\u907F\u8BFE\u7A0B\u8D23\u4EFB\u3002",
            "conflict_evidence": "\u65F6\u95F4\u7EAA\u5F8B\u9AD8\u4E8E\u513F\u7AE5\u72B6\u6001\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q7-S6",
            "level_0": "\u8BA4\u4E3A\u6750\u6599\u8D8A\u591A\u8D8A\u80FD\u8BA9\u5E7C\u513F\u8FD0\u52A8\uFF0C\u6216\u4E0D\u5206\u539F\u56E0\u968F\u610F\u6295\u653E\u3002",
            "level_1": "\u4F1A\u8865\u5145\u89D2\u8272\u9053\u5177\u6216\u5668\u68B0\uFF0C\u4F46\u4E0E\u4E0D\u53C2\u4E0E\u539F\u56E0\u3001\u8FD0\u52A8\u76EE\u6807\u7684\u5173\u7CFB\u8F83\u5F31\u3002",
            "level_2": "\u80FD\u6839\u636E\u539F\u56E0\u548C\u6E38\u620F\u60C5\u8282\u8C03\u6574\u8DEF\u7EBF\u3001\u7A7A\u95F4\u3001\u89D2\u8272\u9053\u5177\u6216\u8F7B\u5668\u68B0\uFF0C\u5E76\u89C2\u5BDF\u8FD0\u52A8\u6295\u5165\u662F\u5426\u589E\u52A0\u3002",
            "level_3": "\u80FD\u6BD4\u8F83\u8C03\u6574\u524D\u540E\u7684\u53C2\u4E0E\u3001\u8D1F\u8377\u3001\u5B89\u5168\u4E0E\u81EA\u4E3B\u6027\uFF0C\u8FED\u4EE3\u73AF\u5883\u540C\u65F6\u907F\u514D\u6750\u6599\u55A7\u5BBE\u593A\u4E3B\u3002",
            "false_evidence": "\u6295\u653E\u2018\u827E\u838E\u2019\u9053\u5177\u5C31\u7B97\u6709\u6548\u3002",
            "conflict_evidence": "\u6750\u6599\u589E\u591A\u4F46\u5E7C\u513F\u4ECD\u9759\u6001\u6E38\u620F\uFF0C\u6216\u98CE\u9669\u589E\u52A0\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q7",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ACADB",
            "hypothesis": "C\u9996\u3001A\u6B21\u3001D\u4E09\u3001B\u672B\uFF0C\u5174\u8DA3\u878D\u5408\u6700\u6E05\u6670\u3002",
            "target_slots": [
              "Q7-S2",
              "Q7-S3",
              "Q7-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB/\u7EC6\u5316",
            "forbidden_question": "\u201CC\u7B2C\u4E00\u5C31\u8BF4\u660E\u5F88\u597D\uFF0C\u4E0D\u7528\u518D\u95EE\u3002\u201D",
            "rationale": "\u9A8C\u8BC1C\u4E0D\u662F\u6210\u4EBA\u5305\u88C5\u7684\u8FD0\u52A8\u4EFB\u52A1\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206\uFF1AACBD/CABD/CDBA",
            "hypothesis": "C/A\u591A\u5C45\u524D\uFF0C\u6574\u4F53\u8F83\u6210\u719F\u4F46\u539F\u56E0\u8BCA\u65AD\u4E0E\u5174\u8DA3\u878D\u5408\u5148\u540E\u4E0D\u7A33\u3002",
            "target_slots": [
              "Q7-S1",
              "Q7-S3"
            ],
            "priority": "P2",
            "preferred_action": "\u6761\u4EF6\u6BD4\u8F83",
            "forbidden_question": "\u201C\u5148\u95EE\u539F\u56E0\u548C\u76F4\u63A5\u52A0\u5165\u6E38\u620F\uFF0C\u4EC0\u4E48\u65F6\u5019\u5404\u81EA\u66F4\u5408\u9002\uFF1F\u201D",
            "rationale": "\u5141\u8BB8A/C\u6761\u4EF6\u6027\u53D8\u5316\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u90E8\u5206\u7406\u89E3\u5174\u8DA3\u548C\u8FD0\u52A8\uFF0C\u4F46\u652F\u6301\u53EF\u80FD\u6CDB\u5316\u3002",
            "target_slots": [
              "Q7-S2",
              "Q7-S4",
              "Q7-S6"
            ],
            "priority": "P1",
            "preferred_action": "\u5177\u4F53\u5316",
            "forbidden_question": "\u201C\u600E\u4E48\u8BA9\u89D2\u8272\u6E38\u620F\u771F\u6B63\u53D8\u6210\u8FD0\u52A8\uFF1F\u201D",
            "rationale": "\u4ECE\u53E3\u53F7\u5230\u64CD\u4F5C\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216B\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u8FD0\u52A8\u65F6\u95F4\u89C4\u5219\u7F6E\u4E8E\u6E38\u620F\u5174\u8DA3\u548C\u4E2A\u4F53\u539F\u56E0\u4E4B\u524D\u3002",
            "target_slots": [
              "Q7-S1",
              "Q7-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u53CD\u4F8B/\u4EF7\u503C\u6743\u8861",
            "forbidden_question": "\u201C\u8FD0\u52A8\u65F6\u95F4\u5FC5\u987B\u505C\u6B62\u89D2\u8272\u6E38\u620F\u5417\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u67E5\u8BFE\u7A0B\u76EE\u6807\u4E0E\u81EA\u4E3B\u6027\u3002",
            "calibration_note": ""
          },
          {
            "condition": "D\u5C45\u524D\u4F46C\u8F83\u540E",
            "hypothesis": "\u53EF\u80FD\u505C\u7559\u5728\u8A00\u8BED\u5F15\u5BFC\uFF0C\u7F3A\u5C11\u6559\u5E08\u4F5C\u4E3A\u5171\u540C\u53C2\u4E0E\u8005\u548C\u60C5\u5883\u751F\u6210\u3002",
            "target_slots": [
              "Q7-S3",
              "Q7-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u89D2\u8272\u8FC1\u79FB",
            "forbidden_question": "\u201C\u5982\u679C\u53EA\u8BF4\u2018\u7A7F\u6F02\u4EAE\u978B\u5B50\u53BB\u8FD0\u52A8\u2019\uFF0C\u4E3A\u4EC0\u4E48\u5B69\u5B50\u4E00\u5B9A\u4F1A\u52A8\u8D77\u6765\uFF1F\u201D",
            "rationale": "\u67E5\u771F\u6B63\u6D3B\u52A8\u8BBE\u8BA1\u3002",
            "calibration_note": ""
          },
          {
            "condition": "C\u5C45\u9996\u4F46A\u672B",
            "hypothesis": "\u53EF\u80FD\u5174\u8DA3\u878D\u5408\u5F3A\uFF0C\u4F46\u5FFD\u7565\u8EAB\u4F53\u4E0D\u9002/\u670D\u9970\u7B49\u771F\u6B63\u539F\u56E0\u3002",
            "target_slots": [
              "Q7-S1"
            ],
            "priority": "P2",
            "preferred_action": "\u53CD\u4F8B",
            "forbidden_question": "\u201C\u5982\u679C\u6709\u5B69\u5B50\u5176\u5B9E\u662F\u56E0\u4E3A\u978B\u5B50\u4E0D\u65B9\u4FBF\u5462\uFF1F\u201D",
            "rationale": "\u9632\u6B62\u5174\u8DA3\u4E07\u80FD\u8BBA\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q7",
        "probes": [
          {
            "slot_id": "Q7-S1",
            "allowed_actions": [
              "\u539F\u56E0\u5047\u8BBE"
            ],
            "preferred_action": "\u8BC1\u636E\u8FFD\u95EE",
            "typical_question": "\u201C\u5979\u4EEC\u4E00\u76F4\u5750\u7740\u73A9\u516C\u4E3B\u65F6\uFF0C\u60A8\u4F1A\u5148\u60F3\u4E86\u89E3\u54EA\u4E9B\u53EF\u80FD\u7684\u539F\u56E0\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u5176\u4E2D\u4E00\u4E2A\u5B69\u5B50\u662F\u978B\u5B50\u4E0D\u65B9\u4FBF\u8DD1\uFF0C\u60A8\u7684\u505A\u6CD5\u4F1A\u600E\u4E48\u53D8\uFF1F\u201D",
            "forbidden_actions": [
              "\u6027\u522B\u5F52\u56E0"
            ],
            "forbidden_question": "\u201C\u5973\u5B69\u5B50\u662F\u4E0D\u662F\u672C\u6765\u5C31\u4E0D\u7231\u8FD0\u52A8\uFF1F\u201D",
            "non_inducing_boundary": "\u907F\u514D\u7FA4\u4F53\u5316\u5224\u65AD\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q7-S2",
            "allowed_actions": [
              "\u5174\u8DA3\u8D44\u6E90\u63D0\u53D6"
            ],
            "preferred_action": "\u8D44\u6E90\u63D0\u53D6",
            "typical_question": "\u201C\u5979\u4EEC\u8FD9\u4E2A\u827E\u838E\u6E38\u620F\u91CC\uFF0C\u54EA\u4E9B\u4E1C\u897F\u53EF\u4EE5\u81EA\u7136\u53D8\u6210\u8EAB\u4F53\u6D3B\u52A8\u7684\u5165\u53E3\uFF1F\u201D",
            "followup_question": "\u201C\u9664\u4E86\u978B\u5B50\uFF0C\u8FD8\u6709\u54EA\u4E9B\u60C5\u8282\uFF1F\u201D",
            "forbidden_actions": [
              "\u76F4\u63A5\u7ED9C\u7B54\u6848"
            ],
            "forbidden_question": "\u201C\u7528\u978B\u5B50\u8BBE\u8BA1\u8D70\u8DD1\u8DF3\u5C31\u884C\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5148\u7531\u6559\u5E08\u8BC6\u522B\u6E38\u620F\u8D44\u6E90\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q7-S3",
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210"
            ],
            "preferred_action": "\u6E38\u620F\u878D\u5408",
            "typical_question": "\u201C\u5982\u679C\u8BA9\u5979\u4EEC\u7EE7\u7EED\u662F\u2018\u827E\u838E\u516C\u4E3B\u2019\uFF0C\u540C\u65F6\u771F\u6B63\u52A8\u8D77\u6765\uFF0C\u60A8\u4F1A\u600E\u6837\u53D1\u5C55\u8FD9\u4E2A\u6E38\u620F\uFF1F\u201D",
            "followup_question": "\u201C\u600E\u6837\u770B\u51FA\u5B83\u4E0D\u662F\u53EA\u6362\u4E86\u4E00\u4E2A\u540D\u5B57\uFF1F\u201D",
            "forbidden_actions": [
              "\u52A8\u4F5C\u6E05\u5355\u5316"
            ],
            "forbidden_question": "\u201C\u8BF7\u5B89\u6392\u8D70\u3001\u8DD1\u3001\u8DF3\u4E09\u4E2A\u9879\u76EE\u3002\u201D",
            "non_inducing_boundary": "\u4FDD\u6301\u6E38\u620F\u751F\u6210\u6027\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q7-S4",
            "allowed_actions": [
              "\u89D2\u8272\u8FDB\u5165"
            ],
            "preferred_action": "\u53C2\u4E0E\u8005\u8EAB\u4EFD",
            "typical_question": "\u201C\u5982\u679C\u60A8\u4EE5\u6E38\u620F\u4F19\u4F34\u8EAB\u4EFD\u8FDB\u53BB\uFF0C\u4F1A\u600E\u4E48\u9080\u8BF7\uFF0C\u624D\u4E0D\u50CF\u5728\u53EB\u5979\u4EEC\u5B8C\u6210\u8FD0\u52A8\u4EFB\u52A1\uFF1F\u201D",
            "followup_question": "\u201C\u4EC0\u4E48\u65F6\u5019\u60A8\u4F1A\u9000\u51FA\uFF1F\u201D",
            "forbidden_actions": [
              "\u5916\u90E8\u547D\u4EE4"
            ],
            "forbidden_question": "\u201C\u73B0\u5728\u8DDF\u8001\u5E08\u6765\u505A\u8FD0\u52A8\u3002\u201D",
            "non_inducing_boundary": "\u68C0\u9A8C\u5171\u540C\u6E38\u620F\u4E0E\u6E10\u9000\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q7-S5",
            "allowed_actions": [
              "\u4EF7\u503C\u6743\u8861"
            ],
            "preferred_action": "\u6BD4\u8F83",
            "typical_question": "\u201C\u6237\u5916\u8FD0\u52A8\u6709\u8EAB\u4F53\u6D3B\u52A8\u76EE\u6807\uFF0C\u5B69\u5B50\u53C8\u6709\u81EA\u5DF1\u7684\u89D2\u8272\u6E38\u620F\uFF0C\u60A8\u4F1A\u600E\u6837\u540C\u65F6\u7167\u987E\uFF1F\u201D",
            "followup_question": "\u201C\u8EAB\u4F53\u72B6\u6001\u4E0D\u4F73\u65F6\u4F1A\u600E\u6837\u53D8\u5316\uFF1F\u201D",
            "forbidden_actions": [
              "\u65F6\u95F4\u89C4\u5219\u7EDD\u5BF9\u5316"
            ],
            "forbidden_question": "\u201C\u8FD0\u52A8\u65F6\u95F4\u5C31\u5FC5\u987B\u8FD0\u52A8\uFF0C\u5BF9\u5417\uFF1F\u201D",
            "non_inducing_boundary": "\u67E5\u76EE\u6807\u4E0E\u81EA\u4E3B\u7684\u6574\u5408\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q7-S6",
            "allowed_actions": [
              "\u5177\u4F53\u5316\uFF0C\u73AF\u5883\u53CD\u601D"
            ],
            "preferred_action": "\u529F\u80FD\u68C0\u9A8C",
            "typical_question": "\u201C\u5982\u679C\u8C03\u6574\u6750\u6599\u6216\u7A7A\u95F4\uFF0C\u60A8\u4F1A\u6539\u4EC0\u4E48\uFF0C\u5E76\u671F\u5F85\u5B83\u5177\u4F53\u589E\u52A0\u54EA\u4E00\u79CD\u8FD0\u52A8\u53C2\u4E0E\uFF1F\u201D",
            "followup_question": "\u201C\u6295\u653E\u540E\u5B69\u5B50\u4ECD\u4E3B\u8981\u5750\u7740\u73A9\uFF0C\u60A8\u4F1A\u600E\u6837\u5224\u65AD\u548C\u8C03\u6574\uFF1F\u201D",
            "forbidden_actions": [
              "\u6750\u6599\u5806\u53E0"
            ],
            "forbidden_question": "\u201C\u591A\u653E\u4E00\u4E9B\u827E\u838E\u9053\u5177\uFF0C\u5B69\u5B50\u81EA\u7136\u5C31\u4F1A\u8FD0\u52A8\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u6750\u6599\u548C\u7A7A\u95F4\u8C03\u6574\u5FC5\u987B\u540C\u65F6\u6709\u539F\u56E0\u3001\u8FD0\u52A8\u529F\u80FD\u4E0E\u89C2\u5BDF\u53CD\u9988\u4F9D\u636E\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q7",
        "rules": [
          {
            "scope": "Q7-S1 \u539F\u56E0\u8BCA\u65AD",
            "sufficient_condition": "\u80FD\u63D0\u51FA\u591A\u539F\u56E0\u5E76\u8BF4\u660E\u4E0D\u540C\u513F\u7AE5\u9700\u8981\u4E0D\u540C\u5224\u65AD\u3002",
            "no_gain_threshold": "1\u8F6E\u53EA\u8BF4\u2018\u5148\u95EE\u539F\u56E0\u2019\u65E0\u8BC1\u636E\uFF0C\u6362\u53CD\u4F8B\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u7B56\u7565\u5B8C\u5168\u5FFD\u89C6\u539F\u56E0\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ7-S2\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u4EC5\u51ED\u5174\u8DA3\u5047\u5B9A\u539F\u56E0\u5DF2\u77E5\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q7-S2~S4 \u5174\u8DA3\u878D\u5408/\u53C2\u4E0E",
            "sufficient_condition": "\u80FD\u4ECE\u89D2\u8272\u6E38\u620F\u751F\u6210\u771F\u5B9E\u8EAB\u4F53\u6D3B\u52A8\uFF0C\u5E76\u4EE5\u4F19\u4F34\u8EAB\u4EFD\u4F4E\u538B\u529B\u52A0\u5165\u3001\u6E10\u9000\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u8BF4\u2018\u501F\u5174\u8DA3\u2019\u65E0\u60C5\u8282/\u52A8\u4F5C\u7EC6\u8282\uFF0C\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u513F\u7AE5\u62D2\u7EDD\u6216\u8FD0\u52A8\u6027\u4E0D\u8DB3\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ7-S5\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u53EA\u662F\u628A\u9879\u76EE\u6362\u540D\u5B57\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q7-S5 \u76EE\u6807/\u81EA\u4E3B\u5E73\u8861",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u8FD0\u52A8\u76EE\u6807\u9700\u8981\u5B9E\u73B0\u4F46\u65B9\u5F0F\u5F39\u6027\uFF0C\u5E76\u7ED9\u51FA\u4E2A\u4F53\u5DEE\u5F02\u8FB9\u754C\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u526A\u679D\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u7528\u65F6\u95F4\u7EAA\u5F8B\u5F3A\u5236\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ7-S6\uFF08\u9700\u8981\u73AF\u5883\u8C03\u6574\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u4E0E\u6838\u5FC3\u5171\u540C\u6EE1\u8DB3\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u628A\u5C0A\u91CD\u81EA\u4E3B\u7B49\u540C\u5B8C\u5168\u4E0D\u652F\u6301\u4E5F\u4E0D\u5F97\u9AD8\u5224\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q7-S6 \u73AF\u5883\u8C03\u6574",
            "sufficient_condition": "\u80FD\u57FA\u4E8E\u539F\u56E0\u548C\u8FD0\u52A8\u76EE\u6807\u8C03\u6574\u6750\u6599\u6216\u7A7A\u95F4\uFF0C\u5E76\u8BF4\u660E\u5982\u4F55\u68C0\u9A8C\u662F\u5426\u771F\u6B63\u589E\u52A0\u8FD0\u52A8\u6295\u5165\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u2018\u589E\u52A0\u6750\u6599\u2019\u3001\u65E0\u529F\u80FD\u4F9D\u636E\u5219\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u786E\u8BA4\u5F53\u524D\u65E0\u9700\u73AF\u5883\u8C03\u6574\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u5E7C\u513F\u4ECD\u4E3B\u8981\u9759\u6001\u6E38\u620F\uFF0C\u6216\u8FD0\u52A8\u8D1F\u8377\u3001\u5B89\u5168\u4E0E\u4E2A\u4F53\u9700\u8981\u5931\u914D\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u6750\u6599\u6570\u91CF\u3001\u89D2\u8272\u540D\u79F0\u6216\u77ED\u6682\u65B0\u5947\u53CD\u5E94\u90FD\u4E0D\u80FD\u5355\u72EC\u8BC1\u660E\u6709\u6548\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q7-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u7406\u89E3\u539F\u56E0\u2014\u63D0\u53D6\u5174\u8DA3\u2014\u751F\u6210\u8FD0\u52A8\u2014\u4F19\u4F34\u8FDB\u5165\u2014\u52A8\u6001\u8C03\u6574\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4F4E\u589E\u76CA\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u65E0\u6CD5\u89E3\u91CAC\u9AD8\u5206\u6838\u5FC3\u673A\u5236\u65F6\u4E0D\u5B9C\u8FC7\u65E9\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q7",
        "title": "\u827E\u838E\u516C\u4E3B\u4E0D\u8FD0\u52A8",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u5224\u65AD\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u5BF9\u6E38\u620F\u7684\u7279\u70B9\u3001\u4EF7\u503C\u7684\u7406\u89E3 \u2192 \u5BF9\u6E38\u620F\u4EF7\u503C\u7684\u7406\u89E3\uFF08\u6E38\u620F\u4E2D\u7684\u5B66\u4E60\uFF09\uFF5C\u5BF9\u6E38\u620F\u72EC\u7279\u7684\u5B66\u4E60\u548C\u53D1\u5C55\u4EF7\u503C\u7684\u8BA4\u8BC6",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u7406\u89E3\u5E7C\u513F\u89D2\u8272\u5174\u8DA3\u548C\u5BA1\u7F8E\u7ECF\u9A8C\uFF0C\u5E76\u628A\u201C\u827E\u838E\u516C\u4E3B\u201D\u7684\u6E38\u620F\u5174\u8DA3\u8F6C\u5316\u4E3A\u7B26\u5408\u5E74\u9F84\u7279\u70B9\u7684\u8FD0\u52A8\u53C2\u4E0E\uFF0C\u800C\u4E0D\u662F\u7B80\u5355\u8981\u6C42\u513F\u7AE5\u56DE\u5230\u8FD0\u52A8\u4EFB\u52A1\u3002",
        "empirical": {
          "0": [
            "ADBC",
            "DBAC",
            "DBCA"
          ],
          "1": [
            "ADCB",
            "BADC",
            "BCDA",
            "BDCA",
            "CBDA",
            "CDAB",
            "DABC",
            "DCBA"
          ],
          "2": [
            "ABCD",
            "ABDC",
            "ACDB",
            "BACD",
            "BCAD",
            "BDAC",
            "CBAD",
            "DACB",
            "DCAB"
          ],
          "3": [
            "ACBD",
            "CABD",
            "CDBA"
          ],
          "4": [
            "CADB"
          ]
        },
        "scoring_note": "\u552F\u4E004\u5206\u4E3ACADB\uFF0C3\u5206\u4E3AACBD\u3001CABD\u3001CDBA\u3002C\u7A33\u5B9A\u6700\u5F3A\uFF0CB/D\u591A\u5C45\u540E\u3002\u8BF4\u660E\u9AD8\u6C34\u5E73\u80FD\u628A\u89D2\u8272\u5174\u8DA3\u76F4\u63A5\u8F6C\u5316\u4E3A\u8EAB\u4F53\u6D3B\u52A8\uFF0C\u540C\u65F6\u4FDD\u7559\u539F\u56E0\u8BCA\u65AD\uFF1B\u5355\u7EAF\u7528\u65F6\u95F4\u89C4\u5219\u628A\u6E38\u620F\u63A8\u8FDF\u5230\u81EA\u7531\u6D3B\u52A8\u4EF7\u503C\u8F83\u4F4E\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q8": {
      "item_id": "Q8",
      "title": "\u5F15\u6C34\u96BE\u9898\u672A\u89E3",
      "ontology": {
        "item_id": "Q8",
        "title": "\u5F15\u6C34\u96BE\u9898\u672A\u89E3",
        "stem": "\u4E2D\u73ED\u4E0A\u5B66\u671F\uFF0C\u5E7C\u513F\u5728\u201C\u5F15\u6C34\u6E38\u620F\u201D\u4E2D\u9047\u5230\u4E86\u96BE\u9898\u2014\u2014\u6C34\u65E0\u6CD5\u88AB\u5F15\u5230\u7AF9\u7247\u7BA1\u9053\u4E0A\u3002\u4ED6\u4EEC\u4E0D\u65AD\u8C03\u6574\u7AF9\u7247\u62FC\u63A5\u7684\u65B9\u5F0F\uFF0C\u5374\u59CB\u7EC8\u6CA1\u80FD\u6210\u529F\uFF0C\u5373\u7AF9\u7247\u4E00\u5934\u9AD8\u4E8E\u51FA\u6C34\u7BA1\u9053\uFF0C\u963B\u788D\u4E86\u5F15\u6D41\u3002\u6E10\u6E10\u5730\u5E7C\u513F\u7684\u63A2\u7D22\u5174\u8DA3\u4E5F\u51CF\u5F31\u4E86\uFF0C\u6709\u7684\u5F00\u59CB\u73A9\u6C34\uFF0C\u6709\u7684\u751A\u81F3\u79BB\u5F00\u4E86\u6C34\u6C60\u3002",
        "options": {
          "A": "\u793A\u8303\u6B63\u786E\u7684\u5F15\u6C34\u65B9\u6CD5\uFF0C\u8BF7\u5E7C\u513F\u6CE8\u610F\u89C2\u5BDF\u5E76\u8BF4\u8BF4\u5F15\u6C34\u7684\u8981\u9886\uFF0C\u518D\u81EA\u5DF1\u8BD5\u4E00\u8BD5\u3002",
          "B": "\u52A0\u5165\u5E7C\u513F\u7684\u63A2\u7D22\uFF0C\u5F15\u5BFC\u4ED6\u4EEC\u89C2\u5BDF\u6C34\u6D41\u53D7\u963B\u7684\u4F4D\u7F6E\uFF0C\u4E00\u8D77\u5C1D\u8BD5\u8C03\u6574\u7AF9\u7247\u7684\u6446\u653E\u65B9\u5F0F\u3002",
          "C": "\u7EC4\u7EC7\u5E7C\u513F\u5C31\u6E38\u620F\u56F0\u96BE\u8FDB\u884C\u8BA8\u8BBA\uFF0C\u5BFB\u627E\u89E3\u51B3\u95EE\u9898\u7684\u65B9\u6848\uFF0C\u5F15\u5BFC\u5E7C\u513F\u518D\u6B21\u5C1D\u8BD5\u3002",
          "D": "\u6295\u653E\u66F4\u591A\u8F85\u52A9\u5F15\u6C34\u7684\u6750\u6599\uFF0C\u91CD\u65B0\u6FC0\u8D77\u5E7C\u513F\u7684\u63A2\u7D22\u5174\u8DA3\uFF0C\u7EE7\u7EED\u89C2\u5BDF\u6E38\u620F\u8FDB\u5C55\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6E38\u620F\u73AF\u5883\u521B\u8BBE\uFF5C\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u5728\u5E7C\u513F\u63A2\u7A76\u5174\u8DA3\u51CF\u5F31\u65F6\uFF0C\u5224\u65AD\u56F0\u96BE\u6765\u6E90\uFF0C\u9009\u62E9\u9002\u5F53\u4ECB\u5165\u65F6\u673A\uFF0C\u5E76\u901A\u8FC7\u6750\u6599\u3001\u95EE\u9898\u6216\u793A\u8303\u652F\u67B6\u6062\u590D\u63A2\u7D22\uFF0C\u800C\u4E0D\u662F\u6025\u4E8E\u66FF\u5E7C\u513F\u5B8C\u6210\u3002",
        "slots": [
          {
            "slot_id": "Q8-S1",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u56F0\u96BE\u673A\u5236\u4E0E\u5173\u952E\u5173\u7CFB\u8BC6\u522B",
            "definition": "\u8BC6\u522B\u6C34\u6D41\u53D7\u963B\u4E0E\u7AF9\u7247\u76F8\u5BF9\u9AD8\u5EA6/\u5761\u5EA6\u5173\u7CFB\uFF0C\u628A\u95EE\u9898\u8F6C\u6210\u5E7C\u513F\u53EF\u89C2\u5BDF\u7684\u2018\u54EA\u91CC\u5835\u4F4F\u3001\u54EA\u8FB9\u9AD8\u4F4E\u2019\u3002",
            "diagnostic_meaning": "\u51B3\u5B9A\u652F\u67B6\u80FD\u5426\u7CBE\u51C6\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u673A\u5236\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u76F4\u63A5\u544A\u8BC9\u7B54\u6848"
            ],
            "default_priority": "P1",
            "empirical_relation": "B\u9AD8\u5206\u5173\u952E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q8-S2",
            "dimension": "C1/C2 \u72B6\u6001\u5224\u65AD",
            "name": "\u5DF2\u6709\u5C1D\u8BD5\u3001\u5174\u8DA3\u4E0B\u964D\u4E0EZPD\u5224\u65AD",
            "definition": "\u770B\u5230\u5E7C\u513F\u5DF2\u53CD\u590D\u8C03\u6574\u5374\u6CA1\u6293\u4F4F\u5173\u952E\u5173\u7CFB\uFF0C\u4E14\u5174\u8DA3\u4E0B\u964D\uFF0C\u8BF4\u660E\u4EC5\u7EE7\u7EED\u81EA\u7531\u8BD5\u8BEF\u7684\u8FB9\u9645\u6536\u76CA\u53D8\u4F4E\u3002",
            "diagnostic_meaning": "\u7528\u4E8E\u51B3\u5B9A\u4ECB\u5165\u65F6\u673A\u548C\u5F3A\u5EA6\u3002",
            "core": true,
            "prerequisites": [
              "Q8-S1"
            ],
            "allowed_actions": [
              "\u8BC1\u636E\u8FFD\u95EE/\u72B6\u6001\u5224\u65AD"
            ],
            "forbidden_actions": [
              "\u628A\u5931\u8D25\u5F52\u80FD\u529B\u4E0D\u8DB3"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u5BF9\u5E94\u4ECB\u5165\u65F6\u673A\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q8-S3",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u5206\u7EA7\u652F\u67B6\u800C\u975E\u76F4\u63A5\u793A\u8303",
            "definition": "\u5148\u5F15\u5BFC\u89C2\u5BDF\u53D7\u963B\u70B9\u3001\u6BD4\u8F83\u9AD8\u4F4E\uFF0C\u518D\u5171\u540C\u8BD5\u9A8C\uFF1B\u53EA\u6709\u66F4\u4F4E\u5F3A\u5EA6\u652F\u67B6\u65E0\u6548\u65F6\u624D\u8003\u8651\u5C40\u90E8\u793A\u8303\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u6700\u5C0F\u5FC5\u8981\u652F\u67B6\u3002",
            "core": true,
            "prerequisites": [
              "Q8-S1",
              "Q8-S2"
            ],
            "allowed_actions": [
              "\u5C42\u7EA7\u6BD4\u8F83/\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u5B8C\u6574\u793A\u8303"
            ],
            "default_priority": "P1",
            "empirical_relation": "A\u5728\u9AD8\u5206\u4E2D\u9760\u540E\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q8-S4",
            "dimension": "C2 \u63A2\u7A76\u652F\u6301",
            "name": "\u89C2\u5BDF\u2014\u5047\u8BBE\u2014\u5C1D\u8BD5\u5FAA\u73AF",
            "definition": "\u652F\u6301\u5E7C\u513F\u770B\u73B0\u8C61\u3001\u731C\u539F\u56E0\u3001\u8C03\u6574\u4E00\u5904\u3001\u89C2\u5BDF\u7ED3\u679C\u3001\u7EE7\u7EED\u4FEE\u6B63\uFF0C\u800C\u975E\u53EA\u8FFD\u6210\u529F\u3002",
            "diagnostic_meaning": "\u4F53\u73B0\u95EE\u9898\u89E3\u51B3\u548C\u5B66\u4E60\u54C1\u8D28\u3002",
            "core": true,
            "prerequisites": [
              "Q8-S3"
            ],
            "allowed_actions": [
              "\u8FC7\u7A0B\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u53EA\u8FFD\u6700\u7EC8\u6210\u529F"
            ],
            "default_priority": "P1",
            "empirical_relation": "B/C\u5747\u53EF\u80FD\u652F\u6301\uFF0CB\u66F4\u8D34\u673A\u5236\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q8-S5",
            "dimension": "B1 \u6750\u6599\u652F\u6301",
            "name": "\u6750\u6599\u6295\u653E\u7684\u529F\u80FD\u6027",
            "definition": "\u65B0\u589E\u6750\u6599\u5FC5\u987B\u5E2E\u52A9\u6BD4\u8F83\u3001\u8FDE\u63A5\u3001\u652F\u6491\u6216\u89C2\u5BDF\u6C34\u6D41\uFF0C\u5E76\u4E0E\u5DF2\u8BCA\u65AD\u7684\u56F0\u96BE\u76F8\u5173\uFF1B\u4E0D\u80FD\u53EA\u9760\u65B0\u5947\u6750\u6599\u91CD\u65B0\u6FC0\u8DA3\u3002",
            "diagnostic_meaning": "\u5BF9\u5E94\u6B21\u6307\u6807\u6750\u6599\u6295\u653E\u3002",
            "core": true,
            "prerequisites": [
              "Q8-S1",
              "Q8-S2"
            ],
            "allowed_actions": [
              "\u5177\u4F53\u5316/\u53CD\u4F8B"
            ],
            "forbidden_actions": [
              "\u6750\u6599\u8D8A\u591A\u8D8A\u597D"
            ],
            "default_priority": "P2",
            "empirical_relation": "D\u4E2D\u4F4D\uFF0C\u4EF7\u503C\u53D6\u51B3\u4E8E\u529F\u80FD\u6027\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q8-S6",
            "dimension": "C2 \u52A8\u673A\u8C03\u8282",
            "name": "\u5174\u8DA3\u4E0B\u964D\u65F6\u7684\u6311\u6218\u8C03\u8282",
            "definition": "\u901A\u8FC7\u7F29\u5C0F\u95EE\u9898\u3001\u5171\u540C\u63A2\u7D22\u3001\u5236\u9020\u53EF\u89C1\u8FDB\u5C55\u6062\u590D\u53EF\u8FBE\u6210\u611F\uFF0C\u540C\u65F6\u4FDD\u7559\u6838\u5FC3\u96BE\u9898\u3002",
            "diagnostic_meaning": "\u628A\u8BA4\u77E5\u652F\u67B6\u548C\u60C5\u7EEA\u652F\u6301\u8054\u52A8\u3002",
            "core": false,
            "prerequisites": [
              "Q8-S2"
            ],
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210"
            ],
            "forbidden_actions": [
              "\u5956\u52B1\u575A\u6301"
            ],
            "default_priority": "P2",
            "empirical_relation": "\u9AD8\u6C34\u5E73\u6269\u5C55\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q8",
        "anchors": [
          {
            "slot_id": "Q8-S1",
            "level_0": "\u53EA\u8BF4\u4E0D\u4F1A\u5F15\u6C34\uFF0C\u4E0D\u6307\u51FA\u5173\u952E\u5173\u7CFB\u3002",
            "level_1": "\u77E5\u9053\u4E0E\u7AF9\u7247\u6446\u653E\u6709\u5173\uFF0C\u4F46\u6A21\u7CCA\u3002",
            "level_2": "\u660E\u786E\u5173\u6CE8\u51FA\u6C34\u53E3\u4E0E\u7AF9\u7247\u76F8\u5BF9\u9AD8\u5EA6\u3001\u5761\u5EA6\u548C\u53D7\u963B\u4F4D\u7F6E\uFF0C\u5E76\u77E5\u9053\u53EF\u901A\u8FC7\u89C2\u5BDF\u6BD4\u8F83\u53D1\u73B0\u3002",
            "level_3": "\u80FD\u628A\u673A\u5236\u8F6C\u4E3A\u5E7C\u513F\u53EF\u89C2\u5BDF\u7EBF\u7D22\uFF0C\u5E76\u8BBE\u8BA1\u8BA9\u5E7C\u513F\u81EA\u5DF1\u53D1\u73B0\u7684\u529E\u6CD5\u3002",
            "false_evidence": "\u6559\u5E08\u81EA\u5DF1\u77E5\u9053\u7B54\u6848\u4F46\u4E0D\u4F1A\u8F6C\u652F\u67B6\u3002",
            "conflict_evidence": "\u5F52\u56E0\u6750\u6599\u4E0D\u597D\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q8-S2",
            "level_0": "\u5FFD\u7565\u53CD\u590D\u5C1D\u8BD5\u548C\u5174\u8DA3\u4E0B\u964D\u3002",
            "level_1": "\u77E5\u9053\u6709\u632B\u8D25\uFF0C\u4F46\u4E0D\u4E86\u89E3\u5DF2\u5C1D\u8BD5\u4EC0\u4E48\u3002",
            "level_2": "\u6982\u62EC\u5E7C\u513F\u5DF2\u7ECF\u8C03\u6574\u62FC\u63A5\u5374\u672A\u5173\u6CE8\u5173\u952E\u9AD8\u5EA6\uFF0C\u5224\u65AD\u81EA\u7531\u8BD5\u8BEF\u6536\u76CA\u4E0B\u964D\uFF0C\u9700\u8981\u5B9A\u5411\u652F\u67B6\u3002",
            "level_3": "\u80FD\u533A\u5206\u64CD\u4F5C\u4E0D\u4F1A\u3001\u672A\u89C2\u5BDF\u5173\u7CFB\u3001\u9700\u8981\u6BD4\u8F83\u5B9E\u9A8C\u7B49\u72B6\u6001\uFF0C\u5E76\u5339\u914D\u652F\u67B6\u3002",
            "false_evidence": "\u53EA\u9F13\u52B1\u575A\u6301\u3002",
            "conflict_evidence": "\u5174\u8DA3\u4E0B\u964D\u4ECD\u65E0\u9650\u81EA\u7531\u8BD5\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q8-S3",
            "level_0": "\u7ACB\u5373\u5B8C\u6574\u793A\u8303\u6216\u5B8C\u5168\u4E0D\u5E2E\u3002",
            "level_1": "\u7ED9\u63D0\u793A\u4F46\u8FC7\u5BBD/\u8FC7\u5F3A\u3002",
            "level_2": "\u5148\u6307\u5411\u53D7\u963B\u4F4D\u7F6E/\u9AD8\u4F4E\u6BD4\u8F83\uFF0C\u7B49\u5F85\u5E7C\u513F\u8BD5\uFF0C\u518D\u6309\u53CD\u5E94\u9010\u7EA7\u589E\u52A0\u5E2E\u52A9\u3002",
            "level_3": "\u80FD\u63CF\u8FF0\u6E05\u6670\u652F\u67B6\u9636\u68AF\u548C\u5347\u7EA7\u6761\u4EF6\uFF0C\u5E7C\u513F\u53D1\u73B0\u540E\u8FC5\u901F\u9000\u56DE\u89C2\u5BDF\u8005\u3002",
            "false_evidence": "\u63D0\u95EE\u81EA\u52A8\u7B49\u4E8E\u4F4E\u652F\u67B6\u3002",
            "conflict_evidence": "\u95EE\u9898\u91CC\u5DF2\u5305\u542B\u7B54\u6848\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q8-S4",
            "level_0": "\u53EA\u8BA9\u5E7C\u513F\u6210\u529F\u3002",
            "level_1": "\u8BA9\u5E7C\u513F\u518D\u8BD5\u4F46\u65E0\u660E\u786E\u6BD4\u8F83\u3002",
            "level_2": "\u5F15\u5BFC\u770B\u53D7\u963B\u70B9\u3001\u731C\u539F\u56E0\u3001\u8C03\u6574\u4E00\u5904\u3001\u770B\u7ED3\u679C\uFF0C\u5E76\u7EE7\u7EED\u4FEE\u6B63\u3002",
            "level_3": "\u80FD\u652F\u6301\u6BD4\u8F83\u4E0D\u540C\u5761\u5EA6/\u4F4D\u7F6E\u5E76\u5F62\u6210\u53EF\u8FC1\u79FB\u7ECF\u9A8C\uFF0C\u64CD\u4F5C\u6743\u6301\u7EED\u5728\u5E7C\u513F\u3002",
            "false_evidence": "\u8BA8\u8BBA\u70ED\u95F9\u4F46\u4E0D\u9A8C\u8BC1\u3002",
            "conflict_evidence": "\u8BA8\u8BBA\u540E\u6559\u5E08\u76F4\u63A5\u5B8C\u6210\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q8-S5",
            "level_0": "\u53EA\u8BF4\u52A0\u66F4\u591A\u6750\u6599\u3002",
            "level_1": "\u80FD\u4E3E\u6750\u6599\u4F46\u4E0E\u56F0\u96BE\u673A\u5236\u5173\u7CFB\u5F31\u3002",
            "level_2": "\u9009\u62E9\u80FD\u5E2E\u52A9\u652F\u6491\u3001\u8FDE\u63A5\u3001\u6BD4\u8F83\u6216\u89C2\u5BDF\u6C34\u6D41\u7684\u6750\u6599\uFF0C\u5E76\u8BF4\u660E\u4E3A\u4EC0\u4E48\u3002",
            "level_3": "\u80FD\u4F9D\u636E\u6750\u6599\u4F7F\u7528\u7ED3\u679C\u518D\u6B21\u8C03\u6574\u73AF\u5883\uFF0C\u907F\u514D\u6750\u6599\u523A\u6FC0\u63A9\u76D6\u6838\u5FC3\u95EE\u9898\u3002",
            "false_evidence": "\u8D8A\u591A\u8D8A\u597D\u3002",
            "conflict_evidence": "\u65B0\u6750\u6599\u8BA9\u5E7C\u513F\u79BB\u5F00\u539F\u95EE\u9898\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q8-S6",
            "level_0": "\u5174\u8DA3\u4E0B\u964D\u5C31\u5956\u52B1\u575A\u6301\u3001\u6362\u65B0\u73A9\u5177\u6216\u76F4\u63A5\u7ED9\u51FA\u7B54\u6848\u3002",
            "level_1": "\u4F1A\u9F13\u52B1\u6216\u7F29\u5C0F\u4EFB\u52A1\uFF0C\u4F46\u6CA1\u6709\u4FDD\u7559\u6838\u5FC3\u96BE\u9898\uFF0C\u4E5F\u672A\u5F62\u6210\u53EF\u89C1\u8FDB\u5C55\u3002",
            "level_2": "\u80FD\u901A\u8FC7\u7F29\u5C0F\u95EE\u9898\u3001\u5171\u540C\u63A2\u7D22\u6216\u5448\u73B0\u5C40\u90E8\u53EF\u89C1\u8FDB\u5C55\u6062\u590D\u53EF\u8FBE\u6210\u611F\uFF0C\u540C\u65F6\u4FDD\u7559\u9AD8\u5EA6/\u5761\u5EA6\u8FD9\u4E00\u6838\u5FC3\u96BE\u9898\u3002",
            "level_3": "\u80FD\u4F9D\u636E\u5E7C\u513F\u8BA4\u77E5\u4E0E\u60C5\u7EEA\u53CD\u9988\u52A8\u6001\u8C03\u8282\u6311\u6218\u548C\u652F\u67B6\uFF0C\u6062\u590D\u6295\u5165\u540E\u9010\u6B65\u5F52\u8FD8\u63A2\u7A76\u4E3B\u5BFC\u6743\u3002",
            "false_evidence": "\u53EA\u8BF4\u2018\u518D\u8BD5\u4E00\u6B21\u2019\u3002",
            "conflict_evidence": "\u5956\u52B1\u6216\u65B0\u5947\u6750\u6599\u66FF\u4EE3\u95EE\u9898\u89E3\u51B3\uFF0C\u6216\u8FC7\u5EA6\u7B80\u5316\u4F7F\u96BE\u9898\u6D88\u5931\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q8",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ABCDA",
            "hypothesis": "B\u9996\u3001C\u6B21\u3001D\u4E09\u3001A\u672B\uFF1B\u5171\u540C\u63A2\u7A76\u548C\u673A\u5236\u652F\u67B6\u6700\u5F3A\u3002",
            "target_slots": [
              "Q8-S1",
              "Q8-S3",
              "Q8-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB/\u5C42\u7EA7",
            "forbidden_question": "\u201CB\u7B2C\u4E00\u5C31\u8BF4\u660E\u5904\u7406\u5B8C\u7F8E\u3002\u201D",
            "rationale": "\u9A8C\u8BC1\u6559\u5E08\u80FD\u5426\u8BF4\u6E05\u2018\u5F15\u5BFC\u5230\u4EC0\u4E48\u7A0B\u5EA6\u2019\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206",
            "hypothesis": "B\u591A\u5C45\u524D\uFF0CC/D\u987A\u5E8F\u53D8\u5316\uFF1B\u6838\u5FC3\u8F83\u6210\u719F\u4F46\u6750\u6599\u548C\u8BA8\u8BBA\u8FB9\u754C\u4E0D\u7A33\u3002",
            "target_slots": [
              "Q8-S4",
              "Q8-S5"
            ],
            "priority": "P2",
            "preferred_action": "\u6BD4\u8F83",
            "forbidden_question": "\u201C\u8BA8\u8BBA\u548C\u52A0\u6750\u6599\u4EC0\u4E48\u65F6\u5019\u6709\u7528\uFF1F\u201D",
            "rationale": "\u67E5\u662F\u5426\u670D\u52A1\u4E8E\u5DF2\u8BCA\u65AD\u673A\u5236\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u90E8\u5206\u652F\u6301\u63A2\u7A76\uFF0C\u4F46\u53EF\u80FD\u63D0\u793A\u8FC7\u5BBD\u6216\u6750\u6599\u6CDB\u5316\u3002",
            "target_slots": [
              "Q8-S2",
              "Q8-S3"
            ],
            "priority": "P1",
            "preferred_action": "\u652F\u67B6\u9636\u68AF",
            "forbidden_question": "\u201C\u81EA\u7531\u8BD5\u591A\u4E45\u4EE5\u540E\u8BE5\u591A\u5E2E\u4E00\u70B9\uFF1F\u201D",
            "rationale": "\u67E5ZPD\u548C\u5347\u7EA7\u9608\u503C\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216A\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u91CD\u6548\u7387\u548C\u793A\u8303\uFF0C\u538B\u7F29\u5E7C\u513F\u53D1\u73B0\u8FC7\u7A0B\u3002",
            "target_slots": [
              "Q8-S3",
              "Q8-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u53CD\u4F8B/\u8FB9\u754C",
            "forbidden_question": "\u201C\u6700\u5FEB\u793A\u8303\u6210\u529F\u4F1A\u5931\u53BB\u4EC0\u4E48\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u67E5\u6700\u5C0F\u5FC5\u8981\u652F\u67B6\u3002",
            "calibration_note": ""
          },
          {
            "condition": "D\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u5174\u8DA3\u4E0B\u964D\u4E3B\u8981\u770B\u6210\u6750\u6599\u523A\u6FC0\u95EE\u9898\u3002",
            "target_slots": [
              "Q8-S1",
              "Q8-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u673A\u5236\u8FFD\u95EE",
            "forbidden_question": "\u201C\u65B0\u589E\u6750\u6599\u5177\u4F53\u8981\u89E3\u51B3\u54EA\u4E2A\u56F0\u96BE\uFF1F\u201D",
            "rationale": "\u9632\u6B62\u6750\u6599\u66FF\u4EE3\u8BCA\u65AD\u3002",
            "calibration_note": ""
          },
          {
            "condition": "B\u5C45\u9996\u4F46\u6559\u5E08\u76F4\u63A5\u6307\u51FA\u2018\u7AF9\u7247\u9AD8\u4E86\u2019",
            "hypothesis": "\u6392\u5E8F\u9AD8\u4F46\u95EE\u9898\u4ECD\u53EF\u80FD\u8FC7\u5F3A\u3002",
            "target_slots": [
              "Q8-S3"
            ],
            "priority": "P1",
            "preferred_action": "\u8BDD\u672F\u91CD\u6784",
            "forbidden_question": "\u201C\u600E\u6837\u63D0\u793A\u5230\u53D7\u963B\u4F4D\u7F6E\uFF0C\u800C\u4E0D\u628A\u9AD8\u5EA6\u7B54\u6848\u76F4\u63A5\u8BF4\u51FA\u6765\uFF1F\u201D",
            "rationale": "\u7EC6\u5316\u652F\u67B6\u5F3A\u5EA6\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q8",
        "probes": [
          {
            "slot_id": "Q8-S1",
            "allowed_actions": [
              "\u673A\u5236\u8FFD\u95EE"
            ],
            "preferred_action": "\u5177\u4F53\u5316",
            "typical_question": "\u201C\u60A8\u89C9\u5F97\u5B69\u5B50\u771F\u6B63\u5361\u4F4F\u7684\u5173\u952E\u70B9\u662F\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u8BA9\u5B69\u5B50\u81EA\u5DF1\u770B\u5230\u8FD9\u4E2A\u5173\u952E\u70B9\uFF0C\u60A8\u4F1A\u5148\u8BA9\u4ED6\u4EEC\u89C2\u5BDF\u54EA\u91CC\uFF1F\u201D",
            "forbidden_actions": [
              "\u76F4\u63A5\u7ED9\u7B54\u6848"
            ],
            "forbidden_question": "\u201C\u662F\u4E0D\u662F\u56E0\u4E3A\u7AF9\u7247\u9AD8\u4E8E\u51FA\u6C34\u53E3\uFF1F\u201D",
            "non_inducing_boundary": "\u770B\u6559\u5E08\u80FD\u5426\u81EA\u4E3B\u63D0\u53D6\u9898\u5E72\u673A\u5236\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q8-S2",
            "allowed_actions": [
              "\u72B6\u6001\u5224\u65AD"
            ],
            "preferred_action": "\u8BC1\u636E\u8FFD\u95EE",
            "typical_question": "\u201C\u4ED6\u4EEC\u5DF2\u7ECF\u53CD\u590D\u8C03\u6574\u53C8\u5F00\u59CB\u5931\u53BB\u5174\u8DA3\uFF0C\u8FD9\u8BF4\u660E\u73B0\u5728\u9700\u8981\u4EC0\u4E48\u7A0B\u5EA6\u7684\u5E2E\u52A9\uFF1F\u201D",
            "followup_question": "\u201C\u54EA\u4E9B\u8868\u73B0\u8BF4\u660E\u7EE7\u7EED\u81EA\u7531\u8BD5\u53EF\u80FD\u6536\u83B7\u4E0D\u5927\uFF1F\u201D",
            "forbidden_actions": [
              "\u80FD\u529B\u8BC4\u4EF7"
            ],
            "forbidden_question": "\u201C\u4ED6\u4EEC\u662F\u4E0D\u662F\u4E0D\u4F1A\u601D\u8003\uFF1F\u201D",
            "non_inducing_boundary": "\u56F4\u7ED5\u5F53\u524D\u8BC1\u636E\u5224\u65AD\u652F\u67B6\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q8-S3",
            "allowed_actions": [
              "\u652F\u67B6\u5C42\u7EA7"
            ],
            "preferred_action": "\u5C42\u7EA7\u6BD4\u8F83",
            "typical_question": "\u201C\u5982\u679C\u4ECE\u6700\u8F7B\u7684\u5E2E\u52A9\u5F00\u59CB\uFF0C\u7B2C\u4E00\u6B65\u4F1A\u63D0\u793A\u4EC0\u4E48\uFF1F\u6CA1\u6548\u679C\u65F6\u4E0B\u4E00\u6B65\u5462\uFF1F\u201D",
            "followup_question": "\u201C\u4EC0\u4E48\u60C5\u51B5\u4E0B\u60A8\u624D\u4F1A\u8003\u8651\u793A\u8303\uFF1F\u201D",
            "forbidden_actions": [
              "\u7EDD\u5BF9\u7981\u6B62\u793A\u8303"
            ],
            "forbidden_question": "\u201C\u4E13\u4E1A\u6559\u5E08\u662F\u4E0D\u662F\u4E0D\u80FD\u793A\u8303\uFF1F\u201D",
            "non_inducing_boundary": "\u68C0\u9A8C\u9636\u68AF\u4E0E\u8FB9\u754C\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q8-S4",
            "allowed_actions": [
              "\u63A2\u7A76\u8FC7\u7A0B"
            ],
            "preferred_action": "\u8FC7\u7A0B\u8FFD\u95EE",
            "typical_question": "\u201C\u60A8\u5E0C\u671B\u5B69\u5B50\u63A5\u4E0B\u6765\u7ECF\u5386\u600E\u6837\u4E00\u8F6E\u2018\u770B\u2014\u731C\u2014\u8BD5\u2014\u518D\u770B\u2019\uFF1F\u201D",
            "followup_question": "\u201C\u8C03\u6574\u4E00\u6B21\u540E\u4F1A\u6BD4\u8F83\u4EC0\u4E48\uFF1F\u201D",
            "forbidden_actions": [
              "\u8FFD\u6210\u529F\u6548\u7387"
            ],
            "forbidden_question": "\u201C\u600E\u6837\u6700\u5FEB\u628A\u6C34\u5F15\u8FC7\u53BB\uFF1F\u201D",
            "non_inducing_boundary": "\u8FC7\u7A0B\u4F18\u5148\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q8-S5",
            "allowed_actions": [
              "\u6750\u6599\u529F\u80FD"
            ],
            "preferred_action": "\u5177\u4F53\u5316",
            "typical_question": "\u201C\u5982\u679C\u8981\u589E\u52A0\u6750\u6599\uFF0C\u60A8\u4F1A\u52A0\u4EC0\u4E48\uFF0C\u5B83\u5177\u4F53\u5E2E\u52A9\u5E7C\u513F\u53D1\u73B0\u6216\u89E3\u51B3\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u6750\u6599\u53EA\u662F\u8BA9\u4ED6\u4EEC\u91CD\u65B0\u73A9\u6C34\uFF0C\u60A8\u4F1A\u600E\u4E48\u5224\u65AD\uFF1F\u201D",
            "forbidden_actions": [
              "\u6750\u6599\u6CDB\u5316"
            ],
            "forbidden_question": "\u201C\u591A\u653E\u6750\u6599\u5C31\u80FD\u6FC0\u53D1\u5174\u8DA3\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u6750\u6599\u5FC5\u987B\u6709\u673A\u5236\u4F9D\u636E\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q8-S6",
            "allowed_actions": [
              "\u7B56\u7565\u751F\u6210\uFF0C\u72B6\u6001\u8C03\u8282"
            ],
            "preferred_action": "\u6311\u6218\u8C03\u8282",
            "typical_question": "\u201C\u5B69\u5B50\u5174\u8DA3\u4E0B\u964D\u65F6\uFF0C\u60A8\u4F1A\u600E\u6837\u628A\u96BE\u9898\u7F29\u5C0F\u5230\u53EF\u7EE7\u7EED\u63A2\u7D22\uFF0C\u540C\u65F6\u4E0D\u628A\u5173\u952E\u7B54\u6848\u62FF\u8D70\uFF1F\u201D",
            "followup_question": "\u201C\u4EC0\u4E48\u53D8\u5316\u8BF4\u660E\u53EF\u4EE5\u51CF\u5C11\u5E2E\u52A9\uFF0C\u4EC0\u4E48\u60C5\u51B5\u9700\u8981\u518D\u8C03\u8282\u6311\u6218\uFF1F\u201D",
            "forbidden_actions": [
              "\u5956\u52B1\u66FF\u4EE3"
            ],
            "forbidden_question": "\u201C\u7ED9\u4E00\u70B9\u5956\u52B1\u8BA9\u4ED6\u4EEC\u575A\u6301\uFF0C\u5174\u8DA3\u5C31\u4F1A\u56DE\u6765\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u8C03\u8282\u53EF\u8FBE\u6210\u611F\u4F46\u4FDD\u7559\u6838\u5FC3\u96BE\u9898\uFF0C\u5E76\u4F9D\u636E\u8BA4\u77E5\u4E0E\u60C5\u7EEA\u53CD\u9988\u6E10\u9000\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q8",
        "rules": [
          {
            "scope": "Q8-S1~S2 \u673A\u5236/\u72B6\u6001",
            "sufficient_condition": "\u80FD\u8BC6\u522B\u9AD8\u5EA6/\u5761\u5EA6\u5173\u7CFB\uFF0C\u5E76\u7ED3\u5408\u53CD\u590D\u5C1D\u8BD5\u548C\u5174\u8DA3\u4E0B\u964D\u5224\u65AD\u9700\u8981\u5B9A\u5411\u652F\u67B6\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u2018\u89C2\u5BDF\u539F\u56E0\u2019\u65E0\u5173\u952E\u73B0\u8C61\u5219\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u7B56\u7565\u4E0E\u673A\u5236\u65E0\u5173\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ8-S3\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u4E0D\u77E5\u9053\u5361\u70B9\u4E0D\u5F97\u9AD8\u5224\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q8-S3~S4 \u652F\u67B6/\u63A2\u7A76",
            "sufficient_condition": "\u80FD\u7ED9\u81F3\u5C112\u7EA7\u7531\u8F7B\u5230\u91CD\u652F\u67B6\uFF0C\u5E76\u4FDD\u6301\u89C2\u5BDF\u2014\u5047\u8BBE\u2014\u5C1D\u8BD5\u5FAA\u73AF\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u8BF4\u2018\u5F15\u5BFC\u89C2\u5BDF\u2019\u65E0\u5347\u7EA7\u6761\u4EF6\uFF0C\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u9047\u5931\u8D25\u5373\u793A\u8303\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ8-S5\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u53EA\u6709\u2018\u4E0D\u544A\u8BC9\u7B54\u6848\u2019\u53E3\u53F7\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q8-S5 \u6750\u6599",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u6750\u6599\u4E0E\u56F0\u96BE\u673A\u5236\u7684\u529F\u80FD\u5173\u7CFB\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u526A\u679D\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u53C8\u4EE5\u65B0\u5947\u523A\u6FC0\u66FF\u4EE3\u95EE\u9898\u89E3\u51B3\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ8-S6\uFF08\u5174\u8DA3\u4E0B\u964D/\u53EF\u8FBE\u6210\u611F\u4E0D\u8DB3\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u4E0E\u6838\u5FC3\u5171\u540C\u6EE1\u8DB3\u65F6\u505C\u6B62\u3002",
            "forbidden_stop": "\u6750\u6599\u6570\u91CF\u88AB\u5F53\u4E3B\u8981\u7B56\u7565\u65F6\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q8-S6 \u6311\u6218\u8C03\u8282",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u5982\u4F55\u7F29\u5C0F\u95EE\u9898\u3001\u5171\u540C\u63A2\u7D22\u6216\u5236\u9020\u53EF\u89C1\u8FDB\u5C55\u6765\u6062\u590D\u53EF\u8FBE\u6210\u611F\uFF0C\u540C\u65F6\u4FDD\u7559\u6838\u5FC3\u96BE\u9898\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u9F13\u52B1\u6216\u5956\u52B1\u3001\u65E0\u6311\u6218\u8C03\u8282\u673A\u5236\u5219\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u5E7C\u513F\u5174\u8DA3\u7A33\u5B9A\u4E14\u5F53\u524D\u65E0\u9700\u8C03\u8282\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u5174\u8DA3\u518D\u6B21\u4E0B\u964D\u3001\u652F\u6301\u8FC7\u5F3A\u4F7F\u96BE\u9898\u6D88\u5931\uFF0C\u6216\u8FDE\u7EED\u5C1D\u8BD5\u4ECD\u65E0\u53EF\u89C1\u8FDB\u5C55\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u4E0D\u5F97\u7528\u5956\u52B1\u3001\u65B0\u5947\u6750\u6599\u6216\u76F4\u63A5\u7B54\u6848\u66FF\u4EE3\u56F0\u96BE\u673A\u5236\u4E0E\u63A2\u7A76\u652F\u67B6\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q8-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u8BC6\u522B\u673A\u5236\u2014\u5224\u65ADZPD\u2014\u5206\u7EA7\u652F\u67B6\u2014\u513F\u7AE5\u9A8C\u8BC1\u2014\u73AF\u5883\u8C03\u6574\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4F4E\u589E\u76CA\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u65E0\u6CD5\u89E3\u91CAA\u4E3A\u4F55\u4F4E\u5206\u65F6\u4E0D\u5B9C\u8FC7\u65E9\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q8",
        "title": "\u5F15\u6C34\u96BE\u9898\u672A\u89E3",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6E38\u620F\u73AF\u5883\u521B\u8BBE\uFF5C\u5BF9\u6E38\u620F\u6750\u6599\u7684\u5206\u6790\u548C\u6295\u653E",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u5728\u5E7C\u513F\u63A2\u7A76\u5174\u8DA3\u51CF\u5F31\u65F6\uFF0C\u5224\u65AD\u56F0\u96BE\u6765\u6E90\uFF0C\u9009\u62E9\u9002\u5F53\u4ECB\u5165\u65F6\u673A\uFF0C\u5E76\u901A\u8FC7\u6750\u6599\u3001\u95EE\u9898\u6216\u793A\u8303\u652F\u67B6\u6062\u590D\u63A2\u7D22\uFF0C\u800C\u4E0D\u662F\u6025\u4E8E\u66FF\u5E7C\u513F\u5B8C\u6210\u3002",
        "empirical": {
          "0": [
            "ACDB",
            "ADCB",
            "CADB",
            "DACB"
          ],
          "1": [
            "ABCD",
            "ABDC",
            "ACBD",
            "ADBC",
            "CABD",
            "CDAB",
            "DABC",
            "DCAB"
          ],
          "2": [
            "BACD",
            "BADC",
            "BDAC",
            "CDBA",
            "DBAC",
            "DBCA",
            "DCBA"
          ],
          "3": [
            "BCAD",
            "BDCA",
            "CBAD",
            "CBDA"
          ],
          "4": [
            "BCDA"
          ]
        },
        "scoring_note": "\u552F\u4E004\u5206\u4E3ABCDA\uFF0C3\u5206\u4E3ABCAD\u3001BDCA\u3001CBAD\u3001CBDA\u3002B\u7A33\u5B9A\u5C45\u524D\uFF0CA\u591A\u5C45\u540E\u3002\u8BF4\u660E\u9AD8\u6C34\u5E73\u5F3A\u8C03\u6559\u5E08\u8FDB\u5165\u5171\u540C\u63A2\u7A76\u3001\u6293\u4F4F\u5173\u952E\u53D7\u963B\u5173\u7CFB\u5E76\u63D0\u4F9B\u9002\u91CF\u652F\u67B6\uFF1B\u76F4\u63A5\u5B8C\u6574\u793A\u8303\u901A\u5E38\u5C5E\u4E8E\u8F83\u4F4E\u5C42\u7EA7\u652F\u6301\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q9": {
      "item_id": "Q9",
      "title": "\u98DE\u884C\u68CB\u5404\u8D70\u5404\u7684",
      "ontology": {
        "item_id": "Q9",
        "title": "\u98DE\u884C\u68CB\u5404\u8D70\u5404\u7684",
        "stem": "\u5927\u73ED\u533A\u57DF\u6E38\u620F\u4E2D\uFF0C\u8F69\u8F69\u548C\u5C0F\u5B87\u4E00\u8D77\u73A9\u98DE\u884C\u68CB\uFF0C\u4ED6\u4EEC\u5C06\u68CB\u5B50\u6446\u597D\u540E\uFF0C\u5404\u81EA\u62FF\u4E86\u4E00\u4E2A\u9AB0\u5B50\u5F00\u59CB\u6295\uFF0C\u5C0F\u5B87\u8BF4\uFF1A\u201C\u8BE5\u6211\u8D70\u3002\u201D\u8F69\u8F69\u8BF4\uFF1A\u201C\u660E\u660E\u8BE5\u6211\u8D70\uFF01\u201D\u76F8\u6301\u4E0D\u4E0B\uFF0C\u4E8E\u662F\u4E24\u4EBA\u5404\u62FF\u4E00\u4E2A\u9AB0\u5B50\uFF0C\u81EA\u987E\u81EA\u5730\u8D70\u81EA\u5DF1\u7684\u68CB\u3002",
        "options": {
          "A": "\u8010\u5FC3\u8BB2\u89E3\u5171\u540C\u6E38\u620F\u7684\u89C4\u5219\uFF0C\u518D\u4EE5\u201C\u68CB\u624B\u201D\u8EAB\u4EFD\u52A0\u5165\u6E38\u620F\u8FDB\u884C\u793A\u8303\u5F15\u5BFC\u3002",
          "B": "\u6682\u4E0D\u4ECB\u5165\uFF0C\u7EE7\u7EED\u89C2\u5BDF\u6E38\u620F\u8FDB\u5C55\uFF0C\u5F85\u533A\u57DF\u5C0F\u7ED3\u65F6\u8BF7\u5E7C\u513F\u5206\u4EAB\u6E38\u620F\u4E2D\u7684\u4F53\u9A8C\u548C\u95EE\u9898\u3002",
          "C": "\u62FF\u8D70\u4E00\u4E2A\u9AB0\u5B50\uFF0C\u8BF7\u5E7C\u513F\u5546\u91CF\u53EA\u6709\u4E00\u4E2A\u9AB0\u5B50\u7684\u5171\u540C\u6E38\u620F\u89C4\u5219\uFF0C\u8FBE\u6210\u4E00\u81F4\u540E\u518D\u5F00\u59CB\u6E38\u620F\u3002",
          "D": "\u5F85\u5E7C\u513F\u4F53\u9A8C\u4E00\u8F6E\u5404\u8D70\u5404\u7684\u6E38\u620F\u540E\uFF0C\u8BE2\u95EE\u5E7C\u513F\u7684\u6E38\u620F\u4F53\u9A8C\uFF0C\u63D0\u793A\u5171\u540C\u6E38\u620F\u89C4\u5219\u7684\u4F5C\u7528\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u6846\u67B6\u7684\u89C2\u5BDF\u4E0E\u7406\u89E3",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u7406\u89E3\u5E7C\u513F\u5BF9\u5171\u540C\u6E38\u620F\u89C4\u5219\u7684\u5B9E\u9645\u4F53\u9A8C\u6C34\u5E73\uFF0C\u901A\u8FC7\u77ED\u65F6\u4F53\u9A8C\u3001\u53CD\u601D\u63D0\u95EE\u548C\u89C4\u5219\u534F\u5546\u5E2E\u52A9\u5E7C\u513F\u7406\u89E3\u5171\u540C\u89C4\u5219\u7684\u610F\u4E49\u3002",
        "slots": [
          {
            "slot_id": "Q9-S1",
            "dimension": "C1 \u6E38\u620F\u6846\u67B6",
            "name": "\u5171\u540C\u89C4\u5219\u5931\u6548\u7684\u6027\u8D28\u5224\u65AD",
            "definition": "\u533A\u5206\u2018\u4E0D\u77E5\u9053\u98DE\u884C\u68CB\u6B63\u5F0F\u89C4\u5219\u2019\u4E0E\u2018\u53CC\u65B9\u6CA1\u6709\u5F62\u6210\u53EF\u5171\u540C\u7EF4\u6301\u7684\u8F6E\u6B21/\u89C4\u5219\u2019\uFF1B\u5F53\u524D\u5DF2\u4ECE\u5171\u540C\u6E38\u620F\u53D8\u6210\u5E76\u884C\u6E38\u620F\u3002",
            "diagnostic_meaning": "\u5BF9\u5E94\u6B21\u6307\u6807\u5BF9\u6E38\u620F\u89C4\u5219\u4E0E\u610F\u56FE\u7684\u7406\u89E3\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u6F84\u6E05/\u5BF9\u6BD4"
            ],
            "forbidden_actions": [
              "\u76F4\u63A5\u8BB2\u89C4\u5219"
            ],
            "default_priority": "P1",
            "empirical_relation": "D/C\u9AD8\u5206\u6838\u5FC3\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q9-S2",
            "dimension": "C2 \u4ECB\u5165\u65F6\u673A",
            "name": "\u77ED\u6682\u4F53\u9A8C\u81EA\u7136\u540E\u679C\u7684\u8FB9\u754C",
            "definition": "\u53EF\u5141\u8BB8\u5E7C\u513F\u77ED\u6682\u4F53\u9A8C\u5404\u8D70\u5404\u7684\u9020\u6210\u65E0\u6CD5\u5171\u540C\u4E92\u52A8\u3001\u65E0\u6CD5\u5224\u65AD\u8F93\u8D62\u7B49\u540E\u679C\uFF0C\u4F46\u8981\u6709\u60C5\u7EEA\u548C\u6301\u7EED\u65F6\u95F4\u8FB9\u754C\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u4E13\u4E1A\u7B49\u5F85\u800C\u975E\u653E\u4EFB\u3002",
            "core": true,
            "prerequisites": [
              "Q9-S1"
            ],
            "allowed_actions": [
              "\u6761\u4EF6\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u65E0\u9650\u4E0D\u4ECB\u5165"
            ],
            "default_priority": "P1",
            "empirical_relation": "D4\u5206\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q9-S3",
            "dimension": "C2 \u53CD\u601D\u56DE\u5E94",
            "name": "\u4ECE\u4F53\u9A8C\u4E2D\u7406\u89E3\u89C4\u5219\u529F\u80FD",
            "definition": "\u901A\u8FC7\u8BE2\u95EE\u6E38\u620F\u4F53\u9A8C\uFF0C\u5F15\u5BFC\u5E7C\u513F\u8BF4\u51FA\u5171\u540C\u89C4\u5219\u5BF9\u8F6E\u6D41\u3001\u516C\u5E73\u3001\u5171\u540C\u9884\u671F\u548C\u6E38\u620F\u6301\u7EED\u7684\u4F5C\u7528\u3002",
            "diagnostic_meaning": "\u89C4\u5219\u6559\u80B2\u4ECE\u5916\u90E8\u8981\u6C42\u8F6C\u4E3A\u7ECF\u9A8C\u7406\u89E3\u3002",
            "core": true,
            "prerequisites": [
              "Q9-S2"
            ],
            "allowed_actions": [
              "\u4F53\u9A8C\u56DE\u987E/\u529F\u80FD\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u80CC\u8BF5\u89C4\u5219"
            ],
            "default_priority": "P1",
            "empirical_relation": "D\u9AD8\u5206\u673A\u5236\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q9-S4",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u5171\u540C\u89C4\u5219\u534F\u5546\u4E0E\u91CD\u5EFA",
            "definition": "\u652F\u6301\u5E7C\u513F\u56F4\u7ED5\u9AB0\u5B50\u6570\u91CF\u3001\u8C01\u5148\u3001\u8F6E\u6D41\u65B9\u5F0F\u7B49\u5546\u91CF\u5E76\u5F62\u6210\u53CC\u65B9\u8BA4\u53EF\u89C4\u5219\uFF0C\u518D\u7EE7\u7EED\u6E38\u620F\u3002",
            "diagnostic_meaning": "\u68C0\u9A8C\u534F\u5546\u652F\u67B6\u800C\u975E\u6210\u4EBA\u5BA3\u5E03\u3002",
            "core": true,
            "prerequisites": [
              "Q9-S3"
            ],
            "allowed_actions": [
              "\u534F\u5546\u8FC7\u7A0B/\u66FF\u4EE3\u65B9\u6848"
            ],
            "forbidden_actions": [
              "\u6559\u5E08\u5B9A\u89C4\u5219"
            ],
            "default_priority": "P1",
            "empirical_relation": "C\u9AD8\u5206\u673A\u5236\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q9-S5",
            "dimension": "C2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u73AF\u5883\u7EA6\u675F\u7684\u652F\u6301\u6027\u4F7F\u7528",
            "definition": "\u4E34\u65F6\u62FF\u8D70\u4E00\u4E2A\u9AB0\u5B50\u53EF\u51CF\u5C11\u5E76\u884C\u884C\u52A8\uFF0C\u4FC3\u8FDB\u5171\u540C\u534F\u5546\uFF0C\u4F46\u4E0D\u80FD\u4F5C\u4E3A\u60E9\u7F5A\u6216\u4EE3\u66FF\u89C4\u5219\u7406\u89E3\u3002",
            "diagnostic_meaning": "\u89E3\u91CAC\u7684\u73AF\u5883\u652F\u67B6\u8FB9\u754C\u3002",
            "core": true,
            "prerequisites": [
              "Q9-S4"
            ],
            "allowed_actions": [
              "\u7406\u7531\u8FFD\u95EE/\u53CD\u4F8B"
            ],
            "forbidden_actions": [
              "\u6CA1\u6536\u4F5C\u4E3A\u63A7\u5236"
            ],
            "default_priority": "P2",
            "empirical_relation": "C\u9AD8\u5206\u4F46\u9700\u770B\u540E\u7EED\u534F\u5546\u8D28\u91CF\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q9-S6",
            "dimension": "C2 \u65F6\u673A",
            "name": "\u5373\u65F6\u652F\u6301\u4E0E\u5C0F\u7ED3\u53CD\u601D\u7684\u533A\u522B",
            "definition": "\u5C0F\u7ED3\u53EF\u56DE\u987E\u7ECF\u9A8C\uFF0C\u4F46\u5171\u540C\u6E38\u620F\u5DF2\u74E6\u89E3\u65F6\u4EC5\u5EF6\u540E\u5230\u5C0F\u7ED3\u53EF\u80FD\u9519\u5931\u5373\u65F6\u5B66\u4E60\u673A\u4F1A\u3002",
            "diagnostic_meaning": "\u89E3\u91CAB\u8F83\u4F4E\u3002",
            "core": false,
            "prerequisites": [
              "Q9-S2"
            ],
            "allowed_actions": [
              "\u65F6\u673A\u6BD4\u8F83"
            ],
            "forbidden_actions": [
              "\u7EDD\u5BF9\u5426\u5B9A\u5C0F\u7ED3"
            ],
            "default_priority": "P2",
            "empirical_relation": "B\u5E76\u975E\u65E0\u4EF7\u503C\uFF0C\u53EA\u662F\u4E0D\u5B9C\u6210\u4E3A\u552F\u4E00\u652F\u6301\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q9",
        "anchors": [
          {
            "slot_id": "Q9-S1",
            "level_0": "\u76F4\u63A5\u8BF4\u4E0D\u61C2\u89C4\u5219/\u4E0D\u5B88\u89C4\u5219\u3002",
            "level_1": "\u77E5\u9053\u5728\u4E89\u5148\u540E\uFF0C\u4F46\u4ECD\u4E3B\u8981\u60F3\u6210\u4EBA\u8BB2\u6E05\u3002",
            "level_2": "\u8BC6\u522B\u6838\u5FC3\u662F\u5171\u4EAB\u8F6E\u6B21\u548C\u5171\u540C\u89C4\u5219\u5931\u6548\uFF0C\u4E24\u4E2A\u9AB0\u5B50\u8BA9\u6E38\u620F\u8FDB\u4E00\u6B65\u5E76\u884C\u5316\u3002",
            "level_3": "\u80FD\u8BF4\u660E\u6B63\u5F0F\u89C4\u5219\u662F\u5426\u5B8C\u5168\u6B63\u786E\u4E0D\u662F\u552F\u4E00\u5173\u952E\uFF0C\u5173\u952E\u662F\u53CC\u65B9\u80FD\u5426\u5171\u540C\u8BA4\u53EF\u5E76\u7EF4\u6301\u89C4\u5219\u3002",
            "false_evidence": "\u4F1A\u80CC\u89C4\u5219\u3002",
            "conflict_evidence": "\u6210\u4EBA\u8BB2\u6E05\u540E\u4ECD\u4E0D\u80FD\u534F\u5546\u5374\u8BA4\u4E3A\u89E3\u51B3\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q9-S2",
            "level_0": "\u4E00\u89C1\u4E89\u6267\u7ACB\u5373\u63A5\u7BA1\u6216\u65E0\u9650\u4E0D\u4ECB\u5165\u3002",
            "level_1": "\u613F\u610F\u4F53\u9A8C\u4E00\u4E0B\u4F46\u65E0\u505C\u6B62\u6807\u51C6\u3002",
            "level_2": "\u5141\u8BB8\u77ED\u6682\u4F53\u9A8C\uFF0C\u5E76\u5728\u5171\u540C\u6027\u660E\u663E\u4E0B\u964D\u6216\u60C5\u7EEA\u5347\u9AD8\u65F6\u4ECB\u5165\u53CD\u601D\u3002",
            "level_3": "\u80FD\u628A\u65F6\u95F4\u3001\u60C5\u7EEA\u3001\u5B66\u4E60\u4EF7\u503C\u548C\u5E7C\u513F\u81EA\u4E3B\u89E3\u51B3\u80FD\u529B\u7ED3\u5408\u6210\u52A8\u6001\u9608\u503C\u3002",
            "false_evidence": "\u653E\u4EFB=\u4F53\u9A8C\u3002",
            "conflict_evidence": "\u51B2\u7A81\u5347\u7EA7\u4ECD\u7B49\u5F85\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q9-S3",
            "level_0": "\u53EA\u8BB2\u2018\u8981\u8F6E\u6D41/\u5B88\u89C4\u5219\u2019\u3002",
            "level_1": "\u80FD\u63D0\u516C\u5E73\u6216\u8F6E\u6D41\u4F46\u62BD\u8C61\u3002",
            "level_2": "\u4ECE\u2018\u5404\u8D70\u5404\u7684\u2019\u4F53\u9A8C\u5F15\u51FA\u5171\u540C\u9884\u671F\u3001\u8F6E\u6B21\u3001\u8F93\u8D62\u3001\u4E92\u52A8\u6301\u7EED\u7B49\u529F\u80FD\u3002",
            "level_3": "\u80FD\u8BA9\u5E7C\u513F\u81EA\u5DF1\u6BD4\u8F83\u4E0D\u540C\u89C4\u5219\u4E0B\u7684\u4F53\u9A8C\uFF0C\u5E76\u7528\u81EA\u5DF1\u7684\u8BDD\u5F62\u6210\u89C4\u5219\u7406\u7531\u3002",
            "false_evidence": "\u80CC\u6761\u6B3E\u3002",
            "conflict_evidence": "\u53EA\u8981\u6C42\u670D\u4ECE\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q9-S4",
            "level_0": "\u6559\u5E08\u76F4\u63A5\u5BA3\u5E03\u89C4\u5219\u3002",
            "level_1": "\u8BA9\u5E7C\u513F\u81EA\u5DF1\u5546\u91CF\u4F46\u7F3A\u5C11\u534F\u5546\u7126\u70B9\u3002",
            "level_2": "\u56F4\u7ED5\u4E00\u4E2A\u9AB0\u5B50\u3001\u8C01\u5148\u8D70\u3001\u5982\u4F55\u8F6E\u6D41\u652F\u6301\u53CC\u65B9\u63D0\u51FA\u65B9\u6848\u5E76\u8FBE\u6210\u4E00\u81F4\u3002",
            "level_3": "\u80FD\u6BD4\u8F83\u591A\u4E2A\u53EF\u884C\u89C4\u5219\u3001\u8BD5\u884C\u540E\u518D\u4FEE\u8BA2\uFF0C\u5E76\u8BA9\u6559\u5E08\u9010\u6B65\u9000\u51FA\u3002",
            "false_evidence": "\u53EA\u80FD\u5728\u6210\u4EBA\u7ED9\u7684\u4E24\u4E2A\u65B9\u6848\u4E2D\u9009\u3002",
            "conflict_evidence": "\u62FF\u8D70\u9AB0\u5B50\u4F5C\u4E3A\u60E9\u7F5A\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q9-S5",
            "level_0": "\u628A\u62FF\u8D70\u9AB0\u5B50\u5F53\u5236\u6B62/\u60E9\u7F5A\u3002",
            "level_1": "\u77E5\u9053\u4E00\u4E2A\u9AB0\u5B50\u80FD\u51CF\u5C11\u51B2\u7A81\uFF0C\u4F46\u540E\u7EED\u4ECD\u7531\u6559\u5E08\u5B9A\u89C4\u5219\u3002",
            "level_2": "\u628A\u4E00\u4E2A\u9AB0\u5B50\u4F5C\u4E3A\u4FC3\u6210\u534F\u5546\u7684\u4E34\u65F6\u6761\u4EF6\uFF0C\u5173\u952E\u51B3\u5B9A\u4EA4\u7ED9\u5E7C\u513F\u3002",
            "level_3": "\u80FD\u5224\u65AD\u4F55\u65F6\u65E0\u9700\u62FF\u8D70\u3001\u4F55\u65F6\u4E34\u65F6\u7ED3\u6784\u6700\u6709\u6548\uFF0C\u5E76\u5141\u8BB8\u4E4B\u540E\u91CD\u65B0\u914D\u7F6E\u6750\u6599\u3002",
            "false_evidence": "\u7269\u7406\u63A7\u5236\u4EE3\u66FF\u534F\u5546\u3002",
            "conflict_evidence": "\u62FF\u8D70\u540E\u6210\u4EBA\u5BA3\u5E03\u8C01\u5148\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q9-S6",
            "level_0": "\u65E0\u8BBA\u5171\u540C\u6E38\u620F\u662F\u5426\u74E6\u89E3\uFF0C\u90FD\u53EA\u7B49\u5C0F\u7ED3\u518D\u5904\u7406\uFF1B\u6216\u5B8C\u5168\u5426\u5B9A\u5C0F\u7ED3\u4EF7\u503C\u3002",
            "level_1": "\u77E5\u9053\u5C0F\u7ED3\u53EF\u4EE5\u53CD\u601D\uFF0C\u4F46\u8BF4\u4E0D\u6E05\u4F55\u65F6\u5FC5\u987B\u63D0\u4F9B\u5373\u65F6\u652F\u6301\u3002",
            "level_2": "\u80FD\u8BF4\u660E\u5171\u540C\u6E38\u620F\u74E6\u89E3\u3001\u51B2\u7A81\u5347\u7EA7\u6216\u5B66\u4E60\u673A\u4F1A\u5C06\u4E27\u5931\u65F6\u9700\u5373\u65F6\u6700\u5C0F\u652F\u6301\uFF0C\u5C0F\u7ED3\u7528\u4E8E\u540E\u7EED\u56DE\u987E\u3002",
            "level_3": "\u80FD\u628A\u5373\u65F6\u534F\u5546\u652F\u67B6\u3001\u6559\u5E08\u9000\u51FA\u4E0E\u5C0F\u7ED3\u4E2D\u7684\u89C4\u5219\u53CD\u601D\u4E32\u6210\u8FDE\u7EED\u652F\u6301\uFF0C\u5E76\u636E\u7ED3\u679C\u8C03\u6574\u540E\u7EED\u73AF\u5883\u6216\u89C4\u5219\u3002",
            "false_evidence": "\u5EF6\u540E\u5C31\u662F\u5C0A\u91CD\u3002",
            "conflict_evidence": "\u5E7C\u513F\u5DF2\u65E0\u6CD5\u5171\u540C\u6E38\u620F\uFF0C\u4ECD\u628A\u5C0F\u7ED3\u4F5C\u4E3A\u552F\u4E00\u63AA\u65BD\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q9",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ADCAB/DCBA",
            "hypothesis": "D\u9996\u3001C\u6B21\uFF0CA/B\u9760\u540E\uFF0C\u4F53\u9A8C\u2014\u53CD\u601D\u2014\u534F\u5546\u903B\u8F91\u6E05\u6670\u3002",
            "target_slots": [
              "Q9-S2",
              "Q9-S3",
              "Q9-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB/\u8FB9\u754C",
            "forbidden_question": "\u201CD\u7B2C\u4E00\u5C31\u53EF\u4EE5\u8BA9\u4ED6\u4EEC\u968F\u4FBF\u73A9\u4E00\u8F6E\u3002\u201D",
            "rationale": "\u9A8C\u8BC1\u4F53\u9A8C\u7684\u5B89\u5168/\u60C5\u7EEA\u9608\u503C\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206",
            "hypothesis": "\u591A\u6570D/C\u5C45\u524D\uFF0C\u6574\u4F53\u8F83\u6210\u719F\u4F46C/D\u5148\u540E\u6216A/B\u8FB9\u754C\u4E0D\u7A33\u3002",
            "target_slots": [
              "Q9-S4",
              "Q9-S5",
              "Q9-S6"
            ],
            "priority": "P2",
            "preferred_action": "\u6BD4\u8F83",
            "forbidden_question": "\u201C\u5148\u62FF\u8D70\u9AB0\u5B50\u548C\u5148\u8BA9\u4ED6\u4EEC\u4F53\u9A8C\uFF0C\u4EC0\u4E48\u65F6\u5019\u4E0D\u540C\uFF1F\u201D",
            "rationale": "\u67E5\u73AF\u5883\u652F\u67B6\u4E0E\u81EA\u7136\u540E\u679C\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u90E8\u5206\u7406\u89E3\u534F\u5546\uFF0C\u4F46\u89C4\u5219\u529F\u80FD\u6216\u4ECB\u5165\u65F6\u673A\u4E0D\u591F\u6E05\u695A\u3002",
            "target_slots": [
              "Q9-S1",
              "Q9-S3",
              "Q9-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u529F\u80FD\u8FFD\u95EE",
            "forbidden_question": "\u201C\u4E3A\u4EC0\u4E48\u4E00\u5B9A\u8981\u6709\u5171\u540C\u89C4\u5219\uFF1F\u201D",
            "rationale": "\u4ECE\u89C4\u5219\u6761\u6B3E\u8F6C\u529F\u80FD\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216A\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u95EE\u9898\u5F53\u89C4\u5219\u77E5\u8BC6\u7F3A\u5931\uFF0C\u504F\u5411\u6210\u4EBA\u8BB2\u89E3\u793A\u8303\u3002",
            "target_slots": [
              "Q9-S1",
              "Q9-S3"
            ],
            "priority": "P1",
            "preferred_action": "\u53CD\u4F8B",
            "forbidden_question": "\u201C\u5982\u679C\u4ED6\u4EEC\u77E5\u9053\u89C4\u5219\u5374\u4ECD\u4E89\u5148\u540E\uFF0C\u8BB2\u4E00\u904D\u591F\u5417\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u533A\u5206\u89C4\u5219\u77E5\u8BC6\u4E0E\u5171\u540C\u89C4\u5219\u3002",
            "calibration_note": ""
          },
          {
            "condition": "B\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u7B49\u5F85\u548C\u540E\u7EED\u5C0F\u7ED3\u6CDB\u5316\uFF0C\u9519\u8FC7\u5171\u540C\u6E38\u620F\u74E6\u89E3\u65F6\u7684\u5373\u65F6\u652F\u6301\u3002",
            "target_slots": [
              "Q9-S2",
              "Q9-S6"
            ],
            "priority": "P1",
            "preferred_action": "\u65F6\u673A\u8FB9\u754C",
            "forbidden_question": "\u201C\u4EC0\u4E48\u65F6\u5019\u7B49\u5230\u5C0F\u7ED3\u5C31\u592A\u665A\u4E86\uFF1F\u201D",
            "rationale": "\u67E5\u5EF6\u540E\u53CD\u601D\u8FB9\u754C\u3002",
            "calibration_note": ""
          },
          {
            "condition": "C\u5C45\u524D\u4F46\u628A\u62FF\u9AB0\u5B50\u5F53\u5904\u7F5A",
            "hypothesis": "\u6392\u5E8F\u53EF\u80FD\u4E0D\u4F4E\u4F46\u4E13\u4E1A\u673A\u5236\u9519\u8BEF\u3002",
            "target_slots": [
              "Q9-S4",
              "Q9-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u7406\u7531\u8FFD\u95EE",
            "forbidden_question": "\u201C\u62FF\u8D70\u4E00\u4E2A\u9AB0\u5B50\u662F\u4E3A\u4E86\u5236\u6B62\uFF0C\u8FD8\u662F\u4E3A\u4E86\u5E2E\u52A9\u53D1\u751F\u4EC0\u4E48\uFF1F\u201D",
            "rationale": "\u533A\u5206\u73AF\u5883\u652F\u67B6\u4E0E\u63A7\u5236\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q9",
        "probes": [
          {
            "slot_id": "Q9-S1",
            "allowed_actions": [
              "\u6027\u8D28\u6F84\u6E05"
            ],
            "preferred_action": "\u5BF9\u6BD4",
            "typical_question": "\u201C\u60A8\u89C9\u5F97\u4ED6\u4EEC\u73B0\u5728\u4E3B\u8981\u662F\u2018\u4E0D\u77E5\u9053\u89C4\u5219\u2019\uFF0C\u8FD8\u662F\u2018\u4E24\u4E2A\u4EBA\u6CA1\u6709\u5171\u540C\u7684\u73A9\u6CD5\u2019\uFF1F\u60A8\u600E\u4E48\u770B\u51FA\u6765\u7684\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u4ED6\u4EEC\u90FD\u77E5\u9053\u98DE\u884C\u68CB\u89C4\u5219\uFF0C\u5374\u4ECD\u4E89\u8C01\u5148\u8D70\u5462\uFF1F\u201D",
            "forbidden_actions": [
              "\u9884\u8BBE\u4E0D\u61C2\u89C4\u5219"
            ],
            "forbidden_question": "\u201C\u4ED6\u4EEC\u663E\u7136\u89C4\u5219\u610F\u8BC6\u5DEE\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5F00\u653E\u5224\u65AD\u95EE\u9898\u6027\u8D28\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q9-S2",
            "allowed_actions": [
              "\u65F6\u673A\u8FB9\u754C"
            ],
            "preferred_action": "\u4F53\u9A8C\u9608\u503C",
            "typical_question": "\u201C\u5982\u679C\u8BA9\u4ED6\u4EEC\u5148\u5404\u8D70\u4E00\u5C0F\u4F1A\u513F\uFF0C\u60A8\u4F1A\u89C2\u5BDF\u4EC0\u4E48\uFF0C\u4EC0\u4E48\u65F6\u5019\u4F1A\u89C9\u5F97\u8BE5\u4ECB\u5165\uFF1F\u201D",
            "followup_question": "\u201C\u60C5\u7EEA\u5347\u9AD8\u65F6\u4F1A\u600E\u4E48\u53D8\u5316\uFF1F\u201D",
            "forbidden_actions": [
              "\u65E0\u9650\u7B49\u5F85"
            ],
            "forbidden_question": "\u201C\u8BA9\u4ED6\u4EEC\u81EA\u5DF1\u73A9\u5230\u7ED3\u675F\u3002\u201D",
            "non_inducing_boundary": "\u4E13\u4E1A\u7B49\u5F85\u5FC5\u987B\u6709\u9608\u503C\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q9-S3",
            "allowed_actions": [
              "\u4F53\u9A8C\u53CD\u601D"
            ],
            "preferred_action": "\u529F\u80FD\u8FFD\u95EE",
            "typical_question": "\u201C\u5404\u8D70\u5404\u7684\u4EE5\u540E\uFF0C\u60A8\u4F1A\u600E\u6837\u95EE\uFF0C\u5E2E\u52A9\u4ED6\u4EEC\u81EA\u5DF1\u8BF4\u51FA\u8FD9\u79CD\u73A9\u6CD5\u7684\u95EE\u9898\uFF1F\u201D",
            "followup_question": "\u201C\u5171\u540C\u89C4\u5219\u5BF9\u4ED6\u4EEC\u7684\u6E38\u620F\u5230\u5E95\u6709\u4EC0\u4E48\u7528\uFF1F\u201D",
            "forbidden_actions": [
              "\u80CC\u8BF5\u89C4\u5219"
            ],
            "forbidden_question": "\u201C\u98DE\u884C\u68CB\u6B63\u786E\u89C4\u5219\u662F\u4EC0\u4E48\uFF1F\u201D",
            "non_inducing_boundary": "\u4ECE\u7ECF\u9A8C\u4E2D\u7406\u89E3\u89C4\u5219\u529F\u80FD\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q9-S4",
            "allowed_actions": [
              "\u534F\u5546\u652F\u67B6"
            ],
            "preferred_action": "\u8FC7\u7A0B\u8FFD\u95EE",
            "typical_question": "\u201C\u5982\u679C\u8981\u8BA9\u4ED6\u4EEC\u81EA\u5DF1\u91CD\u65B0\u7EA6\u5B9A\u73A9\u6CD5\uFF0C\u60A8\u4F1A\u600E\u6837\u628A\u4E89\u8BAE\u53D8\u6210\u53EF\u4EE5\u5546\u91CF\u7684\u95EE\u9898\uFF1F\u201D",
            "followup_question": "\u201C\u4E24\u4E2A\u4EBA\u63D0\u51FA\u4E0D\u540C\u65B9\u6848\u65F6\u600E\u4E48\u529E\uFF1F\u201D",
            "forbidden_actions": [
              "\u6559\u5E08\u5BA3\u5E03"
            ],
            "forbidden_question": "\u201C\u5E94\u8BE5\u8F6E\u6D41\u63B7\u9AB0\u5B50\uFF0C\u5C31\u8FD9\u6837\u73A9\u3002\u201D",
            "non_inducing_boundary": "\u63D0\u4F9B\u7ED3\u6784\u4E0D\u4EE3\u66FF\u51B3\u5B9A\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q9-S5",
            "allowed_actions": [
              "\u73AF\u5883\u652F\u67B6"
            ],
            "preferred_action": "\u7406\u7531\u8FFD\u95EE",
            "typical_question": "\u201C\u5982\u679C\u60A8\u62FF\u8D70\u4E00\u4E2A\u9AB0\u5B50\uFF0C\u60A8\u5E0C\u671B\u8FD9\u4E2A\u52A8\u4F5C\u5E2E\u52A9\u4ED6\u4EEC\u53D1\u751F\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u54EA\u4E9B\u51B3\u5B9A\u8FD8\u5E94\u7559\u7ED9\u5E7C\u513F\uFF1F\u201D",
            "forbidden_actions": [
              "\u60E9\u7F5A"
            ],
            "forbidden_question": "\u201C\u8C01\u62A2\u9AB0\u5B50\u5C31\u6CA1\u6536\u8C01\u7684\u3002\u201D",
            "non_inducing_boundary": "\u73AF\u5883\u8C03\u6574\u670D\u52A1\u4E8E\u534F\u5546\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q9-S6",
            "allowed_actions": [
              "\u65F6\u673A\u6BD4\u8F83\uFF0C\u53CD\u601D"
            ],
            "preferred_action": "\u8FDE\u7EED\u652F\u6301",
            "typical_question": "\u201C\u5171\u540C\u6E38\u620F\u5DF2\u7ECF\u8FDB\u884C\u4E0D\u4E0B\u53BB\u65F6\uFF0C\u60A8\u4F1A\u600E\u6837\u5904\u7406\u5F53\u4E0B\uFF1B\u5C0F\u7ED3\u53C8\u80FD\u8865\u5145\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u4EC0\u4E48\u60C5\u51B5\u53EF\u4EE5\u7B49\u5230\u5C0F\u7ED3\uFF0C\u4EC0\u4E48\u60C5\u51B5\u4E0D\u80FD\u7B49\uFF1F\u201D",
            "forbidden_actions": [
              "\u7EDD\u5BF9\u5EF6\u540E"
            ],
            "forbidden_question": "\u201C\u7559\u5230\u533A\u57DF\u5C0F\u7ED3\u518D\u8C08\uFF0C\u603B\u662F\u6BD4\u5F53\u573A\u4ECB\u5165\u66F4\u5C0A\u91CD\u5E7C\u513F\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5C0F\u7ED3\u6709\u53CD\u601D\u4EF7\u503C\uFF0C\u4F46\u4E0D\u80FD\u66FF\u4EE3\u5FC5\u8981\u7684\u5373\u65F6\u6700\u5C0F\u652F\u6301\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q9",
        "rules": [
          {
            "scope": "Q9-S1~S2 \u6027\u8D28/\u65F6\u673A",
            "sufficient_condition": "\u80FD\u533A\u5206\u89C4\u5219\u77E5\u8BC6\u4E0E\u5171\u540C\u89C4\u5219\u534F\u8C03\uFF0C\u5E76\u8BF4\u660E\u77ED\u6682\u4F53\u9A8C\u7684\u4ECB\u5165\u9608\u503C\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u4E0D\u5B88\u89C4\u5219\uFF0C\u6362\u53CD\u4F8B\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u6210\u4EBA\u8BB2\u89E3\u6210\u4E3A\u552F\u4E00\u7B56\u7565\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ9-S3\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u65E0\u9650\u7B49\u5F85/\u7ACB\u5373\u63A5\u7BA1\u4EFB\u4E00\u6781\u7AEF\u672A\u6F84\u6E05\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q9-S3~S5 \u53CD\u601D/\u534F\u5546/\u73AF\u5883",
            "sufficient_condition": "\u80FD\u4ECE\u4F53\u9A8C\u5F15\u51FA\u89C4\u5219\u529F\u80FD\uFF0C\u652F\u6301\u5E7C\u513F\u5171\u540C\u5546\u8BAE\uFF0C\u5E76\u6B63\u786E\u4F7F\u7528\u73AF\u5883\u7EA6\u675F\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u8BF4\u2018\u8BA9\u4ED6\u4EEC\u5546\u91CF\u2019\u65E0\u8FC7\u7A0B\u652F\u67B6\uFF0C\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u4F7F\u89C4\u5219\u65E0\u6CD5\u7EF4\u6301\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ9-S6\uFF08\u51FA\u73B0\u5373\u65F6/\u5C0F\u7ED3\u65F6\u673A\u5224\u65AD\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u62FF\u9AB0\u5B50\u4F5C\u4E3A\u60E9\u7F5A\u4E0D\u5F97\u9AD8\u5224\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q9-S6 \u5C0F\u7ED3\u8FB9\u754C",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u5C0F\u7ED3\u9002\u5408\u56DE\u987E\u7ECF\u9A8C\uFF0C\u4F46\u5171\u540C\u6E38\u620F\u74E6\u89E3\u6216\u51B2\u7A81\u5347\u7EA7\u65F6\u4E0D\u80FD\u66FF\u4EE3\u5FC5\u8981\u7684\u5373\u65F6\u6700\u5C0F\u652F\u6301\u3002",
            "no_gain_threshold": "1\u8F6E\u65E0\u65B0\u589E\u8BC1\u636E\u5373\u53EF\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u5F53\u524D\u6CA1\u6709\u5C0F\u7ED3\u8DEF\u5F84\u9700\u8981\u5224\u65AD\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u53C8\u628A\u5168\u90E8\u652F\u6301\u63A8\u8FDF\u5230\u5C0F\u7ED3\uFF0C\u6216\u5373\u65F6\u4ECB\u5165\u91CD\u65B0\u63A5\u7BA1\u6E38\u620F\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u6838\u5FC3\u4ECB\u5165\u65F6\u673A\u4ECD\u4E0D\u6E05\u65F6\uFF0C\u4E0D\u5F97\u7528\u5C0F\u7ED3\u66FF\u4EE3\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q9-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u8BC6\u522B\u5171\u540C\u89C4\u5219\u5931\u6548\u2014\u6709\u754C\u4F53\u9A8C\u2014\u53CD\u601D\u89C4\u5219\u529F\u80FD\u2014\u534F\u5546\u91CD\u5EFA\u2014\u6559\u5E08\u9000\u51FA\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4F4E\u589E\u76CA\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u628A\u89C4\u5219\u6559\u80B2\u7B49\u540C\u6210\u4EBA\u8BB2\u89E3\u65F6\u4E0D\u5F97\u63D0\u524D\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q9",
        "title": "\u98DE\u884C\u68CB\u5404\u8D70\u5404\u7684",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u6E38\u620F\u4E2D\u7684\u89C2\u5BDF\uFF5C\u5BF9\u5E7C\u513F\u6E38\u620F\u6846\u67B6\u7684\u89C2\u5BDF\u4E0E\u7406\u89E3",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u7406\u89E3\u5E7C\u513F\u5BF9\u5171\u540C\u6E38\u620F\u89C4\u5219\u7684\u5B9E\u9645\u4F53\u9A8C\u6C34\u5E73\uFF0C\u901A\u8FC7\u77ED\u65F6\u4F53\u9A8C\u3001\u53CD\u601D\u63D0\u95EE\u548C\u89C4\u5219\u534F\u5546\u5E2E\u52A9\u5E7C\u513F\u7406\u89E3\u5171\u540C\u89C4\u5219\u7684\u610F\u4E49\u3002",
        "empirical": {
          "0": [
            "ABDC",
            "ACBD",
            "ADBC",
            "BDAC",
            "BDCA",
            "DABC"
          ],
          "1": [
            "ABCD",
            "ACDB",
            "ADCB",
            "DACB",
            "DBAC"
          ],
          "2": [
            "BACD",
            "BADC",
            "BCAD",
            "CABD",
            "CADB",
            "CBDA"
          ],
          "3": [
            "BCDA",
            "CBAD",
            "CDAB",
            "CDBA",
            "DBCA"
          ],
          "4": [
            "DCAB",
            "DCBA"
          ]
        },
        "scoring_note": "4\u5206\u4E3ADCAB\u3001DCBA\uFF0C3\u5206\u591A\u7531D/C\u5C45\u524D\u3002A/B\u5C45\u524D\u7684\u7EC4\u5408\u5927\u91CF\u843D\u5165\u4F4E\u5206\u3002\u8BF4\u660E\u9AD8\u6C34\u5E73\u91CD\u89C6\u8BA9\u5E7C\u513F\u77ED\u6682\u4F53\u9A8C\u5171\u540C\u89C4\u5219\u5931\u6548\u7684\u540E\u679C\uFF0C\u518D\u901A\u8FC7\u53CD\u601D\u4E0E\u534F\u5546\u91CD\u5EFA\u89C4\u5219\uFF1B\u6210\u4EBA\u8BB2\u89E3\u6216\u5EF6\u540E\u5230\u5C0F\u7ED3\u5747\u8F83\u5F31\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    },
    "Q10": {
      "item_id": "Q10",
      "title": "\u8DF3\u7EF3\u79E9\u5E8F\u6DF7\u4E71",
      "ontology": {
        "item_id": "Q10",
        "title": "\u8DF3\u7EF3\u79E9\u5E8F\u6DF7\u4E71",
        "stem": "\u5468\u4E09\u4E0B\u5348\uFF0C\u5927\u4E94\u73ED\u7684\u5E7C\u513F\u6B63\u81EA\u53D1\u8FDB\u884C\u8DF3\u7EF3\u6E38\u620F\u3002\u674E\u8001\u5E08\u89C2\u5BDF\u540E\u53D1\u73B0\uFF0C\u6324\u5728\u4E00\u8D77\u8DF3\u7EF3\u7684\u5E7C\u513F\u4EBA\u6570\u8F83\u591A\uFF0C\u6574\u4E2A\u573A\u9762\u5341\u5206\u6DF7\u4E71\uFF0C\u5E7C\u513F\u5F88\u5BB9\u6613\u51FA\u73B0\u78B0\u649E\u73B0\u8C61\u3002\u6B64\u5916\uFF0C\u7531\u4E8E\u5F53\u201C\u67F1\u5B50\u201D\u7684\u5E7C\u513F\u5F88\u4E45\u624D\u80FD\u8F6E\u4E0A\u8DF3\u7EF3\uFF0C\u56E0\u6B64\u4E5F\u663E\u5F97\u5F88\u4E0D\u8010\u70E6\u3002",
        "options": {
          "A": "\u8BF7\u5E7C\u513F\u6682\u505C\u6E38\u620F\uFF0C\u5C06\u5E7C\u513F\u5206\u6210\u591A\u4E2A\u5C0F\u7EC4\u5E76\u5F15\u5BFC\u4ED6\u4EEC\u4EE5\u5C0F\u7EC4\u4E3A\u5355\u4F4D\u5206\u533A\u57DF\u5F00\u5C55\u6E38\u620F\u3002",
          "B": "\u8BF7\u5E7C\u513F\u8BF4\u4E00\u8BF4\u8DF3\u7EF3\u6D3B\u52A8\u4E2D\u5B58\u5728\u7684\u95EE\u9898\uFF0C\u5E76\u9080\u8BF7\u5E7C\u513F\u4E00\u8D77\u8BBE\u7F6E\u8DF3\u7EF3\u7684\u89C4\u5219\u3002",
          "C": "\u63D0\u4F9B\u66F4\u591A\u6570\u91CF\u548C\u4E0D\u540C\u79CD\u7C7B\u7684\u8DF3\u7EF3\uFF0C\u5E76\u8A00\u8BED\u5F15\u5BFC\u5E7C\u513F\u5206\u7EC4\u5206\u533A\u540C\u65F6\u8FDB\u884C\u8DF3\u7EF3\u6E38\u620F\u3002",
          "D": "\u6682\u4E0D\u4ECB\u5165\uFF0C\u6D3B\u52A8\u5206\u4EAB\u65F6\u901A\u8FC7\u7167\u7247\u6216\u89C6\u9891\u56DE\u653E\u5F15\u5BFC\u5E7C\u513F\u53D1\u73B0\u95EE\u9898\u5E76\u5546\u8BAE\u89E3\u51B3\u529E\u6CD5\u3002"
        },
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\uFF5C\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u5728\u96C6\u4F53\u6E38\u620F\u79E9\u5E8F\u548C\u5B89\u5168\u98CE\u9669\u4E2D\u4F5C\u51FA\u9002\u65F6\u56DE\u5E94\uFF0C\u5E76\u5F15\u5BFC\u5E7C\u513F\u53C2\u4E0E\u89C4\u5219\u5F62\u6210\uFF0C\u9010\u6B65\u5EFA\u7ACB\u5B89\u5168\u3001\u516C\u5E73\u3001\u53EF\u6301\u7EED\u7684\u5171\u540C\u6E38\u620F\u6587\u5316\u3002",
        "slots": [
          {
            "slot_id": "Q10-S1",
            "dimension": "C2 \u884C\u4E3A\u5206\u6790",
            "name": "\u5B89\u5168\u3001\u79E9\u5E8F\u4E0E\u516C\u5E73\u95EE\u9898\u7EFC\u5408\u8BC6\u522B",
            "definition": "\u4ECE\u62E5\u6324\u78B0\u649E\u3001\u7B49\u5F85\u8FC7\u4E45\u3001\u89D2\u8272\u8D1F\u62C5\u4E0D\u5747\u7B49\u5224\u65AD\u5171\u540C\u6E38\u620F\u5DF2\u51FA\u73B0\u5B89\u5168\u548C\u516C\u5E73\u95EE\u9898\uFF0C\u800C\u4E0D\u53EA\u770B\u2018\u573A\u9762\u4E71\u2019\u3002",
            "diagnostic_meaning": "\u51B3\u5B9A\u4ECB\u5165\u5FC5\u8981\u6027\u548C\u76EE\u6807\u3002",
            "core": true,
            "prerequisites": [],
            "allowed_actions": [
              "\u8BC1\u636E\u8FFD\u95EE/\u6F84\u6E05"
            ],
            "forbidden_actions": [
              "\u53EA\u5F3A\u8C03\u7EAA\u5F8B"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u4E3B\u6307\u6807\u4ECB\u5165\u65F6\u673A\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q10-S2",
            "dimension": "C2/B2 \u4ECB\u5165\u65F6\u673A",
            "name": "\u5373\u65F6\u4ECB\u5165\u4E0E\u81EA\u4E3B\u534F\u5546\u7684\u5E73\u8861",
            "definition": "\u5B58\u5728\u660E\u663E\u78B0\u649E\u98CE\u9669\u65F6\u9700\u8981\u53CA\u65F6\u6682\u505C/\u7EC4\u7EC7\u5BF9\u8BDD\uFF0C\u4F46\u4ECB\u5165\u76EE\u6807\u5E94\u662F\u521B\u9020\u53EF\u534F\u5546\u6761\u4EF6\uFF0C\u800C\u4E0D\u662F\u7531\u6559\u5E08\u76F4\u63A5\u6C38\u4E45\u63A5\u7BA1\u3002",
            "diagnostic_meaning": "\u628A\u5B89\u5168\u6027\u4E0E\u5171\u540C\u6CBB\u7406\u7ED3\u5408\u3002",
            "core": true,
            "prerequisites": [
              "Q10-S1"
            ],
            "allowed_actions": [
              "\u6761\u4EF6\u8FB9\u754C"
            ],
            "forbidden_actions": [
              "\u5B8C\u5168\u5EF6\u540E"
            ],
            "default_priority": "P1",
            "empirical_relation": "D\u53EF\u6709\u53CD\u601D\u4EF7\u503C\uFF0C\u4F46\u4E0D\u80FD\u66FF\u4EE3\u5373\u65F6\u5B89\u5168\u56DE\u5E94\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q10-S3",
            "dimension": "C2/B2 \u4ECB\u5165\u65B9\u5F0F",
            "name": "\u5E7C\u513F\u5171\u540C\u8BC6\u522B\u95EE\u9898\u4E0E\u5F62\u6210\u89C4\u5219",
            "definition": "\u9080\u8BF7\u5E7C\u513F\u8BF4\u51FA\u62E5\u6324\u3001\u7B49\u5F85\u3001\u89D2\u8272\u4E0D\u516C\u5E73\u7B49\u95EE\u9898\uFF0C\u5171\u540C\u8BA8\u8BBA\u4EBA\u6570\u3001\u533A\u57DF\u3001\u8F6E\u6362\u3001\u89D2\u8272\u65F6\u957F\u7B49\u89C4\u5219\u3002",
            "diagnostic_meaning": "\u5B9E\u8BC1B\u9996\u7684\u6838\u5FC3\u4E13\u4E1A\u673A\u5236\u3002",
            "core": true,
            "prerequisites": [
              "Q10-S2"
            ],
            "allowed_actions": [
              "\u534F\u5546\u8FC7\u7A0B/\u529F\u80FD\u8FFD\u95EE"
            ],
            "forbidden_actions": [
              "\u6559\u5E08\u5355\u65B9\u9762\u5BA3\u5E03"
            ],
            "default_priority": "P1",
            "empirical_relation": "\u6240\u67094\u5206\u7EC4\u5408B\u5C45\u9996\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q10-S4",
            "dimension": "B2 \u6559\u5E08\u89D2\u8272",
            "name": "\u6210\u4EBA\u7EC4\u7EC7\u4F5C\u4E3A\u4E34\u65F6\u652F\u67B6",
            "definition": "\u5FC5\u8981\u65F6\u6559\u5E08\u53EF\u5148\u5206\u7EC4/\u5206\u533A\u964D\u4F4E\u5373\u65F6\u98CE\u9669\uFF0C\u4F46\u5E94\u628A\u7406\u7531\u8BF4\u660E\u6E05\u695A\uFF0C\u5E76\u9010\u6B65\u8BA9\u5E7C\u513F\u53C2\u4E0E\u8C03\u6574\u548C\u7EF4\u6301\u89C4\u5219\u3002",
            "diagnostic_meaning": "\u89E3\u91CAA\u6709\u5B89\u5168\u4EF7\u503C\u4F46\u4E0D\u5E94\u6210\u4E3A\u6700\u7EC8\u6CBB\u7406\u65B9\u5F0F\u3002",
            "core": true,
            "prerequisites": [
              "Q10-S1",
              "Q10-S3"
            ],
            "allowed_actions": [
              "\u8FB9\u754C/\u8FC1\u79FB"
            ],
            "forbidden_actions": [
              "\u957F\u671F\u7531\u6559\u5E08\u5206\u7EC4"
            ],
            "default_priority": "P2",
            "empirical_relation": "A\u57284\u5206\u4E2D\u53EF2/3/4\u4F4D\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q10-S5",
            "dimension": "B1/C2 \u73AF\u5883\u652F\u6301",
            "name": "\u6750\u6599\u4E0E\u7A7A\u95F4\u8C03\u6574\u7684\u529F\u80FD\u8FB9\u754C",
            "definition": "\u66F4\u591A\u8DF3\u7EF3\u3001\u5206\u533A\u53EF\u4EE5\u7F13\u89E3\u62E5\u6324\uFF0C\u4F46\u6750\u6599\u589E\u52A0\u672C\u8EAB\u4E0D\u80FD\u89E3\u51B3\u8F6E\u5019\u516C\u5E73\u3001\u89D2\u8272\u89C4\u5219\u548C\u5171\u540C\u534F\u5546\u3002",
            "diagnostic_meaning": "\u89E3\u91CAC\u5728\u5B9E\u8BC1\u9AD8\u5206\u4E2D\u8F83\u5C11\u5C45\u524D\u3002",
            "core": true,
            "prerequisites": [
              "Q10-S1"
            ],
            "allowed_actions": [
              "\u5177\u4F53\u5316/\u5BF9\u6BD4"
            ],
            "forbidden_actions": [
              "\u6750\u6599\u8D8A\u591A\u8D8A\u597D"
            ],
            "default_priority": "P2",
            "empirical_relation": "\u73AF\u5883\u652F\u6301\u5FC5\u987B\u548C\u89C4\u5219\u5171\u5EFA\u914D\u5957\u3002",
            "calibration_note": ""
          },
          {
            "slot_id": "Q10-S6",
            "dimension": "C2 \u53CD\u601D",
            "name": "\u5373\u65F6\u53CD\u601D\u4E0E\u89C6\u9891\u56DE\u653E\u7684\u8FDE\u7EED\u652F\u6301",
            "definition": "\u7167\u7247/\u89C6\u9891\u9002\u5408\u540E\u7EED\u56DE\u987E\u3001\u89C4\u5219\u4FEE\u8BA2\u548C\u5171\u540C\u6587\u5316\u5EFA\u8BBE\uFF0C\u4F46\u5E94\u5EFA\u7ACB\u5728\u5373\u65F6\u5B89\u5168\u5904\u7406\u4E4B\u540E\u3002",
            "diagnostic_meaning": "\u4FDD\u7559D\u7684\u4E13\u4E1A\u4EF7\u503C\u3002",
            "core": false,
            "prerequisites": [
              "Q10-S2",
              "Q10-S3"
            ],
            "allowed_actions": [
              "\u65F6\u673A\u6BD4\u8F83/\u53CD\u601D"
            ],
            "forbidden_actions": [
              "\u628A\u56DE\u653E\u66FF\u4EE3\u73B0\u573A\u652F\u6301"
            ],
            "default_priority": "P3",
            "empirical_relation": "D\u57284\u5206\u4E2D\u591A\u4E3A2/3\u4F4D\u3002",
            "calibration_note": ""
          }
        ]
      },
      "anchors": {
        "item_id": "Q10",
        "anchors": [
          {
            "slot_id": "Q10-S1",
            "level_0": "\u53EA\u8BF4\u573A\u9762\u592A\u4E71\u3001\u8981\u5B89\u9759\u3002",
            "level_1": "\u80FD\u770B\u5230\u78B0\u649E\u98CE\u9669\uFF0C\u4F46\u5FFD\u7565\u7B49\u5F85/\u89D2\u8272\u516C\u5E73\u3002",
            "level_2": "\u540C\u65F6\u8BC6\u522B\u78B0\u649E\u3001\u62E5\u6324\u3001\u8F6E\u5019\u8FC7\u957F\u3001\u2018\u67F1\u5B50\u2019\u89D2\u8272\u8D1F\u62C5\u7B49\uFF0C\u5E76\u628A\u5B83\u4EEC\u89C6\u4E3A\u5171\u540C\u6E38\u620F\u7ED3\u6784\u95EE\u9898\u3002",
            "level_3": "\u80FD\u8FDB\u4E00\u6B65\u533A\u5206\u54EA\u4E9B\u9700\u7ACB\u523B\u5904\u7406\u3001\u54EA\u4E9B\u53EF\u7531\u5E7C\u513F\u534F\u5546\u6539\u8FDB\uFF0C\u5E76\u7528\u89C2\u5BDF\u8BC1\u636E\u6392\u5E8F\u4F18\u5148\u7EA7\u3002",
            "false_evidence": "\u53EA\u8BF4\u5B89\u5168\u7B2C\u4E00\u3002",
            "conflict_evidence": "\u53EA\u5904\u7406\u78B0\u649E\u4E0D\u5904\u7406\u957F\u671F\u7B49\u5F85\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q10-S2",
            "level_0": "\u5B8C\u5168\u4E0D\u4ECB\u5165\u5230\u5206\u4EAB\uFF0C\u6216\u6559\u5E08\u76F4\u63A5\u63A5\u7BA1\u5168\u90E8\u7EC4\u7EC7\u3002",
            "level_1": "\u77E5\u9053\u8981\u5148\u5B89\u5168\u5904\u7406\uFF0C\u4F46\u540E\u7EED\u4ECD\u7531\u6559\u5E08\u51B3\u5B9A\u3002",
            "level_2": "\u5728\u660E\u663E\u98CE\u9669\u65F6\u53CA\u65F6\u6682\u505C/\u8C03\u6574\uFF0C\u968F\u540E\u8BA9\u5E7C\u513F\u53C2\u4E0E\u8BC6\u522B\u95EE\u9898\u548C\u89C4\u5219\u5F62\u6210\u3002",
            "level_3": "\u80FD\u6839\u636E\u98CE\u9669\u5F3A\u5EA6\u9009\u62E9\u6700\u5C0F\u5FC5\u8981\u6210\u4EBA\u652F\u67B6\uFF0C\u5E76\u8FC5\u901F\u628A\u6CBB\u7406\u6743\u9010\u6B65\u4EA4\u56DE\u5E7C\u513F\u3002",
            "false_evidence": "\u6682\u505C=\u63A7\u5236\u3002",
            "conflict_evidence": "\u6709\u98CE\u9669\u4ECD\u4E3A\u4E86\u81EA\u4E3B\u5B8C\u5168\u7B49\u5F85\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q10-S3",
            "level_0": "\u6559\u5E08\u76F4\u63A5\u5BA3\u5E03\u5206\u7EC4\u3001\u8F6E\u6362\u3002",
            "level_1": "\u4F1A\u95EE\u5E7C\u513F\u610F\u89C1\uFF0C\u4F46\u95EE\u9898\u548C\u89C4\u5219\u57FA\u672C\u7531\u6210\u4EBA\u9884\u8BBE\u3002",
            "level_2": "\u8BA9\u5E7C\u513F\u8BF4\u51FA\u95EE\u9898\uFF0C\u56F4\u7ED5\u4EBA\u6570\u3001\u7A7A\u95F4\u3001\u987A\u5E8F\u3001\u89D2\u8272\u8F6E\u6362\u5171\u540C\u63D0\u51FA\u5E76\u9009\u62E9\u89C4\u5219\u3002",
            "level_3": "\u80FD\u652F\u6301\u8BD5\u884C\u2014\u89C2\u5BDF\u2014\u4FEE\u8BA2\uFF0C\u4F7F\u89C4\u5219\u6210\u4E3A\u5E7C\u513F\u5171\u540C\u7EF4\u62A4\u7684\u6E38\u620F\u6587\u5316\u3002",
            "false_evidence": "\u5F62\u5F0F\u6C11\u4E3B\u3001\u5B9E\u8D28\u6210\u4EBA\u51B3\u5B9A\u3002",
            "conflict_evidence": "\u89C4\u5219\u53EA\u4E3A\u5B89\u9759\uFF0C\u4E0D\u89E3\u51B3\u516C\u5E73/\u5B89\u5168\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q10-S4",
            "level_0": "\u6559\u5E08\u957F\u671F\u56FA\u5B9A\u5206\u7EC4\u5206\u533A\u3002",
            "level_1": "\u80FD\u4E34\u65F6\u5206\u7EC4\uFF0C\u4F46\u672A\u8BF4\u660E\u4F55\u65F6\u653E\u624B\u3002",
            "level_2": "\u5FC5\u8981\u65F6\u5148\u5206\u7EC4/\u5206\u533A\u964D\u98CE\u9669\uFF0C\u540C\u65F6\u89E3\u91CA\u8FD9\u662F\u4E34\u65F6\u529E\u6CD5\uFF0C\u5E76\u5F88\u5FEB\u8F6C\u5165\u5E7C\u513F\u534F\u5546\u3002",
            "level_3": "\u80FD\u6839\u636E\u5E7C\u513F\u89C4\u5219\u80FD\u529B\u9010\u6B65\u51CF\u5C11\u6210\u4EBA\u7EC4\u7EC7\uFF0C\u4F7F\u5E7C\u513F\u81EA\u884C\u8C03\u6574\u4EBA\u6570\u3001\u8F6E\u6362\u548C\u533A\u57DF\u3002",
            "false_evidence": "\u9AD8\u6548\u7EC4\u7EC7\u88AB\u7B49\u540C\u9AD8\u6C34\u5E73\u3002",
            "conflict_evidence": "\u6BCF\u6B21\u90FD\u7531\u6559\u5E08\u91CD\u65B0\u5206\u7EC4\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q10-S5",
            "level_0": "\u53EA\u589E\u52A0\u8DF3\u7EF3\u6216\u6269\u5927\u7A7A\u95F4\u3002",
            "level_1": "\u77E5\u9053\u6750\u6599\u80FD\u51CF\u62E5\u6324\uFF0C\u4F46\u4E0D\u5904\u7406\u8F6E\u5019\u548C\u89D2\u8272\u89C4\u5219\u3002",
            "level_2": "\u628A\u6750\u6599/\u7A7A\u95F4\u8C03\u6574\u4E0E\u5171\u540C\u89C4\u5219\u7ED3\u5408\uFF0C\u660E\u786E\u6750\u6599\u89E3\u51B3\u4EC0\u4E48\u3001\u4E0D\u89E3\u51B3\u4EC0\u4E48\u3002",
            "level_3": "\u80FD\u4F9D\u636E\u65B0\u6750\u6599\u540E\u7684\u6E38\u620F\u6570\u636E\u518D\u6B21\u4FEE\u8BA2\u7A7A\u95F4\u548C\u89C4\u5219\uFF0C\u4F7F\u5B89\u5168\u3001\u516C\u5E73\u3001\u53C2\u4E0E\u7387\u540C\u65F6\u63D0\u5347\u3002",
            "false_evidence": "\u5668\u6750\u8D8A\u591A\u8D8A\u597D\u3002",
            "conflict_evidence": "\u65B0\u589E\u6750\u6599\u5BFC\u81F4\u66F4\u6DF7\u4E71\u4ECD\u4E0D\u8C03\u6574\u3002",
            "calibration_note": "40"
          },
          {
            "slot_id": "Q10-S6",
            "level_0": "\u7528\u7167\u7247\u6216\u89C6\u9891\u56DE\u653E\u66FF\u4EE3\u73B0\u573A\u7684\u78B0\u649E\u98CE\u9669\u5904\u7406\u3002",
            "level_1": "\u77E5\u9053\u8981\u5148\u5904\u7406\u5B89\u5168\u3001\u540E\u56DE\u653E\uFF0C\u4F46\u56DE\u653E\u4E3B\u8981\u7528\u4E8E\u6279\u8BC4\u6216\u91CD\u7533\u6210\u4EBA\u89C4\u5219\u3002",
            "level_2": "\u80FD\u5148\u505A\u6700\u5C0F\u5FC5\u8981\u5B89\u5168\u5904\u7406\uFF0C\u518D\u7528\u5F71\u50CF\u5E2E\u52A9\u5E7C\u513F\u56DE\u770B\u79E9\u5E8F\u4E0E\u516C\u5E73\u3001\u4FEE\u8BA2\u5171\u540C\u89C4\u5219\u3002",
            "level_3": "\u80FD\u628A\u5373\u65F6\u5904\u7F6E\u3001\u5F71\u50CF\u53CD\u601D\u3001\u89C4\u5219\u8BD5\u884C\u548C\u518D\u89C2\u5BDF\u5F62\u6210\u95ED\u73AF\uFF0C\u9010\u6B65\u51CF\u5C11\u6210\u4EBA\u7EC4\u7EC7\u3002",
            "false_evidence": "\u5F55\u4E86\u89C6\u9891\u5C31\u53EB\u53CD\u601D\u3002",
            "conflict_evidence": "\u660E\u663E\u98CE\u9669\u4E0B\u7B49\u5F85\u56DE\u653E\uFF0C\u6216\u56DE\u653E\u53D8\u6210\u70B9\u540D\u6279\u8BC4\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "priority": {
        "item_id": "Q10",
        "rules": [
          {
            "condition": "\u5B9E\u8BC14\u5206\uFF1ABADC/BDAC/BDCA",
            "hypothesis": "\u5168\u90E8B\u5C45\u9996\uFF0CA/D\u6B21\u4F4D\u53D8\u5316\uFF0C\u7A81\u51FA\u5171\u540C\u8BC6\u522B\u95EE\u9898\u548C\u89C4\u5219\u5171\u5EFA\u3002",
            "target_slots": [
              "Q10-S2",
              "Q10-S3",
              "Q10-S4"
            ],
            "priority": "P2",
            "preferred_action": "\u8FC1\u79FB/\u8FB9\u754C",
            "forbidden_question": "\u201CB\u7B2C\u4E00\u5C31\u7B49\u4E8E\u5B8C\u5168\u8BA9\u5E7C\u513F\u81EA\u5DF1\u89E3\u51B3\u3002\u201D",
            "rationale": "\u9A8C\u8BC1\u6559\u5E08\u662F\u5426\u540C\u65F6\u5904\u7406\u5373\u65F6\u5B89\u5168\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC13\u5206",
            "hypothesis": "B/C/D/A\u987A\u5E8F\u66F4\u5206\u6563\uFF0C\u4F46\u591A\u4ECD\u4FDD\u7559\u534F\u5546\u6216\u53CD\u601D\u4EF7\u503C\u3002",
            "target_slots": [
              "Q10-S3",
              "Q10-S5",
              "Q10-S6"
            ],
            "priority": "P2",
            "preferred_action": "\u6BD4\u8F83",
            "forbidden_question": "\u201C\u6750\u6599\u589E\u52A0\u548C\u89C4\u5219\u5171\u5EFA\u5206\u522B\u89E3\u51B3\u4EC0\u4E48\uFF1F\u201D",
            "rationale": "\u67E5\u73AF\u5883\u652F\u6301\u8FB9\u754C\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC12\u5206",
            "hypothesis": "\u90E8\u5206\u8BA4\u8BC6\u5230\u95EE\u9898\uFF0C\u4F46\u53EF\u80FD\u7531\u6210\u4EBA\u7EC4\u7EC7\u6216\u6750\u6599\u8C03\u6574\u66FF\u4EE3\u5E7C\u513F\u89C4\u5219\u5F62\u6210\u3002",
            "target_slots": [
              "Q10-S1",
              "Q10-S3",
              "Q10-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u529F\u80FD\u8FFD\u95EE",
            "forbidden_question": "\u201C\u5206\u7EC4\u4EE5\u540E\uFF0C\u5E7C\u513F\u9700\u8981\u5B66\u4F1A\u4EC0\u4E48\uFF1F\u201D",
            "rationale": "\u4ECE\u79E9\u5E8F\u7BA1\u7406\u8F6C\u5171\u540C\u6CBB\u7406\u3002",
            "calibration_note": ""
          },
          {
            "condition": "\u5B9E\u8BC10\u20141\u5206\u6216ABCD",
            "hypothesis": "\u53EF\u80FD\u4EE5\u6210\u4EBA\u6682\u505C\u5206\u7EC4\u4E3A\u4E3B\uFF0C\u4E4B\u540E\u6750\u6599/\u53CD\u601D\u4E0D\u8DB3\uFF0C\u5E7C\u513F\u5171\u5EFA\u89C4\u5219\u4EF7\u503C\u4F4E\u3002",
            "target_slots": [
              "Q10-S3",
              "Q10-S4"
            ],
            "priority": "P1",
            "preferred_action": "\u53CD\u4F8B",
            "forbidden_question": "\u201C\u5982\u679C\u4EE5\u540E\u6BCF\u6B21\u90FD\u7531\u8001\u5E08\u5206\u7EC4\uFF0C\u5B69\u5B50\u4F1A\u5F62\u6210\u5171\u540C\u89C4\u5219\u5417\uFF1F\u201D",
            "rationale": "\u6838\u5FC3\u67E5\u6559\u5E08\u89D2\u8272\u8F6C\u6362\u3002",
            "calibration_note": ""
          },
          {
            "condition": "D\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u8FC7\u5EA6\u5EF6\u540E\u73B0\u573A\u4ECB\u5165\uFF0C\u5B89\u5168\u98CE\u9669\u5904\u7406\u4E0D\u8DB3\u3002",
            "target_slots": [
              "Q10-S1",
              "Q10-S2"
            ],
            "priority": "P1",
            "preferred_action": "\u65F6\u673A\u8FB9\u754C",
            "forbidden_question": "\u201C\u5DF2\u7ECF\u5F88\u5BB9\u6613\u78B0\u649E\u65F6\uFF0C\u8FD8\u7B49\u5230\u5206\u4EAB\u5417\uFF1F\u201D",
            "rationale": "\u533A\u5206\u89C6\u9891\u53CD\u601D\u4E0E\u5373\u65F6\u5B89\u5168\u3002",
            "calibration_note": ""
          },
          {
            "condition": "C\u5C45\u524D",
            "hypothesis": "\u53EF\u80FD\u628A\u6DF7\u4E71\u4E3B\u8981\u89E3\u91CA\u4E3A\u5668\u6750\u4E0D\u8DB3\uFF0C\u5FFD\u7565\u8F6E\u6362\u548C\u516C\u5E73\u89C4\u5219\u3002",
            "target_slots": [
              "Q10-S1",
              "Q10-S5"
            ],
            "priority": "P1",
            "preferred_action": "\u673A\u5236\u8FFD\u95EE",
            "forbidden_question": "\u201C\u591A\u51E0\u6839\u8DF3\u7EF3\u80FD\u89E3\u51B3\u5F53\u2018\u67F1\u5B50\u2019\u7B49\u592A\u4E45\u5417\uFF1F\u201D",
            "rationale": "\u67E5\u6750\u6599\u4E0E\u7ED3\u6784\u95EE\u9898\u3002",
            "calibration_note": ""
          }
        ]
      },
      "probe": {
        "item_id": "Q10",
        "probes": [
          {
            "slot_id": "Q10-S1",
            "allowed_actions": [
              "\u95EE\u9898\u8BC6\u522B"
            ],
            "preferred_action": "\u8BC1\u636E\u8FFD\u95EE",
            "typical_question": "\u201C\u60A8\u770B\u5230\u8FD9\u4E2A\u8DF3\u7EF3\u573A\u9762\u65F6\uFF0C\u89C9\u5F97\u771F\u6B63\u9700\u8981\u89E3\u51B3\u7684\u6709\u54EA\u51E0\u7C7B\u95EE\u9898\uFF1F\u201D",
            "followup_question": "\u201C\u78B0\u649E\u98CE\u9669\u548C\u2018\u67F1\u5B50\u2019\u7B49\u592A\u4E45\uFF0C\u6027\u8D28\u4E00\u6837\u5417\uFF1F\u201D",
            "forbidden_actions": [
              "\u7EAA\u5F8B\u5316"
            ],
            "forbidden_question": "\u201C\u662F\u4E0D\u662F\u5148\u8BA9\u5927\u5BB6\u5B89\u9759\u4E0B\u6765\uFF1F\u201D",
            "non_inducing_boundary": "\u8BC6\u522B\u5B89\u5168\u3001\u79E9\u5E8F\u3001\u516C\u5E73\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q10-S2",
            "allowed_actions": [
              "\u65F6\u673A\u8FB9\u754C"
            ],
            "preferred_action": "\u6761\u4EF6\u5224\u65AD",
            "typical_question": "\u201C\u4EC0\u4E48\u60C5\u51B5\u4F1A\u8BA9\u60A8\u73B0\u5728\u5C31\u6682\u505C\u6216\u8C03\u6574\uFF0C\u4EC0\u4E48\u60C5\u51B5\u53EF\u4EE5\u7EE7\u7EED\u89C2\u5BDF\uFF1F\u201D",
            "followup_question": "\u201C\u600E\u6837\u505A\u5230\u5148\u964D\u98CE\u9669\uFF0C\u53C8\u4E0D\u628A\u540E\u9762\u90FD\u66FF\u5E7C\u513F\u51B3\u5B9A\uFF1F\u201D",
            "forbidden_actions": [
              "\u5B8C\u5168\u5EF6\u540E"
            ],
            "forbidden_question": "\u201C\u7B49\u5206\u4EAB\u65F6\u518D\u770B\u89C6\u9891\u66F4\u5C0A\u91CD\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5B89\u5168\u662F\u5373\u65F6\u5E95\u7EBF\uFF0C\u81EA\u4E3B\u662F\u540E\u7EED\u76EE\u6807\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q10-S3",
            "allowed_actions": [
              "\u89C4\u5219\u5171\u5EFA"
            ],
            "preferred_action": "\u534F\u5546\u8FC7\u7A0B",
            "typical_question": "\u201C\u5982\u679C\u628A\u5B69\u5B50\u4EEC\u5148\u53EC\u96C6\u4E00\u4E0B\uFF0C\u60A8\u4F1A\u600E\u6837\u8BA9\u4ED6\u4EEC\u81EA\u5DF1\u8BF4\u51FA\u95EE\u9898\u5E76\u4E00\u8D77\u60F3\u89C4\u5219\uFF1F\u201D",
            "followup_question": "\u201C\u54EA\u4E9B\u89C4\u5219\u6700\u9700\u8981\u5148\u8BD5\uFF1A\u4EBA\u6570\u3001\u533A\u57DF\u3001\u8F6E\u6362\u8FD8\u662F\u522B\u7684\uFF1F\u201D",
            "forbidden_actions": [
              "\u6210\u4EBA\u5BA3\u5E03"
            ],
            "forbidden_question": "\u201C\u8001\u5E08\u89C4\u5B9A\u6BCF\u7EC4\u4E94\u4E2A\u4EBA\u3002\u201D",
            "non_inducing_boundary": "\u8BA9\u5E7C\u513F\u53C2\u4E0E\u5F62\u6210\u3001\u8BD5\u884C\u548C\u4FEE\u8BA2\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q10-S4",
            "allowed_actions": [
              "\u6210\u4EBA\u652F\u67B6\u8FB9\u754C"
            ],
            "preferred_action": "\u89D2\u8272\u53CD\u601D",
            "typical_question": "\u201C\u5982\u679C\u4E3A\u4E86\u5B89\u5168\u60A8\u5148\u5206\u4E86\u51E0\u4E2A\u5C0F\u7EC4\uFF0C\u63A5\u4E0B\u6765\u600E\u6837\u628A\u8FD9\u4EF6\u4E8B\u6162\u6162\u8FD8\u7ED9\u5B69\u5B50\uFF1F\u201D",
            "followup_question": "\u201C\u4EC0\u4E48\u8868\u73B0\u8BF4\u660E\u4EE5\u540E\u53EF\u4EE5\u8BA9\u4ED6\u4EEC\u81EA\u5DF1\u7EC4\u7EC7\uFF1F\u201D",
            "forbidden_actions": [
              "\u6C38\u4E45\u7EC4\u7EC7"
            ],
            "forbidden_question": "\u201C\u4EE5\u540E\u90FD\u7531\u8001\u5E08\u5206\u7EC4\u6700\u7701\u4E8B\u3002\u201D",
            "non_inducing_boundary": "\u6210\u4EBA\u7EC4\u7EC7\u53EA\u80FD\u662F\u4E34\u65F6\u652F\u67B6\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q10-S5",
            "allowed_actions": [
              "\u6750\u6599/\u7A7A\u95F4\u529F\u80FD"
            ],
            "preferred_action": "\u5BF9\u6BD4",
            "typical_question": "\u201C\u591A\u653E\u8DF3\u7EF3\u3001\u5206\u5F00\u573A\u5730\u5206\u522B\u80FD\u89E3\u51B3\u4EC0\u4E48\uFF0C\u53C8\u89E3\u51B3\u4E0D\u4E86\u4EC0\u4E48\uFF1F\u201D",
            "followup_question": "\u201C\u5982\u679C\u8FD8\u662F\u6709\u4EBA\u7B49\u5F88\u4E45\uFF0C\u4E0B\u4E00\u6B65\u8981\u6539\u4EC0\u4E48\uFF1F\u201D",
            "forbidden_actions": [
              "\u6750\u6599\u4E07\u80FD"
            ],
            "forbidden_question": "\u201C\u5668\u6750\u591F\u591A\u5C31\u4E0D\u4F1A\u4E71\u4E86\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u67E5\u7ED3\u6784\u6027\u89C4\u5219\u95EE\u9898\u3002",
            "calibration_note": "44"
          },
          {
            "slot_id": "Q10-S6",
            "allowed_actions": [
              "\u65F6\u673A\u6BD4\u8F83\uFF0C\u53CD\u601D"
            ],
            "preferred_action": "\u5F71\u50CF\u53CD\u601D",
            "typical_question": "\u201C\u73B0\u573A\u5148\u964D\u4F4E\u78B0\u649E\u98CE\u9669\u540E\uFF0C\u60A8\u4F1A\u600E\u6837\u7528\u7167\u7247\u6216\u89C6\u9891\u5E2E\u52A9\u5E7C\u513F\u7EE7\u7EED\u4FEE\u8BA2\u89C4\u5219\uFF1F\u201D",
            "followup_question": "\u201C\u600E\u6837\u907F\u514D\u56DE\u653E\u53D8\u6210\u6559\u5E08\u6279\u8BC4\u6216\u516C\u5E03\u7B54\u6848\uFF1F\u201D",
            "forbidden_actions": [
              "\u56DE\u653E\u66FF\u4EE3"
            ],
            "forbidden_question": "\u201C\u5148\u628A\u89C6\u9891\u62CD\u4E0B\u6765\uFF0C\u7B49\u5206\u4EAB\u65F6\u518D\u5904\u7406\u5B89\u5168\u95EE\u9898\u66F4\u5B8C\u6574\u5427\uFF1F\u201D",
            "non_inducing_boundary": "\u5F71\u50CF\u7528\u4E8E\u540E\u7EED\u5171\u540C\u53CD\u601D\uFF0C\u4E0D\u80FD\u5EF6\u8FDF\u5373\u65F6\u5B89\u5168\u5E95\u7EBF\uFF0C\u4E5F\u4E0D\u80FD\u70B9\u540D\u8BC4\u5224\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          }
        ]
      },
      "stop": {
        "item_id": "Q10",
        "rules": [
          {
            "scope": "Q10-S1~S2 \u95EE\u9898/\u65F6\u673A",
            "sufficient_condition": "\u80FD\u540C\u65F6\u8BC6\u522B\u5B89\u5168\u3001\u79E9\u5E8F\u3001\u516C\u5E73\u95EE\u9898\uFF0C\u5E76\u8BF4\u660E\u660E\u663E\u78B0\u649E\u98CE\u9669\u9700\u8981\u53CA\u65F6\u5904\u7406\u3002",
            "no_gain_threshold": "1\u8F6E\u53EA\u8BF4\u2018\u4E71/\u5B89\u5168\u2019\u65E0\u7ED3\u6784\uFF0C\u6362\u516C\u5E73\u53CD\u4F8B\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u53C8\u575A\u6301\u5B8C\u5168\u5EF6\u540E\u6216\u5168\u9762\u63A5\u7BA1\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ10-S3\u3002",
            "stop_condition": "\u4E0D\u80FD\u5355\u72EC\u505C\u6B62\u3002",
            "forbidden_stop": "\u5373\u65F6\u5B89\u5168\u9608\u503C\u4E0D\u6E05\u4E0D\u5F97\u505C\u6B62\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q10-S3~S4 \u89C4\u5219\u5171\u5EFA/\u6559\u5E08\u89D2\u8272",
            "sufficient_condition": "\u80FD\u652F\u6301\u5E7C\u513F\u5171\u540C\u8BC6\u522B\u95EE\u9898\u3001\u5F62\u6210\u89C4\u5219\uFF0C\u5E76\u628A\u6210\u4EBA\u5206\u7EC4\u7B49\u7EC4\u7EC7\u4F5C\u4E3A\u4E34\u65F6\u652F\u67B6\u9010\u6B65\u9000\u51FA\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u53EA\u6709\u6210\u4EBA\u65B9\u6848\u65E0\u5E7C\u513F\u53C2\u4E0E\uFF0C\u8BB0\u5F55\u4E0D\u8DB3\u3002",
            "prune_condition": "\u5145\u5206\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u8BD5\u884C\u5931\u8D25\u6216\u6559\u5E08\u91CD\u65B0\u63A5\u7BA1\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ10-S5\u3002",
            "stop_condition": "\u6838\u5FC3\u5145\u5206\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u6CA1\u6709\u89C4\u5219\u5171\u5EFA\u673A\u5236\u4E0D\u5F97\u5224\u9AD8\u8D28\u91CF\u3002",
            "calibration_note": "44"
          },
          {
            "scope": "Q10-S5 \u6750\u6599/\u7A7A\u95F4\u529F\u80FD",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u6750\u6599\u548C\u7A7A\u95F4\u8C03\u6574\u5404\u81EA\u80FD\u89E3\u51B3\u4EC0\u4E48\uFF0C\u5E76\u627F\u8BA4\u5176\u4E0D\u80FD\u66FF\u4EE3\u8F6E\u6362\u3001\u516C\u5E73\u4E0E\u5171\u540C\u89C4\u5219\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u628A\u6750\u6599\u6570\u91CF\u5F53\u4F5C\u4E07\u80FD\u7B56\u7565\u5219\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\u540E\u526A\u679D\u3002",
            "reopen_condition": "\u540E\u7EED\u6750\u6599\u589E\u52A0\u4F46\u62E5\u6324\u3001\u7B49\u5F85\u6216\u89D2\u8272\u4E0D\u516C\u5E73\u4ECD\u672A\u6539\u5584\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u8F6CQ10-S6\uFF08\u9700\u8981\u540E\u7EED\u5F71\u50CF\u53CD\u601D\u65F6\uFF09\u6216\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u4E0E\u6838\u5FC3Slot\u5171\u540C\u6EE1\u8DB3\u65F6\uFF0C\u53EF\u51C6\u5907\u505C\u6B62\u3002",
            "forbidden_stop": "\u4E0D\u5F97\u7528\u6750\u6599\u6216\u5206\u533A\u66FF\u4EE3\u5E7C\u513F\u5171\u540C\u6CBB\u7406\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "Q10-S6 \u5F71\u50CF\u53CD\u601D",
            "sufficient_condition": "\u80FD\u8BF4\u660E\u5148\u5B8C\u6210\u5373\u65F6\u6700\u5C0F\u5B89\u5168\u5904\u7406\uFF0C\u518D\u7528\u7167\u7247\u6216\u89C6\u9891\u652F\u6301\u5E7C\u513F\u56DE\u770B\u79E9\u5E8F\u3001\u516C\u5E73\u5E76\u4FEE\u8BA2\u5171\u540C\u89C4\u5219\u3002",
            "no_gain_threshold": "1\u8F6E\u4ECD\u53EA\u8BF4\u2018\u770B\u89C6\u9891\u2019\u3001\u65E0\u53CD\u601D\u673A\u5236\u5219\u526A\u679D\u3002",
            "prune_condition": "\u8FBE\u52302\u7EA7\uFF0C\u6216\u5F53\u524D\u6CA1\u6709\u5F71\u50CF\u8D44\u6E90/\u53CD\u601D\u9700\u8981\u65F6\u526A\u679D\u3002",
            "reopen_condition": "\u51FA\u73B0\u65B0\u78B0\u649E\u98CE\u9669\u3001\u56DE\u653E\u53D8\u6210\u6279\u8BC4\uFF0C\u6216\u4FEE\u8BA2\u540E\u7684\u89C4\u5219\u65E0\u6CD5\u7EF4\u6301\u65F6\u91CD\u5F00\u3002",
            "shift_condition": "\u6574\u9898\u603B\u7ED3\u3002",
            "stop_condition": "\u975E\u5FC5\u987B\uFF1BS6\u5145\u5206\u6216\u786E\u8BA4\u5F53\u524D\u60C5\u5883\u4E0D\u9002\u7528\u65F6\u7ED3\u675F\u8BE5\u53EF\u9009\u5206\u652F\u3002",
            "forbidden_stop": "\u4E0D\u5F97\u7528\u5F71\u50CF\u56DE\u653E\u5EF6\u8FDF\u5373\u65F6\u98CE\u9669\u5904\u7406\uFF0C\u4E5F\u4E0D\u5F97\u8FDB\u884C\u516C\u5F00\u7F9E\u8FB1\u3002",
            "calibration_note": "\u5F85\u4E13\u5BB6\u68C0\u6838"
          },
          {
            "scope": "\u6574\u9898",
            "sufficient_condition": "Q10-S1~S5\u81F3\u5C114\u4E2A2\u7EA7\uFF0C\u5F62\u6210\u2018\u8BC6\u522B\u98CE\u9669\u4E0E\u516C\u5E73\u2014\u5373\u65F6\u6700\u5C0F\u4ECB\u5165\u2014\u5E7C\u513F\u5171\u5EFA\u89C4\u5219\u2014\u6210\u4EBA\u6E10\u9000\u2014\u73AF\u5883/\u89C4\u5219\u518D\u8C03\u6574\u2019\u94FE\u6761\uFF1BS6\u4E3A\u53EF\u9009\u6269\u5C55\uFF0C\u4E0D\u4F5C\u4E3A\u6574\u9898\u6700\u4F4E\u505C\u6B62\u6761\u4EF6\u3002",
            "no_gain_threshold": "\u8FDE\u7EED2\u8F6E\u6838\u5FC3\u65E0\u63D0\u5347\u3002",
            "prune_condition": "\u5145\u5206\u5206\u652F\u526A\u679D\u3002",
            "reopen_condition": "\u65B0\u51B2\u7A81\u91CD\u5F00\u3002",
            "shift_condition": "\u65E0\u3002",
            "stop_condition": "\u6EE1\u8DB3\u5145\u5206\u6216\u65F6\u95F4\u4E0A\u9650\u4F4E\u589E\u76CA\u505C\u6B62\u3002",
            "forbidden_stop": "\u4ECD\u628AB\u5F0F\u5171\u5EFA\u7406\u89E3\u4E3A\u4E0D\u9700\u5373\u65F6\u5B89\u5168\u5904\u7406\u65F6\u4E0D\u5F97\u63D0\u524D\u505C\u6B62\u3002",
            "calibration_note": "44"
          }
        ]
      },
      "metadata": {
        "item_id": "Q10",
        "title": "\u8DF3\u7EF3\u79E9\u5E8F\u6DF7\u4E71",
        "primary_indicator": "\u6E38\u620F\u652F\u6301\u4E0E\u6307\u5BFC \u2192 \u5BF9\u6E38\u620F\u884C\u4E3A\u7684\u5206\u6790\u4E0E\u56DE\u5E94\uFF5C\u4ECB\u5165\u65F6\u673A\u7684\u628A\u63E1\uFF1B\u4ECB\u5165\u65B9\u5F0F\u7684\u9002\u5B9C\u6709\u6548\u6027",
        "secondary_indicator": "\u6E38\u620F\u6761\u4EF6\u7684\u4FDD\u969C \u2192 \u6559\u5E08\u5728\u5E7C\u513F\u6E38\u620F\u4E2D\u7684\u89D2\u8272\uFF5C\u57FA\u672C\u5B9A\u4F4D\uFF1A\u652F\u6301\u8005\u3001\u5408\u4F5C\u8005\u4E0E\u5F15\u5BFC\u8005",
        "diagnostic_focus": "\u8003\u5BDF\u6559\u5E08\u80FD\u5426\u5728\u96C6\u4F53\u6E38\u620F\u79E9\u5E8F\u548C\u5B89\u5168\u98CE\u9669\u4E2D\u4F5C\u51FA\u9002\u65F6\u56DE\u5E94\uFF0C\u5E76\u5F15\u5BFC\u5E7C\u513F\u53C2\u4E0E\u89C4\u5219\u5F62\u6210\uFF0C\u9010\u6B65\u5EFA\u7ACB\u5B89\u5168\u3001\u516C\u5E73\u3001\u53EF\u6301\u7EED\u7684\u5171\u540C\u6E38\u620F\u6587\u5316\u3002",
        "empirical": {
          "0": [
            "ABCD"
          ],
          "1": [
            "ACBD",
            "ACDB",
            "ADBC",
            "BACD",
            "CABD",
            "CADB",
            "CBDA",
            "DABC",
            "DACB"
          ],
          "2": [
            "ABDC",
            "ADCB",
            "BCAD",
            "CBAD",
            "CDAB",
            "DCAB"
          ],
          "3": [
            "BCDA",
            "CDBA",
            "DBAC",
            "DBCA",
            "DCBA"
          ],
          "4": [
            "BADC",
            "BDAC",
            "BDCA"
          ]
        },
        "scoring_note": "4\u5206\u4E3ABADC\u3001BDAC\u3001BDCA\uFF0C\u5168\u90E8\u4EE5B\u5C45\u9996\uFF1B3\u5206\u4E5F\u591A\u4FDD\u6301B/C/D\u5728\u524D\u3002\u8BF4\u660E\u9AD8\u6C34\u5E73\u9996\u5148\u8BA9\u5E7C\u513F\u5171\u540C\u8BC6\u522B\u79E9\u5E8F\u3001\u5B89\u5168\u4E0E\u8F6E\u5019\u95EE\u9898\uFF0C\u5E76\u53C2\u4E0E\u89C4\u5219\u5F62\u6210\uFF1B\u6210\u4EBA\u76F4\u63A5\u5206\u7EC4\u53EF\u4F5C\u4E3A\u5B89\u5168\u6027\u652F\u67B6\uFF0C\u4F46\u4E0D\u80FD\u66FF\u4EE3\u5E7C\u513F\u5171\u540C\u5EFA\u6784\u89C4\u5219\u3002",
        "review_note": "\u6682\u65E0\u7279\u522B\u7591\u70B9\uFF1B\u4ECD\u9700\u9886\u57DF\u4E13\u5BB6\u7ED3\u5408\u8D4B\u5206\u539F\u7406\u3001\u771F\u5B9E\u4F5C\u7B54\u8FC7\u7A0B\u548C\u8BBF\u8C08\u8D44\u6599\u590D\u6838\u3002",
        "source_version": "2026-08-21-tcim-v0.1-ai-draft",
        "source": "DOC/\u6570\u636E\u8868 5\u4E2A.zip"
      }
    }
  }
};

// web/src/core/tcim/engine.js
var beliefState = __toESM(require_belief_state(), 1);
var teacherModel = __toESM(require_teacher_model(), 1);
var agentPlanner = __toESM(require_agent_planner(), 1);
var decisionGate = __toESM(require_decision_gate(), 1);
var challengeQueue = __toESM(require_challenge_queue(), 1);
var evidenceUpdater = __toESM(require_evidence_updater(), 1);
var prdmV2ns = __toESM(require_prdm_v2(), 1);
var knowledgeNeedNs = __toESM(require_knowledge_need(), 1);
var import_meta = {};
var { validateProposal: v2ValidateProposal, commitProposal: v2CommitProposal } = evidenceUpdater.default || evidenceUpdater;
var prdmV2 = prdmV2ns.default || prdmV2ns;
var knowledgeNeed = knowledgeNeedNs.default || knowledgeNeedNs;
var SYNONYMS = {
  \u5E7C\u513F: "\u5E7C\u513F",
  \u5B69\u5B50: "\u5E7C\u513F",
  \u5C0F\u670B\u53CB: "\u5E7C\u513F",
  \u5B9D\u8D1D: "\u5E7C\u513F",
  \u6ED1: "\u6E7F\u6ED1",
  \u6E7F\u6ED1: "\u6E7F\u6ED1",
  \u5730\u9762: "\u5730\u9762",
  \u5730\u6ED1: "\u6E7F\u6ED1",
  \u8BBE\u5907: "\u5668\u68B0",
  \u5668\u6750: "\u5668\u68B0",
  \u7BEE\u7403\u67B6: "\u5668\u68B0",
  \u98CE\u9669: "\u98CE\u9669",
  \u5371\u9669: "\u98CE\u9669",
  \u5B89\u5168: "\u98CE\u9669",
  \u4ECB\u5165: "\u4ECB\u5165",
  \u5E72\u9884: "\u4ECB\u5165",
  \u5236\u6B62: "\u4ECB\u5165",
  \u63D0\u9192: "\u4ECB\u5165",
  \u6E38\u620F: "\u6E38\u620F",
  \u73A9\u6CD5: "\u6E38\u620F",
  \u73A9\u6C34: "\u7528\u6C34",
  \u63A5\u6C34: "\u7528\u6C34",
  \u704C\u6C34: "\u7528\u6C34",
  \u89C4\u5219: "\u89C4\u5219",
  \u89C4\u77E9: "\u89C4\u5219",
  \u79E9\u5E8F: "\u89C4\u5219",
  \u573A\u5730: "\u573A\u5730",
  \u5730\u65B9: "\u573A\u5730",
  \u533A\u57DF: "\u573A\u5730",
  \u4ED6\u4EBA: "\u4ED6\u4EBA",
  \u522B\u4EBA: "\u4ED6\u4EBA",
  \u5176\u4ED6: "\u4ED6\u4EBA",
  \u89C2\u5BDF: "\u89C2\u5BDF",
  \u5173\u6CE8: "\u89C2\u5BDF",
  \u8F6C\u573A: "\u8F6C\u573A",
  \u8FC1\u79FB: "\u8F6C\u573A",
  \u81EA\u4E3B: "\u81EA\u4E3B",
  \u751F\u6210: "\u751F\u6210",
  \u5C0A\u91CD: "\u5C0A\u91CD"
};
var STOP_BIGRAMS = /* @__PURE__ */ new Set(["\u6211\u4EEC", "\u4F60\u4EEC", "\u4ED6\u4EEC", "\u8FD9\u4E2A", "\u90A3\u4E2A", "\u53EF\u4EE5", "\u5E94\u8BE5", "\u5C31\u662F", "\u8FD8\u662F", "\u5982\u679C", "\u4F46\u662F", "\u56E0\u4E3A", "\u6240\u4EE5", "\u4EC0\u4E48", "\u600E\u4E48", "\u7136\u540E", "\u4EE5\u53CA", "\u6216\u8005", "\u662F\u5426", "\u8FD8\u6709", "\u6CA1\u6709", "\u4E0D\u662F", "\u4E0D\u4F1A", "\u4E00\u4E2A", "\u81EA\u5DF1", "\u89C9\u5F97", "\u7684\u8BDD", "\u65F6\u5019", "\u5F53\u65F6", "\u4E4B\u540E", "\u4E4B\u524D", "\u8FD9\u6837", "\u90A3\u6837", "\u4E8B\u60C5", "\u60C5\u51B5", "\u65B9\u9762"]);
var RATE_MIN = 0.15;
var HITS_MIN = 3;
var semanticProvider = null;
var V2_ENABLED = String(typeof import_meta && typeof import_meta.env !== "undefined" && import_meta.env.VITE_TCIM_V2 || typeof process !== "undefined" && process.env && process.env.VITE_TCIM_V2 || "").trim() === "1";
var _semanticMode = String(typeof import_meta && typeof import_meta.env !== "undefined" && import_meta.env.VITE_TCIM_SEMANTIC_MODE || typeof process !== "undefined" && process.env && process.env.TCIM_SEMANTIC_MODE || (V2_ENABLED ? "fallback_allowed" : "disabled")).trim();
function setSemanticMode(mode) {
  _semanticMode = String(mode || "disabled").trim();
}
function getSemanticMode() {
  return _semanticMode;
}
function isV2Enabled() {
  return V2_ENABLED;
}
function setV2Enabled(v) {
  V2_ENABLED = !!v;
}
function setSemanticProvider(provider) {
  semanticProvider = typeof provider === "function" ? provider : null;
}
var JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/;
function offlineSemantic(teacherTurn) {
  return { candidate_spans: [], slot_evidence_proposals: [], conflict_candidates: [], false_evidence_flags: [], no_change_reasons: [], uncertainty: [], source_turn: teacherTurn || "", provider_version: "offline-v0.2" };
}
function normalizeSemanticProposal(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    proposal_type: p.proposal_type || "EvidenceAnalysisProposal",
    candidate_spans: Array.isArray(p.candidate_spans) ? p.candidate_spans : [],
    slot_evidence_proposals: Array.isArray(p.slot_evidence_proposals) ? p.slot_evidence_proposals : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    uncertainty: Array.isArray(p.uncertainty) ? p.uncertainty : [],
    no_change_reasons: Array.isArray(p.no_change_reasons) ? p.no_change_reasons : [],
    source_turn: p.source_turn || null,
    provider_version: p.provider_version || "custom"
  };
}
async function analyzeSemantic(teacherTurn, ctx) {
  const turn = String(teacherTurn || "").trim();
  if (!semanticProvider) {
    return { proposal: offlineSemantic(turn), ok: true, errors: [], provider: "offline" };
  }
  let raw;
  try {
    raw = await semanticProvider(turn, ctx || {});
  } catch (e) {
    return { proposal: offlineSemantic(turn), ok: false, errors: [`semantic_provider_error:${e && e.message}`], provider: "error" };
  }
  const errors = [];
  const normalized = normalizeSemanticProposal(raw);
  const validSlotIds = ctx && ctx.validSlotIds;
  for (const s of normalized.candidate_spans) {
    const text = s && s.text;
    if (!text) errors.push("candidate_spans \u67D0\u6761\u7F3A\u5C11 text");
    else if (turn && !turn.includes(text)) errors.push(`span\u300C${text}\u300D\u672A\u51FA\u73B0\u5728\u6559\u5E08\u539F\u8BDD\u4E2D`);
  }
  for (const sp of normalized.slot_evidence_proposals) {
    if (!sp || !sp.slot_id) errors.push("slot_evidence_proposal \u7F3A slot_id");
    else if (validSlotIds && !validSlotIds.has(sp.slot_id)) errors.push(`slot \u300C${sp.slot_id}\u300D\u4E0D\u5B58\u5728\u4E8E\u672C\u9898`);
    if (typeof sp.proposed_level === "number" && (sp.proposed_level < 0 || sp.proposed_level > 3)) errors.push(`slot \u300C${sp.slot_id}\u300D proposed_level \u8D8A\u754C: ${sp.proposed_level}`);
    if (Array.isArray(sp.supporting_spans) && sp.supporting_spans.length) {
      for (const t of sp.supporting_spans) if (turn && !turn.includes(t)) errors.push(`slot \u300C${sp.slot_id}\u300D supporting_span\u300C${t}\u300D\u672A\u56DE\u6307\u6559\u5E08\u539F\u8BDD`);
    }
  }
  if (JUDGE_RE.test(JSON.stringify(normalized))) errors.push("proposal \u51FA\u73B0\u80FD\u529B/\u4EBA\u683C/\u52A8\u673A\u76F4\u63A5\u5224\u5B9A\u8BCD\uFF08G05\uFF09");
  if (errors.length) return { proposal: offlineSemantic(turn), ok: false, errors, provider: "invalid" };
  return { proposal: { ...normalized, source_turn: normalized.source_turn || turn }, ok: true, errors: [], provider: "custom" };
}
function splitBlocks(text) {
  return String(text || "").replace(/[，。！？；：、""''（）()“”‘’\s]/g, "|").split("|").filter((b) => b.length >= 2);
}
function bigramsOf(text) {
  const out = /* @__PURE__ */ new Set();
  for (const block of splitBlocks(text)) {
    for (let i = 0; i < block.length - 1; i += 1) out.add(block.slice(i, i + 2));
  }
  return out;
}
function normalizeBigrams(bigrams) {
  const out = /* @__PURE__ */ new Set();
  for (const bg of bigrams) {
    const canon = SYNONYMS[bg];
    if (canon) out.add(canon);
    else if (!STOP_BIGRAMS.has(bg)) out.add(bg);
  }
  return out;
}
function buildKeywords(anchorText) {
  return normalizeBigrams(bigramsOf(anchorText));
}
function overlapCount(text, keywords) {
  const teacherSet = normalizeBigrams(bigramsOf(text));
  const kwCount = keywords && typeof keywords.size === "number" ? keywords.size : 0;
  if (!teacherSet.size || !kwCount) return 0;
  let hit = 0;
  for (const kw of keywords) if (teacherSet.has(kw)) hit += 1;
  return hit;
}
function assessSlot(teacherTurn, anchor, currentLevel = 0) {
  if (!anchor) return { level: currentLevel, confidence: 0, matched: false };
  let best = currentLevel;
  let bestHit = 0;
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || "");
    const hits = overlapCount(teacherTurn, kws);
    const kwCount = kws.size;
    const rate = kwCount ? hits / kwCount : 0;
    if (rate >= RATE_MIN && hits >= HITS_MIN && lv > best && hits > bestHit) {
      best = lv;
      bestHit = hits;
    }
  }
  const matched = best > currentLevel;
  const confidence = matched ? Math.min(1, bestHit / 4 + 0.3) : currentLevel > 0 ? 0.4 : 0;
  return { level: best, confidence, matched };
}
function statusFromLevel(level) {
  if (level <= 0) return "UNKNOWN";
  if (level === 1) return "PARTIAL";
  if (level === 2) return "SUFFICIENT";
  return "HIGH_QUALITY";
}
function slotTouchedByTeacher(teacherTurn, anchor) {
  if (!teacherTurn || !anchor) return false;
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || "");
    if (overlapCount(teacherTurn, kws) > 0) return true;
  }
  return false;
}
function anchorHitsInTurn(teacherTurn, anchor) {
  if (!teacherTurn || !anchor) return 0;
  let hits = 0;
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || "");
    hits += overlapCount(teacherTurn, kws);
  }
  return hits;
}
function teacherAnchorSpan(teacherTurn, anchor) {
  if (!teacherTurn || !anchor) return "";
  const norm = String(teacherTurn);
  for (let lv = 1; lv <= 3; lv += 1) {
    const kws = buildKeywords(anchor[`level_${lv}`] || "");
    for (const kw of kws) {
      const short = String(kw).replace(/\s+/g, "");
      if (short && short.length >= 2 && short.length <= 14 && norm.includes(kw)) return short;
    }
  }
  return "";
}
function initPrior(itemId, ranking, tags) {
  const item = TCIM_DATA.items[itemId];
  const prior = {};
  const rankingStr = (ranking || []).join("");
  const first = rankingStr[0] || "";
  const last = rankingStr[rankingStr.length - 1] || "";
  for (const rule of item.priority && item.priority.rules || []) {
    const cond = rule.condition || "";
    let matched = false;
    if (cond.includes("0\u20141\u5206") || cond.includes("0-1\u5206")) matched = last === "D" || (tags || []).some((t) => /极快|低确信|反复修改/.test(t));
    else if (/实证4分|4分/.test(cond)) matched = first === "A" || first === "C";
    else if (/实证3分/.test(cond)) matched = /[ABC]/.test(first);
    else if (/实证2分/.test(cond)) matched = true;
    else if (/D居末/.test(cond)) matched = last === "D";
    else if (/D排前|D靠前/.test(cond)) matched = first === "D";
    else if (/A居首/.test(cond)) matched = first === "A";
    else matched = true;
    if (!matched) continue;
    const boost = /低确信|反复修改|不确定|0—1分/.test(cond) ? 0.4 : 0.2;
    for (const slotId of rule.target_slots || []) {
      prior[slotId] = {
        uncertainty: Math.min(1, (prior[slotId]?.uncertainty || 0) + boost),
        priority: rule.priority === "P1" ? 0.9 : rule.priority === "P2" ? 0.6 : 0.3
      };
    }
  }
  return prior;
}
function createEvidence(itemId, prior, pretest) {
  const item = TCIM_DATA.items[itemId];
  const slots = item.ontology && item.ontology.slots || [];
  const ev = {};
  const lowScoreBoost = pretest && typeof pretest.mean === "number" && pretest.mean < 2 ? 0.15 : 0;
  const highScoreBoost = pretest && typeof pretest.mean === "number" && pretest.mean >= 3 ? 0.1 : 0;
  const noviceBoost = pretest && /^[0-5]\s*年/.test(String(pretest.teachingYears || "")) ? 0.1 : 0;
  for (const s of slots) {
    const p = prior[s.slot_id] || {};
    ev[s.slot_id] = {
      slot_id: s.slot_id,
      level: 0,
      status: "UNKNOWN",
      confidence: 0,
      uncertainty: Math.min(1, (p.uncertainty || 0) + lowScoreBoost + highScoreBoost + noviceBoost),
      priorPriority: p.priority || (s.default_priority === "P1" ? 0.9 : s.default_priority === "P2" ? 0.6 : 0.3),
      supporting_spans: [],
      conflicting_spans: [],
      probe_status: "OPEN",
      probe_count: 0,
      asked_questions: []
    };
  }
  return ev;
}
function updateEvidence(itemId, ev, teacherTurn, turnId) {
  const item = TCIM_DATA.items[itemId];
  const anchorsBySlot = {};
  for (const a of item.anchors && item.anchors.anchors || []) anchorsBySlot[a.slot_id] = a;
  const next = {};
  const updates = [];
  for (const slotId of Object.keys(ev)) {
    const st = { ...ev[slotId], supporting_spans: ev[slotId].supporting_spans.slice(), conflicting_spans: ev[slotId].conflicting_spans.slice() };
    if (st.probe_status === "PRUNED" || st.probe_status === "SATURATED") {
      next[slotId] = st;
      continue;
    }
    const anchor = anchorsBySlot[slotId];
    if (!anchor) {
      next[slotId] = st;
      continue;
    }
    const before = { level: st.level, confidence: st.confidence };
    const { level, confidence, matched } = assessSlot(teacherTurn, anchor, st.level);
    const conflictKws = buildKeywords(anchor.conflict_evidence || "");
    const hasConflict = conflictKws.size > 0 && overlapCount(teacherTurn, conflictKws) >= 1;
    if (matched) {
      st.level = level;
      st.status = statusFromLevel(level);
      st.confidence = confidence;
      if (!st.supporting_spans.includes(teacherTurn)) st.supporting_spans.push(teacherTurn);
    } else if (hasConflict && st.level > 0) {
      st.confidence = Math.max(0.2, st.confidence - 0.2);
      if (!st.conflicting_spans.includes(teacherTurn)) st.conflicting_spans.push(teacherTurn);
    }
    if (before.level !== st.level || before.confidence !== st.confidence) {
      updates.push({ slot_id: slotId, before, after: { level: st.level, confidence: st.confidence }, reason: matched ? `anchor_level_${level}` : hasConflict ? "conflict_added" : "no_change" });
    }
    next[slotId] = st;
  }
  return { evidence: next, updates };
}
function rankSlots(itemId, ev) {
  const item = TCIM_DATA.items[itemId];
  const slots = item.ontology && item.ontology.slots || [];
  return slots.filter((s) => s.core && ev[s.slot_id] && ev[s.slot_id].probe_status !== "PRUNED" && ev[s.slot_id].probe_status !== "SATURATED").map((s) => {
    const st = ev[s.slot_id];
    const score = (st.priorPriority || 0) + (st.level === 0 ? 0.5 : 0) + (st.uncertainty || 0) + (st.conflicting_spans.length ? 0.3 : 0) - Math.min(1, (st.probe_count || 0) / 4) * 0.3;
    return { slot: s, score };
  }).sort((a, b) => b.score - a.score);
}
function itemSufficient(itemId, ev) {
  const item = TCIM_DATA.items[itemId];
  const coreSlots = (item.ontology && item.ontology.slots || []).filter((s) => s.core);
  const sufficient = coreSlots.filter((s) => ev[s.slot_id] && ev[s.slot_id].level >= 2).length;
  return sufficient >= 4;
}
function probeForSlot(itemId, slotId) {
  const item = TCIM_DATA.items[itemId];
  const list = item.probe && Array.isArray(item.probe.probes) ? item.probe.probes : Array.isArray(item.probe) ? item.probe : [];
  return list.find((p) => p.slot_id === slotId) || null;
}
var REPAIR_RE = /(?:不是，?我的意思|我不是这个意思|我说的是|没(?:听|看)(?:懂|明白|清)|你没(?:理解|明白)|理解错(?:了)?|我(?:重新|再说)?(?:说|讲|表达)(?:不清|不对)+|换个(?:说法|角度)|意思(?:不是|是|是说)|我表达(?:错|不清))/i;
var REPAIR_LEAK = /标准答案|得分|分数|能力等级|评分|专家排序|R\/P\/G|slot|证据|锚点|内部指标/i;
function isRepairTurn(text) {
  return REPAIR_RE.test(String(text || "").replace(/\s+/g, ""));
}
function sanitizeExcerpt(text) {
  return String(text || "").replace(/[，。！？“”"''、：；]/g, "").replace(/\s+/g, " ").trim().slice(0, 14);
}
function repairQuestion(teacherTurn) {
  const excerpt = sanitizeExcerpt(teacherTurn);
  if (excerpt && !REPAIR_LEAK.test(excerpt)) return `\u6211\u53EF\u80FD\u6CA1\u7406\u89E3\u51C6\u786E\uFF0C\u60A8\u662F\u60F3\u8BF4\u201C${excerpt}\u201D\u5417\uFF1F`;
  return "\u6211\u53EF\u80FD\u6CA1\u7406\u89E3\u51C6\u786E\uFF0C\u60A8\u66F4\u60F3\u8BF4\u7684\u662F\u54EA\u4E00\u70B9\u5462\uFF1F";
}
function generateQuestion(itemId, ev, turnNo, history, preferredSlot, teacherTurn) {
  const ranked = rankSlots(itemId, ev);
  if (!ranked.length) return { question: "\u611F\u8C22\u60A8\u7684\u5206\u4EAB\uFF0C\u672C\u60C5\u5883\u7684\u8BBF\u8C08\u5148\u5230\u8FD9\u91CC\u3002", done: true };
  const askedTexts = (history || []).filter((h) => h.role === "ai" && h.text).map((h) => String(h.text).trim());
  const templateAsked = (t) => {
    if (!t) return true;
    const norm = String(t).trim().replace(/[，。！？？]/g, "");
    return askedTexts.some((x) => {
      const xn = String(x).replace(/[，。！？？]/g, "");
      return xn === norm || xn.includes(norm) || norm.includes(xn);
    });
  };
  let top;
  if (preferredSlot) {
    const pp = probeForSlot(itemId, preferredSlot);
    const freshPreferred = [pp && pp.typical_question, pp && pp.followup_question].filter((t) => t && !templateAsked(t));
    if (freshPreferred.length) top = { slot: { slot_id: preferredSlot } };
  }
  if (!top) {
    const candidates = ranked.filter((r) => {
      const p2 = probeForSlot(itemId, r.slot.slot_id);
      const freshTemplates = [p2 && p2.typical_question, p2 && p2.followup_question].filter((t) => t && !templateAsked(t));
      return freshTemplates.length > 0;
    });
    let touched = null;
    if (teacherTurn) {
      const item = TCIM_DATA.items[itemId];
      const ab2 = {};
      for (const a of item.anchors && item.anchors.anchors || []) ab2[a.slot_id] = a;
      const scored = candidates.map((c) => ({ c, hits: anchorHitsInTurn(teacherTurn, ab2[c.slot.slot_id]) })).filter((x) => x.hits > 0).sort((x, y) => y.hits - x.hits);
      touched = scored.length ? scored[0].c : null;
    }
    top = touched || candidates[0] || ranked[0];
  }
  const slotId = top.slot.slot_id;
  const p = probeForSlot(itemId, slotId);
  const st = ev[slotId];
  if (!st.asked_questions) st.asked_questions = [];
  const askedCount = st.asked_questions.length;
  const it = TCIM_DATA.items[itemId];
  const ab = {};
  for (const a of it.anchors && it.anchors.anchors || []) ab[a.slot_id] = a;
  const followsTeacher = !!(teacherTurn && slotTouchedByTeacher(teacherTurn, ab[slotId]));
  const anchorSpan = followsTeacher ? teacherAnchorSpan(teacherTurn, ab[slotId]) : "";
  let template = "";
  if (askedCount === 0) template = p && p.typical_question || "";
  else if (askedCount === 1) template = p && p.followup_question || p && p.typical_question || "";
  else template = p && p.followup_question || "";
  if (template && templateAsked(template)) template = "";
  st.probe_count = (st.probe_count || 0) + 1;
  if (template) {
    st.asked_questions.push(template);
    return { question: template, done: false, target_slot: slotId, probe_strategy: p && p.preferred_action || "\u6F84\u6E05", followup_reason: followsTeacher ? "teacher_topic_match" : "evidence_gap", anchor_span: anchorSpan };
  }
  const genericBank = [
    "\u9762\u5BF9\u8FD9\u4E2A\u60C5\u5883\uFF0C\u60A8\u6700\u60F3\u5148\u5224\u65AD\u4EC0\u4E48\uFF1F",
    "\u60A8\u4E3A\u4EC0\u4E48\u4F1A\u7279\u522B\u770B\u91CD\u8FD9\u4E00\u70B9\uFF1F",
    "\u4EC0\u4E48\u60C5\u51B5\u4E0B\u60A8\u7684\u5904\u7406\u4F1A\u6709\u6240\u4E0D\u540C\uFF1F",
    "\u60A8\u5E0C\u671B\u8FD9\u6837\u7684\u5904\u7406\u7ED9\u5B69\u5B50\u5E26\u6765\u4EC0\u4E48\uFF1F",
    "\u5982\u679C\u6362\u4E00\u4E2A\u5B69\u5B50\uFF0C\u60A8\u7684\u505A\u6CD5\u4F1A\u4E00\u6837\u5417\uFF1F",
    "\u5982\u679C\u65F6\u95F4\u548C\u6761\u4EF6\u90FD\u5141\u8BB8\uFF0C\u60A8\u8FD8\u4F1A\u505A\u54EA\u4E9B\u4E0D\u540C\u7684\u4E8B\uFF1F"
  ];
  let generic = "";
  for (const g of genericBank) {
    if (!templateAsked(g) && !st.asked_questions.includes(g)) {
      generic = g;
      break;
    }
  }
  if (!generic) {
    return { question: "\u611F\u8C22\u60A8\u7684\u5206\u4EAB\uFF0C\u672C\u60C5\u5883\u7684\u8BBF\u8C08\u5148\u5230\u8FD9\u91CC\u3002", done: true, target_slot: slotId, probe_strategy: "CLOSE" };
  }
  st.asked_questions.push(generic);
  return { question: generic, done: false, target_slot: slotId, probe_strategy: "\u901A\u7528\u8FFD\u95EE", followup_reason: followsTeacher ? "teacher_topic_match" : "evidence_gap", anchor_span: anchorSpan };
}
var LEAK_PATTERNS = [
  /标准答案/,
  /正确答案/,
  /专家排序/,
  /得分/,
  /分数/,
  /能力等级/,
  /评分/,
  /入选原因/,
  /R\/P\/G/,
  /IIV/,
  /Evidence/,
  /evidence/,
  /slot/i,
  /Slot/,
  /锚点/,
  /证据缺口/,
  /内部指标/
];
var EVALUATIVE_PATTERNS = [
  /很专业/,
  /非常正确/,
  /说得很好/,
  /答得很好/,
  /您的答案很好/,
  /棒/,
  /优秀/,
  /完美/
];
function countQuestionMarks(text) {
  return (String(text).match(/[？?]/g) || []).length;
}
function checkConstraints(question, actionPlan, askedHistory) {
  const issues = [];
  const q = String(question || "").trim();
  if (!q) issues.push("empty_question");
  if (countQuestionMarks(q) > 1) issues.push("multi_question");
  if (q.length > 120) issues.push("too_long");
  for (const p of LEAK_PATTERNS) if (p.test(q)) issues.push("leak_internal:" + p.source);
  for (const p of EVALUATIVE_PATTERNS) if (p.test(q)) issues.push("evaluative:" + p.source);
  if (askedHistory && askedHistory.includes(q)) issues.push("duplicate_question");
  return { ok: issues.length === 0, issues };
}
function initTcisSession(itemId, ranking, tags, pretest) {
  const prior = initPrior(itemId, ranking, tags);
  return {
    itemId,
    evidence: createEvidence(itemId, prior, pretest),
    turnNo: 0,
    history: [],
    done: false,
    replay: [],
    // 结构化 Replay：每轮决策记录
    pretest: pretest || null,
    ranking: (ranking || []).slice(),
    // A00 输入：教师排序
    processTags: (tags || []).slice(),
    // A00 输入：过程标签
    contextual_belief_state: { beliefs: {}, version: 0 }
    // V0.2 Belied State
  };
}
function replayEvent(session, event) {
  session.replay.push(Object.assign({
    turn_no: session.turnNo,
    ts: Date.now(),
    engine_version: ENGINE_VERSION
  }, event));
}
function firstQuestion(session) {
  const item = TCIM_DATA.items[session.itemId];
  const isV2 = getSemanticMode() !== "disabled";
  if (!isV2) {
    const gen2 = generateQuestion(session.itemId, session.evidence, session.turnNo, session.history);
    session.turnNo += 1;
    if (gen2.question) session.history.push({ role: "ai", text: gen2.question, ts: Date.now() });
    return { question: gen2.question || "", done: gen2.done, target_slot: gen2.target_slot || null, gate: null, replay: session.replay };
  }
  const factRefs = [session.itemId, ...(session.ranking || []).map((r) => `OPT-${r}`)];
  const a00 = teacherModel.buildContextInterpretationProposal({
    factRefs,
    assessmentSnapshot: { open_text: session.pretest && session.pretest.total != null ? String(session.pretest.total) : null },
    processTags: session.processTags || [],
    questionTitle: item.metadata && item.metadata.title || ""
  });
  const bs = session.contextual_belief_state || { beliefs: {}, version: 0 };
  for (const b of a00.proposed_beliefs || []) {
    const mut = { op: "ADD", claim: b.claim, confidence: b.confidence, uncertainty: 0.6, source_refs: b.source_refs || factRefs, alternatives: b.alternatives || [] };
    const v = beliefState.validateBeliefMutation(mut, bs);
    if (v.ok) {
      const r = beliefState.applyBeliefMutation(bs, mut, "init");
      session.contextual_belief_state = r.state;
    }
  }
  const teacherModelSnapshot = teacherModel.buildTeacherModelSnapshot({
    factRefs,
    beliefState: session.contextual_belief_state,
    evidenceStateRef: session.itemId,
    turnId: "init"
  });
  replayEvent(session, { event: "TeacherModelEvent", active_belief_refs: teacherModelSnapshot.active_belief_refs, competing_belief_refs: teacherModelSnapshot.competing_belief_refs, builder_version: teacherModelSnapshot.builder_version });
  const agentDecision = agentPlanner.planDecision({ item, evidence: session.evidence, teacherModel: teacherModelSnapshot, beliefState: session.contextual_belief_state });
  replayEvent(session, { event: "PlannerEvent", selected_action_id: agentDecision.selected_action_id, primary_target_slot: agentDecision.primary_target_slot, claimed_table_alignment: agentDecision.claimed_table_alignment, claimed_risk_level: agentDecision.claimed_risk_level, rejected_action_ids: agentDecision.rejected_action_ids });
  const gateResult = decisionGate.validateDecision(agentDecision, { expectedStateVersion: session.contextual_belief_state.version, committedStateVersion: session.contextual_belief_state.version });
  replayEvent(session, { event: "GateEvent", decision: gateResult.decision, approved_action_id: gateResult.approved_action_id, adjudicated_risk_level: gateResult.adjudicated_risk_level, adjudicated_table_alignment: gateResult.adjudicated_table_alignment, evaluator_required: gateResult.evaluator_required });
  const gen = generateQuestion(session.itemId, session.evidence, session.turnNo, session.history, agentDecision.primary_target_slot);
  session.turnNo += 1;
  const q = gen.question || "";
  if (q) session.history.push({ role: "ai", text: q, ts: Date.now() });
  return { question: q, done: gen.done, target_slot: agentDecision.primary_target_slot, gate: gateResult, replay: session.replay };
}
async function processTeacherTurn(session, teacherTurn) {
  if (session.done) return { question: "", done: true };
  session.turnNo += 1;
  const turnId = `t${session.turnNo}`;
  const trimmed = String(teacherTurn || "").trim();
  if (trimmed) {
    session.history.push({ role: "teacher", text: trimmed, ts: Date.now() });
    replayEvent(session, { event: "TurnReceived", raw_teacher_text: trimmed });
  }
  const item = TCIM_DATA.items[session.itemId];
  const validSlotIds = new Set((item.ontology && item.ontology.slots || []).map((s) => s.slot_id));
  const evidenceBefore = JSON.parse(JSON.stringify(session.evidence));
  const anchorBySlot = {};
  for (const a of item.anchors && item.anchors.anchors || []) anchorBySlot[a.slot_id] = a;
  const semantic = await analyzeSemantic(trimmed, {
    itemId: session.itemId,
    turnId,
    evidenceSummary: session.evidence,
    questionTitle: item.metadata && item.metadata.title || "",
    validSlotIds,
    anchorBySlot
  });
  for (const sp of semantic.ok && semantic.proposal ? semantic.proposal.slot_evidence_proposals || [] : []) {
    replayEvent(session, { event: "SemanticEvent", type: "slot_proposal", slot: sp.slot_id, proposed_level: sp.proposed_level, confidence: sp.confidence, supporting_spans: sp.supporting_spans || [], provider: semantic.provider });
  }
  for (const span of semantic.ok && semantic.proposal ? semantic.proposal.candidate_spans || [] : []) {
    replayEvent(session, { event: "SemanticEvent", type: "span", span: span.text, slots: span.candidate_slots || [], provider: semantic.provider });
  }
  for (const c of semantic.ok && semantic.proposal ? semantic.proposal.conflict_candidates || [] : []) {
    replayEvent(session, { event: "SemanticEvent", type: "conflict_candidate", slot: c.slot_id || "?", note: c.reason, provider: semantic.provider });
  }
  if (semantic.errors && semantic.errors.length) {
    replayEvent(session, { event: "SemanticEvent", type: "invalid", errors: semantic.errors, provider: semantic.provider });
  }
  let evidence;
  let updates = [];
  let beliefEvents = [];
  let teacherModelSnapshot = null;
  let agentDecision = null;
  let gateResult = null;
  let challengeCandidates = [];
  if (getSemanticMode() === "disabled") {
    const r = updateEvidence(session.itemId, session.evidence, trimmed, turnId);
    evidence = r.evidence;
    updates = r.updates;
  } else if (semantic.ok && semantic.proposal && (semantic.proposal.slot_evidence_proposals || []).length) {
    const p = semantic.proposal;
    const anchorsBySlot = {};
    for (const a of item.anchors && item.anchors.anchors || []) anchorsBySlot[a.slot_id] = a;
    const v = v2ValidateProposal(p, { itemId: session.itemId, validSlotIds, teacherTurn: trimmed, anchorsBySlot });
    const c = v2CommitProposal(session.evidence, v.acceptedUpdates, trimmed, turnId);
    evidence = c.state;
    updates = c.updates;
    let bs = session.contextual_belief_state || { beliefs: {}, version: 0 };
    for (const u of (p.uncertainty || []).slice(0, 2)) {
      const mut = { op: "ADD", claim: u, confidence: 0.6, uncertainty: 0.6, source_refs: [turnId, session.itemId], alternatives: [] };
      const validB = beliefState.validateBeliefMutation(mut, bs);
      if (validB.ok) {
        const r = beliefState.applyBeliefMutation(bs, mut, turnId);
        bs = r.state;
        beliefEvents.push(r.event);
      }
    }
    session.contextual_belief_state = bs;
    teacherModelSnapshot = teacherModel.buildTeacherModelSnapshot({ factRefs: [turnId, session.itemId], beliefState: bs, evidenceStateRef: session.itemId, turnId });
    agentDecision = agentPlanner.planDecision({ item, evidence, teacherModel: teacherModelSnapshot, beliefState: bs });
    gateResult = decisionGate.validateDecision(agentDecision, { expectedStateVersion: bs.version, committedStateVersion: bs.version });
    const cq = challengeQueue.createChallengeQueue();
    const chal = challengeQueue.challengeFromDecision(cq, agentDecision, gateResult);
    if (chal) challengeCandidates = cq.challenges;
  } else {
    const r = updateEvidence(session.itemId, session.evidence, trimmed, turnId);
    evidence = r.evidence;
    updates = r.updates;
  }
  session.evidence = evidence;
  for (const u of updates) {
    replayEvent(session, { event: "EvidenceUpdate", slot_id: u.slot_id, before: u.before, after: u.after, reason: u.reason });
  }
  if (!updates.length) {
    replayEvent(session, { event: "EvidenceUpdate", slot_id: null, before: null, after: null, reason: "no_change" });
  }
  for (const ev of beliefEvents) replayEvent(session, { event: "BeliefEvent", op: ev.op, claim: ev.claim || null, before: ev.before, after: ev.after });
  if (teacherModelSnapshot) replayEvent(session, { event: "TeacherModelEvent", active_belief_refs: teacherModelSnapshot.active_belief_refs, competing_belief_refs: teacherModelSnapshot.competing_belief_refs });
  if (agentDecision) replayEvent(session, { event: "PlannerEvent", selected_action_id: agentDecision.selected_action_id, primary_target_slot: agentDecision.primary_target_slot, claimed_table_alignment: agentDecision.claimed_table_alignment, claimed_risk_level: agentDecision.claimed_risk_level, rejected_action_ids: agentDecision.rejected_action_ids });
  if (gateResult) replayEvent(session, { event: "GateEvent", decision: gateResult.decision, approved_action_id: gateResult.approved_action_id, adjudicated_risk_level: gateResult.adjudicated_risk_level, adjudicated_table_alignment: gateResult.adjudicated_table_alignment, evaluator_required: gateResult.evaluator_required });
  if (challengeCandidates.length) replayEvent(session, { event: "ChallengeEvent", challenges: challengeCandidates });
  if (itemSufficient(session.itemId, evidence)) {
    session.done = true;
    const closing = "\u611F\u8C22\u60A8\u7684\u5206\u4EAB\uFF0C\u672C\u60C5\u5883\u7684\u8BBF\u8C08\u5148\u5230\u8FD9\u91CC\u3002";
    session.history.push({ role: "ai", text: closing, ts: Date.now() });
    replayEvent(session, {
      event: "OrchestratorEvent",
      decision: "STOP_CANDIDATE",
      target_slot: "ALL",
      reason: "item_sufficient",
      knowledge_need: false
    });
    replayEvent(session, { event: "GenerationEvent", action_type: "CLOSE", question: closing, constraint_result: "pass" });
    return { question: closing, done: true, updates, actionPlan: { action_type: "STOP_CANDIDATE", target_slot: "ALL" }, replay: session.replay };
  }
  const ranked = rankSlots(session.itemId, evidence);
  const actionPlan = { target_slot: ranked[0]?.slot.slot_id || null, probe_strategy: "" };
  const rag = knowledgeNeed.decideKnowledgeNeed({ evidence, item, turnNo: session.turnNo });
  replayEvent(session, {
    event: "OrchestratorEvent",
    decision: "PROBE",
    target_slot: actionPlan.target_slot,
    ranked_slots: ranked.slice(0, 5).map((r) => ({ slot: r.slot.slot_id, score: Number(r.score.toFixed(3)) })),
    knowledge_need: rag.need,
    knowledge_need_gap: rag.gap,
    rag_route: rag.need ? rag.route_ceiling : "R0",
    reason: "top_evidence_gap"
  });
  const recentTurns = session.history.filter((h) => h.role === "teacher").map((h) => h.text);
  const obs = prdmV2.observe({ teacherTurn: trimmed, recentTurns, observedActionFingerprint: agentDecision ? agentDecision.selected_action_id || "" : "", turnId });
  replayEvent(session, { event: "PRDMObserveEvent", interaction_read: obs, forbidden_present: prdmV2.FORBIDDEN_OBS.some((f) => obs[f] !== void 0 && obs[f] !== null) });
  const protectedAction = agentDecision ? { target_slot: agentDecision.primary_target_slot, professional_objective: "", probe_strategy: "" } : null;
  const prdm = prdmV2.plan({ protectedAction, actionFingerprint: agentDecision ? agentDecision.selected_action_id : "", teacherTurn: trimmed, recentTurns, evidenceUpdates: updates });
  if (prdm) {
    replayEvent(session, {
      event: "PRDMPlanEvent",
      dialogue_plan: {
        move: prdm.dialogue_move,
        stance: prdm.stance,
        progress: prdm.local_progress === void 0 ? prdm.local_progress ? prdm.local_progress.status : "n/a" : prdm.local_progress && prdm.local_progress.status,
        challenge_level: prdm.challenge_level,
        question_load: prdm.question_load,
        response_dose: prdm.response_dose,
        fingerprint: prdm.protected_action_fingerprint
      }
    });
  }
  const gen = generateQuestion(session.itemId, evidence, session.turnNo, session.history, agentDecision ? agentDecision.primary_target_slot : null, trimmed);
  if (isRepairTurn(trimmed) && !gen.done) {
    gen.question = repairQuestion(trimmed);
    gen.probe_strategy = "\u6F84\u6E05\u4FEE\u590D";
    gen.followup_reason = "teacher_repair";
    gen.anchor_span = sanitizeExcerpt(trimmed);
  }
  if (gen.done) {
    session.done = true;
    const closing = gen.question || "\u611F\u8C22\u60A8\u7684\u5206\u4EAB\uFF0C\u672C\u60C5\u5883\u7684\u8BBF\u8C08\u5148\u5230\u8FD9\u91CC\u3002";
    session.history.push({ role: "ai", text: closing, ts: Date.now() });
    replayEvent(session, {
      event: "OrchestratorEvent",
      decision: "STOP_CANDIDATE",
      target_slot: gen.target_slot || "ALL",
      reason: "questions_exhausted",
      knowledge_need: false
    });
    replayEvent(session, { event: "GenerationEvent", action_type: "CLOSE", question: closing, constraint_result: "pass" });
    return { question: closing, done: true, updates, actionPlan: { action_type: "STOP_CANDIDATE", target_slot: gen.target_slot || "ALL" }, replay: session.replay };
  }
  const genText = gen.question || "";
  const priorQuestions = session.history.filter((h) => h.role === "ai").map((h) => h.text);
  const checked = checkConstraints(genText, actionPlan, priorQuestions);
  let finalQuestion = genText;
  let constraintResult = checked.ok ? "pass" : "rewritten";
  if (!checked.ok) {
    const safeBank = [
      "\u5173\u4E8E\u8FD9\u4E00\u70B9\uFF0C\u60A8\u80FD\u518D\u591A\u8BF4\u4E00\u4E9B\u60A8\u662F\u600E\u4E48\u5224\u65AD\u7684\u5417\uFF1F",
      "\u60A8\u6700\u60F3\u5148\u5E2E\u5B69\u5B50\u89E3\u51B3\u7684\u662F\u54EA\u4E00\u4EF6\u4E8B\uFF1F",
      "\u5982\u679C\u6362\u4E00\u4E2A\u66F4\u5177\u4F53\u7684\u573A\u666F\uFF0C\u60A8\u4F1A\u600E\u4E48\u5904\u7406\uFF1F"
    ];
    const safeAsked = new Set(priorQuestions.map((q) => String(q).replace(/\s+/g, "")));
    const freshSafe = safeBank.find((q) => !safeAsked.has(String(q).replace(/\s+/g, "")));
    finalQuestion = freshSafe || safeBank[Math.min(session.turnNo % safeBank.length, safeBank.length - 1)];
    replayEvent(session, {
      event: "ConstraintEvent",
      target_slot: gen.target_slot,
      issues: checked.issues,
      rewritten_to: finalQuestion
    });
  }
  actionPlan.target_slot = gen.target_slot || actionPlan.target_slot;
  actionPlan.probe_strategy = gen.probe_strategy;
  session.history.push({ role: "ai", text: finalQuestion, ts: Date.now() });
  replayEvent(session, {
    event: "GenerationEvent",
    action_type: "PROBE",
    target_slot: gen.target_slot,
    probe_strategy: gen.probe_strategy,
    question: finalQuestion,
    constraint_result: constraintResult,
    constraint_issues: checked.ok ? [] : checked.issues,
    prdm_move: prdm && prdm.dialogue_move || "n/a",
    evidence_before_count: Object.keys(evidenceBefore).length,
    // 2.1：记录本轮问题与教师上一答的承接关系(回放/研究审计用)
    source_turn_id: turnId,
    followup_reason: gen.followup_reason || "evidence_gap",
    anchor_span: gen.anchor_span || ""
  });
  return {
    question: finalQuestion,
    done: gen.done,
    updates,
    actionPlan,
    replay: session.replay
  };
}
var ENGINE_VERSION = "2026-08-21-tcim-web-v0.2";
var tcimData = TCIM_DATA;
