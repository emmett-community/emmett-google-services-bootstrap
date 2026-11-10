import { startTracing } from '../../../src/tracing';

await startTracing({ serviceName: 'tracing-fixture' });
