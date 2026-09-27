/**

- csrf-json-fetch.js
- 
- Hardened JSON fetch for same-origin APIs protected by synchronizer-token
- CSRF. A variant of this module runs in production on thedjcalendar.com.
- 
- Behaviors:
- 
  - fetches the CSRF token once, caches it, and re-fetches on expiry signals
- 
  - injects the token in BOTH the X-CSRF-Token header and the JSON body,
- so the call survives either server-side check
- 
  - retries exactly once on a token-expiry response, never on real errors
- 
  - never throws: resolves a typed result object the caller can branch on
- 
  - zero dependencies
     */

var CSRF_TOKEN_URL   = '/csrf-token.php';
var CSRF_BODY_FIELD  = 'csrf_token';
var CSRF_HEADER      = 'X-CSRF-Token';
var EXPIRY_STATUS    = { 403: true, 419: true };

var cachedToken = null;
var tokenPromise = null;

function fetchToken() {
  if (cachedToken) {
    return Promise.resolve(cachedToken);
  }
  if (!tokenPromise) {
    tokenPromise = fetch(CSRF_TOKEN_URL, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) { throw new Error('csrf token fetch failed: ' + res.status); }
        return res.json();
      })
      .then(function (data) {
        cachedToken = (data && data.token) ? data.token : null;
        return cachedToken;
      })
      .then(function (t) { tokenPromise = null; return t; },
            function (e) { tokenPromise = null; throw e; });
  }
  return tokenPromise;
}

function dropToken() {
  cachedToken = null;
}

/**

- postJson(url, payload, options) -> Promise
- 
- result: { ok: boolean, status: number, data: Object|null, error: string|null }
   */
  function postJson(url, payload, options) {
    options = options || {};
    return fetchToken()
   .then(function (token) {
     return sendOnce(url, payload, token, options);
   })
   .then(function (res) {
     if (!res.ok && EXPIRY_STATUS[res.status]) {
   // The token went stale between page load and this call. Drop the
   // cache, mint a fresh one, retry exactly once. A second failure is
   // a real error, not a token problem - surface it instead of looping.
   dropToken();
   return fetchToken().then(function (fresh) {
     return sendOnce(url, payload, fresh, options);
   });
     }
     return res;
   })
   .catch(function (err) {
     return { ok: false, status: 0, data: null, error: String((err && err.message) || err) };
   });
  }

function sendOnce(url, payload, token, options) {
  var body = {};
  var key;
  for (key in (payload || {})) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      body[key] = payload[key];
    }
  }
  body[CSRF_BODY_FIELD] = token;

  var ctrl  = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl
    ? setTimeout(function () { ctrl.abort(); }, options.timeoutMs || 15000)
    : null;

  var headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  headers[CSRF_HEADER] = token;

  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: headers,
    body: JSON.stringify(body),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function (res) {
    if (timer) { clearTimeout(timer); }
    return res.json().then(function (data) {
      return { ok: res.ok, status: res.status, data: data, error: res.ok ? null : ('http ' + res.status) };
    }, function () {
      // Non-JSON body (e.g. an HTML error page): still a valid HTTP result.
      return { ok: res.ok, status: res.status, data: null, error: res.ok ? null : ('http ' + res.status) };
    });
  }, function (err) {
    if (timer) { clearTimeout(timer); }
    return { ok: false, status: 0, data: null, error: String((err && err.message) || err) };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { postJson: postJson, _dropToken: dropToken };
}
