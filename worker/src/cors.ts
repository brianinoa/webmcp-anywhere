/**
 * CORS policy, centralized. Hackathon-permissive:
 *  - GET/HEAD/OPTIONS: any origin.
 *  - Mutations: the studio origins, localhost dev servers, and chrome-extension://*.
 */
const STUDIO_ORIGINS = [
  /^https:\/\/webmcp-anywhere\.briandaniloinoa\.workers\.dev$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^chrome-extension:\/\/[a-p]{32}$/,
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originAllowed(origin: string | null, method: string): boolean {
  if (SAFE_METHODS.has(method)) return true; // reads are open, with or without an Origin
  // Origin-less POST is allowed: the extension's background service worker creates
  // fresh-id user recipes and cannot present an Origin. A create can't clobber an existing
  // recipe (the id is server-assigned; a duplicate id 409s), so it is low-risk. Overwrite
  // (PUT) and delete (DELETE) still require a trusted browser Origin — an origin-less client
  // (curl, server) must never be able to rewrite or remove the shared library.
  if (!origin) return method === "POST";
  return STUDIO_ORIGINS.some((re) => re.test(origin));
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(request: Request): Response {
  const origin = request.headers.get("Origin");
  const method = request.headers.get("Access-Control-Request-Method") ?? "GET";
  if (!originAllowed(origin, method)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
