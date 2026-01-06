import type { Firestore } from '@google-cloud/firestore';

type DocSnapshot = {
  exists: boolean;
  data: () => unknown;
};

type DocRef = {
  get: () => Promise<DocSnapshot>;
  set: (value: unknown) => Promise<void>;
};

type CollectionRef = {
  doc: (id: string) => DocRef;
};

export const createInMemoryFirestore = (): Firestore => {
  const store = new Map<string, unknown>();

  const doc = (path: string): DocRef => ({
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
    }),
    set: async (value: unknown) => {
      store.set(path, value);
    },
  });

  const collection = (path: string): CollectionRef => ({
    doc: (id: string) => doc(`${path}/${id}`),
  });

  return {
    doc,
    collection,
    terminate: async () => {},
    settings: () => {},
  } as unknown as Firestore;
};
