import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createRequestId, logger } from '@/lib/logging/logger';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'AREA_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_INVALID_RESPONSE'
  | 'NO_ROUTE_FOUND'
  | 'NOT_CONFIGURED'
  | 'INTERNAL_ERROR';

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  AREA_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_UNAVAILABLE: 502,
  UPSTREAM_INVALID_RESPONSE: 502,
  NO_ROUTE_FOUND: 404,
  NOT_CONFIGURED: 501,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function errorResponse(
  error: unknown,
  requestId = createRequestId(),
): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    if (error.status >= 500) logger.error(error.message, { requestId, code: error.code });
    else logger.warn(error.message, { requestId, code: error.code });
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details, requestId } },
      { status: error.status, headers: { 'x-request-id': requestId } },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_FAILED' as const,
          message: 'Request validation failed.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          requestId,
        },
      },
      { status: 422, headers: { 'x-request-id': requestId } },
    );
  }
  logger.error('Unhandled API error', {
    requestId,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR' as const,
        message: 'An unexpected error occurred. The failure has been logged.',
        requestId,
      },
    },
    { status: 500, headers: { 'x-request-id': requestId } },
  );
}
