import {mapLoadError,validDiagnosticCode} from './atlas-map-diagnostics.js';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY = 10000;
// The desktop protocol owns its transfer timeouts, including large ZIP fallback.
const DEFAULT_TIMEOUT = globalThis.location?.protocol === 'tarkov:' ? 0 : 25000;

function retryDelay(value, attempt) {
  const delay = 350 * 2 ** attempt + Math.random() * 200;
  if (!value) return delay;
  const after = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(after) ? delay : Math.max(delay, after);
}

function wait(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', abort, {once: true});
  });
}

// The deadline covers the body as well as the response headers. Aborting a
// sector or a map immediately cancels its fetch and any scheduled retry.
export async function readMapResource(url, label, read, {
  code = 'MAP-RESOURCE', fetcher = globalThis.fetch, signal, cache = 'default', headers, timeout = DEFAULT_TIMEOUT,
  retries = 2, readError = false, onRetry
} = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    const timer = timeout > 0 ? setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeout) : undefined;
    let failure, delay;
    try {
      const response = await fetcher(url, {
        signal: controller.signal, headers, cache: attempt && cache !== 'no-store' ? 'reload' : cache
      });
      controller.signal.throwIfAborted();
      if (response.ok) {
        const value = await read(response);
        controller.signal.throwIfAborted();
        return value;
      }
      const status = response.status, temporary = RETRYABLE_STATUS.has(status);
      if (temporary) delay = retryDelay(response.headers?.get('Retry-After'), attempt);
      let detail;
      if (readError && (!temporary || attempt >= retries || delay > MAX_RETRY_DELAY)) {
        try { detail = (await response.json())?.error; } catch {}
      } else {
        void response.body?.cancel().catch(() => {});
      }
      const description = typeof detail === 'string' && detail.length <= 200 ? ` · ${detail}` : '';
      const origin = response.headers?.get('X-Map-Error-Code');
      const sourceCode = validDiagnosticCode(origin) ? origin : undefined;
      const upstream = response.headers?.get('X-Map-Upstream-Error-Code');
      failure = mapLoadError(`${code}-HTTP-${status}`, `${label}失败（HTTP ${status}）${description}`, {
        status, url, temporary, attempts: attempt + 1, sourceCode,
        upstreamCode: validDiagnosticCode(upstream) ? upstream : undefined
      });
    } catch (cause) {
      signal?.throwIfAborted();
      const timedOut = controller.signal.reason?.name === 'TimeoutError';
      const network = cause instanceof TypeError || cause?.name === 'NetworkError';
      const temporary = timedOut || network;
      const reason = timedOut ? '响应超时' : network ? '网络连接异常' : '响应格式无效';
      const suffix = timedOut ? 'TIMEOUT' : network ? 'NETWORK' : 'RESPONSE';
      failure = mapLoadError(`${code}-${suffix}`, `${label}失败（${reason}）`, {cause, url, temporary, attempts: attempt + 1});
      if (temporary) delay = retryDelay(null, attempt);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
    signal?.throwIfAborted();
    if (!failure.temporary || attempt >= retries || delay > MAX_RETRY_DELAY) throw failure;
    onRetry?.(failure, attempt + 1, retries);
    await wait(delay, signal);
  }
}

export function readMapJson(url, label, options) {
  return readMapResource(url, label, response => response.json(), options);
}

