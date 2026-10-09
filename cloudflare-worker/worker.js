/**
 * Cloudflare Worker CORS bridge for the Apps Script API.
 * Set GAS_URL and ALLOWED_ORIGIN as Worker secrets/variables.
 * This proxy does not authenticate users; Apps Script verifies every ID token.
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    const corsOrigin = allowed.includes(origin) ? origin : "";
    const cors = {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") {
      if (!corsOrigin) return new Response("Origin not allowed", {status:403});
      return new Response(null, {status:204, headers:{...cors,"Access-Control-Allow-Origin":corsOrigin}});
    }
    if (request.method !== "POST") return new Response("Method not allowed", {status:405});
    if (!corsOrigin) return new Response("Origin not allowed", {status:403});
    if (!env.GAS_URL || !env.GAS_URL.startsWith("https://script.google.com/macros/s/")) {
      return new Response(JSON.stringify({ok:false,error:"Worker backend is not configured."}), {
        status:500, headers:{"Content-Type":"application/json", "Access-Control-Allow-Origin":corsOrigin, "Cache-Control":"no-store"}
      });
    }
    let body;
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ok:false,error:"Invalid JSON."}), {
        status:400, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":corsOrigin,"Cache-Control":"no-store"}
      });
    }
    if (!body || typeof body.idToken !== "string" || body.idToken.length > 10000) {
      return new Response(JSON.stringify({ok:false,error:"Google sign-in token required."}), {
        status:400, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":corsOrigin,"Cache-Control":"no-store"}
      });
    }
    try {
      const upstream = await fetch(env.GAS_URL, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body),
        redirect:"follow"
      });
      const text = await upstream.text();
      let data;
      try { data = JSON.parse(text); } catch { data = {ok:false,error:"Apps Script returned a non-JSON response. Check deployment access and URL."}; }
      return new Response(JSON.stringify(data), {
        status:upstream.ok ? 200 : upstream.status,
        headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":corsOrigin,"Cache-Control":"no-store","Vary":"Origin"}
      });
    } catch (error) {
      return new Response(JSON.stringify({ok:false,error:"Could not reach the Apps Script backend."}), {
        status:502, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":corsOrigin,"Cache-Control":"no-store","Vary":"Origin"}
      });
    }
  }
};