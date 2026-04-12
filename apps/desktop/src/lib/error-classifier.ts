/**
 * Error Classifier — structured error categorization for API errors.
 *
 * Ported from CodePilot's error-classifier.ts pattern-matching classifier.
 * Produces actionable, user-facing error messages with recovery hints.
 */
import i18n from "../i18n";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

// ── Error categories ────────────────────────────────────────────

export type ErrorCategory =
  | 'NO_CREDENTIALS'
  | 'AUTH_REJECTED'
  | 'AUTH_FORBIDDEN'
  | 'RATE_LIMITED'
  | 'NETWORK_UNREACHABLE'
  | 'ENDPOINT_NOT_FOUND'
  | 'MODEL_NOT_AVAILABLE'
  | 'CONTEXT_TOO_LONG'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'EMPTY_RESPONSE'
  | 'OVERLOADED'
  | 'INVALID_REQUEST'
  | 'STREAM_ERROR'
  | 'ABORT'
  | 'UNKNOWN';

/** A concrete action the user can take to recover */
export interface RecoveryAction {
  label: string;
  action?: 'open_settings' | 'retry' | 'new_conversation';
}

export interface ClassifiedError {
  category: ErrorCategory;
  /** User-facing message explaining what went wrong */
  userMessage: string;
  /** Actionable hint telling the user how to fix it */
  actionHint: string;
  /** Original raw error message */
  rawMessage: string;
  /** Provider name if available */
  providerName?: string;
  /** Additional detail (stderr, cause, etc.) */
  details?: string;
  /** Whether this error is likely transient and retryable */
  retryable: boolean;
  /** Structured recovery actions for UI buttons */
  recoveryActions: RecoveryAction[];
}

// ── Classification context ──────────────────────────────────────

export interface ErrorContext {
  error: unknown;
  providerName?: string;
  baseUrl?: string;
  model?: string;
}

// ── Pattern definitions ─────────────────────────────────────────

interface ErrorPattern {
  category: ErrorCategory;
  patterns: Array<string | RegExp>;
  codes?: string[];
  userMessage: (ctx: ErrorContext) => string;
  actionHint: (ctx: ErrorContext) => string;
  retryable: boolean;
}

const providerHint = (ctx: ErrorContext) =>
  ctx.providerName ? ` (${ctx.providerName})` : '';

const ERROR_PATTERNS: ErrorPattern[] = [
  // ── No credentials ──
  {
    category: 'NO_CREDENTIALS',
    patterns: ['no api key', 'missing api key', 'api key required', 'missing credentials', 'ANTHROPIC_API_KEY'],
    userMessage: (ctx) => t('errors.noCredentials', { provider: providerHint(ctx) }),
    actionHint: () => t('errors.noCredentialsHint'),
    retryable: false,
  },

  // ── Auth rejected (401) ──
  {
    category: 'AUTH_REJECTED',
    patterns: ['401', 'Unauthorized', 'invalid_api_key', 'invalid api key', 'authentication_error', 'authentication failed'],
    userMessage: (ctx) => t('errors.authRejected', { provider: providerHint(ctx) }),
    actionHint: () => t('errors.authRejectedHint'),
    retryable: false,
  },

  // ── Auth forbidden (403) ──
  {
    category: 'AUTH_FORBIDDEN',
    patterns: ['403', 'Forbidden', 'permission_error', 'access denied'],
    userMessage: (ctx) => t('errors.authForbidden', { provider: providerHint(ctx) }),
    actionHint: () => t('errors.authForbiddenHint'),
    retryable: false,
  },

  // ── Rate limited (429) ──
  {
    category: 'RATE_LIMITED',
    patterns: ['429', 'rate limit', 'Rate limit', 'too many requests'],
    userMessage: () => t('errors.rateLimited'),
    actionHint: () => t('errors.rateLimitedHint'),
    retryable: true,
  },

  // ── Overloaded ──
  {
    category: 'OVERLOADED',
    patterns: ['overloaded', 'overloaded_error', 'capacity', 'service_unavailable'],
    userMessage: (ctx) => t('errors.overloaded', { provider: providerHint(ctx) }),
    actionHint: () => t('errors.overloadedHint'),
    retryable: true,
  },

  // ── Model not available ──
  {
    category: 'MODEL_NOT_AVAILABLE',
    patterns: ['model_not_found', 'model not found', 'model_not_available', 'invalid model', 'does not exist', /not_found_error.*model/],
    userMessage: (ctx) => t('errors.modelNotAvailable', { provider: providerHint(ctx), model: ctx.model || '' }),
    actionHint: () => t('errors.modelNotAvailableHint'),
    retryable: false,
  },

  // ── Context too long ──
  {
    category: 'CONTEXT_TOO_LONG',
    patterns: ['context_length', 'context window', 'too many tokens', 'max_tokens', 'prompt is too long'],
    userMessage: () => t('errors.contextTooLong'),
    actionHint: () => t('errors.contextTooLongHint'),
    retryable: false,
  },

  // ── Invalid request ──
  {
    category: 'INVALID_REQUEST',
    patterns: ['invalid_request_error', 'invalid request', 'bad request', '400'],
    userMessage: () => t('errors.invalidRequest'),
    actionHint: () => t('errors.invalidRequestHint'),
    retryable: false,
  },

  // ── Timeout ──
  {
    category: 'TIMEOUT',
    patterns: ['timeout', 'Timeout', 'ETIMEDOUT', 'timed out', 'deadline exceeded'],
    codes: ['ETIMEDOUT'],
    userMessage: () => t('errors.timeout'),
    actionHint: () => t('errors.timeoutHint'),
    retryable: true,
  },

  // ── Network unreachable ──
  {
    category: 'NETWORK_UNREACHABLE',
    patterns: ['ECONNREFUSED', 'ECONNRESET', 'fetch failed', 'Failed to fetch', 'network error', 'DNS', 'ENOTFOUND', 'ERR_'],
    codes: ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND'],
    userMessage: (ctx) => t('errors.networkUnreachable', { url: ctx.baseUrl || '' }),
    actionHint: () => t('errors.networkUnreachableHint'),
    retryable: true,
  },

  // ── Endpoint not found (404) ──
  {
    category: 'ENDPOINT_NOT_FOUND',
    patterns: ['404', 'Not Found', 'endpoint not found'],
    userMessage: (ctx) => t('errors.endpointNotFound', { provider: providerHint(ctx) }),
    actionHint: () => t('errors.endpointNotFoundHint'),
    retryable: false,
  },

  // ── Server error (5xx) ──
  {
    category: 'SERVER_ERROR',
    patterns: ['500', '502', '503', 'internal server error', 'bad gateway', 'service unavailable'],
    userMessage: (ctx) => t('errors.serverError', { provider: providerHint(ctx) }),
    actionHint: () => t('errors.serverErrorHint'),
    retryable: true,
  },

  // ── Stream error ──
  {
    category: 'STREAM_ERROR',
    patterns: ['stream error', 'stream closed', 'SSE', 'event source', 'readable stream'],
    userMessage: () => t('errors.streamError'),
    actionHint: () => t('errors.streamErrorHint'),
    retryable: true,
  },

  // ── Abort ──
  {
    category: 'ABORT',
    patterns: ['abort', 'AbortError', 'aborted', 'cancelled', 'canceled'],
    userMessage: () => t('errors.abort'),
    actionHint: () => '',
    retryable: false,
  },
];

// ── Classifier ──────────────────────────────────────────────────

export function classifyError(ctx: ErrorContext): ClassifiedError {
  const error = ctx.error;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const errorCode = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const extraDetail = cause instanceof Error ? cause.message : cause ? String(cause) : '';

  const searchText = `${rawMessage}\n${extraDetail}`.toLowerCase();

  for (const pattern of ERROR_PATTERNS) {
    // Check error code first (most specific)
    if (pattern.codes && errorCode && pattern.codes.includes(errorCode)) {
      return buildResult(pattern, ctx, rawMessage, extraDetail);
    }

    // Check patterns against combined text
    const matched = pattern.patterns.some(p => {
      if (typeof p === 'string') return searchText.includes(p.toLowerCase());
      return p.test(searchText);
    });

    if (matched) {
      return buildResult(pattern, ctx, rawMessage, extraDetail);
    }
  }

  // Fallback: unknown error
  return {
    category: 'UNKNOWN',
    userMessage: t('errors.unknown', { provider: providerHint(ctx) }),
    actionHint: t('errors.unknownHint'),
    rawMessage,
    providerName: ctx.providerName,
    details: extraDetail || undefined,
    retryable: false,
    recoveryActions: [{ label: t('errors.openSettings'), action: 'open_settings' }],
  };
}

function buildRecoveryActions(category: ErrorCategory): RecoveryAction[] {
  switch (category) {
    case 'AUTH_REJECTED':
    case 'AUTH_FORBIDDEN':
    case 'NO_CREDENTIALS':
      return [{ label: t('errors.openSettings'), action: 'open_settings' }];
    case 'RATE_LIMITED':
    case 'OVERLOADED':
    case 'TIMEOUT':
    case 'NETWORK_UNREACHABLE':
    case 'SERVER_ERROR':
    case 'STREAM_ERROR':
      return [{ label: t('errors.retry'), action: 'retry' }];
    case 'MODEL_NOT_AVAILABLE':
    case 'ENDPOINT_NOT_FOUND':
      return [{ label: t('errors.openSettings'), action: 'open_settings' }];
    case 'CONTEXT_TOO_LONG':
      return [{ label: t('errors.newConversation'), action: 'new_conversation' }];
    case 'ABORT':
      return [];
    default:
      return [{ label: t('errors.openSettings'), action: 'open_settings' }];
  }
}

function buildResult(
  pattern: ErrorPattern,
  ctx: ErrorContext,
  rawMessage: string,
  extraDetail: string,
): ClassifiedError {
  return {
    category: pattern.category,
    userMessage: pattern.userMessage(ctx),
    actionHint: pattern.actionHint(ctx),
    rawMessage,
    providerName: ctx.providerName,
    details: extraDetail || undefined,
    retryable: pattern.retryable,
    recoveryActions: buildRecoveryActions(pattern.category),
  };
}

// ── Formatting helper ───────────────────────────────────────────

/** Format a ClassifiedError into a user-friendly string */
export function formatClassifiedError(err: ClassifiedError): string {
  let msg = err.userMessage;
  if (err.actionHint) msg += `\n${err.actionHint}`;
  if (err.details) msg += `\n\n${t('errors.details')}: ${err.details}`;
  return msg;
}
