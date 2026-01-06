import type { PubSub } from '@google-cloud/pubsub';

export const createInMemoryPubSub = (): PubSub => {
  return {
    close: async () => {},
  } as unknown as PubSub;
};
