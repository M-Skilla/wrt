import { config } from './config.js';
import { startEventListener } from './events.js';
import { startExplorer, txById } from './fabric/explorer.js';
import { closeAll } from './fabric/gateway.js';
import { startKeeper } from './keeper.js';
import { buildServer } from './server.js';

const app = await buildServer();
await app.listen({ port: config.port, host: '0.0.0.0' });

void startExplorer(app.log);
void startEventListener(app.log, (txId) => txById(txId)?.creator.mspId);
startKeeper(app.log);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      closeAll();
      process.exit(0);
    });
  });
}
