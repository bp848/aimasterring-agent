import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { AudioMetrics, MasteringParameters } from '../types';

type JobStatus = 'queued' | 'processing' | 'completed' | 'error';

interface MasteringJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  finalMetrics: AudioMetrics | null;
  masteredAudioUrl: string | null;
  error?: string;
  stderr?: string;
}

const cwd = process.cwd();
const UPLOAD_DIR = path.join(cwd, 'tmp', 'uploads');
const OUTPUT_DIR = path.join(cwd, 'tmp', 'outputs');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/static', express.static(OUTPUT_DIR));

const pythonBinary = process.env.PYTHON_BIN ?? 'python3';
const cliPath = path.join(cwd, 'python', 'mastering_cli.py');
const jobStore = new Map<string, MasteringJob>();

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    pythonBinary,
    pendingJobs: [...jobStore.values()].filter((job) => job.status === 'queued' || job.status === 'processing').length,
  });
});

app.post('/api/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'オーディオファイルが必要です。' });
  }

  try {
    const { stdout } = await execPythonCli(['analyze', req.file.path]);
    const metrics = parseMetricsJson(stdout)?.metrics;
    if (!metrics) {
      throw new Error('測定結果を解析できませんでした。');
    }
    return res.json({ metrics });
  } catch (error) {
    console.error('Analysis CLI failed:', error);
    return res.status(500).json({ error: '音声解析に失敗しました。' });
  } finally {
    cleanupTempFile(req.file.path);
  }
});

app.post('/api/master', upload.single('file'), async (req, res) => {
  if (!req.file || typeof req.body?.params !== 'string') {
    cleanupTempFile(req.file?.path ?? '');
    return res.status(400).json({ error: 'file と params が必要です。' });
  }

  let params: MasteringParameters;
  try {
    params = JSON.parse(req.body.params) as MasteringParameters;
  } catch (error) {
    cleanupTempFile(req.file.path);
    return res.status(400).json({ error: 'params が JSON ではありません。' });
  }

  const jobId = crypto.randomUUID();
  const outputFilename = `${jobId}.wav`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  const now = new Date().toISOString();
  const job: MasteringJob = {
    id: jobId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    fileName: req.file.originalname,
    finalMetrics: null,
    masteredAudioUrl: null,
  };
  jobStore.set(jobId, job);

  startMasteringJob(jobId, req.file.path, outputPath, params, outputFilename);

  return res.status(202).json({ jobId, status: job.status });
});

app.get('/api/master/:jobId', (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'ジョブが見つかりません。' });
  }
  return res.json({
    ...job,
    progress: job.status === 'completed' ? 1 : job.status === 'processing' ? 0.6 : job.status === 'queued' ? 0.2 : 1,
  });
});

const metricsSchema = z.object({
  lufs: z.number().nullable().optional(),
  truePeak: z.number().nullable().optional(),
  crest: z.number().nullable().optional(),
});

const masteringParamsSchema = z.object({
  platform: z.enum(['streaming', 'beatport', 'cd', 'youtube']),
  currentMetrics: metricsSchema,
  targetMetrics: metricsSchema,
  promptSupplement: z.string().max(2000).optional(),
});

const geminiResponseSchema = z.object({
  inputTrimDb: z.number(),
  compThresholdDbfs: z.number(),
  compRatio: z.number(),
  compAttackMs: z.number(),
  compReleaseMs: z.number(),
  eqLowHz: z.number(),
  eqLowDb: z.number(),
  eqLowQ: z.number(),
  eqHighHz: z.number(),
  eqHighDb: z.number(),
  eqHighQ: z.number(),
  targetLufs: z.number(),
  truePeak: z.number(),
  limiterCeilingDb: z.number(),
  limiterLookaheadMs: z.number(),
  limiterReleaseMs: z.number(),
  platform: z.enum(['streaming', 'beatport', 'cd', 'youtube']),
  profileName: z.string(),
});

const tokenBucket = createTokenBucket({
  capacity: Number(process.env.GEMINI_RATE_LIMIT ?? 8),
  refillIntervalMs: 60_000,
});

app.post('/api/mastering-params', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY が未設定です。' });
  }
  if (!tokenBucket.tryRemoveToken()) {
    return res.status(429).json({ error: 'Gemini API レートリミットに達しました。時間をおいて再試行してください。' });
  }

  const parseResult = masteringParamsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'リクエスト形式が不正です。', details: parseResult.error.flatten() });
  }

  try {
    const params = await requestGeminiParameters(parseResult.data);
    return res.json({ params });
  } catch (error) {
    console.error('Gemini request failed:', error);
    return res.status(502).json({ error: 'Gemini API 呼び出しに失敗しました。' });
  }
});

function startMasteringJob(
  jobId: string,
  inputPath: string,
  outputPath: string,
  params: MasteringParameters,
  outputFilename: string,
) {
  const job = jobStore.get(jobId);
  if (!job) {
    return;
  }
  job.status = 'processing';
  job.updatedAt = new Date().toISOString();

  const cliArgs = buildMasterArgs(inputPath, outputPath, params);
  const child = spawn(pythonBinary, cliArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  let cleaned = false;

  const cleanupOnce = () => {
    if (!cleaned) {
      cleaned = true;
      cleanupTempFile(inputPath);
    }
  };

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('error', (error) => {
    cleanupOnce();
    const currentJob = jobStore.get(jobId);
    if (!currentJob) {
      return;
    }
    currentJob.status = 'error';
    currentJob.error = `mastering_cli 起動に失敗しました: ${error.message}`;
    currentJob.stderr = stderr.slice(-800);
    currentJob.updatedAt = new Date().toISOString();
  });

  child.on('close', (code) => {
    cleanupOnce();
    const currentJob = jobStore.get(jobId);
    if (!currentJob) {
      return;
    }
    currentJob.updatedAt = new Date().toISOString();
    if (code !== 0) {
      currentJob.status = 'error';
      currentJob.error = 'mastering_cli がエラーで終了しました。';
      currentJob.stderr = stderr.slice(-800);
      return;
    }

    const parsed = parseMetricsJson(stdout);
    currentJob.finalMetrics = parsed?.finalMetrics ?? parsed?.metrics ?? null;
    currentJob.masteredAudioUrl = `/static/${outputFilename}?t=${Date.now()}`;
    currentJob.status = 'completed';
  });
}

async function execPythonCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBinary, [cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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
        const error = new Error(`CLI exited with code ${code}`);
        (error as any).stderr = stderr;
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });
}

const buildMasterArgs = (inputPath: string, outputPath: string, params: MasteringParameters): string[] => {
  return [
    cliPath,
    'master',
    inputPath,
    outputPath,
    '--target-lufs',
    String(params.targetLufs),
    '--true-peak',
    String(params.truePeak),
    '--input-trim-db',
    String(params.inputTrimDb),
    '--comp-threshold',
    String(params.compThresholdDbfs),
    '--comp-ratio',
    String(params.compRatio),
    '--attack',
    String(params.compAttackMs),
    '--release',
    String(params.compReleaseMs),
    '--eq-low-hz',
    String(params.eqLowHz),
    '--eq-low-db',
    String(params.eqLowDb),
    '--eq-low-q',
    String(params.eqLowQ),
    '--eq-high-hz',
    String(params.eqHighHz),
    '--eq-high-db',
    String(params.eqHighDb),
    '--eq-high-q',
    String(params.eqHighQ),
    '--limiter-ceiling',
    String(params.limiterCeilingDb),
    '--limiter-lookahead',
    String(params.limiterLookaheadMs),
    '--limiter-release',
    String(params.limiterReleaseMs),
    '--platform',
    params.platform,
    '--profile-name',
    params.profileName,
  ];
};

const parseMetricsJson = (raw: string): { metrics?: AudioMetrics; finalMetrics?: AudioMetrics } | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    console.warn('metrics JSON parse failed:', error);
    return null;
  }
};

const cleanupTempFile = (filePath?: string) => {
  if (!filePath) {
    return;
  }
  fs.promises.unlink(filePath).catch((error) => console.warn('Failed to clean up temp file:', filePath, error));
};

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-exp';

const SYSTEM_PROMPT = [
  'You are a professional mastering engineer following the user\'s A/B/C specification:',
  'A) Apply an input trim around -1.5 dB before any saturation to keep transient safety.',
  'B) Use a wideband RMS compressor (ratio ≈1.6:1, threshold around -13 dBFS, attack 12 ms, release 80 ms) for 1.5–2 dB GR.',
  'C) Optional gentle shelves: 120 Hz about -0.8 dB (Q 0.7) and 3.5 kHz about +0.6 dB (Q 0.7).',
  'D) Limiter aims at LUFS -14, true peak -1 dBTP, ceiling -1 dBTP, lookahead 1 ms, release 40 ms.',
  'E) Return metadata for platform profile selection.',
  'Use the supplied "current" vs "target" loudness metrics and platform to fine-tune the exact numbers.',
  'Respond with strict JSON that matches the schema and field names exactly:',
  '{ "inputTrimDb": number, "compThresholdDbfs": number, "compRatio": number, "compAttackMs": number, "compReleaseMs": number,',
  '"eqLowHz": number, "eqLowDb": number, "eqLowQ": number, "eqHighHz": number, "eqHighDb": number, "eqHighQ": number,',
  '"targetLufs": number, "truePeak": number, "limiterCeilingDb": number, "limiterLookaheadMs": number, "limiterReleaseMs": number, "platform": string, "profileName": string }',
  'No prose, no comments, no code fences—return the JSON object only.',
].join('\n');

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const requestGeminiParameters = async (payload: z.infer<typeof masteringParamsSchema>): Promise<MasteringParameters> => {
  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildUserPrompt(payload),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      topP: 0.8,
      topK: 32,
      responseMimeType: 'application/json',
    },
  };

  let lastError: unknown;
  const attempts = Number(process.env.GEMINI_MAX_RETRIES ?? 3);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const data = await callGeminiEndpoint(body);
      const text = extractGeminiText(data);
      if (!text) {
        throw new Error('Gemini 応答からテキストを抽出できませんでした。');
      }

      const cleaned = stripCodeFence(text);

      const jsonResult = JSON.parse(cleaned);
      const parsed = geminiResponseSchema.parse(jsonResult);
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const backoffMs = 500 * attempt ** 2;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError ?? new Error('Gemini API 呼び出しに失敗しました。');
};

const callGeminiEndpoint = async (body: Record<string, unknown>): Promise<any> => {
  const response = await fetch(`${GEMINI_ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
};

const extractGeminiText = (payload: any): string | undefined => {
  const candidate = payload?.candidates?.[0];
  if (!candidate) {
    return undefined;
  }
  const parts = candidate.content?.parts ?? [];
  const textParts = parts
    .map((part: any) => part.text)
    .filter((value: any): value is string => typeof value === 'string');
  return textParts.join('').trim();
};

const stripCodeFence = (text: string): string => {
  if (text.startsWith('```')) {
    return text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  return text.trim();
};

const buildUserPrompt = (payload: z.infer<typeof masteringParamsSchema>): string => {
  const lines = [
    `Platform: ${payload.platform}`,
    `Current metrics: LUFS=${payload.currentMetrics.lufs ?? 'N/A'}, TruePeak=${payload.currentMetrics.truePeak ?? 'N/A'}, Crest=${payload.currentMetrics.crest ?? 'N/A'}`,
    `Target metrics: LUFS=${payload.targetMetrics.lufs ?? 'N/A'}, TruePeak=${payload.targetMetrics.truePeak ?? 'N/A'}, Crest=${payload.targetMetrics.crest ?? 'N/A'}`,
  ];
  if (payload.promptSupplement) {
    lines.push(`Notes: ${payload.promptSupplement}`);
  }
  lines.push('Respond with JSON only.');
  return lines.join('\n');
};

function createTokenBucket({ capacity, refillIntervalMs }: { capacity: number; refillIntervalMs: number }) {
  let available = capacity;
  let lastRefill = Date.now();

  return {
    tryRemoveToken() {
      const now = Date.now();
      const elapsed = now - lastRefill;
      if (elapsed >= refillIntervalMs) {
        available = capacity;
        lastRefill = now;
      }
      if (available <= 0) {
        return false;
      }
      available -= 1;
      return true;
    },
  };
}

export default app;

const startServer = () => {
  console.log('--- SERVER STARTING ---');
  console.log('ENV PORT:', process.env.PORT);

  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  const host = '0.0.0.0';

  console.log(`Attempting to bind to http://${host}:${port}`);

  app.listen(port, host, () => {
    console.log(`✅ SERVER RUNNING: Listening on http://${host}:${port}`);
  });
};

startServer();
