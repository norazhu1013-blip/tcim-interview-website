/**
 * TCIM 访谈模式开关。
 *
 * VITE_TCIM_MODE=ont    → 使用 TCIM Ontology-only 确定性访谈（默认，网页可先跑起来）
 * VITE_TCIM_MODE=legacy → 使用既有 LLM 提示词访谈（gsyg_interviewChat）
 *
 * 两者会话结构兼容（messages/stage/status）；仅「下一问」来源不同。
 * legacy 路径代码完全保留，切回 legacy 即恢复旧行为。
 */
const MODE = String(import.meta.env.VITE_TCIM_MODE || 'ont').trim().toLowerCase()

export const TCIM_MODE = MODE === 'ont' ? 'ont' : 'legacy'
export const isTcisMode = () => TCIM_MODE === 'ont'
