import type { FastifyRequest } from 'fastify';
import { resolveIdentity } from '../fabric/gateway.js';

/** The demo identity making the request (spec §9.1 "Demo identity", not real auth). */
export function who(req: FastifyRequest): string {
  const header = req.headers['x-wrt-identity'];
  return resolveIdentity(Array.isArray(header) ? header[0] : header).label;
}

export const s = {
  str: { type: 'string', minLength: 1 },
  int: { type: 'integer', minimum: 0 },
  posInt: { type: 'integer', minimum: 1 },
  bp: { type: 'integer', minimum: 0, maximum: 10000 },
  hashes: { type: 'array', items: { type: 'string', pattern: '^[0-9a-f]{64}$' }, default: [] },
  reading: {
    type: 'object',
    required: ['grade', 'netKg', 'moistureBp'],
    additionalProperties: false,
    properties: {
      grade: { type: 'string', minLength: 1 },
      netKg: { type: 'integer', minimum: 1 },
      moistureBp: { type: 'integer', minimum: 0, maximum: 10000 },
    },
  },
} as const;

export function body(required: string[], properties: Record<string, unknown>) {
  return { body: { type: 'object', required, additionalProperties: false, properties } };
}

/** Builds a QueryContract:List filter from query-string params, skipping empty ones. */
export function filterFrom(raw: object, fields: string[]): string {
  const query = raw as Record<string, unknown>;
  const filter: Record<string, unknown> = {};
  for (const f of fields) {
    const v = query[f.replace(/\./g, '_')] ?? query[f];
    if (typeof v === 'string' && v !== '') {
      filter[f] = v.includes(',') ? { $in: v.split(',') } : v;
    }
  }
  return JSON.stringify(filter);
}
