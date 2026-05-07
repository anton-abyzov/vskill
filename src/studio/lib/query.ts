// Tiny URL-querystring helper shared by studio routes. Same trick used inline
// in ~12 other places across eval-server; kept local-scoped for now since the
// wider extraction touches more files than this simplification pass.

export function parseQuery(url: string | undefined): URLSearchParams {
  return new URL(url || "/", "http://localhost").searchParams;
}
