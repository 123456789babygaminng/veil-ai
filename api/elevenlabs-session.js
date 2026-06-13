function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

async function elevenLabsRequest(path, apiKey, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(`https://api.elevenlabs.io${path}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "xi-api-key": apiKey } : {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function responseError(response, fallback) {
  let detail = "";
  try {
    const data = await response.json();
    detail = data?.detail?.message || data?.detail || data?.message || data?.error || "";
  } catch {
    detail = await response.text().catch(() => "");
  }
  return new Error(`${fallback} (${response.status})${detail ? `: ${String(detail).slice(0, 240)}` : ""}`);
}

async function createPrivateSession(agentId, apiKey) {
  const params = new URLSearchParams({ agent_id: agentId });
  const tokenResponse = await elevenLabsRequest(
    `/v1/convai/conversation/token?${params.toString()}`,
    apiKey
  );
  if (tokenResponse.ok) {
    const data = await tokenResponse.json();
    if (data.token) return { conversationToken: data.token, transport: "webrtc" };
  }

  const signedPaths = [
    `/v1/convai/conversation/get-signed-url?${params.toString()}`,
    `/v1/convai/conversation/get_signed_url?${params.toString()}`
  ];
  let lastResponse = tokenResponse;
  for (const path of signedPaths) {
    const response = await elevenLabsRequest(path, apiKey);
    lastResponse = response;
    if (!response.ok) continue;
    const data = await response.json();
    if (data.signed_url) return { signedUrl: data.signed_url, transport: "websocket" };
  }
  throw await responseError(lastResponse, "ElevenLabs could not create a conversation session");
}

module.exports = async function elevenLabsSessionHandler(req, res) {
  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return send(res, 405, { error: "Method not allowed" });
  }

  const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
  const agentId = String(process.env.ELEVENLABS_AGENT_ID || "").trim();

  if (!agentId) {
    return send(res, 503, {
      configured: false,
      code: "missing_agent_id",
      error: "Add ELEVENLABS_AGENT_ID in the Vercel environment variables and redeploy."
    });
  }

  if (req.method === "GET") {
    if (!apiKey) {
      return send(res, 200, {
        configured: true,
        publicAgent: true,
        agentId,
        voices: [],
        warning: "No ElevenLabs API key is configured. The agent default voice will be used."
      });
    }
    try {
      let response = await elevenLabsRequest("/v2/voices?page_size=100", apiKey);
      if (!response.ok) response = await elevenLabsRequest("/v1/voices", apiKey);
      if (!response.ok) throw await responseError(response, "Could not load ElevenLabs voices");
      const data = await response.json();
      const voices = Array.isArray(data.voices)
        ? data.voices
          .filter(voice => voice?.voice_id && voice?.name)
          .slice(0, 80)
          .map(voice => ({
            id: String(voice.voice_id),
            name: String(voice.name),
            category: String(voice.category || "")
          }))
        : [];
      return send(res, 200, {
        configured: true,
        publicAgent: false,
        voices
      });
    } catch (error) {
      console.error("Could not load ElevenLabs voices", error);
      return send(res, 200, {
        configured: true,
        publicAgent: false,
        voices: [],
        warning: "Voices could not be loaded. The agent default voice is still available."
      });
    }
  }

  if (!apiKey) {
    return send(res, 200, {
      configured: true,
      publicAgent: true,
      agentId,
      transport: "public"
    });
  }

  try {
    const session = await createPrivateSession(agentId, apiKey);
    return send(res, 200, {
      configured: true,
      publicAgent: false,
      ...session
    });
  } catch (error) {
    console.error("Could not create ElevenLabs voice session", error);
    return send(res, 502, {
      configured: true,
      code: "session_failed",
      error: error?.message || "Could not create voice session"
    });
  }
};
