import type { FastifyPluginAsync } from 'fastify';
import { UserParamsSchema, UpdatePreferencesBodySchema } from '../schemas';
import { getUserPreferences, updateUserPreferences } from '../../application/preferenceService';

const preferencesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users/:id/preferences', async (request) => {
    const { id } = UserParamsSchema.parse(request.params);
    return getUserPreferences(id);
  });

  fastify.post('/users/:id/preferences', async (request, reply) => {
    const { id } = UserParamsSchema.parse(request.params);
    const body = UpdatePreferencesBodySchema.parse(request.body);

    await updateUserPreferences(id, body);

    request.log.info({ userId: id }, 'preference updated');

    return reply.code(204).send();
  });
};

export default preferencesPlugin;
