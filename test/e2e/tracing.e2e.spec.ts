import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';

const run = promisify(execFile);
const projectId = 'demo-project';

type ExportedSpan = {
  traceId: string;
  parentId?: string;
  name: string;
  id: string;
};

// The console exporter writes each span as an object with these fields in this order
const SPAN =
  /traceId: '([0-9a-f]{32})',\s+parentId: (?:'([0-9a-f]{16})'|undefined),\s+traceState: [^\n]*\n\s+name: (?:'([^']*)'|"([^"]*)"),\s+id: '([0-9a-f]{16})'/g;

const parseSpans = (stdout: string): ExportedSpan[] =>
  [...stdout.matchAll(SPAN)].map((match) => ({
    traceId: match[1],
    parentId: match[2],
    name: match[3] ?? match[4],
    id: match[5],
  }));

const startEmulator = () =>
  new GenericContainer('myfstartup/firebase-emulator-suite:15')
    .withPlatform('linux/amd64')
    .withExposedPorts(4000, 9099, 8080, 9000, 8085)
    .withBindMounts([
      {
        source: path.join(process.cwd(), 'test', 'firebase', 'firebase.json'),
        target: '/app/firebase.json',
        mode: 'ro' as const,
      },
      {
        source: path.join(process.cwd(), 'test', 'firebase', '.firebaserc'),
        target: '/app/.firebaserc',
        mode: 'ro' as const,
      },
    ])
    .withEnvironment({ PROJECT_ID: projectId })
    .withWaitStrategy(Wait.forHttp('/', 4000).withStartupTimeout(120000))
    .start();

void describe('Tracing E2E', () => {
  let emulator: StartedTestContainer | undefined;
  let spans: ExportedSpan[] = [];

  const named = (name: string) => spans.filter((span) => span.name === name);
  const byId = (id: string | undefined) => spans.find((span) => span.id === id);
  const ancestorsOf = (span: ExportedSpan): ExportedSpan[] => {
    const parent = byId(span.parentId);
    return parent ? [parent, ...ancestorsOf(parent)] : [];
  };
  const describeSpans = () =>
    spans
      .map(
        (span) =>
          `${span.traceId} ${span.id} <- ${span.parentId ?? '-'} ${span.name}`,
      )
      .join('\n');

  before(async () => {
    emulator = await startEmulator();
    const host = emulator.getHost();

    // The fixture runs in a process of its own, with the tracing loaded first, as a service does
    const { stdout } = await run(
      process.execPath,
      [
        '--import',
        'tsx',
        '--import',
        './test/fixtures/tracing/preload.ts',
        './test/fixtures/tracing/messaging.ts',
      ],
      {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          OTEL_TRACES_EXPORTER: 'console',
          FIRESTORE_EMULATOR_HOST: `${host}:${emulator.getMappedPort(8080)}`,
          FIREBASE_DATABASE_EMULATOR_HOST: `${host}:${emulator.getMappedPort(9000)}`,
          PUBSUB_EMULATOR_HOST: `${host}:${emulator.getMappedPort(8085)}`,
          GCLOUD_PROJECT: projectId,
          FIRESTORE_PROJECT_ID: projectId,
          PUBSUB_PROJECT_ID: projectId,
        },
        timeout: 120000,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    spans = parseSpans(stdout);
  });

  after(async () => {
    await emulator?.stop();
  });

  void it('keeps the request, the publication and the handling of the event in one trace', () => {
    const [request] = named('POST /orders/:orderId');
    const [publish] = named('emmett.pubsub.publish_event');
    const [handle] = named('emmett.pubsub.handle_event');
    assert.ok(request && publish && handle, describeSpans());

    assert.equal(publish.traceId, request.traceId, describeSpans());
    assert.ok(ancestorsOf(publish).includes(request), describeSpans());
    assert.equal(handle.traceId, request.traceId, describeSpans());
    assert.equal(handle.parentId, publish.id, describeSpans());
  });

  void it('traces the work of the subscriber under the handling of the event', () => {
    const [handle] = named('emmett.pubsub.handle_event');
    const appendsInHandler = named('emmett.firestore.append_to_stream').filter(
      (span) => ancestorsOf(span).includes(handle),
    );

    assert.equal(appendsInHandler.length, 1, describeSpans());
  });

  void it('traces the calls of the Firestore and Pub/Sub clients under the Emmett library spans', () => {
    const [request] = named('POST /orders/:orderId');
    const [publish] = named('emmett.pubsub.publish_event');
    const appends = named('emmett.firestore.append_to_stream');
    const libraryNames = new Set(
      spans
        .filter((span) => span.name.startsWith('emmett.'))
        .map((span) => span.name),
    );
    const clientSpans = spans.filter(
      (span) =>
        span.traceId === request.traceId &&
        !libraryNames.has(span.name) &&
        !span.name.startsWith('POST ') &&
        !span.name.startsWith('request handler') &&
        !span.name.startsWith('middleware'),
    );

    const underAppend = clientSpans.filter((span) =>
      ancestorsOf(span).some((ancestor) => appends.includes(ancestor)),
    );
    const underPublish = clientSpans.filter((span) =>
      ancestorsOf(span).includes(publish),
    );

    assert.ok(underAppend.length > 0, describeSpans());
    assert.ok(underPublish.length > 0, describeSpans());
  });
});
