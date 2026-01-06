import type { Event } from '@event-driven-io/emmett';

export type TestEvent = Event & {
  type: 'TestEvent';
  data: { value: number };
};

export const testEvent: TestEvent = {
  type: 'TestEvent',
  data: { value: 1 },
};
