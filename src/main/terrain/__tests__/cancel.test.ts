import assert from 'node:assert/strict';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createJob, cancelJob, stopJobs } from '../pipeline/index';

test('cancel removes queued job and marks failed', async () => {
  const root = join(tmpdir(), `terrain-cancel-q-${Date.now()}`);
  await mkdir(join(root, 'jobs'), { recursive: true });
  try {
    // Fill the 2-worker slots with hanging tasks, third stays queued.
    const jobs = [];
    for (let i = 0; i < 3; i++) {
      const content = new Uint8Array(Buffer.from(`<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>t${i}</name></Document></kml>`));
      jobs.push(await createJob(root, { filename: `t${i}.kml`, content }));
      await new Promise(r => setTimeout(r, 20));
    }
    const queued = jobs[2];
    const cancelled = await cancelJob(root, queued.id);
    assert.equal(cancelled.status, 'failed');
    assert.match(cancelled.error ?? '', /取消/);
    const disk = JSON.parse(await readFile(join(root, 'jobs', queued.id, 'status.json'), 'utf8'));
    assert.equal(disk.status, 'failed');
  } finally {
    await stopJobs(root).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('cancel aborts a running hang worker into failed', async () => {
  const root = join(tmpdir(), `terrain-cancel-r-${Date.now()}`);
  await mkdir(join(root, 'jobs'), { recursive: true });
  try {
    const content = new Uint8Array(Buffer.from('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>run</name></Document></kml>'));
    const job = await createJob(root, { filename: 'run.kml', content });
    await new Promise(r => setTimeout(r, 50));
    const cancelled = await cancelJob(root, job.id);
    assert.equal(cancelled.status, 'failed');
    assert.match(cancelled.error ?? '', /取消|中断|重试/);
  } finally {
    await stopJobs(root).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
