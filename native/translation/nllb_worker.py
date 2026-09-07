#!/usr/bin/env python3
"""Persistent JSON-lines NLLB worker used by the macOS development adapter."""
import json
import sys

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

MODEL_ID = "facebook/nllb-200-distilled-600M"
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, src_lang="jpn_Jpan")
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
model.eval()

for line in sys.stdin:
    try:
        payload = json.loads(line)
        texts = payload.get("texts", [])
        if not texts:
            result = {"translations": []}
        else:
            encoded = tokenizer(texts, return_tensors="pt", padding=True, truncation=True, max_length=512)
            generated = model.generate(**encoded, forced_bos_token_id=tokenizer.convert_tokens_to_ids(payload.get("targetLanguage", "zho_Hans")), max_new_tokens=256)
            result = {"translations": tokenizer.batch_decode(generated, skip_special_tokens=True)}
    except Exception as error:
        result = {"error": str(error)}
    print("YOMI_NLLB_RESULT:" + json.dumps(result, ensure_ascii=False), flush=True)
