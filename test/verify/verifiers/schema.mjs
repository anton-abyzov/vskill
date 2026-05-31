// Schema verifier — runs a Zod schema (or any object with .safeParse) against the surface.
/**
 * @param {any} schema  Zod-shaped { safeParse(value) -> { success, data?, error? } }
 * @param {any} surface
 * @returns {import("../verify-types.mjs").Check[]}
 */
export function runSchema(schema, surface) {
  if (!schema || typeof schema.safeParse !== "function") {
    return [{ id: "schema.shape", status: "warn", message: "no schema declared (skipped)" }];
  }
  const r = schema.safeParse(surface);
  if (r.success) return [{ id: "schema.shape", status: "ok", message: "surface matches schema" }];
  return [
    {
      id: "schema.shape",
      status: "fail",
      message: `surface failed schema validation`,
      actual: r.error?.issues ?? r.error?.message ?? String(r.error),
    },
  ];
}
