// In-memory request limits. One Render instance serves the pilot, so process
// memory is the right store; move to Redis only if the API is ever scaled out.
//
// Three tools:
//   rateLimit    — N requests per window per key (per shop, per IP, ...)
//   concurrency  — at most N requests in flight per key (paid audio calls)
//   lockout      — count FAILURES per key and refuse further tries for a while
//                  (guessing shop codes)

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Fixed windows are good enough here and need no timers: expired buckets are
// swept lazily so the Map cannot grow without bound.
function makeWindowCounter(windowMs) {
  const buckets = new Map();
  let lastSweep = Date.now();
  return function hit(key) {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      lastSweep = now;
    }
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    return b;
  };
}

function tooMany(res, resetAt, message) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.set("Retry-After", String(retryAfter));
  return res.status(429).json({
    error: message || "Bahut zyada requests — thodi der baad try karein.",
    retry_after: retryAfter,
  });
}

/**
 * rateLimit({ windowMs, max, key, message })
 * `key(req)` returns the bucket name; a falsy key skips the limit.
 */
function rateLimit({ windowMs, max, key = clientIp, message }) {
  const hit = makeWindowCounter(windowMs);
  return function rateLimitMiddleware(req, res, next) {
    const k = key(req);
    if (!k) return next();
    const bucket = hit(k);
    if (bucket.count > max) return tooMany(res, bucket.resetAt, message);
    next();
  };
}

/** concurrency({ max, key }) — released when the response finishes or drops. */
function concurrency({ max, key = clientIp, message }) {
  const inFlight = new Map();
  return function concurrencyMiddleware(req, res, next) {
    const k = key(req);
    if (!k) return next();
    const current = inFlight.get(k) || 0;
    if (current >= max) {
      res.set("Retry-After", "2");
      return res.status(429).json({
        error: message || "Pichli awaaz abhi process ho rahi hai — ek second ruk kar bolein.",
        retry_after: 2,
      });
    }
    inFlight.set(k, current + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (inFlight.get(k) || 1) - 1;
      if (n <= 0) inFlight.delete(k);
      else inFlight.set(k, n);
    };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
}

/**
 * lockout({ windowMs, maxFailures }) -> { check(req, res), fail(req) }
 * check() answers 429 and returns true when the caller is locked out.
 */
function lockout({ windowMs, maxFailures }) {
  const hit = makeWindowCounter(windowMs);
  const peek = new Map(); // key -> bucket, mirrors hit() for read-only checks
  return {
    check(req, res) {
      const b = peek.get(clientIp(req));
      if (b && b.resetAt > Date.now() && b.count >= maxFailures) {
        tooMany(res, b.resetAt, "Bahut galat code try hue — thodi der baad dobara try karein.");
        return true;
      }
      return false;
    },
    fail(req) {
      const k = clientIp(req);
      peek.set(k, hit(k));
      if (peek.size > 5000) {
        const now = Date.now();
        for (const [key, b] of peek) if (b.resetAt <= now) peek.delete(key);
      }
    },
  };
}

module.exports = { rateLimit, concurrency, lockout, clientIp };
