
/* ============================================================
 * NAKORNPING DOCUMENT — LINE WEBHOOK WORKER
 * Version 1.0.0
 * ============================================================ */

export default {

  async fetch(request, env) {

    // --------------------------------------------------------
    // 1. METHOD VALIDATION
    // --------------------------------------------------------

    if (request.method !== "POST") {

      return new Response(
        "Method Not Allowed",
        {
          status: 405
        }
      );

    }

    try {

      // ------------------------------------------------------
      // 2. READ LINE REQUEST
      // ------------------------------------------------------

      const signature = request.headers.get(
        "x-line-signature"
      );

      if (!signature) {

        return new Response(
          "Missing LINE Signature",
          {
            status: 401
          }
        );

      }

      const body = await request.text();

      // ------------------------------------------------------
      // 3. VALIDATE CONFIGURATION
      // ------------------------------------------------------

      if (
        !env.LINE_CHANNEL_SECRET ||
        !env.GAS_WEB_APP_URL ||
        !env.GAS_WEBHOOK_SECRET
      ) {

        console.error(
          "Missing Worker Environment Variables"
        );

        return new Response(
          "Worker Configuration Error",
          {
            status: 500
          }
        );

      }

      // ------------------------------------------------------
      // 4. VERIFY LINE SIGNATURE
      // ------------------------------------------------------

      const encoder = new TextEncoder();

      const key = await crypto.subtle.importKey(

        "raw",

        encoder.encode(
          env.LINE_CHANNEL_SECRET
        ),

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

      // เปรียบเทียบ Signature

      if (signature !== expectedSignature) {

        console.error(
          "LINE Signature Verification Failed"
        );

        return new Response(
          "Invalid Signature",
          {
            status: 401
          }
        );

      }

      // ------------------------------------------------------
      // 5. PREPARE GOOGLE APPS SCRIPT URL
      // ------------------------------------------------------

      const gasUrl = new URL(
        env.GAS_WEB_APP_URL
      );

      gasUrl.searchParams.set(
        "key",
        env.GAS_WEBHOOK_SECRET
      );

      // ------------------------------------------------------
      // 6. FORWARD TO GOOGLE APPS SCRIPT
      // ------------------------------------------------------

      const response = await fetch(

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

      // ------------------------------------------------------
      // 7. CHECK BACKEND RESPONSE
      // ------------------------------------------------------

      const responseText = await response.text();

      if (!response.ok) {

        console.error(
          "GAS STATUS:",
          response.status
        );

        console.error(
          "GAS RESPONSE:",
          responseText
        );

        return new Response(
          "Google Apps Script Error",
          {
            status: 502
          }
        );

      }

      console.log(
        "LINE WEBHOOK SUCCESS"
      );

      // ------------------------------------------------------
      // 8. RETURN HTTP 200 TO LINE
      // ------------------------------------------------------

      return new Response(

        "OK",

        {

          status: 200,

          headers: {

            "Content-Type": "text/plain"

          }

        }

      );

    } catch (error) {

      console.error(
        "WORKER ERROR:",
        error.stack || error.message
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
