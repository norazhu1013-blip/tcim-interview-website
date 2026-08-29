'use strict';

const path = require('path');
const { createDialogueAgent } = require('./src/dialogue-agent');
const { createHttpServer, isLoopbackHost } = require('./src/http-server');
const { createLocalStore } = require('./src/local-store');
const { createLocalGateway } = require('./src/local-gateway');
const { loadEnvFile } = require('./src/env-file');

loadEnvFile(path.resolve(__dirname, '.env'));

function start(env = process.env) {
  const host = String(env.TCIM_DIALOGUE_HOST || '127.0.0.1');
  if (!isLoopbackHost(host)) throw new Error('TCIM_DIALOGUE_HOST must be a loopback host (127.0.0.0/8, localhost, or ::1)');
  const port = Number(env.TCIM_DIALOGUE_PORT || 8787);
  const agent = createDialogueAgent({ env });
  const dataFile = path.resolve(__dirname, env.TCIM_LOCAL_DATA_FILE || '.runtime-data/state.json');
  const store = createLocalStore({ filePath: dataFile });
  const gateway = createLocalGateway({ store, agent });
  const server = createHttpServer({ agent, gateway, maxBodyBytes: env.TCIM_DIALOGUE_MAX_BODY_BYTES });
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`[tcim-dialogue] listening on http://${host}:${address.port} provider=${agent.provider.id} model=${agent.provider.model}`);
  });
  return { server, agent, store, gateway };
}

if (require.main === module) start();

module.exports = { start };
