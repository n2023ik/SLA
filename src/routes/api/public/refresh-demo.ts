/**
 * Re-times the in-progress demo orders (and all of their events) relative to
 * "now", so the live demo is never pinned to the date the dataset was seeded.
 *
 * Caller must present the shared secret; nothing about the request body is
 * trusted. Completed history is untouched.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/refresh-demo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        const provided = request.headers.get("x-refresh-secret");
        if (!secret || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("refresh_demo_live_orders");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ refreshedAt: new Date().toISOString(), data }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
