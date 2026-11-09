// RFC 9457 problem details. Slugs map to `urn:poolamkoo:problem:<slug>`; plain HTTP errors
// without a slug use `about:blank`.
export type ProblemSlug =
  | 'validation'
  | 'unauthorized'
  | 'not-found'
  | 'rate-limited'
  | 'payload-too-large'
  | 'conflict'
  | 'internal';

export interface ProblemFieldError {
  path: string;
  message: string;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  request_id: string;
  errors?: ProblemFieldError[];
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export function titleFor(status: number): string {
  return TITLES[status] ?? (status >= 500 ? 'Server Error' : 'Error');
}

export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly slug: ProblemSlug | undefined,
    readonly detail: string,
    readonly errors?: ProblemFieldError[],
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
    this.name = 'ProblemError';
  }
}

export function toProblemBody(err: ProblemError, requestId: string): ProblemBody {
  return {
    type: err.slug ? `urn:poolamkoo:problem:${err.slug}` : 'about:blank',
    title: titleFor(err.status),
    status: err.status,
    detail: err.detail,
    request_id: requestId,
    ...(err.errors ? { errors: err.errors } : {}),
  };
}

export const problems = {
  validation: (detail = 'Request validation failed', errors: ProblemFieldError[] = []) =>
    new ProblemError(400, 'validation', detail, errors),
  unauthorized: (detail = 'Authentication required') =>
    new ProblemError(401, 'unauthorized', detail, undefined, {
      'www-authenticate': 'Bearer',
    }),
  notFound: (detail = 'Resource not found') => new ProblemError(404, 'not-found', detail),
  conflict: (detail: string) => new ProblemError(409, 'conflict', detail),
  payloadTooLarge: (detail = 'Request body is too large') =>
    new ProblemError(413, 'payload-too-large', detail),
  rateLimited: (retryAfterSeconds: number) =>
    new ProblemError(
      429,
      'rate-limited',
      `Too many requests. Retry in ${retryAfterSeconds} seconds.`,
      undefined,
      { 'retry-after': String(retryAfterSeconds) },
    ),
  internal: () => new ProblemError(500, 'internal', 'An unexpected error occurred'),
};
