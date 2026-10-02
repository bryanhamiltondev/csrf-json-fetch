# csrf-json-fetch

![CI](https://github.com/bryanhamiltondev/csrf-json-fetch/actions/workflows/ci.yml/badge.svg)

**Hardened JSON fetch for same-origin APIs protected by synchronizer-token CSRF.** A variant of this module handles every POST request on [thedjcalendar.com](https://thedjcalendar.com) — newsletter signups, alert subscriptions, venue submissions — all protected by double-submission CSRF tokens, all zero dependencies.

---

## The problem it solves

Sending JSON to an API that validates CSRF tokens sounds simple: grab the token, slap it in a header, done. Then your production logs show four failure modes that a naive implementation misses:

1. **The token race.** Page loads, two components fire POSTs at once. Both fetch the token, both get it, both succeed — but you made two round-trips to `/csrf-token.php` instead of one. With a cached token and a shared in-flight Promise, concurrent callers share the same token fetch.

2. **The stale token.** User opens a tab, walks away for coffee, comes back 30 minutes later and hits submit. The session expired. The server returns 419. The naive approach fails the request. `postJson` detects the expiry code, drops the cached token, fetches a fresh one, and retries exactly once.

3. **The server-side inconsistency.** Some endpoints check the `X-CSRF-Token` header, some unwrap the token from the JSON body, some check both. `postJson` injects the token in **both places** — your API can check whichever it prefers without a second deployment.

4. **The silent failure.** A fetch that throws (network error, CORS block, timeout) produces a rejected promise that, if unhandled, is a red console error or a crashed UI. `postJson` never throws: every path resolves a typed result object the caller can branch on.

---

## Usage

```js
postJson('/api/subscribe', {
  email: 'dj@example.com',
  city:  'nyc'
}).then(function (res) {
  if (res.ok) {
    // res.data -> the JSON response body
    showSuccess(res.data.message);
  } else if (res.status === 422) {
    // res.data -> validation errors from the server
    showErrors(res.data.errors);
  } else {
    // res.error -> human-readable string
    showError(res.error);
  }
});
```

### Configuration

```js
// Defaults — override before calling postJson
CSRF_TOKEN_URL  = '/csrf-token.php';   // endpoint that returns {"token":"..."}
CSRF_BODY_FIELD = 'csrf_token';        // JSON body key
CSRF_HEADER     = 'X-CSRF-Token';      // request header key
EXPIRY_STATUS   = { 403: true, 419: true };  // status codes that trigger a retry
```

### Options

```js
postJson(url, payload, {
  timeoutMs: 10000  // AbortController timeout (default 15000)
});
```

### Result shape

Every call resolves one of:

| ok | status | data | error | Meaning |
|----|--------|------|-------|---------|
| true | 200-299 | Object | null | Success |
| false | 4xx/5xx | Object or null | "http 422" | Server error (with body if JSON) |
| false | 0 | null | "Failed to fetch" | Network / CORS / timeout |

---

## Design decisions

| Decision | Why |
|----------|-----|
| **Dual token injection (header + body)** | The server team (or your future self) can migrate between check strategies without redeploying the client. |
| **Single retry on 403/419 only** | Retrying on every 4xx would mask real bugs. Token expiry is the *one* transient error that session semantics guarantee is safe to retry. |
| **Shared in-flight Promise for token fetch** | Prevents the "two widgets, two token requests" race with zero coordination code at the call site. |
| **Never throws** | An unhandled rejected promise is a UI crash. A result object the caller can `if (res.ok)` on is the vanilla-JS equivalent of a typed `Result<T, E>`. |
| **AbortController timeout** | A fetch that hangs forever ties up connection pools on mobile. 15s default, configurable per-call. |
| **Zero dependencies** | This module ships as a single file that a `<script>` tag or `require()` can consume. No build step, no lockfile. |

---

## Scope

Pattern implementation, published as-is. The production site configures its own endpoint URLs and expiry status codes. This repo is the contract — the CSRF dance, the retry logic, the typed result — not the server-side token generator.

---

## Related

- [instant-search-index](https://github.com/bryanhamiltondev/instant-search-index) — client-side search with a prebuilt JSON index, the other half of thedjcalendar.com's front-end architecture
- [sri-lazy-loader](https://github.com/bryanhamiltondev/sri-lazy-loader) — race-safe lazy script loader with SRI, used alongside this module on production pages
