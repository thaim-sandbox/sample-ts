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

async function waitForUrl(getOutput: () => string): Promise<string> {
  const pattern = /listening on (\S+)/;
  await waitFor(() => pattern.test(getOutput()), getOutput);
  return getOutput().match(pattern)![1];
}

test('ルートへのアクセスをログ出力する', async () => {
  const { child, getOutput } = startApp();
  try {
    const url = await waitForUrl(getOutput);

    const res = await fetch(url);
    assert.equal(await res.text(), 'ok');
    await waitFor(() => getOutput().includes('GET /'), getOutput);
  } finally {
    child.kill('SIGKILL');
  }
});

// 処理中リクエストに SIGTERM を送り、完了を待たずに 503 を返して終了することを検証する
async function assertCancelledOnSigterm(path: string, logPrefix: string, cancelLog: string): Promise<void> {
  const { child, getOutput } = startApp();
  const url = await waitForUrl(getOutput);

  const startedAt = Date.now();
  const resPromise = fetch(`${url}${path}?ms=10000`);
  await waitFor(() => getOutput().includes(`${logPrefix} start`), getOutput);

  child.kill('SIGTERM');
  const res = await resPromise;
  const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];

  assert.equal(res.status, 503);
  assert.ok(Date.now() - startedAt < 10000, '処理が完了するまで待たずに応答する');
  assert.ok(getOutput().includes(cancelLog), getOutput());
  assert.ok(!getOutput().includes(`${logPrefix} end`), getOutput());
  assert.equal(code, null);
  assert.equal(signal, 'SIGTERM');
}

test('SIGTERM で cancellable-sleep を中断し、503 を返して終了する', () =>
  assertCancelledOnSigterm('/cancellable-sleep', 'cancellable sleep', 'cancellable sleep cancelled by SIGTERM'));

test('cpu-heavy は Worker スレッドで処理を完了して応答する', async () => {
  const { child, getOutput } = startApp();
  try {
    const url = await waitForUrl(getOutput);

    const res = await fetch(`${url}/cpu-heavy?ms=100`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^computed \d+ iterations in 100ms$/);
  } finally {
    child.kill('SIGKILL');
  }
});

test('SIGTERM で cpu-heavy の Worker を強制終了し、503 を返して終了する', () =>
  assertCancelledOnSigterm('/cpu-heavy', 'cpu heavy', 'cpu heavy cancelled by SIGTERM (worker terminated)'));

test('SIGTERM でライフサイクルフックが順に呼ばれ、シグナルにより終了する', async () => {
  const { child, getOutput } = startApp();
  await waitForUrl(getOutput);

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
