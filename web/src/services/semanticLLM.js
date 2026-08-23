/**
 * semanticLLM.js —— TCIM A01 语义预筛的 LLM provider（网页端）。
 *
 * 职责：把一个能用 `context` 的 `semanticProvider` 赋给 TCIM 引擎（engine.setSemanticProvider），
 *       使 A01 的「语义理解」真实走云端 LLM（经网关 /call → gsyg_semanticProbe）。
 *       语义层只出 EvidenceAnalysisProposal，绝不写证据状态、绝不判能力等级（由引擎确定性裁决）。
 *
 * 关键：无论网关/云函数/LLM 是否可用，provider 都**永不抛错**——任一失败即回退「空 Proposal」，
 *       不丢失教师回答、不猜测。TCIM 引擎在此种情形下与「未接入语义层」完全一致。
 *
 * 用法：
 *   import { registerSemanticProvider } from '../services/semanticLLM.js'
 *   registerSemanticProvider()   // 在 TCIM 初始化前调用一次（幂等）
 *
 * 网关/云函数调用由 web-gateway.callGateway('semanticProbe', {...}) 完成；身份走 HttpOnly 会话 Cookie，
 * 业务数据不带 openid/uid。
 */
import { callGateway } from './web-gateway.js'
// 引擎不 import 本模块，故静态 import 无循环依赖，保证 provider 在开机前同步就位。
import { setSemanticProvider as engineSetSemanticProvider } from '../core/tcim/engine.js'

// 允许的候选 span 标签（与引擎/云函数一致）
const SPAN_TYPES = ['supporting', 'conflict', 'false']
// 能力/人格/动机判定词（G05 硬拦）
const JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/

/** 空 Proposal（回退/默认）。 */
function emptyProposal(turn) {
  return {
    proposal_type: 'EvidenceAnalysisProposal',
    candidate_spans: [],
    candidate_slots: [],
    conflict_candidates: [],
    false_evidence_flags: [],
    uncertainty: 0,
    no_change_reasons: [],
    source_turn: turn || '',
    provider_version: 'offline-v0.1'
  }
}

/** 规范化服务器返回的 Proposal（缺失数组补空，span 回指原话 + 类型合法 + 过滤低置信）。 */
function normalizeServerProposal(raw, turn) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const spans = Array.isArray(p.candidate_spans) ? p.candidate_spans : []
  const cleanSpans = spans
    .filter((s) => s && s.text && turn.includes(s.text)) // G04：必须回指原话
    .filter((s) => (typeof s.confidence === 'number' ? s.confidence >= 0.25 : true))
    .map((s) => ({
      text: s.text,
      slot_id: s.slot_id || null,
      span_type: SPAN_TYPES.includes(s.span_type) ? s.span_type : 'supporting',
      confidence: typeof s.confidence === 'number' ? s.confidence : 0.3
    }))
  return {
    proposal_type: 'EvidenceAnalysisProposal',
    candidate_spans: cleanSpans,
    candidate_slots: Array.isArray(p.candidate_slots) ? p.candidate_slots : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    no_change_reasons: Array.isArray(p.no_change_reasons) ? p.no_change_reasons : [],
    uncertainty: typeof p.uncertainty === 'number' ? p.uncertainty : 0,
    source_turn: turn || '',
    provider_version: p.provider_version || 'semantic-v0.1'
  }
}

/** 是否应禁用语义层：网关未配置，或构建变量显式关闭。 */
function semanticEnabled() {
  if (String(import.meta.env.VITE_TCIM_SEMANTIC || '').trim() === '0') return false
  const gateway = Boolean(String(import.meta.env.VITE_WEB_API_BASE_URL || '').trim())
  return gateway
}

/**
 * 生成一个遵循 A01 契约的 semanticProvider（供 engine.setSemanticProvider 注入）。
 * 该 provider 本身不抛错：成功/失败都返回合法 Proposal。
 * @returns {(teacherTurn, ctx) => Promise<EvidenceAnalysisProposal>}
 */
export function makeSemanticProvider() {
  return async function semanticProvider(teacherTurn, ctx) {
    const turn = String(teacherTurn || '').trim()
    if (!semanticEnabled() || !turn) return emptyProposal(turn)

    // ctx 里可能带 itemId/evidenceSummary；构造给云函数的上下文（不携带 openid/uid）
    const event = {
      itemId: ctx?.itemId || '',
      teacherTurn: turn,
      turnId: ctx?.turnId || '',
      anchors: (ctx?.anchorBySlot) ? Object.values(ctx.anchorBySlot) : [],
      evidenceSummary: ctx?.evidenceSummary || {},
      questionTitle: ctx?.questionTitle || ''
    }

    try {
      const res = await callGateway('semanticProbe', event)
      if (!res || !res.ok || !res.proposal) {
        // 网关/云函数异常或返回空 → 回退空 Proposal（不丢回答、不猜测）
        return emptyProposal(turn)
      }
      return normalizeServerProposal(res.proposal, turn)
    } catch (e) {
      // 网络失败 → 回退空 Proposal，保证 TCIM 始终能用
      return emptyProposal(turn)
    }
  }
}

/**
 * 注册语义 provider 到 TCIM 引擎。幂等；重复调用无副作用。
 * 缺网关/构建时（semanticEnabled()=false）注入一个「永不抛错的离线 provider」，
 * 引擎行为与未接入完全一致。
 */
export function registerSemanticProvider() {
  engineSetSemanticProvider(makeSemanticProvider())
}
