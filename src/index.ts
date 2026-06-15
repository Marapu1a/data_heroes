import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerRoutes } from './http/registerRoutes';

async function main() {
  const fastify = Fastify({ logger: true });

  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: error.issues });
    }
    if (error.message.startsWith('Unsupported combination')) {
      return reply.status(400).send({ error: error.message });
    }
    // Fastify built-in errors (e.g. malformed JSON body, unsupported content-type)
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send({ error: error.message });
    }
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  registerRoutes(fastify);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await fastify.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
