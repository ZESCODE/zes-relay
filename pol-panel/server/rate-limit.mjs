/**
 * rate-limit.mjs — fixed-window counters per key (IP, or IP+route).
 * Small, dependency-free, and good enough for a single-process sidecar.
 */

const buckets = new Map();
let sweepTimer = null;

function sweep() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function startSweeper(intervalMs = 60_000) {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, intervalMs);
  sweepTimer.unref?.();
}

export function resetLimiter() {
  buckets.clear();
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs
 * @param {number} opts.max
 * @param {string} opts.name
 * @param {(req:import('express').Request)=>string} [opts.key]
 */
export function rateLimit({ windowMs, max, name, key }) {
  startSweeper();
  return function rateLimitMiddleware(req, res, next) {
    const id = key ? key(req) : req.ip || "unknown";
    const bucketKey = `${name}:${id}`;
    const now = Date.now();
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: {
          code: "rate_limited",
          message: `${name} rate limit exceeded (${max}/${Math.round(windowMs / 1000)}s). Retry in ${retryAfter}s.`,
        },
      });
    }
    next();
  };
}

export function limiterStats() {
  return { buckets: buckets.size };
}
