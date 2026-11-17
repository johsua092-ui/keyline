/**
 * KEYLINE worker
 *
 * One job: be the server side of the measurement console, for ANY endpoint.
 *
 *   /api/health   liveness
 *   /api/probe    one upstream call, measured server side
 *   /api/models   upstream model list, passed through unchanged
 *   /api/quota    best effort balance read, only reported when upstream answers with numbers
 *   everything else -> static assets from ./public
 *
 * Why this exists at all: browsers cannot read most LLM endpoints directly,
 * because those endpoints do not send CORS headers. This worker sends the
 * request from a server instead, so the tool works with any base URL.
 *
 * Universality: neither the path, the auth header, the request body nor the
 * response shape is hardcoded. The client sends them, with defaults that suit
 * OpenAI compatible gateways. Anything with a JSON request and a JSON or SSE
 * response can be measured by pointing the pointers at the right fields.
 *
 * The worker stays stateless and 1:1. The browser owns the concurrency, each
 * invocation makes exactly one upstream request. Nothing is logged, nothing is
 * cached, keys are never written to storage.
 *
 * Timing uses performance.now() around the upstream fetch. The server total
 * and the client round trip are returned separately, so network overhead is
 * visible instead of hidden inside a single number.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });
}

/** Join a base URL and a path without doubling or dropping slashes. */
function joinUrl(base, path) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const p = String(path || '').trim();
  if (!p) return b;
  return b + (p.startsWith('/') ? p : '/' + p);
}

/**
 * Build auth headers. `mode` covers the common schemes, and `headerName`
 * covers anything else, so a custom gateway is one field away.
 */
function authHeaders(mode, key, headerName, extra) {
  const h = { 'Content-Type': 'application/json' };
  const k = key == null ? '' : String(key);
  switch (mode) {
    case 'x-api-key':
      h['x-api-key'] = k;
      break;
    case 'api-key':
      h['api-key'] = k;
      break;
    case 'x-goog-api-key':
      h['x-goog-api-key'] = k;
      break;
    case 'custom-header':
      if (headerName) h[headerName] = k;
      break;
    case 'none':
      break;
    default:
      h['Authorization'] = 'Bearer ' + k;
  }
  if (extra && typeof extra === 'object') {
    for (const [name, value] of Object.entries(extra)) {
      if (name && String(name).trim()) h[String(name).trim()] = String(value);
    }
  }
  return h;
}

/** Reject anything that is not a plain http(s) URL. */
function checkUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return { error: 'Not a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only http and https are allowed.' };
  return { url: u };
}

/**
 * Read a value out of a response using a dot path, e.g.
 *   choices[0].message.content
 *   candidates[0].content.parts[0].text
 *   usageMetadata.promptTokenCount
 */
function pick(obj, ptr) {
  if (!ptr || obj == null) return undefined;
  const parts = String(ptr).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function firstNumber(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string' && c.trim() !== '' && Number.isFinite(Number(c))) return Number(c);
  }
  return null;
}

function firstString(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length) return c;
  }
  return null;
}

const DEFAULT_BODY = {
  model: '{{model}}',
  messages: [{ role: 'user', content: '{{prompt}}' }],
  max_tokens: '{{maxTokens}}',
  stream: '{{stream}}',
};

const DEFAULT_EXTRACT = {
  text: 'choices[0].message.content',
  promptTokens: 'usage.prompt_tokens',
  completionTokens: 'usage.completion_tokens',
  totalTokens: 'usage.total_tokens',
  model: 'model',
  error: 'error.message',
  altPromptTokens: 'usage.input_tokens',
  altCompletionTokens: 'usage.output_tokens',
};

/**
 * Render a request body template. Placeholders are substituted as raw JSON
 * values, so numbers stay numbers and booleans stay booleans.
 */
function renderBody(template, vars) {
  let text;
  if (template && String(template).trim()) {
    text = String(template);
    text = text.replace(/"\{\{(\w+)\}\}"/g, (_m, name) => JSON.stringify(vars[name] ?? ''));
    text = text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(vars[name] ?? ''));
    try {
      return JSON.parse(text);
    } catch {
      return { __templateError: 'Request body template is not valid JSON after substitution.' };
    }
  }
  const body = structuredClone(DEFAULT_BODY);
  body.model = vars.model;
  body.messages = [{ role: 'user', content: vars.prompt }];
  body.max_tokens = vars.maxTokens;
  body.stream = vars.stream;
  return body;
}

async function handleProbe(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Body must be JSON.' }, 400);
  }

  const {
    baseUrl,
    path = '/v1/chat/completions',
    apiKey = '',
    authMode = 'bearer',
    authHeaderName = '',
    extraHeaders = null,
    model,
    prompt,
    maxTokens = 8,
    stream = false,
    bodyTemplate = '',
    extract = null,
  } = body;

  const checked = checkUrl(baseUrl);
  if (checked.error) return json({ ok: false, error: checked.error }, 400);
  if (!model) return json({ ok: false, error: 'model is required.' }, 400);

  if (env && env.ALLOWED_HOSTS) {
    const allow = String(env.ALLOWED_HOSTS).split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length && !allow.includes(checked.url.hostname)) {
      return json({ ok: false, error: 'Host not in ALLOWED_HOSTS: ' + checked.url.hostname }, 403);
    }
  }

  // Pointers sent as empty strings mean "keep the default", so they are skipped.
  const ex = { ...DEFAULT_EXTRACT };
  if (extract && typeof extract === 'object') {
    for (const [k, v] of Object.entries(extract)) {
      if (v && String(v).trim()) ex[k] = String(v).trim();
    }
  }
  const wantsStream = !!stream;
  const target = joinUrl(baseUrl, String(path).replace(/\{\{model\}\}/g, encodeURIComponent(model)));
  const headers = authHeaders(authMode, apiKey, authHeaderName, extraHeaders);

  const payload = renderBody(bodyTemplate, {
    model,
    prompt: prompt || 'Reply with the single word: ok',
    maxTokens: Math.max(1, Math.min(4096, Number(maxTokens) || 8)),
    stream: wantsStream,
  });
  if (payload.__templateError) return json({ ok: false, error: payload.__templateError }, 400);
  if (wantsStream && !bodyTemplate) payload.stream_options = { include_usage: true };

  const t0 = performance.now();
  let res;
  try {
    res = await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (err) {
    return json({ ok: false, error: 'Upstream unreachable: ' + String(err && err.message ? err.message : err), totalMs: Math.round((performance.now() - t0) * 100) / 100 });
  }
  const ttfbMs = performance.now() - t0;

  let text = '';
  let usageObj = null;
  let modelEcho = null;
  let finish = null;
  let ttftMs = null;
  let parsed = null;
  let rawPreview = '';
  const httpStatus = res.status;
  const upstreamType = res.headers.get('content-type') || '';

  try {
    if (wantsStream && res.ok && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const part = line.slice(5).trim();
          if (!part || part === '[DONE]') continue;
          let evt;
          try {
            evt = JSON.parse(part);
          } catch {
            continue;
          }
          if (!modelEcho) modelEcho = firstString(pick(evt, ex.model));
          if (pick(evt, 'usage')) usageObj = pick(evt, 'usage');
          if (pick(evt, 'usageMetadata')) usageObj = pick(evt, 'usageMetadata');
          const piece = firstString(
            pick(evt, ex.text),
            pick(evt, 'choices[0].delta.content'),
            pick(evt, 'choices[0].delta.reasoning_content'),
            pick(evt, 'delta.text'),
            pick(evt, 'candidates[0].content.parts[0].text'),
          );
          if (piece) {
            if (ttftMs === null) ttftMs = performance.now() - t0;
            text += piece;
          }
          const fr = pick(evt, 'choices[0].finish_reason');
          if (typeof fr === 'string' && fr) finish = fr;
        }
      }
    } else {
      const raw = await res.text();
      rawPreview = raw.slice(0, 400);
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      if (parsed) {
        usageObj = pick(parsed, 'usage') || pick(parsed, 'usageMetadata') || null;
        modelEcho = firstString(pick(parsed, ex.model), parsed.model, parsed.modelVersion);
        text = firstString(pick(parsed, ex.text)) || '';
        if (!text) text = firstString(pick(parsed, 'choices[0].message.reasoning_content')) || '';
        if (!text) text = firstString(pick(parsed, 'choices[0].message.reasoning')) || '';
        if (!text) {
          const parts = pick(parsed, 'candidates[0].content.parts');
          if (Array.isArray(parts)) text = parts.map((p) => firstString(p && p.text) || '').join('');
        }
        if (!text) {
          const content = pick(parsed, 'content');
          if (Array.isArray(content)) text = content.map((c) => firstString(c && c.text) || '').join('');
          else if (typeof content === 'string') text = content;
        }
        const fr = pick(parsed, 'choices[0].finish_reason');
        if (typeof fr === 'string' && fr) finish = fr;
        if (!res.ok && !text) {
          text = firstString(pick(parsed, ex.error), pick(parsed, 'message'), rawPreview) || rawPreview;
        }
      } else {
        text = rawPreview;
      }
    }
  } catch (err) {
    return json({ ok: false, httpStatus, ttfbMs: round(ttfbMs), error: 'Read failed: ' + String(err && err.message ? err.message : err) });
  }

  const totalMs = performance.now() - t0;

  // Tokens come only from what the upstream reported. Nothing is estimated.
  let promptTokens = null;
  let completionTokens = null;
  let totalTokens = null;
  if (parsed || usageObj) {
    const src = parsed || {};
    promptTokens = firstNumber(
      pick(src, ex.promptTokens),
      pick(usageObj, ex.promptTokens),
      pick(src, ex.altPromptTokens),
      pick(usageObj, ex.altPromptTokens),
      pick(src, 'usageMetadata.promptTokenCount'),
      pick(usageObj, 'promptTokenCount'),
    );
    completionTokens = firstNumber(
      pick(src, ex.completionTokens),
      pick(usageObj, ex.completionTokens),
      pick(src, ex.altCompletionTokens),
      pick(usageObj, ex.altCompletionTokens),
      pick(src, 'usageMetadata.candidatesTokenCount'),
      pick(usageObj, 'candidatesTokenCount'),
    );
    totalTokens = firstNumber(
      pick(src, ex.totalTokens),
      pick(usageObj, ex.totalTokens),
      pick(src, 'usageMetadata.totalTokenCount'),
      pick(usageObj, 'totalTokenCount'),
    );
    if (totalTokens === null && promptTokens !== null && completionTokens !== null) totalTokens = promptTokens + completionTokens;
  }

  const decodeStart = ttftMs !== null ? ttftMs : ttfbMs;
  const decodeWindow = totalMs - decodeStart;
  const decodeTps = completionTokens !== null && completionTokens > 0 && decodeWindow > 0 ? (completionTokens / decodeWindow) * 1000 : null;
  const endToEndTps = totalTokens !== null && totalMs > 0 ? (totalTokens / totalMs) * 1000 : null;

  return json({
    ok: res.ok,
    httpStatus,
    ttfbMs: round(ttfbMs),
    ttftMs: ttftMs === null ? null : round(ttftMs),
    totalMs: round(totalMs),
    promptTokens,
    completionTokens,
    totalTokens,
    tokensSource: promptTokens !== null || completionTokens !== null ? 'upstream' : null,
    decodeTps: decodeTps === null ? null : round(decodeTps),
    endToEndTps: endToEndTps === null ? null : round(endToEndTps),
    modelEcho,
    finish,
    contentType: upstreamType,
    text: String(text || '').slice(0, 2000),
    rawPreview,
  });
}

async function handleModels(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Body must be JSON.' }, 400);
  }
  const { baseUrl, path = '/v1/models', apiKey = '', authMode = 'bearer', authHeaderName = '', extraHeaders = null, extract = null } = body;
  const checked = checkUrl(baseUrl);
  if (checked.error) return json({ ok: false, error: checked.error }, 400);

  const t0 = performance.now();
  let res;
  try {
    res = await fetch(joinUrl(baseUrl, path), { method: 'GET', headers: authHeaders(authMode, apiKey, authHeaderName, extraHeaders) });
  } catch (err) {
    return json({ ok: false, error: 'Upstream unreachable: ' + String(err && err.message ? err.message : err) });
  }
  const ms = round(performance.now() - t0);
  const raw = await res.text();

  let ids = [];
  try {
    const parsed = JSON.parse(raw);
    let arr = Array.isArray(parsed) ? parsed : pick(parsed, 'data');
    if (!Array.isArray(arr)) arr = pick(parsed, 'models');
    if (!Array.isArray(arr)) arr = pick(parsed, 'result');
    if (Array.isArray(arr)) {
      ids = arr
        .map((m) => {
          if (typeof m === 'string') return m;
          if (!m || typeof m !== 'object') return null;
          return firstString(m.id, m.name, m.model, m.slug, pick(m, 'model_name'));
        })
        .filter(Boolean);
    }
  } catch {
    /* leave ids empty, surface the raw message below */
  }
  ids = [...new Set(ids.map((s) => String(s).replace(/^models\//, '')))].sort((a, b) => a.localeCompare(b));

  return json({
    ok: res.ok,
    httpStatus: res.status,
    ms,
    count: ids.length,
    ids,
    error: res.ok ? null : raw.slice(0, 400),
  });
}

/**
 * Balance read. Gateways expose this at different paths, so a candidate list is
 * tried and the first response carrying numbers wins. When nothing numeric
 * comes back, found:false is returned and the UI shows n/a. A custom path can
 * be supplied, which overrides the candidate list.
 */
const QUOTA_CANDIDATES = [
  '/api/user/self',
  '/api/usage',
  '/dashboard/billing/credit_grants',
  '/v1/dashboard/billing/subscription',
  '/v1/credits',
];

async function handleQuota(req, env) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Body must be JSON.' }, 400);
  }
  const { baseUrl, apiKey = '', authMode = 'bearer', authHeaderName = '', extraHeaders = null, path = '' } = body;
  const checked = checkUrl(baseUrl);
  if (checked.error) return json({ ok: false, error: checked.error }, 400);

  const list = path ? [path] : QUOTA_CANDIDATES;
  const tried = [];
  for (const p of list) {
    let res;
    try {
      res = await fetch(joinUrl(baseUrl, p), { method: 'GET', headers: authHeaders(authMode, apiKey, authHeaderName, extraHeaders) });
    } catch (err) {
      tried.push({ path: p, error: String(err && err.message ? err.message : err) });
      continue;
    }
    const raw = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* not json */
    }
    const found = res.ok && parsed && containsNumber(parsed);
    tried.push({ path: p, httpStatus: res.status, found });
    if (found) {
      return json({ ok: true, found: true, path: p, values: flatten(parsed), tried });
    }
  }
  return json({ ok: true, found: false, tried, error: 'No numeric balance at the tried paths.' });
}

function containsNumber(obj, depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return false;
  for (const v of Object.values(obj)) {
    if (typeof v === 'number') return true;
    if (v && typeof v === 'object' && containsNumber(v, depth + 1)) return true;
  }
  return false;
}

/** Collect dotted numeric paths so the UI can show balance fields without guessing names. */
function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (typeof v === 'number') out[key] = v;
    else if (v && typeof v === 'object') flatten(v, key, out, depth + 1);
  }
  return out;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'keyline', version: 2 });
    }
    if (url.pathname === '/api/probe') {
      if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
      return handleProbe(req, env);
    }
    if (url.pathname === '/api/models') {
      if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
      return handleModels(req, env);
    }
    if (url.pathname === '/api/quota') {
      if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
      return handleQuota(req, env);
    }

    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(req);
    }
    return new Response('Not found', { status: 404, headers: CORS });
  },
};
