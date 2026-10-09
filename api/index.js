import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3001);
const PRICE_TO_PLAN = new Map([
  [process.env.PADDLE_PRICE_PLUS, "Plus"],
  [process.env.PADDLE_PRICE_PRO, "Pro"],
  [process.env.PADDLE_PRICE_MAX, "Max"],
].filter(([id]) => Boolean(id)));

const processed = new Set();

function send(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, paddle-signature",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(data));
}

async function rawBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200000) throw new Error("payload_too_large");
  }
  return raw;
}

function verifyPaddle(raw, header) {
  const secret = String(process.env.PADDLE_WEBHOOK_SECRET || "");
  if (!secret) return { ok: false, reason: "webhook_secret_not_configured" };
  let ts = null;
  const h1 = [];
  for (const part of String(header || "").split(";")) {
    const [k, v] = part.split("=");
    if (k === "ts") ts = Number(v);
    if (k === "h1" && v) h1.push(v);
  }
  if (!Number.isFinite(ts) || !h1.length) return { ok: false, reason: "missing_signature" };
  if (Math.abs(Math.floor(Date.now()/1000) - ts) > 300) return { ok: false, reason: "signature_too_old" };
  const expected = crypto.createHmac("sha256", secret).update(`${ts}:${raw}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  const valid = h1.some(sig => {
    try {
      const actual = Buffer.from(sig, "hex");
      return actual.length === expectedBuf.length && crypto.timingSafeEqual(actual, expectedBuf);
    } catch {
      return false;
    }
  });
  return valid ? { ok: true } : { ok: false, reason: "invalid_signature" };
}

function firstPriceId(data) {
  for (const item of Array.isArray(data?.items) ? data.items : []) {
    const id = item?.price?.id || item?.price_id || item?.priceId;
    if (id) return String(id);
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "saldo-slim-api",
      environment: "production",
      webhookConfigured: Boolean(process.env.PADDLE_WEBHOOK_SECRET),
      paddlePricesConfigured: PRICE_TO_PLAN.size === 3
    });
  }

  if (req.method === "POST" && url.pathname === "/billing/paddle/webhook") {
    try {
      const raw = await rawBody(req);
      const verification = verifyPaddle(raw, req.headers["paddle-signature"]);
      if (!verification.ok) return send(res, 401, verification);

      const event = raw ? JSON.parse(raw) : {};
      const eventId = String(event.event_id || "");
      if (eventId && processed.has(eventId)) return send(res, 200, { ok: true, duplicate: true });
      if (eventId) processed.add(eventId);

      const data = event.data || {};
      const priceId = firstPriceId(data);
      const plan = PRICE_TO_PLAN.get(priceId) || null;
      const userId = String(data?.custom_data?.saldo_slim_user_id || data?.custom_data?.user_id || "") || null;

      console.log(JSON.stringify({
        at: new Date().toISOString(),
        eventId,
        eventType: event.event_type || null,
        transactionId: String(event.event_type || "").startsWith("transaction.") ? data?.id || null : data?.transaction_id || null,
        subscriptionId: data?.subscription_id || (String(event.event_type || "").startsWith("subscription.") ? data?.id || null : null),
        priceId,
        plan,
        userId
      }));

      return send(res, 200, { ok: true, received: true, eventId, plan, linkedUser: Boolean(userId) });
    } catch (error) {
      console.error(error);
      return send(res, 500, { ok: false, error: "internal_error" });
    }
  }

  return send(res, 404, { error: "not_found" });
});

server.listen(PORT, () => console.log(`Saldo Slim API listening on ${PORT}`));
