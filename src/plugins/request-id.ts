import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

// Passed to Fastify({ genReqId }): honour a well-formed incoming id, otherwise generate one.
export function genReqId(req: { headers: FastifyRequest['headers'] }): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

// Echo the id on every response. Set in onRequest (so early failures such as rate limiting
// carry it) and again in onSend (so error replies that reset headers still have it).
export const requestIdPlugin = fp(
  async (app) => {
    app.addHook('onRequest', async (request, reply) => {
      void reply.header('x-request-id', request.id);
    });
    app.addHook('onSend', async (request, reply) => {
      void reply.header('x-request-id', request.id);
    });
  },
  { name: 'request-id' },
);
