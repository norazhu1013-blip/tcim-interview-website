import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const statePath = process.argv[2] || path.join(root, 'local-dialogue-server', '.runtime-data', 'state.json')
const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
const formulaic = /^(?:(?:我理解|我的理解|听起来|我听到|也就是说|您的意思是|你(?:刚才)?的意思是|您(?:刚才)?(?:说|提到))|(?:明白|好的|嗯|原来如此)[，,]\s*您|您(?:一下就|选择|希望|说要|会看|觉得|从|认为|想把|要先|是根据)).{5,80}[。！!；;]/u
const relational = /^(?:嗯|明白|确实|这个(?:场面|情境|取舍|判断)|这里|这确实|您很看重|您很在意|能看出您在|不容易|可以理解).{0,28}[。！!；;，,]/u
const rows = []

for (const interview of Object.values(state.interviews || {})) {
  for (const [itemId, transcript] of Object.entries(interview.transcripts || {})) {
    const messages = Array.isArray(transcript.messages) ? transcript.messages : []
    const questions = messages.filter((message) => message.role === 'ai' && /[?？]/u.test(String(message.text || '')))
    const followUps = questions.slice(1)
    const formulaicCount = followUps.filter((message) => formulaic.test(String(message.text || '').trim())).length
    const relationalCount = followUps.filter((message) => relational.test(String(message.text || '').trim())).length
    const metrics = (Array.isArray(transcript.performanceMetrics) ? transcript.performanceMetrics : [])
      .map((metric) => Number(metric.visibleLatencyMs || 0)).filter((value) => value > 0)
    rows.push({
      sessionId: String(interview.sessionId || '').slice(0, 8),
      itemId,
      startedAt: Number(transcript.startedAt || 0),
      promptVersion: String(transcript.dialogueSession?.lastAgentResult?.trace?.promptVersion || ''),
      questions: questions.length,
      followUps: followUps.length,
      formulaicRestatements: formulaicCount,
      formulaicRate: followUps.length ? Number((formulaicCount / followUps.length).toFixed(3)) : 0,
      relationalMicrocues: relationalCount,
      relationalCueRate: followUps.length ? Number((relationalCount / followUps.length).toFixed(3)) : 0,
      generationFailures: Array.isArray(transcript.generationFailures) ? transcript.generationFailures.length : 0,
      integrativeStatus: String(transcript.dialogueSession?.integrativeQuestion?.status || 'NONE'),
      averageVisibleLatencyMs: metrics.length ? Math.round(metrics.reduce((sum, value) => sum + value, 0) / metrics.length) : 0
    })
  }
}

const substantive = rows.filter((row) => row.followUps > 0)
const totalFollowUps = substantive.reduce((sum, row) => sum + row.followUps, 0)
const totalFormulaic = substantive.reduce((sum, row) => sum + row.formulaicRestatements, 0)
const totalRelational = substantive.reduce((sum, row) => sum + row.relationalMicrocues, 0)
const report = {
  generatedAt: new Date().toISOString(),
  privacy: 'aggregate-only; teacher utterances are not emitted',
  summary: {
    transcripts: rows.length,
    substantiveTranscripts: substantive.length,
    followUpQuestions: totalFollowUps,
    formulaicRestatements: totalFormulaic,
    formulaicRate: totalFollowUps ? Number((totalFormulaic / totalFollowUps).toFixed(3)) : 0,
    relationalMicrocues: totalRelational,
    relationalCueRate: totalFollowUps ? Number((totalRelational / totalFollowUps).toFixed(3)) : 0,
    generationFailures: rows.reduce((sum, row) => sum + row.generationFailures, 0),
    integrativeQuestionsObserved: rows.filter((row) => row.integrativeStatus !== 'NONE').length
  },
  transcripts: rows.sort((left, right) => left.startedAt - right.startedAt)
}
console.log(JSON.stringify(report, null, 2))
