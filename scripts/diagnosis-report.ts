/**
 * Developer report: prints one complete order journey (ORDER_CREATED →
 * DELIVERED) with expected vs actual time per stage and the diagnosis evidence,
 * plus the dataset-wide validation summary.
 *
 * Usage:
 *   npm run report -- QC-00123  |  bun run scripts/diagnosis-report.ts             # picks the worst delayed order
 *   bun run scripts/diagnosis-report.ts QC-00123    # a specific order
 */

import { existsSync } from "node:fs";

// bun loads .env automatically; node needs a nudge.
if (existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
process.env["SUPABASE_URL"] ??= process.env["VITE_SUPABASE_URL"];
process.env["SUPABASE_PUBLISHABLE_KEY"] ??= process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

const { buildSnapshot } = await import("../src/lib/ops.data");
const { journeyReport } = await import("../src/lib/validation/journey");
const { createClient } = await import("@supabase/supabase-js");

// Operational data is authenticated-only; this developer report runs server-side
// with the service role, which never reaches the browser bundle.
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to run this report");
const db = createClient(process.env["SUPABASE_URL"]!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const snap = await buildSnapshot(30, Date.now(), db);
const argOrder = process.argv[2];
const orderId = argOrder ?? snap.primaryDiagnoses[0]?.orderId ?? snap.orders[0]!.orderId;

console.log("=== DATASET VALIDATION ===");
for (const check of snap.validation.checks) {
  console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
}

console.log("\n=== DIAGNOSES BY STAGE ===");
for (const stage of ["PICK_START", "PICKING", "PACKING", "DISPATCH", "DELIVERY"]) {
  console.log(`${stage.padEnd(11)} ${snap.diagnoses.filter((d) => d.stage === stage).length}`);
}

console.log("\n=== SYSTEMIC FINDINGS ===");
for (const f of snap.systemic.slice(0, 10)) {
  console.log(`[${f.severity}] ${f.kind} · ${f.title} — ${f.occurrences} orders`);
  for (const line of f.evidence) console.log(`    - ${line}`);
}

console.log("\n=== ORDER JOURNEY ===");
console.log(await journeyReport(orderId, db));
