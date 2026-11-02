import { InMemoryPubSub } from '@emmett-community/emmett-google-pubsub/testing';
import type { PubSub } from '@google-cloud/pubsub';

export const createInMemoryPubSub = (): PubSub =>
  new InMemoryPubSub() as unknown as PubSub;
