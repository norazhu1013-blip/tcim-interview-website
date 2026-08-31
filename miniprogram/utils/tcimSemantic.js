// tcimSemantic.js —— 小程序侧 TCIM A01 语义 provider。
// 与 web 端 semanticLLM.js 同逻辑，但直接 `wx.cloud.callFunction('gsyg_semanticProbe', event)`
// （不经网关；semanticProbe 云函数不校验身份，天然支持小程序的 OPENID 环境）。
// 只出 EvidenceAnalysisProposal，绝不写证据状态/绝不判能力等级；失败/未配置/低置信 → 回退空 Proposal。
// 注意：这是瞬时语义调用,失败不入 pendingReports（与上报类调用不同）。
const JUDGE_RE = /能力|人格|动机|心理|性格|智力水平|属于.{0,3}(高|中|低)能力/

function emptyProposal(turn) {
  return {
    proposal_type: 'EvidenceAnalysisProposal',
    candidate_spans: [],
    slot_evidence_proposals: [],
    conflict_candidates: [],
    false_evidence_flags: [],
    no_change_reasons: [],
    uncertainty: [],
    source_turn: turn || '',
    provider_version: 'offline-v0.2'
  };
}

// G04：span 必须逐字回指教师原话；G05：剔除能力/人格/动机判定词。
function normalizeServerProposal(raw, turn) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const spans = Array.isArray(p.candidate_spans) ? p.candidate_spans : [];
  const cleanSpans = spans
    .filter((s) => s && s.text && String(turn).includes(s.text))
    .map((s) => ({ text: s.text, candidate_slots: Array.isArray(s.candidate_slots) ? s.candidate_slots : [] }));
  const proposal = {
    proposal_type: 'EvidenceAnalysisProposal',
    candidate_spans: cleanSpans,
    slot_evidence_proposals: Array.isArray(p.slot_evidence_proposals) ? p.slot_evidence_proposals : [],
    conflict_candidates: Array.isArray(p.conflict_candidates) ? p.conflict_candidates : [],
    false_evidence_flags: Array.isArray(p.false_evidence_flags) ? p.false_evidence_flags : [],
    no_change_reasons: Array.isArray(p.no_change_reasons) ? p.no_change_reasons : [],
    uncertainty: Array.isArray(p.uncertainty) ? p.uncertainty : [],
    source_turn: turn || '',
    provider_version: p.provider_version || 'semantic-v0.2'
  };
  if (JUDGE_RE.test(JSON.stringify(proposal))) {
    proposal.candidate_spans = proposal.candidate_spans.filter((s) => !JUDGE_RE.test(s.text));
    proposal.g05_flag = true;
  }
  return proposal;
}

function semanticEnabled() {
  return !!(typeof wx !== 'undefined' && wx.cloud);
}

function makeSemanticProvider() {
  return async function semanticProvider(teacherTurn, ctx) {
    const turn = String(teacherTurn || '').trim();
    if (!semanticEnabled() || !turn) return emptyProposal(turn);
    const event = {
      itemId: (ctx && ctx.itemId) || '',
      teacherTurn: turn,
      turnId: (ctx && ctx.turnId) || '',
      anchors: (ctx && ctx.anchorBySlot) ? Object.values(ctx.anchorBySlot) : [],
      evidenceSummary: (ctx && ctx.evidenceSummary) || {},
      questionTitle: (ctx && ctx.questionTitle) || ''
    };
    try {
      const res = await new Promise((resolve) => {
        wx.cloud.callFunction({
          name: 'gsyg_semanticProbe',
          data: event,
          success: (r) => resolve(r && r.result),
          fail: () => resolve(null)
        });
      });
      if (!res || !res.ok || !res.proposal) return emptyProposal(turn);
      return normalizeServerProposal(res.proposal, turn);
    } catch (e) {
      return emptyProposal(turn);
    }
  };
}

module.exports = { makeSemanticProvider };
