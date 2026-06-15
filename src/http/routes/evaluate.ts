import type { FastifyPluginAsync } from 'fastify';
import { EvaluateBodySchema } from '../schemas';
import { evaluateForUser } from '../../application/preferenceService';

const evaluatePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/evaluate', async (request) => {
    const body = EvaluateBodySchema.parse(request.body);

    const result = await evaluateForUser(body);

    request.log.info(
      { userId: body.userId, decision: result.decision, reason: result.reason },
      'evaluation completed',
    );

    return result;
  });
};

export default evaluatePlugin;
