
/* ============================================================
 * NAKORNPING DOCUMENT — LINE WEBHOOK WORKER
 * Version 2.0.0
 *
 * LINE → CLOUDFLARE WORKER → GOOGLE APPS SCRIPT
 * ============================================================ */

const CONFIG = {
  APP_NAME: "Nakornping Document Worker",
  VERSION: "2.0.0",
  WEBHOOK_PATH: "/webhook"
};

export default {

  async fetch(request, env, ctx) {

    const url = new URL(request.url);

    // ========================================================
    // 1. HEALTH CHECK
    // ========================================================

    if (request.method === "GET") {

      return new Response(
        JSON.stringify({
          success: true,
          service: CONFIG.APP_NAME,
          version: CONFIG.VERSION,
          status: "running"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=UTF-8"
          }
        }
      );
    }

    // ========================================================
    // 2. METHOD VALIDATION
    // ========================================================

    if (request.method !== "POST") {

      return new Response("Method Not Allowed", {
        status: 405
      });
    }

    if (url.pathname !== CONFIG.WEBHOOK_PATH) {

      return new Response("Not Found", {
        status: 404
      });
    }

    try {

      // ======================================================
      // 3. CHECK LINE CHANNEL SECRET
      // ======================================================

      if (!env.LINE_CHANNEL_SECRET) {

        console.error("Missing LINE_CHANNEL_SECRET");

        return new Response("Worker Configuration Error", {
          status: 500
        });
      }

      // ======================================================
      // 4. GET SIGNATURE AND BODY
      // ======================================================

      const signature = request.headers.get(
        "x-line-signature"
      );

      if (!signature) {

        return new Response("Missing LINE Signature", {
          status: 401
        });
      }

      const body = await request.text();

      // ======================================================
      // 5. VERIFY LINE SIGNATURE — HMAC SHA256
      // ======================================================

      const encoder = new TextEncoder();

      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(env.LINE_CHANNEL_SECRET),
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

      const expectedSignature = btoa(
        String.fromCharCode(
          ...new Uint8Array(hash)
        )
      );

      if (signature !== expectedSignature) {

        console.error("LINE Signature Verification Failed");

        return new Response("Invalid Signature", {
          status: 401
        });
      }

      console.log("LINE Signature Verified");

      // ======================================================
      // 6. PARSE WEBHOOK BODY
      // ======================================================

      let payload;

      try {

        payload = JSON.parse(body);

      } catch (error) {

        console.error("Invalid JSON Payload");

        return new Response("Invalid JSON", {
          status: 400
        });
      }

      // ======================================================
      // 7. LINE WEBHOOK VERIFY
      // ======================================================

      // LINE Verify normally sends events: []
      // No need to call Google Apps Script.

      if (
        Array.isArray(payload.events) &&
        payload.events.length === 0
      ) {

        console.log("LINE WEBHOOK VERIFY SUCCESS");

        return new Response("OK", {
          status: 200,
          headers: {
            "Content-Type": "text/plain"
          }
        });
      }

      // ======================================================
      // 8. CHECK GOOGLE APPS SCRIPT CONFIGURATION
      // ======================================================

      if (
        !env.GAS_WEB_APP_URL ||
        !env.GAS_WEBHOOK_SECRET
      ) {

        console.error("Missing GAS Configuration");

        return new Response(
          "Google Apps Script Configuration Error",
          {
            status: 500
          }
        );
      }

      // ======================================================
      // 9. PREPARE GAS WEBHOOK URL
      // ======================================================

      const gasUrl = new URL(env.GAS_WEB_APP_URL);

      gasUrl.searchParams.set(
        "key",
        env.GAS_WEBHOOK_SECRET
      );

      // ======================================================
      // 10. FORWARD WEBHOOK TO GOOGLE APPS SCRIPT
      // ======================================================

      const gasResponse = await fetch(
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

      const gasResponseText = await gasResponse.text();

      // ======================================================
      // 11. CHECK GAS RESPONSE
      // ======================================================

      if (!gasResponse.ok) {

        console.error(
          "GAS HTTP ERROR:",
          gasResponse.status
        );

        console.error(
          "GAS RESPONSE:",
          gasResponseText.substring(0, 1000)
        );

        return new Response(
          "Google Apps Script Error",
          {
            status: 502
          }
        );
      }

      // ======================================================
      // 12. SUCCESS
      // ======================================================

      console.log("LINE WEBHOOK SUCCESS");

      return new Response("OK", {
        status: 200,
        headers: {
          "Content-Type": "text/plain"
        }
      });

    } catch (error) {

      // ======================================================
      // 13. ERROR HANDLING
      // ======================================================

      console.error(
        "WORKER ERROR:",
        error?.stack || error?.message || String(error)
      );

      return new Response(
        "Internal Server Error",
        {
          status: 500
        }
      );
    }
  }
};
