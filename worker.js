
/* ============================================================
 * NAKORNPING DOCUMENT — LINE WEBHOOK WORKER
 * Version 2.1.0
 *
 * LINE → CLOUDFLARE WORKER → GOOGLE APPS SCRIPT
 *
 * Features:
 * 1. Health Check
 * 2. LINE Signature Verification (HMAC-SHA256)
 * 3. Constant-time Signature Comparison
 * 4. GAS Authentication
 * 5. Webhook Verification
 * 6. Configuration Diagnostics
 * 7. Error Handling
 * ============================================================ */

const CONFIG = Object.freeze({
  APP_NAME: "Nakornping Document Worker",
  VERSION: "2.1.0",
  WEBHOOK_PATH: "/webhook",
  MAX_BODY_SIZE: 1024 * 1024,
  GAS_HOST: "script.google.com"
});

// ============================================================
// 1. RESPONSE HELPER
// ============================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function textResponse(message, status = 200) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

// ============================================================
// 2. CONSTANT-TIME STRING COMPARISON
// ============================================================

function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();

  const x = encoder.encode(a);
  const y = encoder.encode(b);

  let diff = x.length ^ y.length;

  const maxLength = Math.max(x.length, y.length);

  for (let i = 0; i < maxLength; i++) {
    diff |= (x[i] || 0) ^ (y[i] || 0);
  }

  return diff === 0;
}

// ============================================================
// 3. VERIFY LINE SIGNATURE
// ============================================================

async function verifyLineSignature(body, signature, secret) {

  if (!body || !signature || !secret) {
    return false;
  }

  try {

    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

    const hash = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body)
    );

    const expected = btoa(
      String.fromCharCode(...new Uint8Array(hash))
    );

    return constantTimeEqual(signature, expected);

  } catch (error) {

    console.error(
      "[LINE] Signature verification error:",
      error?.message || String(error)
    );

    return false;
  }
}

// ============================================================
// 4. VALIDATE GAS URL
// ============================================================

function validateGasUrl(value) {

  try {

    const url = new URL(value);

    if (url.protocol !== "https:") {
      return false;
    }

    if (url.hostname !== CONFIG.GAS_HOST) {
      return false;
    }

    if (!/^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname)) {
      return false;
    }

    return true;

  } catch (error) {

    return false;
  }
}

// ============================================================
// 5. HEALTH CHECK
// ============================================================

function healthCheck() {

  return jsonResponse({
    success: true,
    service: CONFIG.APP_NAME,
    version: CONFIG.VERSION,
    status: "running",
    timestamp: new Date().toISOString()
  });
}

// ============================================================
// 6. MAIN WEBHOOK HANDLER
// ============================================================

async function handleWebhook(request, env) {

  // ----------------------------------------------------------
  // 6.1 Check LINE Configuration
  // ----------------------------------------------------------

  if (!env.LINE_CHANNEL_SECRET) {

    console.error(
      "[CONFIG] Missing LINE_CHANNEL_SECRET"
    );

    return textResponse(
      "Worker Configuration Error: LINE_CHANNEL_SECRET",
      500
    );
  }

  // ----------------------------------------------------------
  // 6.2 Get LINE Signature
  // ----------------------------------------------------------

  const signature = request.headers.get(
    "x-line-signature"
  );

  if (!signature) {

    console.warn(
      "[LINE] Missing LINE Signature"
    );

    return textResponse(
      "Missing LINE Signature",
      401
    );
  }

  // ----------------------------------------------------------
  // 6.3 Read Request Body
  // ----------------------------------------------------------

  const contentLength = Number(
    request.headers.get("content-length") || 0
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > CONFIG.MAX_BODY_SIZE
  ) {

    return textResponse(
      "Payload Too Large",
      413
    );
  }

  const body = await request.text();

  if (
    new TextEncoder().encode(body).length >
    CONFIG.MAX_BODY_SIZE
  ) {

    return textResponse(
      "Payload Too Large",
      413
    );
  }

  // ----------------------------------------------------------
  // 6.4 Verify LINE Signature
  // ----------------------------------------------------------

  const signatureValid = await verifyLineSignature(
    body,
    signature,
    env.LINE_CHANNEL_SECRET
  );

  if (!signatureValid) {

    console.error(
      "[LINE] Invalid Signature"
    );

    return textResponse(
      "Invalid LINE Signature",
      401
    );
  }

  console.log(
    "[LINE] Signature Verified"
  );

  // ----------------------------------------------------------
  // 6.5 Parse JSON
  // ----------------------------------------------------------

  let payload;

  try {

    payload = JSON.parse(body);

  } catch (error) {

    console.error(
      "[LINE] Invalid JSON Payload"
    );

    return textResponse(
      "Invalid JSON",
      400
    );
  }

  if (
    !payload ||
    !Array.isArray(payload.events)
  ) {

    return textResponse(
      "Invalid Webhook Payload",
      400
    );
  }

  // ----------------------------------------------------------
  // 6.6 LINE Webhook Verify
  // ----------------------------------------------------------

  // LINE Verify sends an empty events array.
  // Signature must still be verified before returning 200.

  if (payload.events.length === 0) {

    console.log(
      "[LINE] WEBHOOK VERIFY SUCCESS"
    );

    return textResponse(
      "OK",
      200
    );
  }

  // ----------------------------------------------------------
  // 6.7 Check GAS Configuration
  // ----------------------------------------------------------

  if (!env.GAS_WEB_APP_URL) {

    console.error(
      "[CONFIG] Missing GAS_WEB_APP_URL"
    );

    return textResponse(
      "GAS Configuration Error: GAS_WEB_APP_URL",
      500
    );
  }

  if (!env.GAS_WEBHOOK_SECRET) {

    console.error(
      "[CONFIG] Missing GAS_WEBHOOK_SECRET"
    );

    return textResponse(
      "GAS Configuration Error: GAS_WEBHOOK_SECRET",
      500
    );
  }

  // ----------------------------------------------------------
  // 6.8 Validate GAS URL
  // ----------------------------------------------------------

  if (!validateGasUrl(env.GAS_WEB_APP_URL)) {

    console.error(
      "[CONFIG] Invalid GAS_WEB_APP_URL"
    );

    return textResponse(
      "Invalid Google Apps Script URL",
      500
    );
  }

  // ----------------------------------------------------------
  // 6.9 Prepare GAS Request
  // ----------------------------------------------------------

  const gasUrl = new URL(
    env.GAS_WEB_APP_URL
  );

  // Maintain compatibility with the existing GAS code.
  // GAS should read the secret from doPost(e).parameter.key

  gasUrl.searchParams.set(
    "key",
    env.GAS_WEBHOOK_SECRET
  );

  // ----------------------------------------------------------
  // 6.10 Forward to Google Apps Script
  // ----------------------------------------------------------

  let gasResponse;

  try {

    gasResponse = await fetch(
      gasUrl.toString(),
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: body,

        redirect: "follow"
      }
    );

  } catch (error) {

    console.error(
      "[GAS] Fetch Failed:",
      error?.message || String(error)
    );

    return textResponse(
      "Google Apps Script Connection Failed",
      502
    );
  }

  // ----------------------------------------------------------
  // 6.11 Check GAS Response
  // ----------------------------------------------------------

  if (!gasResponse.ok) {

    console.error(
      "[GAS] HTTP ERROR:",
      gasResponse.status
    );

    return textResponse(
      "Google Apps Script Error",
      502
    );
  }

  // ----------------------------------------------------------
  // 6.12 SUCCESS
  // ----------------------------------------------------------

  console.log(
    "[SYSTEM] LINE WEBHOOK SUCCESS"
  );

  return textResponse(
    "OK",
    200
  );
}

// ============================================================
// 7. CLOUDFLARE WORKER ENTRY POINT
// ============================================================

export default {

  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    // --------------------------------------------------------
    // 7.1 Health Check
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {

      return healthCheck();
    }

    // --------------------------------------------------------
    // 7.2 Webhook Path Validation
    // --------------------------------------------------------

    if (url.pathname !== CONFIG.WEBHOOK_PATH) {

      return textResponse(
        "Not Found",
        404
      );
    }

    // --------------------------------------------------------
    // 7.3 Method Validation
    // --------------------------------------------------------

    if (request.method !== "POST") {

      return textResponse(
        "Method Not Allowed",
        405
      );
    }

    // --------------------------------------------------------
    // 7.4 Process Webhook
    // --------------------------------------------------------

    try {

      return await handleWebhook(
        request,
        env
      );

    } catch (error) {

      console.error(
        "[WORKER] UNHANDLED ERROR:",
        error?.stack || error?.message || String(error)
      );

      return textResponse(
        "Internal Server Error",
        500
      );
    }
  }
};
