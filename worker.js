
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ตรวจสอบ Worker
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          success: true,
          service: "Nakornping Document Worker",
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

    // รับ LINE Webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      try {
        const body = await request.text();

        console.log("LINE Webhook received:", body);

        return new Response("OK", {
          status: 200,
          headers: {
            "Content-Type": "text/plain"
          }
        });

      } catch (error) {
        console.error("Webhook Error:", error);

        return new Response("OK", {
          status: 200
        });
      }
    }

    return new Response("Not Found", {
      status: 404
    });
  }
};
