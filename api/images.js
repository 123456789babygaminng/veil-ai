const { Readable } = require("node:stream");

const UPSTREAM = "https://subnp.com";
const TIMEOUT_MS = 180000;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Type, Cache-Control");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function readBody(req) {
  if (req.body === undefined || req.body === null) return "";
  return typeof req.body === "string" || Buffer.isBuffer(req.body)
    ? req.body
    : JSON.stringify(req.body);
}

module.exports = async function images(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === "GET") {
      const imageUrl = req.query?.url;
      if (imageUrl) {
        const parsed = new URL(imageUrl, UPSTREAM);
        if (parsed.origin !== UPSTREAM || !parsed.pathname.startsWith("/api/image/")) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ success: false, error: "Unsupported image URL" }));
          return;
        }
        const upstreamImage = await fetch(parsed.href, {
          headers: { accept: "image/*" },
          signal: AbortSignal.timeout(60000)
        });
        res.statusCode = upstreamImage.status;
        res.setHeader("Content-Type", upstreamImage.headers.get("content-type") || "image/png");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        if (!upstreamImage.body) {
          res.end();
          return;
        }
        Readable.fromWeb(upstreamImage.body).pipe(res);
        return;
      }

      const upstream = await fetch(`${UPSTREAM}/api/free/models`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30000)
      });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(text);
      return;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, POST, OPTIONS");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
      return;
    }

    const upstream = await fetch(`${UPSTREAM}/api/free/generate`, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        "user-agent": req.headers["user-agent"] || "VEIL-Images"
      },
      body: readBody(req),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.statusCode = error?.name === "TimeoutError" ? 504 : 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      success: false,
      error: error?.name === "TimeoutError"
        ? "The image generation request timed out."
        : "VEIL could not reach the image generation service."
    }));
  }
};
