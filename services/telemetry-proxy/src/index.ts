import { flatten } from "./flatten.js";

interface Env {
  HONEYCOMB_API_KEY: string;
  HONEYCOMB_DATASET: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const event = {
      time: (body as { session?: { started_at?: string } })?.session?.started_at ?? new Date().toISOString(),
      data: flatten(body),
    };

    try {
      await fetch(`https://api.honeycomb.io/1/batch/${env.HONEYCOMB_DATASET}`, {
        method: "POST",
        headers: {
          "X-Honeycomb-Team": env.HONEYCOMB_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([event]),
      });
    } catch {
      // silently swallow — never expose upstream errors to clients
    }

    return new Response("OK", { status: 200 });
  },
};
