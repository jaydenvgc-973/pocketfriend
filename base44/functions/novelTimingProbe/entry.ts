// Temporary diagnostic: measures how long a single request may run before the
// platform cuts it. Deleted once the limit is known.
Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const seconds = Math.max(1, Math.min(200, Number(body.seconds) || 5));
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  return Response.json({ requested: seconds, elapsed_ms: Date.now() - started });
});