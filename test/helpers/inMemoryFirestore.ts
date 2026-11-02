import { InMemoryFirestore } from '@emmett-community/emmett-google-firestore/testing';
import type { Firestore } from '@google-cloud/firestore';

export const createInMemoryFirestore = (): Firestore =>
  new InMemoryFirestore() as unknown as Firestore;
