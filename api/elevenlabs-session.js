const ELEVENLABS_API = "https://api.elevenlabs.io";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

async function elevenLabs(path, apiKey) {
  return fetch(`${ELEVENLABS_API}${path}`, {
    headers: {
      accept: "application/json",
      "xi-api-key": apiKey
    },
    signal: AbortSignal.timeout(15000)
  });
}

async function listVoices(apiKey) {
  if (!apiKey) return [];
  const response = await elevenLabs("/v2/voices?page_size=40&sort=name&sort_direction=asc&include_total_count=false", apiKey);
  if (!response.ok) return [];
  const data = await response.json();
  return (data.voices || []).map(voice => ({
    id: voice.voice_id,
    name: voice.name,
    category: voice.category || voice.labels?.use_case || "",
    previewUrl: voice.preview_url || ""
  }));
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
  const agentId = String(process.env.ELEVENLABS_AGENT_ID || "").trim();
  if (!agentId) {
    json(res, 503, {
      configured: false,
      error: "ELEVENLABS_AGENT_ID is not configured in Vercel."
    });
    return;
  }

  try {
    if (req.method === "GET") {
      const voices = await listVoices(apiKey);
      json(res, 200, {
        configured: true,
        agentId,
        voices,
        warning: apiKey
          ? voices.length ? "" : "The agent is ready, but this API key cannot list workspace voices."
          : "The public agent will be used with its configured voice."
      });
      return;
    }

    if (!apiKey) {
      json(res, 200, {
        configured: true,
        agentId,
        warning: "Using the public ElevenLabs agent connection."
      });
      return;
    }

    const query = new URLSearchParams({
      agent_id: agentId,
      include_conversation_id: "true"
    });
    const response = await elevenLabs(`/v1/convai/conversation/get-signed-url?${query}`, apiKey);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.signed_url) {
      json(res, 200, {
        configured: true,
        agentId,
        warning: data.detail?.message || data.detail || "Signed connection unavailable; trying the public agent."
      });
      return;
    }

    json(res, 200, {
      configured: true,
      signedUrl: data.signed_url,
      conversationId: data.conversation_id || null
    });
  } catch (error) {
    json(res, 502, {
      configured: false,
      error: error?.name === "TimeoutError"
        ? "ElevenLabs did not respond in time."
        : "VEIL could not create an ElevenLabs voice session."
    });
  }
};
