import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';
import type { AudioMetrics, MasteringParameters } from '../types';

type JobStatus = 'queued' | 'processing' | 'completed' | 'error';

interface MasteringJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  sourceUrl?: string;
  remoteOutputObject?: string | null;
  masteredAudioExpiresAt?: string | null;
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

const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
});

const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET ?? 'ai-mastering-uploads';
const UPLOAD_PREFIX = process.env.UPLOAD_PREFIX ?? 'uploads';
const OUTPUT_PREFIX = process.env.OUTPUT_PREFIX ?? 'outputs';
const SIGNED_UPLOAD_TTL_SECONDS = Number(process.env.UPLOAD_SIGNED_URL_TTL ?? 600);
const SIGNED_DOWNLOAD_TTL_SECONDS = Number(process.env.DOWNLOAD_SIGNED_URL_TTL ?? 86_400);
const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 536_870_912); // 512 MB
const ALLOWED_EXTENSIONS = (process.env.ALLOWED_UPLOAD_EXTENSIONS ?? '.wav,.wave,.aiff,.aif,.mp3,.flac')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const app = express();
app.use(express.json({ limit: '2mb' }));

const pythonBinary = process.env.PYTHON_BIN ?? 'python3';
const cliPath = path.join(cwd, 'python', 'mastering_cli.py');
const jobStore = new Map<string, MasteringJob>();

const ensureAllowedExtension = (filename: string): string => {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) {
    throw new Error('ファイル拡張子が指定されていません。');
  }
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`サポートされていないファイル拡張子です: ${ext}`);
  }
  return ext;
};

const inferExtensionFromUrl = (url: string): string => {
  const sanitized = url.split('?')[0];
  const ext = path.extname(sanitized).toLowerCase();
  if (ext && ALLOWED_EXTENSIONS.includes(ext)) {
    return ext;
  }
  return '.wav';
};

const parseGcsUri = (uri: string): { bucketName: string; objectName: string } => {
  const withoutScheme = uri.slice('gs://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(`gs:// URI が不正です: ${uri}`);
  }
  return {
    bucketName: withoutScheme.slice(0, slashIndex),
    objectName: withoutScheme.slice(slashIndex + 1),
  };
};

const downloadRemoteFile = async (sourceUrl: string): Promise<{ localPath: string }> => {
  const ext = inferExtensionFromUrl(sourceUrl);
  const localPath = path.join(UPLOAD_DIR, `remote-${crypto.randomUUID()}${ext}`);

  if (sourceUrl.startsWith('gs://')) {
    const { bucketName, objectName } = parseGcsUri(sourceUrl);
    await storage.bucket(bucketName).file(objectName).download({ destination: localPath });
    return { localPath };
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`リモートファイルのダウンロードに失敗しました: HTTP ${response.status}`);
  }
  const body = response.body;
  if (!body) {
    throw new Error('リモートファイルのレスポンスが空でした。');
  }
  await pipeline(Readable.fromWeb(body as any), fs.createWriteStream(localPath));
  return { localPath };
};

const uploadMasteredFile = async (localPath: string, jobId: string) => {
  const destination = `${OUTPUT_PREFIX}/${jobId}.wav`;
  await storage.bucket(UPLOAD_BUCKET).upload(localPath, {
    destination,
    resumable: false,
    contentType: 'audio/wav',
  });
  const expires = Date.now() + SIGNED_DOWNLOAD_TTL_SECONDS * 1000;
  const [signedUrl] = await storage
    .bucket(UPLOAD_BUCKET)
    .file(destination)
    .getSignedUrl({ version: 'v4', action: 'read', expires });

  return {
    objectUrl: `gs://${UPLOAD_BUCKET}/${destination}`,
    signedUrl,
    expiresAt: new Date(expires).toISOString(),
  };
};

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    pythonBinary,
    pendingJobs: [...jobStore.values()].filter((job) => job.status === 'queued' || job.status === 'processing').length,
  });
});

const uploadUrlRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.number().int().positive(),
});

const sourceUrlSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('gs://') || value.startsWith('https://'), {
    message: 'sourceUrl は gs:// または https:// である必要があります。',
  });

app.post('/api/upload-url', async (req, res) => {
  const parseResult = uploadUrlRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'リクエスト形式が不正です。', details: parseResult.error.flatten() });
  }

  const { filename, contentType, fileSize } = parseResult.data;
  if (fileSize > MAX_UPLOAD_BYTES) {
    return res
      .status(400)
      .json({ error: `ファイルサイズが上限(${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB)を超えています。` });
  }

  let ext: string;
  try {
    ext = ensureAllowedExtension(filename);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }

  const objectKey = `${UPLOAD_PREFIX}/${crypto.randomUUID()}${ext}`;
  const expires = Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000;

  try {
    const [uploadUrl] = await storage
      .bucket(UPLOAD_BUCKET)
      .file(objectKey)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires,
        contentType,
      });

    return res.json({
      uploadUrl,
      objectUrl: `gs://${UPLOAD_BUCKET}/${objectKey}`,
      publicUrl: `https://storage.googleapis.com/${UPLOAD_BUCKET}/${objectKey}`,
      expiresAt: new Date(expires).toISOString(),
    });
  } catch (error) {
    console.error('Failed to create signed upload URL:', error);
    return res.status(500).json({ error: '署名付きURLの生成に失敗しました。' });
  }
});

const analyzeRequestSchema = z.object({
  sourceUrl: sourceUrlSchema,
});

app.post('/api/analyze', async (req, res) => {
  const parseResult = analyzeRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'リクエスト形式が不正です。', details: parseResult.error.flatten() });
  }

  let localFilePath: string | undefined;
  try {
    const downloadResult = await downloadRemoteFile(parseResult.data.sourceUrl);
    localFilePath = downloadResult.localPath;
    const { stdout } = await execPythonCli(['analyze', localFilePath]);
    const metrics = parseMetricsJson(stdout)?.metrics;

    if (!metrics) {
      throw new Error(`解析結果の読み込みに失敗しました: ${stdout}`);
    }
    return res.json({ metrics });
  } catch (error: any) {
    console.error('Analysis CLI failed:', error);
    const errorMessage =
      (typeof error === 'object' && error !== null && 'stderr' in error && (error as any).stderr) ||
      (error as Error)?.message ||
      '不明なエラーが発生しました';

    return res.status(500).json({
      error: '音声解析プロセスでエラーが発生しました。',
      details: errorMessage,
      command: `${pythonBinary} ${cliPath} analyze <downloaded>`,
    });
  } finally {
    cleanupTempFile(localFilePath);
  }
});

const masterRequestSchema = z.object({
  sourceUrl: sourceUrlSchema,
  params: masteringParamsSchema,
  originalFileName: z.string().optional(),
});

app.post('/api/master', async (req, res) => {
  const parseResult = masterRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'リクエスト形式が不正です。', details: parseResult.error.flatten() });
  }

  const { sourceUrl, params, originalFileName } = parseResult.data;
  const jobId = crypto.randomUUID();
  const outputFilename = `${jobId}.wav`;

  const now = new Date().toISOString();
  const job: MasteringJob = {
    id: jobId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    fileName: originalFileName ?? 'remote-source',
    sourceUrl,
    finalMetrics: null,
    masteredAudioUrl: null,
    remoteOutputObject: null,
    masteredAudioExpiresAt: null,
  };
  jobStore.set(jobId, job);

  startMasteringJob({
    jobId,
    sourceUrl,
    outputFilename,
    params,
  });

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

interface MasteringJobInput {
  jobId: string;
  sourceUrl: string;
  outputFilename: string;
  params: MasteringParameters;
}

function startMasteringJob({ jobId, sourceUrl, outputFilename, params }: MasteringJobInput) {
  void (async () => {
    let localInputPath: string | undefined;
    let localOutputPath: string | undefined;
    try {
      const job = jobStore.get(jobId);
      if (!job) {
        return;
      }
      job.status = 'processing';
      job.updatedAt = new Date().toISOString();

      const downloadResult = await downloadRemoteFile(sourceUrl);
      localInputPath = downloadResult.localPath;
      localOutputPath = path.join(OUTPUT_DIR, outputFilename);

      const { stdout, stderr } = await runMasteringCli(localInputPath, localOutputPath, params);
      const currentJob = jobStore.get(jobId);
      if (!currentJob) {
        return;
      }
      const parsed = parseMetricsJson(stdout);
      currentJob.stderr = stderr.slice(-800);
      currentJob.finalMetrics = parsed?.finalMetrics ?? parsed?.metrics ?? null;

      const uploadResult = await uploadMasteredFile(localOutputPath, jobId);
      currentJob.masteredAudioUrl = uploadResult.signedUrl;
      currentJob.masteredAudioExpiresAt = uploadResult.expiresAt;
      currentJob.remoteOutputObject = uploadResult.objectUrl;
      currentJob.status = 'completed';
      currentJob.updatedAt = new Date().toISOString();
    } catch (error) {
      const job = jobStore.get(jobId);
      if (job) {
        job.status = 'error';
        job.error = error instanceof Error ? error.message : String(error);
        if ((error as any)?.stderr) {
          job.stderr = String((error as any).stderr).slice(-800);
        }
        job.updatedAt = new Date().toISOString();
      }
    } finally {
      cleanupTempFile(localInputPath);
      cleanupTempFile(localOutputPath);
    }
  })();
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

async function runMasteringCli(
  inputPath: string,
  outputPath: string,
  params: MasteringParameters,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cliArgs = buildMasterArgs(inputPath, outputPath, params);
    const child = spawn(pythonBinary, cliArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      const wrapped = new Error(`mastering_cli 起動に失敗しました: ${error.message}`);
      (wrapped as any).stderr = stderr;
      reject(wrapped);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const err = new Error('mastering_cli がエラーで終了しました。');
        (err as any).stderr = stderr;
        return reject(err);
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
  "You are a professional mastering engineer following the user's A/B/C specification:",
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

// フロントエンドの配信設定
const frontendDist = path.join(cwd, 'dist');

if (fs.existsSync(frontendDist)) {
  console.log('Serving static files from:', frontendDist);

  // 静的ファイル（JS, CSS, 画像など）を先に配信
  app.use(express.static(frontendDist));

  // API以外のすべてのGETリクエストに対して index.html を返す (SPA対応)
  // 注意: Express 5.0 の app.get('*') エラーを回避するため、app.use で処理します
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    } else {
      next();
    }
  });
} else {
  console.warn('WARNING: Frontend build directory (dist) not found. UI will not be served.');
}

// ------------------------------------------------------------
//  サーバー起動処理 (Cloud Run対応版)
// ------------------------------------------------------------
const startServer = () => {
  console.log('--- SERVER STARTING ---');
  console.log('ENV PORT:', process.env.PORT);

  // Cloud Runはポート番号を環境変数PORTで渡してくるため、それを優先する。
  // なければ 8080 (Cloud Runのデフォルト) を使う。
  const port = process.env.PORT ? Number(process.env.PORT) : 8080;
  
  // 重要: コンテナ外からアクセスできるように '0.0.0.0' でリッスンする
  const host = '0.0.0.0';

  console.log(`Attempting to bind to http://${host}:${port}`);

  app.listen(port, host, () => {
    console.log(`✅ SERVER RUNNING: Listening on http://${host}:${port}`);
  });
};

startServer();
