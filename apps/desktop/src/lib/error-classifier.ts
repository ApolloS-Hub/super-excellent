/**
 * Error Classifier — structured error categorization for API errors.
 *
 * Ported from CodePilot's error-classifier.ts pattern-matching classifier.
 * Produces actionable, user-facing error messages with recovery hints.
 *
 * Envelope schema inspired by claw-code ROADMAP:
 *   - kind: high-level category (auth / network / quota / ...)
 *   - operation: what syscall / API call failed (chat / file_read / tool_execute)
 *   - target: which resource (URL, file path, tool name)
 *   - retryable: whether auto-retry is expected to succeed
 *   - hint: specific next action
 *
 * Downstream consumers (UI, watchdog, StopHooks) can dispatch on the typed
 * fields instead of regex-matching prose.
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

/** High-level machine-dispatchable kind of failure */
export type ErrorKind =
  | 'auth'          // credentials / permissions
  | 'quota'         // rate limit / overload / budget
  | 'network'       // connection / DNS / firewall
  | 'config'        // invalid endpoint / model / params
  | 'input'         // user-caused malformed request
  | 'server'        // 5xx / gateway / capacity
  | 'timeout'       // exceeded deadline
  | 'context'       // context window overflow
  | 'stream'        // SSE / streaming parse
  | 'abort'         // user cancellation
  | 'unknown';

/** A concrete action the user can take to recover */
export interface RecoveryAction {
  label: string;
  action?: 'open_settings' | 'retry' | 'new_conversation';
}

export interface ClassifiedError {
  category: ErrorCategory;
  /** High-level kind for machine dispatch */
  kind: ErrorKind;
  /** Which operation failed (chat / tool_execute / file_read / mcp_connect) */
  operation?: string;
  /** Which resource (URL, tool name, file path, provider) */
  target?: string;
  /** User-facing message explaining what went wrong */
  userMessage: string;
  /** Actionable hint telling the user how to fix it */
  actionHint: string;
  /** Machine-readable hint key, e.g. "rotate_api_key", "switch_provider" */
  hint?: string;
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

/** Map ErrorCategory → ErrorKind for machine dispatch */
const CATEGORY_TO_KIND: Record<ErrorCategory, ErrorKind> = {
  NO_CREDENTIALS: 'auth',
  AUTH_REJECTED: 'auth',
  AUTH_FORBIDDEN: 'auth',
  RATE_LIMITED: 'quota',
  OVERLOADED: 'quota',
  NETWORK_UNREACHABLE: 'network',
  ENDPOINT_NOT_FOUND: 'config',
  MODEL_NOT_AVAILABLE: 'config',
  INVALID_REQUEST: 'input',
  CONTEXT_TOO_LONG: 'context',
  TIMEOUT: 'timeout',
  SERVER_ERROR: 'server',
  EMPTY_RESPONSE: 'server',
  STREAM_ERROR: 'stream',
  ABORT: 'abort',
  UNKNOWN: 'unknown',
};

/** Map ErrorCategory → machine-readable hint for automatic recovery */
const CATEGORY_TO_HINT: Record<ErrorCategory, string> = {
  NO_CREDENTIALS: 'configure_api_key',
  AUTH_REJECTED: 'rotate_api_key',
  AUTH_FORBIDDEN: 'upgrade_plan',
  RATE_LIMITED: 'wait_and_retry',
  OVERLOADED: 'switch_provider_or_wait',
  NETWORK_UNREACHABLE: 'check_network_or_proxy',
  ENDPOINT_NOT_FOUND: 'fix_base_url',
  MODEL_NOT_AVAILABLE: 'switch_model',
  INVALID_REQUEST: 'adjust_params',
  CONTEXT_TOO_LONG: 'compact_or_new_session',
  TIMEOUT: 'retry_with_backoff',
  SERVER_ERROR: 'wait_and_retry',
  EMPTY_RESPONSE: 'retry',
  STREAM_ERROR: 'retry',
  ABORT: 'none',
  UNKNOWN: 'open_settings',
};

// ── Classification context ──────────────────────────────────────

export interface ErrorContext {
  error: unknown;
  providerName?: string;
  baseUrl?: string;
  model?: string;
  /** Which operation was running (e.g. "chat", "tool_execute", "mcp_connect") */
  operation?: string;
  /** Which resource (tool name, file path, URL) */
  target?: string;
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
    kind: CATEGORY_TO_KIND['UNKNOWN'],
    operation: ctx.operation,
    target: ctx.target ?? ctx.baseUrl,
    userMessage: t('errors.unknown', { provider: providerHint(ctx) }),
    actionHint: t('errors.unknownHint'),
    hint: CATEGORY_TO_HINT['UNKNOWN'],
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
    kind: CATEGORY_TO_KIND[pattern.category],
    operation: ctx.operation,
    target: ctx.target ?? ctx.baseUrl,
    userMessage: pattern.userMessage(ctx),
    actionHint: pattern.actionHint(ctx),
    hint: CATEGORY_TO_HINT[pattern.category],
    rawMessage,
    providerName: ctx.providerName,
    details: extraDetail || undefined,
    retryable: pattern.retryable,
    recoveryActions: buildRecoveryActions(pattern.category),
  };
}

// ── Machine-dispatch helpers ────────────────────────────────────

/** Returns true if the error should be automatically retried by the watchdog */
export function shouldAutoRetry(err: ClassifiedError): boolean {
  return err.retryable && err.kind !== 'abort';
}

/** Returns true if the error suggests switching to a different provider */
export function shouldSwitchProvider(err: ClassifiedError): boolean {
  return err.kind === 'quota' || err.kind === 'server' ||
    (err.kind === 'config' && err.category === 'MODEL_NOT_AVAILABLE');
}

/** Returns true if the error requires user intervention (not auto-fixable) */
export function requiresUserAction(err: ClassifiedError): boolean {
  return err.kind === 'auth' || err.kind === 'input' ||
    (err.kind === 'config' && err.category === 'ENDPOINT_NOT_FOUND');
}

/** Returns true if the current context should be compacted before retrying */
export function shouldCompactContext(err: ClassifiedError): boolean {
  return err.kind === 'context';
}

// ── Formatting helper ───────────────────────────────────────────

/** Format a ClassifiedError into a user-friendly string */
export function formatClassifiedError(err: ClassifiedError): string {
  let msg = err.userMessage;
  if (err.actionHint) msg += `\n${err.actionHint}`;
  if (err.details) msg += `\n\n${t('errors.details')}: ${err.details}`;
  return msg;
}
