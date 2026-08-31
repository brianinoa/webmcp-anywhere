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
  // Mutations must come from a known browser origin. A missing Origin (curl, server-side
  // client) is NOT trusted here — otherwise anyone could overwrite the shared library.
  if (!origin) return false;
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
