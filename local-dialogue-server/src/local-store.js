'use strict';

const fs = require('fs');
const path = require('path');

function emptyState() {
  return { version: 1, teachers: {}, sessions: {}, drafts: {}, interviews: {} };
}

function normalizeState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return {
    version: 1,
    teachers: state.teachers && typeof state.teachers === 'object' ? state.teachers : {},
    sessions: state.sessions && typeof state.sessions === 'object' ? state.sessions : {},
    drafts: state.drafts && typeof state.drafts === 'object' ? state.drafts : {},
    interviews: state.interviews && typeof state.interviews === 'object' ? state.interviews : {}
  };
}

function createLocalStore(options = {}) {
  const filePath = path.resolve(options.filePath || process.env.TCIM_LOCAL_DATA_FILE || path.join(__dirname, '..', '.runtime-data', 'state.json'));
  let mutationQueue = Promise.resolve();

  async function read() {
    try {
      return normalizeState(JSON.parse(await fs.promises.readFile(filePath, 'utf8')));
    } catch (error) {
      if (error && error.code === 'ENOENT') return emptyState();
      throw error;
    }
  }

  async function write(state) {
    const directory = path.dirname(filePath);
    await fs.promises.mkdir(directory, { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tempPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tempPath, filePath);
  }

  function mutate(mutator) {
    const operation = mutationQueue.then(async () => {
      const state = await read();
      const result = await mutator(state);
      await write(state);
      return result;
    });
    mutationQueue = operation.catch(() => {});
    return operation;
  }

  return { filePath, read, mutate };
}

module.exports = { createLocalStore, emptyState, normalizeState };
