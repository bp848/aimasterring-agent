#!/usr/bin/env python3
"""
AI mastering CLI powered by ffmpeg/ffprobe.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, asdict


@dataclass
class AudioMetrics:
  lufs: float | None
  truePeak: float | None
  crest: float | None


def run_command(cmd: list[str]) -> str:
  try:
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout
  except subprocess.CalledProcessError as e:
    print(f"Command failed: {e.cmd}", file=sys.stderr)
    print(f"STDOUT: {e.stdout}", file=sys.stderr)
    print(f"STDERR: {e.stderr}", file=sys.stderr)
    raise


def get_loudness_metrics(file_path: str) -> AudioMetrics:
  # loudnormを使って解析 (print_format=json)
  cmd = [
    'ffmpeg', '-i', file_path,
    '-af', 'loudnorm=print_format=json',
    '-f', 'null', '-'
  ]

  try:
    # ffmpegのloudnorm解析結果はstderrに出力される
    result = subprocess.run(cmd, capture_output=True, text=True)

    # stderrからJSON部分を抽出する
    stderr_output = result.stderr
    json_start = stderr_output.find('{')
    json_end = stderr_output.rfind('}') + 1

    if json_start != -1 and json_end != -1:
      json_str = stderr_output[json_start:json_end]
      data = json.loads(json_str)

      input_i = float(data.get('input_i', -99))
      input_tp = float(data.get('input_tp', -99))

      # クレストファクターの簡易計算 (Peak - RMSに近い値として)
      crest = input_tp - input_i

      return AudioMetrics(lufs=input_i, truePeak=input_tp, crest=crest)

  except Exception as e:
    print(f"Warning: Failed to parse loudnorm metrics: {e}", file=sys.stderr)

  return AudioMetrics(lufs=None, truePeak=None, crest=None)


def apply_mastering(input_path: str, output_path: str, args: argparse.Namespace):
  filters = []

  # 1. Input Trim (属性アクセスの安全な書き方に修正)
  trim_db = getattr(args, "input_trim_db", None)
  if trim_db:
    filters.append(f"volume={trim_db}dB")

  # 2. EQ Low
  eq_low_hz = getattr(args, "eq_low_hz", None)
  eq_low_db = getattr(args, "eq_low_db", None)
  eq_low_q = getattr(args, "eq_low_q", None)
  if eq_low_hz and eq_low_db and eq_low_q:
    filters.append(f"eq=frequency={eq_low_hz}:width_type=q:width={eq_low_q}:gain={eq_low_db}")

  # 3. EQ High
  eq_high_hz = getattr(args, "eq_high_hz", None)
  eq_high_db = getattr(args, "eq_high_db", None)
  eq_high_q = getattr(args, "eq_high_q", None)
  if eq_high_hz and eq_high_db and eq_high_q:
    filters.append(f"eq=frequency={eq_high_hz}:width_type=q:width={eq_high_q}:gain={eq_high_db}")

  # 4. Compressor
  comp_th = getattr(args, "comp_threshold", None)
  comp_ratio = getattr(args, "comp_ratio", None)
  comp_att = getattr(args, "attack", None)
  comp_rel = getattr(args, "release", None)

  if comp_th and comp_ratio:
    # ffmpeg acompressor expects: threshold, ratio, attack, release...
    # defaults: attack=20, release=250 (ffmpeg uses ms)
    att = comp_att if comp_att else 20
    rel = comp_rel if comp_rel else 250
    filters.append(f"acompressor=threshold={comp_th}dB:ratio={comp_ratio}:attack={att}:release={rel}")

  # 5. Limiter (alimiter)
  lim_ceil = getattr(args, "limiter_ceiling", None)
  # alimiter limit is usually close to 0 or -1.
  if lim_ceil:
    # attack is usually auto, release in ms
    lim_rel = getattr(args, "limiter_release", 100)
    filters.append(f"alimiter=limit={lim_ceil}:attack=5:release={lim_rel}")

  # 6. Loudness Normalization (Target LUFS) - Optional finish
  target_lufs = getattr(args, "target_lufs", None)
  true_peak = getattr(args, "true_peak", None)

  if target_lufs and true_peak:
    filters.append(f"loudnorm=I={target_lufs}:TP={true_peak}")

  filter_str = ",".join(filters) if filters else "anull"

  cmd = [
    'ffmpeg', '-y', '-i', input_path,
    '-af', filter_str,
    output_path
  ]

  print(f"Executing FFmpeg: {' '.join(cmd)}", file=sys.stderr)
  run_command(cmd)


def main():
  parser = argparse.ArgumentParser()
  subparsers = parser.add_subparsers(dest='mode', required=True)

  # Analyze command
  p_analyze = subparsers.add_parser('analyze')
  p_analyze.add_argument('input_file')

  # Master command
  p_master = subparsers.add_parser('master')
  p_master.add_argument('input_file')
  p_master.add_argument('output_file')

  # Mastering params
  p_master.add_argument('--target-lufs', type=float)
  p_master.add_argument('--true-peak', type=float)
  p_master.add_argument('--input-trim-db', type=float)
  p_master.add_argument('--comp-threshold', type=float)
  p_master.add_argument('--comp-ratio', type=float)
  p_master.add_argument('--attack', type=float)
  p_master.add_argument('--release', type=float)
  p_master.add_argument('--eq-low-hz', type=float)
  p_master.add_argument('--eq-low-db', type=float)
  p_master.add_argument('--eq-low-q', type=float)
  p_master.add_argument('--eq-high-hz', type=float)
  p_master.add_argument('--eq-high-db', type=float)
  p_master.add_argument('--eq-high-q', type=float)
  p_master.add_argument('--limiter-ceiling', type=float)
  p_master.add_argument('--limiter-lookahead', type=float)
  p_master.add_argument('--limiter-release', type=float)
  p_master.add_argument('--platform', type=str)
  p_master.add_argument('--profile-name', type=str)

  args = parser.parse_args()

  if args.mode == 'analyze':
    metrics = get_loudness_metrics(args.input_file)
    print(json.dumps({"metrics": asdict(metrics)}))

  elif args.mode == 'master':
    apply_mastering(args.input_file, args.output_file, args)
    # マスタリング後の再測定
    final_metrics = get_loudness_metrics(args.output_file)
    print(json.dumps({"finalMetrics": asdict(final_metrics)}))


if __name__ == '__main__':
  main()
