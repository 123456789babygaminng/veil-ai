const { Readable } = require("node:stream");

const UPSTREAM = "https://unlimited.surf";
const UPSTREAM_TIMEOUT_MS = 240000;
const UPSTREAM_ATTEMPTS = 2;

function copyRequestHeaders(req) {
  const headers = {
    accept: req.headers.accept || "text/event-stream, application/json",
    "content-type": req.headers["content-type"] || "application/json",
    "user-agent": req.headers["user-agent"] || "VEIL-Web"
  };
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  return headers;
}

function copyResponseHeaders(upstream, res) {
  const allowed = [
    "content-type",
    "cache-control",
    "content-disposition",
    "x-request-id",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset"
  ];
  for (const name of allowed) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  setCorsHeaders(res);
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id, Content-Disposition");
}

function requestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body === undefined || req.body === null) return undefined;
  return typeof req.body === "string" || Buffer.isBuffer(req.body)
    ? req.body
    : JSON.stringify(req.body);
}

async function proxy(req, res, pathname) {
  const method = req.method || "GET";
  const body = requestBody(req);
  const headers = copyRequestHeaders(req);
  let upstream;
  let lastError;

  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt += 1) {
    try {
      upstream = await fetch(`${UPSTREAM}${pathname}`, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
      if (![502, 503, 504].includes(upstream.status) || attempt === UPSTREAM_ATTEMPTS) break;
    } catch (error) {
      lastError = error;
      if (attempt === UPSTREAM_ATTEMPTS) throw error;
    }
  }

  if (!upstream && lastError) throw lastError;

  res.statusCode = upstream.status;
  copyResponseHeaders(upstream, res);

  if (!upstream.body || method === "HEAD") {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

function createProxy(pathname, methods = ["GET", "POST"]) {
  return async function veilProxy(req, res) {
    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!methods.includes(req.method)) {
      res.statusCode = 405;
      res.setHeader("Allow", methods.join(", "));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      await proxy(req, res, pathname);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      res.statusCode = error?.name === "TimeoutError" ? 504 : 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        error: error?.name === "TimeoutError"
          ? "The VEIL model request timed out."
          : "VEIL could not reach the model service."
      }));
    }
  };
}

module.exports = { createProxy };
