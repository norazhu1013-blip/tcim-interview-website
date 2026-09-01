import assert from 'node:assert/strict'
import fs from 'node:fs'
import { TCIM_RELEASE, currentReleaseSnapshot } from './release.js'

const runtime = JSON.parse(fs.readFileSync(new URL('../generated/tcim-new-five-tables.runtime.v0.2.1.json', import.meta.url), 'utf8'))

assert.equal(TCIM_RELEASE.runtimeDatasetId, runtime.datasetId)
assert.equal(TCIM_RELEASE.runtimeSchemaVersion, runtime.schemaVersion)
assert.equal(TCIM_RELEASE.runtimeConfigFingerprint, runtime.configFingerprint)
assert.match(TCIM_RELEASE.releaseId, /^TCIM-WEB-/)
assert.match(TCIM_RELEASE.expectedDialoguePromptVersion, /r8-premise-aware-natural-close$/)

const snapshot = currentReleaseSnapshot(123456)
assert.equal(snapshot.capturedAt, 123456)
assert.equal(snapshot.releaseId, TCIM_RELEASE.releaseId)
assert.equal(Object.isFrozen(TCIM_RELEASE), true)

console.log('release version checks: 8/8')
