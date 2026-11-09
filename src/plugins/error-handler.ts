import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ProblemError, problems, toProblemBody, type ProblemFieldError } from '../lib/problem.js';

function sendProblem(request: FastifyRequest, reply: FastifyReply, problem: ProblemError) {
  const body = JSON.stringify(toProblemBody(problem, request.id));
  return reply
    .code(problem.status)
    .headers(problem.headers)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .send(body);
}

// "/install_id" -> "install_id"; non-body inputs are prefixed with where they came from.
function fieldPath(instancePath: string, context: string | undefined): string {
  const dotted = instancePath.replace(/^\//, '').replaceAll('/', '.');
  return context && context !== 'body' ? `${context}${dotted ? `.${dotted}` : ''}` : dotted;
}

function fieldErrors(err: FastifyError): ProblemFieldError[] {
  return (err.validation ?? []).map((v) => ({
    path: fieldPath(v.instancePath, err.validationContext),
    message: v.message ?? 'Invalid value',
  }));
}

function toProblem(err: FastifyError | ProblemError): ProblemError {
  if (err instanceof ProblemError) return err;

  if (hasZodFastifySchemaValidationErrors(err) || err.validation) {
    return problems.validation(undefined, fieldErrors(err));
  }
  if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || err.statusCode === 413) {
    return problems.payloadTooLarge();
  }
  if (err.statusCode === 400) {
    // Malformed JSON, empty body, wrong content-length, ...
    return problems.validation('Malformed request');
  }
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    // Other client errors (415, 405, ...): about:blank with the standard title, no internals.
    return new ProblemError(err.statusCode, undefined, 'The request could not be processed');
  }
  return problems.internal();
}

export const errorHandlerPlugin = fp(
  async (app) => {
    app.setErrorHandler((err: FastifyError | ProblemError, request, reply) => {
      const problem = toProblem(err);
      if (problem.status >= 500) {
        // Log the real error server-side only; the client gets a generic problem.
        request.log.error({ err }, 'unhandled error');
      }
      return sendProblem(request, reply, problem);
    });

    // Unknown routes: @fastify/rate-limit does not cover the 404 handler on its own, so apply it
    // explicitly (requires the security plugin to be registered first).
    app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) =>
      sendProblem(request, reply, problems.notFound()),
    );
  },
  { name: 'error-handler' },
);
