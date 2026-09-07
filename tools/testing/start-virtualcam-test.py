"""
Virtual USB Camera Streamer for NSTrans Testing
Streams simulated Nintendo Switch Japanese game scenes into OBS Virtual Camera at 30 FPS.
"""
import math
import sys
import time
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import pyvirtualcam

WIDTH = 1280
HEIGHT = 720
FPS = 30
SCENE_DURATION_SEC = 5.0

# Fonts
FONT_CANDIDATES_BOLD = [
    r"C:\Windows\Fonts\YuGothB.ttc",
    r"C:\Windows\Fonts\msgothic.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
]
FONT_CANDIDATES_REGULAR = [
    r"C:\Windows\Fonts\YuGothM.ttc",
    r"C:\Windows\Fonts\msgothic.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
]

def load_font(candidates, size):
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

font_title = load_font(FONT_CANDIDATES_BOLD, 30)
font_speaker = load_font(FONT_CANDIDATES_BOLD, 26)
font_dialogue = load_font(FONT_CANDIDATES_REGULAR, 32)
font_hint = load_font(FONT_CANDIDATES_REGULAR, 22)
font_hud = load_font(FONT_CANDIDATES_BOLD, 20)

SCENES = [
    {
        "title": "ゼルダの伝説 ティアーズ オブ ザ キングダム風",
        "bg_top": (15, 25, 45),
        "bg_bottom": (35, 55, 75),
        "speaker": "ゼルダ",
        "lines": [
            "リンク… 目を覚まして…",
            "厄災ガノンを討ち破り、ハイラルの地を救ってください。"
        ],
        "button": "A 次へ"
    },
    {
        "title": "ポケットモンスター風 バトル会話",
        "bg_top": (40, 20, 30),
        "bg_bottom": (80, 45, 60),
        "speaker": "ネモ",
        "lines": [
            "すごいバトルだったね！",
            "キミとポケモンたちのコンビネーション、最高だよ！"
        ],
        "button": "A つづける"
    },
    {
        "title": "ゼノブレイド風 クエスト進行",
        "bg_top": (20, 40, 35),
        "bg_bottom": (45, 75, 65),
        "speaker": "レックス",
        "lines": [
            "オレたちの力を見せてやろうぜ！",
            "楽園を目指して、最後まで諦めずに進むんだ！"
        ],
        "button": "A 送る"
    },
    {
        "title": "RPGメニュー画面 道具リスト",
        "bg_top": (25, 25, 35),
        "bg_bottom": (50, 50, 65),
        "speaker": "所持品メニュー",
        "lines": [
            "やくそう - HPを50回復する。",
            "退魔の剣 - 邪悪を打ち払う伝説のマスターソード。"
        ],
        "button": "B とじる"
    },
    {
        "title": "ボス対決前 宿敵の言葉",
        "bg_top": (45, 15, 15),
        "bg_bottom": (75, 25, 25),
        "speaker": "魔王ガノン",
        "lines": [
            "よくぞここまで辿り着いたな、勇者よ。",
            "だが貴様らの希望も、この暗黒の力で終わりだ！"
        ],
        "button": "A 戦闘開始"
    },
]

def render_frame(frame_idx, timestamp):
    scene_idx = int(timestamp // SCENE_DURATION_SEC) % len(SCENES)
    scene = SCENES[scene_idx]
    
    # Animated background gradient with subtle pulse
    img = Image.new("RGB", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(img)
    
    # Gradient interpolation
    t = (math.sin(timestamp * 1.5) + 1.0) / 2.0
    r1, g1, b1 = scene["bg_top"]
    r2, g2, b2 = scene["bg_bottom"]
    
    # Draw gradient lines (step by 4 for efficiency)
    for y in range(0, HEIGHT, 4):
        ratio = y / HEIGHT
        r = int(r1 + (r2 - r1) * ratio + t * 5)
        g = int(g1 + (g2 - g1) * ratio + t * 5)
        b = int(b1 + (b2 - b1) * ratio + t * 5)
        draw.rectangle([0, y, WIDTH, y + 4], fill=(r, g, b))
    
    # Floating particles to simulate active video motion
    for p_idx in range(15):
        speed = 0.3 + (p_idx % 5) * 0.15
        px = int((p_idx * 97 + timestamp * 60 * speed) % WIDTH)
        py = int((p_idx * 61 + math.sin(timestamp + p_idx) * 40 + 200) % 450)
        draw.ellipse([px, py, px + 5, py + 5], fill=(240, 240, 255, 120))
    
    # Top HUD Bar
    draw.rectangle([0, 0, WIDTH, 50], fill=(15, 18, 24))
    draw.text((25, 12), f"NSTrans Test Cam | {scene['title']}", font=font_hud, fill=(200, 220, 255))
    fps_text = f"CAM: 30 FPS | TIME: {timestamp:.1f}s | SCENE: {scene_idx + 1}/{len(SCENES)}"
    draw.text((WIDTH - 420, 12), fps_text, font=font_hud, fill=(150, 255, 180))

    # Switch Game Dialogue Box (Bottom Area, ~480px to ~670px)
    box_x0, box_y0, box_x1, box_y1 = 90, 480, 1190, 675
    # Dark dialogue box with gold/blue border
    draw.rectangle([box_x0, box_y0, box_x1, box_y1], fill=(18, 22, 30), outline=(210, 185, 110), width=3)
    
    # Speaker name plate
    speaker_w = len(scene["speaker"]) * 30 + 40
    draw.rectangle([box_x0 + 30, box_y0 - 24, box_x0 + 30 + speaker_w, box_y0 + 16], fill=(30, 40, 55), outline=(210, 185, 110), width=2)
    draw.text((box_x0 + 48, box_y0 - 20), scene["speaker"], font=font_speaker, fill=(255, 230, 130))
    
    # Dialogue Text lines
    start_y = box_y0 + 35
    for i, line in enumerate(scene["lines"]):
        draw.text((box_x0 + 45, start_y + i * 50), line, font=font_dialogue, fill=(255, 255, 255))
    
    # Controller prompt hint at bottom right of dialogue box
    blink = int(timestamp * 2) % 2 == 0
    if blink:
        draw.text((box_x1 - 140, box_y1 - 38), scene["button"], font=font_hint, fill=(255, 220, 100))

    # Convert to BGR for OpenCV / DirectShow
    frame = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    return frame

def main():
    print("=" * 60, flush=True)
    print("NSTrans Japanese Test Video Streamer (Virtual USB Camera)", flush=True)
    print(f"Resolution: {WIDTH}x{HEIGHT} @ {FPS} FPS", flush=True)
    print("Streaming Japanese RPG game scenes to 'OBS Virtual Camera'...", flush=True)
    print("=" * 60, flush=True)

    try:
        with pyvirtualcam.Camera(width=WIDTH, height=HEIGHT, fps=FPS, fmt=pyvirtualcam.PixelFormat.BGR) as cam:
            print(f"Virtual camera active: {cam.device}", flush=True)
            print("Ready! You can now launch NSTrans to test live OCR and translation.", flush=True)
            
            frame_idx = 0
            start_time = time.time()
            last_report = 0
            
            while True:
                now = time.time()
                timestamp = now - start_time
                frame = render_frame(frame_idx, timestamp)
                cam.send(frame)
                cam.sleep_until_next_frame()
                frame_idx += 1

                if int(timestamp) // 5 > last_report:
                    last_report = int(timestamp) // 5
                    scene_idx = int(timestamp // SCENE_DURATION_SEC) % len(SCENES)
                    print(f"[{time.strftime('%H:%M:%S')}] Streaming frame #{frame_idx} | Scene {scene_idx+1}/{len(SCENES)}: {SCENES[scene_idx]['speaker']} - {SCENES[scene_idx]['lines'][0]}", flush=True)
                
    except KeyboardInterrupt:
        print("\nStreaming stopped by user.", flush=True)
    except Exception as e:
        print(f"Error starting virtual camera: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
