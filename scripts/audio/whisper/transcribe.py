#!/usr/bin/env python3
"""Transkripsi klip audio dengan faster-whisper untuk pemeriksaan #49 (ADR-010).

Masukan (stdin): {"items": [{"key": str, "path": str, "language": "id"|"en"}]}
Keluaran (stdout, satu JSON):
  {"version": 1, "model": str, "items": [
     {"key", "transcript", "language", "languageProbability", "durationSec"} | {"key", "error"}]}
Semua log ke stderr. Exit 0 kecuali masukan rusak (exit 2).
"""

import argparse
import json
import sys

# Patch kompatibilitas: PyAV 14+ menolak kwarg `metadata_errors` yang masih dikirim faster-whisper
# saat membuka berkas audio. Buang kwarg itu sebelum diteruskan ke av.open.
try:
    import av

    _orig_av_open = av.open

    def _patched_av_open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _orig_av_open(*args, **kwargs)

    av.open = _patched_av_open
except ImportError:
    pass


def log(message):
    print(message, file=sys.stderr, flush=True)


def read_request():
    """Baca dan validasi masukan dari stdin; melempar ValueError bila rusak."""
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        raise ValueError(f"stdin bukan JSON valid: {e}") from e
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError('stdin harus berbentuk {"items": [...]}')
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"items[{i}] bukan objek")
        for field in ("key", "path", "language"):
            if not isinstance(item.get(field), str) or item[field] == "":
                raise ValueError(f"items[{i}].{field} harus string tidak kosong")
    return items


def transcribe_item(model, item):
    segments, info = model.transcribe(
        item["path"],
        language=item["language"],
        beam_size=5,
        vad_filter=True,
        temperature=0,
        condition_on_previous_text=False,
    )
    transcript = " ".join(segment.text.strip() for segment in segments).strip()
    return {
        "key": item["key"],
        "transcript": transcript,
        "language": info.language,
        "languageProbability": min(1.0, max(0.0, float(info.language_probability))),
        "durationSec": float(info.duration),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="medium")
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()

    try:
        items = read_request()
    except ValueError as e:
        log(f"Masukan rusak: {e}")
        return 2

    # Hanya JSON akhir yang boleh masuk stdout: cetakan liar pustaka dialihkan ke stderr.
    out = sys.stdout
    sys.stdout = sys.stderr

    results = []
    if items:
        # Impor dan muat model hanya bila ada yang dikerjakan (unduhan model besar).
        from faster_whisper import WhisperModel

        log(f"Memuat model {args.model} (cpu, int8) dari {args.model_dir}")
        model = WhisperModel(
            args.model, device="cpu", compute_type="int8", download_root=args.model_dir
        )
        for n, item in enumerate(items, start=1):
            log(f"[{n}/{len(items)}] {item['key']}")
            try:
                results.append(transcribe_item(model, item))
            except Exception as e:  # satu berkas rusak tidak boleh menghentikan sisanya
                results.append({"key": item["key"], "error": f"{type(e).__name__}: {e}"})

    json.dump({"version": 1, "model": args.model, "items": results}, out, ensure_ascii=False)
    out.write("\n")
    out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
