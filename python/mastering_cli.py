#!/usr/bin/env python3
"""
AI mastering CLI powered by ffmpeg/ffprobe.

Modes:
    analyze <input_file>                   -> emits measured metrics JSON
    master <input_file> <output_file> ...  -> renders mastering chain + emits final metrics JSON

Both modes rely on ffmpeg + ffprobe binaries being available on the host.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


FFMPEG_BIN = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = os.environ.get("FFPROBE_BIN", "ffprobe")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AI Mastering CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Measure loudness / peak metrics for an input file.")
    analyze.add_argument("input_file", type=Path)
    analyze.add_argument("--tag", type=str, default="analyze")

    master = subparsers.add_parser("master", help="Run DSP chain and export mastered audio.")
    master.add_argument("input_file", type=Path)
    master.add_argument("output_file", type=Path)
    master.add_argument("--target-lufs", type=float, default=-14.0)
    master.add_argument("--true-peak", type=float, default=-1.0)
    master.add_argument("--input-trim-db", type=float, default=0.0)
    master.add_argument("--comp-threshold", type=float, default=-13.0)
    master.add_argument("--comp-ratio", type=float, default=1.6)
    master.add_argument("--attack", type=float, default=12.0, help="Compressor attack in milliseconds.")
    master.add_argument("--release", type=float, default=80.0, help="Compressor release in milliseconds.")
    master.add_argument("--eq-low-hz", type=float, default=120.0)
    master.add_argument("--eq-low-db", type=float, default=-0.8)
    master.add_argument("--eq-low-q", type=float, default=0.7)
    master.add_argument("--eq-high-hz", type=float, default=3500.0)
    master.add_argument("--eq-high-db", type=float, default=0.6)
    master.add_argument("--eq-high-q", type=float, default=0.7)
    master.add_argument("--limiter-ceiling", type=float, default=-1.0)
    master.add_argument("--limiter-lookahead", type=float, default=1.0, help="Reserved for future limiter improvements.")
    master.add_argument("--limiter-release", type=float, default=40.0, help="Limiter release in milliseconds.")
    master.add_argument("--platform", type=str, default="streaming")
    master.add_argument("--profile-name", type=str, default="Streaming Default")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        ensure_binaries()
        if args.command == "analyze":
            metrics = measure_audio(args.input_file, tag=args.tag)
            print(json.dumps({"metrics": metrics}))
            return

        args.output_file.parent.mkdir(parents=True, exist_ok=True)
        render_master(args)
        final_metrics = measure_audio(args.output_file, tag="mastered")
        print(
            json.dumps(
                {
                    "finalMetrics": final_metrics,
                    "outputFile": str(args.output_file),
                    "platform": args.platform,
                    "profileName": args.profile_name,
                }
            )
        )
    except Exception as exc:  # pragma: no cover - surfaced to Node caller
        print(f"[mastering_cli] {exc}", file=sys.stderr)
        sys.exit(1)


def ensure_binaries() -> None:
    for binary in (FFMPEG_BIN, FFPROBE_BIN):
        if shutil.which(binary) is None:
            raise RuntimeError(
                f"Required binary '{binary}' was not found on PATH. "
                "Install ffmpeg/ffprobe or set FFMPEG_BIN / FFPROBE_BIN."
            )


def render_master(args: argparse.Namespace) -> None:
    filter_chain = build_filter_chain(args)
    cmd = [
        FFMPEG_BIN,
        "-hide_banner",
        "-y",
        "-nostdin",
        "-i",
        str(args.input_file),
        "-acodec",
        "pcm_s24le",
        "-af",
        filter_chain,
        str(args.output_file),
    ]
    result = run_subprocess(cmd)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg mastering failed: {result.stderr.strip()[:600]}")


def build_filter_chain(args: argparse.Namespace) -> str:
    filters: List[str] = []
    if args.input_trim_db := getattr(args, "input_trim_db", None):
        if abs(float(args.input_trim_db)) > 0.01:
            filters.append(f"volume={float(args.input_trim_db):.3f}dB")

    threshold_amp = db_to_amplitude(args.comp_threshold)
    attack = max(args.attack / 1000.0, 0.001)
    release = max(args.release / 1000.0, 0.005)
    filters.append(
        "acompressor="
        f"threshold={threshold_amp:.6f}:ratio={max(args.comp_ratio, 1.0):.3f}:"
        f"attack={attack:.4f}:release={release:.4f}:makeup=0.0:knee=2.0"
    )

    filters.append(
        "bass="
        f"g={args.eq_low_db:.2f}:f={max(args.eq_low_hz, 20.0):.1f}:width_type=q:width={max(args.eq_low_q, 0.1):.3f}"
    )
    filters.append(
        "treble="
        f"g={args.eq_high_db:.2f}:f={max(args.eq_high_hz, 200.0):.1f}:width_type=q:width={max(args.eq_high_q, 0.1):.3f}"
    )

    limiter_limit = db_to_amplitude(args.limiter_ceiling)
    limiter_release = max(args.limiter_release / 1000.0, 0.005)
    filters.append(
        "alimiter="
        f"limit={limiter_limit:.6f}:level=1.0:attack=0.001:release={limiter_release:.4f}"
    )

    return ",".join(filters)


def measure_audio(audio_path: Path, *, tag: str) -> Dict[str, Any]:
    loudnorm_cmd = [
        FFMPEG_BIN,
        "-hide_banner",
        "-nostdin",
        "-i",
        str(audio_path),
        "-af",
        "loudnorm=I=-14:TP=-1.0:LRA=9:print_format=json",
        "-f",
        "null",
        "-",
    ]
    result = run_subprocess(loudnorm_cmd)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg loudnorm failed: {trim_log(result.stderr)}")
    stats = parse_loudnorm_json(result.stderr)
    probe = probe_stream(audio_path)

    lufs = safe_float(stats.get("input_i"))
    true_peak = safe_float(stats.get("input_tp"))
    crest = round((true_peak - lufs), 1) if lufs is not None and true_peak is not None else None

    sample_rate = None
    bit_depth = None
    if probe:
        sr = probe.get("sample_rate")
        if sr:
            sample_rate = round(float(sr) / 1000.0, 1)
        bit_depth = resolve_bit_depth(probe)

    metrics: Dict[str, Any] = {
        "lufs": round(lufs, 1) if isinstance(lufs, float) else None,
        "truePeak": round(true_peak, 1) if isinstance(true_peak, float) else None,
        "crest": crest,
        "sampleRate": sample_rate,
        "bitDepth": bit_depth,
        "notes": f"{tag} metrics via ffmpeg loudnorm ({audio_path.name})",
    }
    return metrics


def probe_stream(audio_path: Path) -> Dict[str, Any]:
    cmd = [
        FFPROBE_BIN,
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels,bits_per_sample,bits_per_raw_sample,sample_fmt",
        "-of",
        "json",
        str(audio_path),
    ]
    result = run_subprocess(cmd)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {audio_path}: {trim_log(result.stderr)}")
    data = json.loads(result.stdout or "{}")
    streams = data.get("streams") or []
    return streams[0] if streams else {}


def resolve_bit_depth(probe: Dict[str, Any]) -> Optional[str]:
    for key in ("bits_per_sample", "bits_per_raw_sample"):
        value = probe.get(key)
        if value:
            return f"{value}-bit"

    sample_fmt = probe.get("sample_fmt")
    if isinstance(sample_fmt, str):
        if sample_fmt.startswith("fl"):
            return "32-bit float"
        if sample_fmt.startswith("s16"):
            return "16-bit"
        if sample_fmt.startswith("s24"):
            return "24-bit"
        if sample_fmt.startswith("s32"):
            return "32-bit"
    return None


def parse_loudnorm_json(stderr_output: str) -> Dict[str, Any]:
    start = stderr_output.rfind("{")
    end = stderr_output.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise RuntimeError("Unable to parse loudnorm output.")
    snippet = stderr_output[start : end + 1]
    return json.loads(snippet)


def safe_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def db_to_amplitude(value: float) -> float:
    return max(10 ** (value / 20.0), 1e-6)


@dataclass
class CompletedProcess:
    returncode: int
    stdout: str
    stderr: str


def run_subprocess(cmd: List[str]) -> CompletedProcess:
    process = subprocess.run(cmd, capture_output=True, text=True)
    return CompletedProcess(returncode=process.returncode, stdout=process.stdout, stderr=process.stderr)


def trim_log(log: str, limit: int = 600) -> str:
    snippet = log.strip()
    return snippet[-limit:]


if __name__ == "__main__":
    main()
