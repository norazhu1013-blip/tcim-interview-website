'use strict';

const crypto = require('crypto');
const advisor = require('../../cloudfunctions/gsyg_selectFinal/advisor_port.js');
const norms = require('../../cloudfunctions/gsyg_selectFinal/advisor_norms.js');
const { InputError } = require('./dialogue-agent');

const LETTERS = ['A', 'B', 'C', 'D'];
const ALGO_VERSION = 'advisor_local_v1';

function actorFromRequest(req) {
  const requested = String(req.headers['x-tcim-local-user'] || 'local-user').trim();
  const safe = requested.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) || 'local-user';
  return `local:${safe}`;
}

function key(actor, ...parts) {
  return [actor, ...parts.map((part) => String(part || ''))].join('|');
}

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new InputError(`${field} is required`);
  return text;
}

function rankIsValid(value) {
  return Array.isArray(value) && value.length === 4 && new Set(value).size === 4 && value.every((letter) => LETTERS.includes(letter));
}

function replayTrajectory(firstRanking, moveLog) {
  const current = rankIsValid(firstRanking) ? firstRanking.slice() : LETTERS.slice();
  const events = [];
  for (const move of Array.isArray(moveLog) ? moveLog : []) {
    if (!move || !LETTERS.includes(move.option)) continue;
    const previousValue = current.join('');
    const oldIndex = current.indexOf(move.option);
    if (oldIndex >= 0) current.splice(oldIndex, 1);
    const toIndex = Math.min(current.length, Math.max(0, Number(move.to_pos || 1) - 1));
    current.splice(toIndex, 0, move.option);
    events.push({
      ts: Number(move.ts) || 0,
      previousValue,
      currentValue: current.join(''),
      answer: move.option
    });
  }
  return events;
}

function buildAdvisorInput(session) {
  const answers = session.answers || {};
  const converted = {};
  const logs = [];
  const missing = [];
  for (let number = 1; number <= 10; number += 1) {
    const itemId = `Q${number}`;
    const answer = answers[itemId];
    if (!answer || !rankIsValid(answer.final_ranking)) {
      missing.push(itemId);
      continue;
    }
    converted[String(number - 1)] = answer.final_ranking.map((letter) => LETTERS.indexOf(letter));
    const enterTs = Number(answer.enter_ts) || number * 100000;
    const submitTs = Number(answer.submit_ts) || enterTs + (Number(answer.duration_ms) || 30000);
    logs.push({ userOpenid: session.openid, questionIndex: String(number), timestamp: String(enterTs), action: 'enter_question' });
    for (const drag of replayTrajectory(answer.first_ranking, answer.move_log)) {
      logs.push({
        userOpenid: session.openid,
        questionIndex: String(number),
        timestamp: String(drag.ts || enterTs),
        action: 'change_sorting_option',
        previousValue: drag.previousValue,
        currentValue: drag.currentValue,
        answer: drag.answer
      });
    }
    logs.push({ userOpenid: session.openid, questionIndex: String(number), timestamp: String(submitTs), action: 'leave_question' });
  }
  if (missing.length) return { missing };
  return {
    resultsRow: {
      participantName: String(session.profile && (session.profile.name || session.profile.participantName) || ''),
      userOpenid: session.openid,
      answers: converted
    },
    logs
  };
}

function toLocalSelection(result, answers) {
  const final = result.finalSelected.map((item) => {
    const id = `Q${Number(item.questionIndex)}`;
    const answer = answers[id] || {};
    const rawSources = String(item.source_summary || '').split('/');
    const sources = [];
    if (rawSources.includes('R')) sources.push('R分·结果偏离');
    if (rawSources.includes('P')) sources.push('P分·过程异常');
    if (rawSources.includes('G')) sources.push('G分·结果×过程');
    if (!sources.length) sources.push('覆盖增补');
    const teacherFinalOrder = rankIsValid(answer.final_ranking) ? answer.final_ranking.join('') : '';
    const teacherInitialOrder = answer.first_ranking_source === 'teacher_choice' && rankIsValid(answer.first_ranking)
      ? answer.first_ranking.join('')
      : '';
    return {
      id,
      py_item_id: item.final_item_id,
      final_rank: item.final_rank,
      sources,
      source_summary: item.source_summary,
      source_count: item.source_count,
      primary_ability_type: item.primary_ability_type,
      secondary_ability_type: item.secondary_ability_type,
      FES: item.FES,
      RS: item.RS,
      R_rank: item.R_rank,
      P_rank: item.P_rank,
      G_rank: item.G_rank,
      IIV_classic: item.IIV_classic,
      IIV_hybrid: item.IIV_hybrid,
      priorityOption: item.priorityOption,
      priorityPair: item.priorityPair,
      interview_focus: item.interview_focus,
      selection_reason: item.selection_reason,
      coverage_role: item.coverage_role,
      teacherFinalOrder,
      teacherInitialOrder,
      orderChanged: Boolean(teacherInitialOrder && teacherInitialOrder !== teacherFinalOrder),
      orderChangeSummary: teacherInitialOrder && teacherInitialOrder !== teacherFinalOrder
        ? `初始排序${teacherInitialOrder},最终排序${teacherFinalOrder}`
        : `仅记录最终排序${teacherFinalOrder}`
    };
  });
  return {
    final,
    routes: {
      R: (result.rSelected || []).map((item) => `Q${Number(item.questionIndex)}`),
      P: (result.pSelected || []).map((item) => `Q${Number(item.questionIndex)}`),
      G: (result.gSelected || []).map((item) => `Q${Number(item.questionIndex)}`)
    },
    algo: ALGO_VERSION,
    normsVersion: norms.version,
    generatedAt: Date.now()
  };
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function formalComparisonTranscripts(value) {
  const records = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(records).filter(([, record]) => (
    record
    && record.mode === 'dialogue_agent_new_five_tables_evidence_state'
    && record.simulationOnly !== true
    && String(record.llmProfile || record.provider || '').toLowerCase() !== 'mock'
    && !String(record.llmModel || record.model || '').toLowerCase().startsWith('mock-')
  )));
}

function createLocalGateway(options = {}) {
  if (!options.store) throw new TypeError('store is required');
  const store = options.store;
  const agent = options.agent;

  async function call(action, data, req) {
    const actor = actorFromRequest(req);
    const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    if (action === 'whoami') {
      const state = await store.read();
      return { ok: true, user: { uid: actor, identityType: 'web_account' }, identityType: 'web_account', isAdmin: false, teacher: state.teachers[actor] || null, local: true };
    }
    if (action === 'dialogueTurn') {
      if (!agent) throw new InputError('dialogue agent is unavailable', 'service_unavailable');
      return agent.run(payload, null);
    }
    if (action === 'reportTeacher') {
      if (!payload.profile || typeof payload.profile !== 'object') throw new InputError('profile is required');
      return store.mutate((state) => {
        const now = Date.now();
        state.teachers[actor] = { openid: actor, profile: payload.profile, updatedAt: now };
        return { ok: true, serverUpdatedAt: now };
      });
    }
    if (action === 'reportSession') {
      const sessionId = requireText(payload.sessionId, 'sessionId');
      return store.mutate((state) => {
        const storageKey = key(actor, sessionId);
        const previous = state.sessions[storageKey] || {};
        const now = Date.now();
        state.sessions[storageKey] = {
          ...previous,
          ...payload,
          openid: actor,
          sessionId,
          selection: payload.selection || previous.selection || null,
          createdAt: previous.createdAt || now,
          updatedAt: now
        };
        return { ok: true, sessionId, serverUpdatedAt: now };
      });
    }
    if (action === 'selectFinal') {
      const sessionId = requireText(payload.sessionId, 'sessionId');
      return store.mutate((state) => {
        const storageKey = key(actor, sessionId);
        const session = state.sessions[storageKey];
        if (!session) return { ok: false, error: 'session_not_found', message: 'Session was not reported locally' };
        if (session.selection && session.selection.algo === ALGO_VERSION && session.selection.normsVersion === norms.version) {
          return { ok: true, selection: session.selection, cached: true };
        }
        const input = buildAdvisorInput(session);
        if (input.missing) return { ok: false, error: 'incomplete_answers', message: `缺少题目:${input.missing.join(',')}` };
        const calculated = advisor.calculate([input.resultsRow], input.logs, { logQuestionBase: 1, norms });
        session.selection = toLocalSelection(calculated, session.answers || {});
        session.updatedAt = Date.now();
        return { ok: true, selection: session.selection, cached: false };
      });
    }
    if (action === 'reportDraft') {
      const sessionId = requireText(payload.sessionId, 'sessionId');
      const itemId = requireText(payload.itemId, 'itemId');
      const turnSeq = Number(payload.turnSeq || 0);
      return store.mutate((state) => {
        const storageKey = key(actor, sessionId, itemId);
        const previous = state.drafts[storageKey];
        if (previous && Number(previous.turnSeq || 0) > turnSeq) {
          return { ok: true, stale: true, serverUpdatedAt: previous.updatedAt };
        }
        const now = Date.now();
        state.drafts[storageKey] = { ...payload, openid: actor, sessionId, itemId, turnSeq, updatedAt: now };
        return { ok: true, stale: false, serverUpdatedAt: now };
      });
    }
    if (action === 'reportInterview') {
      const sessionId = requireText(payload.sessionId, 'sessionId');
      const revision = Number(payload.revision || 0);
      const formalPayload = { ...payload, transcripts: formalComparisonTranscripts(payload.transcripts) };
      return store.mutate((state) => {
        const storageKey = key(actor, sessionId);
        const previous = state.interviews[storageKey];
        if (previous && Number(previous.revision || 0) > revision) {
          return { ok: true, stale: true, serverRecordId: storageKey, serverUpdatedAt: previous.updatedAt, payloadHash: previous.payloadHash };
        }
        const now = Date.now();
        const payloadHash = hashPayload(formalPayload);
        state.interviews[storageKey] = { ...formalPayload, openid: actor, sessionId, revision, payloadHash, updatedAt: now };
        return { ok: true, stale: false, serverRecordId: storageKey, serverUpdatedAt: now, payloadHash };
      });
    }
    throw new InputError(`unsupported gateway action: ${action}`, 'unsupported_action');
  }

  return { call, actorFromRequest };
}

module.exports = { createLocalGateway, actorFromRequest, buildAdvisorInput, toLocalSelection, formalComparisonTranscripts, ALGO_VERSION };
