'use strict';

function boundedTimeout(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? Math.floor(number) : fallback;
}

function timeoutPolicy(env = process.env) {
  return Object.freeze({
    business: boundedTimeout(env.GSYG_WEB_UPSTREAM_TIMEOUT_MS, 15000, 5000, 65000),
    interview: boundedTimeout(env.GSYG_WEB_INTERVIEW_TIMEOUT_MS, 65000, 30000, 65000),
    background: boundedTimeout(env.GSYG_WEB_BACKGROUND_TIMEOUT_MS, 100000, 95000, 110000)
  });
}

function upstreamChannel(name, data = {}) {
  if (name === 'gsyg_dialogueAgent') {
    if (['item_evidence', 'delta_audit'].includes(data?.operation)) return 'background';
    if (['turn', 'evidence', 'coordination'].includes(data?.operation)) return 'interview';
    return 'business'; // health/unknown operations never reserve a model window.
  }
  return name === 'gsyg_interviewChat' ? 'interview' : 'business';
}

module.exports = { boundedTimeout, timeoutPolicy, upstreamChannel };
