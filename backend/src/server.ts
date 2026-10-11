import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { HttpError } from './fabric/errors.js';
import { setLedgerLogger } from './fabric/ledger.js';
import { disputeRoutes } from './routes/disputes.js';
import { loanRoutes } from './routes/loans.js';
import { metaRoutes } from './routes/meta.js';
import { receiptRoutes } from './routes/receipts.js';
import { registryRoutes } from './routes/registry.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: true } },
  });
  setLedgerLogger(app.log);
  await app.register(cors, { origin: config.corsOrigin.split(','), allowedHeaders: ['Content-Type', 'X-WRT-Identity', 'Last-Event-ID'] });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Errors: { error: { code, message, txId? } }. Chaincode messages are passed through unchanged.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, ...(err.txId ? { txId: err.txId } : {}) } });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) {
      return reply.status(400).send({ error: { code: 'INVALID_ARGUMENT', message: `INVALID_ARGUMENT: ${e.message}` } });
    }
    app.log.error(err);
    return reply.status(e.statusCode ?? 500).send({ error: { code: 'INTERNAL', message: e.message } });
  });

  await app.register(metaRoutes);
  await app.register(registryRoutes);
  await app.register(receiptRoutes);
  await app.register(loanRoutes);
  await app.register(disputeRoutes);
  return app;
}
