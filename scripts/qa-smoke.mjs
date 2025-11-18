#!/usr/bin/env node

/**
 * Lightweight QA smoke test that verifies ffmpeg + python mastering_cli.py.
 * 1. Generates a synthetic sine wave via ffmpeg
 * 2. Runs `mastering_cli.py analyze`
 * 3. Runs `mastering_cli.py master`
 * 4. Prints resulting metrics JSON to stdout
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`${command} exited with code ${code}\n${stderr}`);
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });

const ensureFfmpeg = async () => {
  await run('ffmpeg', ['-hide_banner', '-version']);
};

const main = async () => {
  await ensureFfmpeg();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-mastering-smoke-'));
  const sourcePath = path.join(tmpDir, 'source.wav');
  const masteredPath = path.join(tmpDir, 'mastered.wav');

  await run('ffmpeg', [
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-ac',
    '2',
    '-ar',
    '48000',
    sourcePath,
  ]);

  const analysis = await run(PYTHON_BIN, ['python/mastering_cli.py', 'analyze', sourcePath]);
  console.log('[qa-smoke] analyze metrics:', analysis.stdout.trim());

  const master = await run(PYTHON_BIN, [
    'python/mastering_cli.py',
    'master',
    sourcePath,
    masteredPath,
    '--target-lufs',
    '-14',
    '--true-peak',
    '-1',
    '--comp-threshold',
    '-13',
    '--comp-ratio',
    '1.6',
  ]);
  console.log('[qa-smoke] mastered metrics:', master.stdout.trim());

  await fs.rm(tmpDir, { recursive: true, force: true });
};

main().catch((error) => {
  console.error('[qa-smoke] failed:', error);
  process.exit(1);
});
