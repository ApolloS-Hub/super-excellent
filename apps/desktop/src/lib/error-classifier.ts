/**
 * Error Classifier — structured error categorization for API errors.
 *
 * Ported from CodePilot's error-classifier.ts pattern-matching classifier.
 * Produces actionable, user-facing error messages with recovery hints.
 */

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
    userMessage: (ctx) => `未找到 API 密钥${providerHint(ctx)}`,
    actionHint: () => '请到设置页面配置 API Key',
    retryable: false,
  },

  // ── Auth rejected (401) ──
  {
    category: 'AUTH_REJECTED',
    patterns: ['401', 'Unauthorized', 'invalid_api_key', 'invalid api key', 'authentication_error', 'authentication failed'],
    userMessage: (ctx) => `认证失败${providerHint(ctx)}`,
    actionHint: () => '请检查 API Key 是否正确且未过期',
    retryable: false,
  },

  // ── Auth forbidden (403) ──
  {
    category: 'AUTH_FORBIDDEN',
    patterns: ['403', 'Forbidden', 'permission_error', 'access denied'],
    userMessage: (ctx) => `权限不足${providerHint(ctx)}`,
    actionHint: () => '您的 API Key 可能缺少相关权限，请检查套餐限额',
    retryable: false,
  },

  // ── Rate limited (429) ──
  {
    category: 'RATE_LIMITED',
    patterns: ['429', 'rate limit', 'Rate limit', 'too many requests'],
    userMessage: () => '请求频率超限',
    actionHint: () => '请稍候再试。如果持续出现，请考虑升级 API 套餐',
    retryable: true,
  },

  // ── Overloaded ──
  {
    category: 'OVERLOADED',
    patterns: ['overloaded', 'overloaded_error', 'capacity', 'service_unavailable'],
    userMessage: (ctx) => `服务过载${providerHint(ctx)}`,
    actionHint: () => '服务暂时繁忙，请稍后重试',
    retryable: true,
  },

  // ── Model not available ──
  {
    category: 'MODEL_NOT_AVAILABLE',
    patterns: ['model_not_found', 'model not found', 'model_not_available', 'invalid model', 'does not exist', /not_found_error.*model/],
    userMessage: (ctx) => `模型不可用${providerHint(ctx)}${ctx.model ? ` (${ctx.model})` : ''}`,
    actionHint: () => '所选模型可能不受此提供商支持，请尝试其他模型',
    retryable: false,
  },

  // ── Context too long ──
  {
    category: 'CONTEXT_TOO_LONG',
    patterns: ['context_length', 'context window', 'too many tokens', 'max_tokens', 'prompt is too long'],
    userMessage: () => '对话上下文过长',
    actionHint: () => '请使用 /compact 压缩对话，或开始新对话',
    retryable: false,
  },

  // ── Invalid request ──
  {
    category: 'INVALID_REQUEST',
    patterns: ['invalid_request_error', 'invalid request', 'bad request', '400'],
    userMessage: () => '请求格式错误',
    actionHint: () => '请检查参数配置或尝试其他模型',
    retryable: false,
  },

  // ── Timeout ──
  {
    category: 'TIMEOUT',
    patterns: ['timeout', 'Timeout', 'ETIMEDOUT', 'timed out', 'deadline exceeded'],
    codes: ['ETIMEDOUT'],
    userMessage: () => '请求超时',
    actionHint: () => '服务器响应太慢，请稍后重试',
    retryable: true,
  },

  // ── Network unreachable ──
  {
    category: 'NETWORK_UNREACHABLE',
    patterns: ['ECONNREFUSED', 'ECONNRESET', 'fetch failed', 'Failed to fetch', 'network error', 'DNS', 'ENOTFOUND', 'ERR_'],
    codes: ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND'],
    userMessage: (ctx) => `网络连接失败${ctx.baseUrl ? ` (${ctx.baseUrl})` : ''}`,
    actionHint: () => '请检查网络连接或代理设置',
    retryable: true,
  },

  // ── Endpoint not found (404) ──
  {
    category: 'ENDPOINT_NOT_FOUND',
    patterns: ['404', 'Not Found', 'endpoint not found'],
    userMessage: (ctx) => `API 端点未找到${providerHint(ctx)}`,
    actionHint: () => 'Base URL 可能不正确，请检查设置',
    retryable: false,
  },

  // ── Server error (5xx) ──
  {
    category: 'SERVER_ERROR',
    patterns: ['500', '502', '503', 'internal server error', 'bad gateway', 'service unavailable'],
    userMessage: (ctx) => `服务器错误${providerHint(ctx)}`,
    actionHint: () => '服务器暂时不可用，请稍后重试',
    retryable: true,
  },

  // ── Stream error ──
  {
    category: 'STREAM_ERROR',
    patterns: ['stream error', 'stream closed', 'SSE', 'event source', 'readable stream'],
    userMessage: () => '数据流中断',
    actionHint: () => '连接中断，请重试',
    retryable: true,
  },

  // ── Abort ──
  {
    category: 'ABORT',
    patterns: ['abort', 'AbortError', 'aborted', 'cancelled', 'canceled'],
    userMessage: () => '已停止生成',
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
    userMessage: `发生未知错误${providerHint(ctx)}`,
    actionHint: '请查看错误详情。如果持续出现，请检查设置',
    rawMessage,
    providerName: ctx.providerName,
    details: extraDetail || undefined,
    retryable: false,
    recoveryActions: [{ label: '打开设置', action: 'open_settings' }],
  };
}

function buildRecoveryActions(category: ErrorCategory): RecoveryAction[] {
  switch (category) {
    case 'AUTH_REJECTED':
    case 'AUTH_FORBIDDEN':
    case 'NO_CREDENTIALS':
      return [{ label: '打开设置', action: 'open_settings' }];
    case 'RATE_LIMITED':
    case 'OVERLOADED':
    case 'TIMEOUT':
    case 'NETWORK_UNREACHABLE':
    case 'SERVER_ERROR':
    case 'STREAM_ERROR':
      return [{ label: '重试', action: 'retry' }];
    case 'MODEL_NOT_AVAILABLE':
    case 'ENDPOINT_NOT_FOUND':
      return [{ label: '打开设置', action: 'open_settings' }];
    case 'CONTEXT_TOO_LONG':
      return [{ label: '新对话', action: 'new_conversation' }];
    case 'ABORT':
      return [];
    default:
      return [{ label: '打开设置', action: 'open_settings' }];
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
  if (err.details) msg += `\n\n详情: ${err.details}`;
  return msg;
}
