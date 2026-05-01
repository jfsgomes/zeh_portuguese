import Fastify from "fastify";

const server = Fastify({
  logger: true,
});

server.get("/health", async () => {
  return { ok: true };
});

const port = Number(process.env.PORT ?? 3000);

try {
  await server.listen({ port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
