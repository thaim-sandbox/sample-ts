import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function startApp(): { child: ChildProcess; getOutput: () => string } {
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: '0', NO_COLOR: '1' },
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk));
  return { child, getOutput: () => output };
}

async function waitFor(
  predicate: () => boolean,
  describe: () => string,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout\n${describe()}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('ルートへのアクセスをログ出力する', async () => {
  const { child, getOutput } = startApp();
  try {
    await waitFor(() => /listening on (\S+)/.test(getOutput()), getOutput);
    const url = getOutput().match(/listening on (\S+)/)![1];

    const res = await fetch(url);
    assert.equal(await res.text(), 'ok');
    await waitFor(() => getOutput().includes('GET /'), getOutput);
  } finally {
    child.kill('SIGKILL');
  }
});

test('SIGTERM で cancellable-sleep を中断し、503 を返して終了する', async () => {
  const { child, getOutput } = startApp();
  await waitFor(() => /listening on (\S+)/.test(getOutput()), getOutput);
  const url = getOutput().match(/listening on (\S+)/)![1];

  const startedAt = Date.now();
  const resPromise = fetch(`${url}/cancellable-sleep?ms=10000`);
  await waitFor(() => getOutput().includes('cancellable sleep start'), getOutput);

  child.kill('SIGTERM');
  const res = await resPromise;
  const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];

  assert.equal(res.status, 503);
  assert.ok(Date.now() - startedAt < 10000, 'sleep が完了するまで待たずに応答する');
  assert.ok(getOutput().includes('cancellable sleep cancelled by SIGTERM'), getOutput());
  assert.ok(!getOutput().includes('cancellable sleep end'), getOutput());
  assert.equal(code, null);
  assert.equal(signal, 'SIGTERM');
});

test('SIGTERM でライフサイクルフックが順に呼ばれ、シグナルにより終了する', async () => {
  const { child, getOutput } = startApp();
  await waitFor(() => getOutput().includes('listening on'), getOutput);

  child.kill('SIGTERM');
  const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
  const output = getOutput();

  const hooks = [
    'onModuleDestroy',
    'beforeApplicationShutdown signal=SIGTERM',
    'onApplicationShutdown signal=SIGTERM',
  ];
  const positions = hooks.map((h) => output.indexOf(h));
  assert.ok(positions.every((p) => p >= 0), output);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  // Nest はフック完了後に自身のリスナーを外して同じシグナルを再送する
  assert.equal(code, null);
  assert.equal(signal, 'SIGTERM');
});
