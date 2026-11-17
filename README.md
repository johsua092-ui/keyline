# KEYLINE

A batch API key tester. Paste the key file you already have, name a base URL, and get back which keys answer, how fast, and exactly how many tokens each one served.

No database. No accounts. One static page and one small Worker.

```
public/index.html    the whole app, no build step
worker/index.js      the server side, for any gateway
server.mjs           local preview, uses the same worker module
DESIGN.md            the design direction and every rule it resolves
```

## What it does

- **Reads any key file.** One key per line, markdown bullets, CSV columns, pipe rows, `KEY=value`, an `export` line, a JSON array, or a JSON object dump. Duplicates are collapsed and counted. Lines that are not keys are reported by name instead of being dropped in silence. Comments (`#`, `//`, `;`, `<!--`) are skipped as structure.
- **Works with any gateway.** OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Azure, Cloudflare AI Gateway, Ollama, llama.cpp, vLLM, LiteLLM, New API, or something private. Sixteen presets only fill the form. Every field stays editable, and an advanced panel lets you set the request body template and the response pointers, so a gateway with a shape nobody has seen still works.
- **Measures honestly.** Tokens are read from the gateway's own `usage` block. When a gateway reports none, the cell says `n/a` rather than estimating from character counts. Latency is taken server side next to the upstream, and the browser round trip is shown beside it so network overhead is visible instead of folded into one number.
- **Take active keys.** Choose how many passing keys to take, sort by file order, fastest, highest throughput, or most tokens, then copy or download as `.txt`, `.csv`, `.json`, `.md` or `.env`.
- **Per model summary.** Probes, pass rate, average and p95 latency, average throughput, tokens served, plus labeled measurement bars for scanning.

## Quick start

### 1. Preview locally

```bash
node server.mjs           # http://127.0.0.1:4173
PORT=8080 node server.mjs
```

No dependencies. Node 18 or newer, because the preview imports the same worker module that runs in production.

### 2. Deploy the whole thing (app plus proxy)

```bash
npx wrangler deploy
```

One Worker serves the page and answers `/api/probe`, `/api/models` and `/api/quota`. That is the complete deployment, and it is what makes every gateway reachable, because the request leaves from a server instead of the browser.

Optionally lock it down to specific upstream hosts:

```bash
npx wrangler deploy --var ALLOWED_HOSTS:"api.openai.com,api.anthropic.com,my-gateway.example.com"
```

### 3. Or host the page anywhere and keep the Worker

The page is a single static file with no build step, so it runs on GitHub Pages, Netlify, Vercel, S3, or a folder on a web server. Publish `public/`.

Without a Worker on the same origin, the app falls back to calling the gateway straight from the browser. That only works for gateways that send CORS headers. The status lamp in the toolbar says which mode is active, and it explains itself when clicked.

For a same-origin proxy behind nginx:

```nginx
server {
    listen 8899;
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;
    }
}
```

## How a measurement is taken

One probe is one request per key.

```
browser  --POST /api/probe-->  worker  --POST {{baseUrl}}{{path}}-->  gateway
```

The Worker wraps the upstream call in `performance.now()` and returns:

| Field | Meaning |
|---|---|
| `ttfbMs` | time until the gateway's response headers arrive |
| `ttftMs` | time until the first content chunk, when streaming is on |
| `totalMs` | time until the whole reply is read |
| `clientMs` | the browser's own round trip, measured separately |
| `overheadMs` | `clientMs - totalMs`, so the network cost is visible |
| `promptTokens`, `completionTokens`, `totalTokens` | read from the gateway `usage` block, never estimated |
| `decodeTps` | `completionTokens / (totalMs - ttftMs)`, the decode rate |
| `endToEndTps` | `totalTokens / totalMs`, the rate a caller actually feels |

`n/a` appears wherever the gateway did not report a number. Nothing is filled in.

## Universality, in detail

Presets exist to save typing, not to constrain. The fields that matter:

| Field | Default | Why it exists |
|---|---|---|
| Base URL | none | any gateway |
| Request path | `/v1/chat/completions` | `{{model}}` is substituted, which covers Gemini's path style |
| Models path | `/v1/models` | any list endpoint |
| Auth header | `Authorization: Bearer` | also `x-api-key`, `api-key`, `x-goog-api-key`, a custom header name, or none |
| Extra headers | empty | as JSON, for gateways that want a referer or a version pin |
| Request body template | OpenAI chat shape | substitution tokens `{{model}}` `{{prompt}}` `{{maxTokens}}` `{{stream}}` |
| Response pointers | OpenAI shape | dot paths with array indexes, for example `candidates[0].content.parts[0].text` |
| Balance path | empty | tries the usual paths, or use your own |

A gateway that returns `{"result":[{"model_name":"x"}]}` for its list is handled by the pointer fallbacks. One that wants `{"contents":[{"parts":[{"text":"..."}]}]}` is one preset away.

## Privacy

Keys live in the browser tab. They are sent only to the base URL you name, or through your own proxy, and the Worker keeps no state, writes no logs, and caches nothing. The endpoint key field is optional and only used for the model list and the balance read.

## Rules this build follows

`DESIGN.md` records the design direction and, for every rule it resolves, which way it went and why. The short version:

- Zero gradients, zero emoji, zero em dashes. Icons are hand authored SVG on a 24 grid with square caps, and each one names a real object on screen.
- Archivo for interface, IBM Plex Mono for every number, so measurement columns align digit for digit.
- Bone and graphite ground with a single vermilion accent. Status colours are semantic, not decorative.
- Three radii assigned by role, one shadow on the sticky toolbar only.
- Empty, loading and error states on every data surface.
- AA contrast or better on every text pair. The ratios are computed in `DESIGN.md`.
- Light and dark both shipped and both verified.

## Verification

Recorded from a real run against a live gateway, in a browser, on the built artifact. Not a description of intent.

| Check | Result |
|---|---|
| Parse a mixed pile | 6 lines in, 5 unique keys out, 0 duplicates, 1 prose line reported by name |
| Comments and `<!-- -->` | skipped, not counted as failures |
| Real key probe | `ok: true`, 200, `usage` read, tokens and tok/s populated |
| Invalid keys | reported as `rejected` with the gateway's own message in the row |
| Timing honesty | gateway total 2729.85 ms, client round trip 2738.2 ms, overhead 8.35 ms shown separately |
| Tokens | prompt 2019, output 8, total 2027, source `upstream` |
| Emoji, em dashes, gradients | 0, 0, 0 |
| Horizontal overflow at 390 px | 0 px |
| Tap targets at 390 px | every control 44 px, the model checkbox sits inside a full width label |
| Console errors | 0 |
| Empty, loading, error states | all three present and reachable |

## Licence

MIT. See `LICENSE`.
