import base64
import json
import os
import re
import sys

# Force UTF-8 I/O encoding on Windows where system default is often gbk/cp936
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Packaged clients ship the Apache-2.0 Meiki ONNX weights next to this worker.
# Force Hugging Face into offline mode so OCR never depends on Python, a daemon,
# or a network request after NSTrans has been installed.
if getattr(sys, "frozen", False):
    os.environ.setdefault("HF_HOME", os.path.join(sys._MEIPASS, "huggingface"))
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

import cv2
import numpy as np
from meikiocr import MeikiOCR

engine = MeikiOCR()
JAPANESE_CHARACTER = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
CONTROLLER_CHARACTER = set("ABXYLR")


def convert_lines(results, offset_x=0, offset_y=0, scale=1.0):
    regions = []
    for line in results:
        chars = line.get("chars", [])
        text = line.get("text", "").strip()
        if not text or not chars:
            continue
        # Enlarged Switch footer crops occasionally attach the adjacent button
        # glyph to the word (e.g. 選ぶA). Remove that glyph and its character box.
        if len(text) > 1 and text[-1].upper() in CONTROLLER_CHARACTER and JAPANESE_CHARACTER.search(text[:-1]):
            text = text[:-1]
            if len(chars) > 1:
                chars = chars[:-1]
        if len(text) > 1 and text[0].upper() in CONTROLLER_CHARACTER and JAPANESE_CHARACTER.search(text[1:]):
            text = text[1:]
            if len(chars) > 1:
                chars = chars[1:]
        boxes = [char["bbox"] for char in chars]
        confidences = [float(char["conf"]) for char in chars]
        regions.append({
            "source": text,
            "translated": "",
            "confidence": sum(confidences) / len(confidences) * 100,
            "box": {
                "x0": offset_x + min(box[0] for box in boxes) / scale,
                "y0": offset_y + min(box[1] for box in boxes) / scale,
                "x1": offset_x + max(box[2] for box in boxes) / scale,
                "y1": offset_y + max(box[3] for box in boxes) / scale,
            },
            "fontFamily": "sans",
        })
    return regions


def overlap_over_smaller(a, b):
    width = max(0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    height = max(0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    intersection = width * height
    area_a = max(1, (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]))
    area_b = max(1, (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]))
    return intersection / min(area_a, area_b)


def merge_passes(primary, detail):
    merged = list(primary)
    for candidate in detail:
        duplicate_index = next((index for index, existing in enumerate(merged) if overlap_over_smaller(existing["box"], candidate["box"]) > 0.55), None)
        if duplicate_index is None:
            merged.append(candidate)
            continue
        existing = merged[duplicate_index]
        existing_text, candidate_text = existing["source"].strip(), candidate["source"].strip()
        candidate_completes_fragment = existing_text in candidate_text and len(candidate_text) > len(existing_text) and candidate["confidence"] >= 50
        same_text = existing_text.rstrip(":：") == candidate_text.rstrip(":：")
        if candidate_completes_fragment or (same_text and candidate["confidence"] > existing["confidence"]):
            merged[duplicate_index] = candidate
    return merged


for raw_line in sys.stdin:
    try:
        request = json.loads(raw_line)
        image = cv2.imdecode(np.frombuffer(base64.b64decode(request["image"]), dtype=np.uint8), cv2.IMREAD_COLOR)
        results = engine.run_ocr(
            image,
            det_threshold=float(request.get("det_threshold", 0.45)),
            rec_threshold=float(request.get("rec_threshold", 0.15)),
        )
        regions = convert_lines(results)
        # Bottom controller hints are only ~10 px high in a 560 px capture.
        # A narrow 2x pass recovers complete words such as 選ぶ without lowering
        # thresholds across the whole image and reintroducing HUD noise.
        height = image.shape[0]
        width = image.shape[1]
        bottom_y = int(height * 0.88)
        bottom_x = int(width * 0.43)
        bottom = cv2.resize(image[bottom_y:height, bottom_x:width], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        detail_results = engine.run_ocr(bottom, det_threshold=0.35, rec_threshold=0.10)
        regions = merge_passes(regions, convert_lines(detail_results, offset_x=bottom_x, offset_y=bottom_y, scale=2.0))
        for index, region in enumerate(regions):
            region["id"] = f"meiki-{index}"
        print("YOMI_RESULT:" + json.dumps({"regions": regions}, ensure_ascii=False), flush=True)
    except Exception as error:
        print("YOMI_RESULT:" + json.dumps({"regions": [], "error": str(error)}, ensure_ascii=False), flush=True)
