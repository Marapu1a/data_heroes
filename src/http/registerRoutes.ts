import type { FastifyInstance } from 'fastify';
import preferencesPlugin from './routes/preferences';
import evaluatePlugin from './routes/evaluate';

export function registerRoutes(fastify: FastifyInstance): void {
  fastify.get('/health', async () => ({ status: 'ok' }));
  fastify.register(preferencesPlugin);
  fastify.register(evaluatePlugin);
}
