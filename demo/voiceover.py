"""Voiceover for the 30-second demo video.

Generates one WAV clip per shot with OpenAI TTS, trims the silence around
each phrase and lays them end to end into one track. The printed start times
are where each shot should begin in the edit: the video is cut to the voice.

    .venv/Scripts/python demo/voiceover.py [voice]

Reads OPENAI_API_KEY from the environment or app/.env.local.
"""
import json
import os
import sys
import urllib.request
import wave
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "audio"
MODEL = "gpt-4o-mini-tts"
VOICE = sys.argv[1] if len(sys.argv) > 1 else "onyx"
LEAD, GAP = 0.3, 0.35  # seconds of silence before the first phrase and between phrases

STYLE = (
    "Speak Russian. Confident documentary narrator of a short NASA mission video. "
    "Warm low voice, clear diction, no theatrical drama. "
    "Fast pace, about 170 words per minute, like a 30-second product trailer. "
    "Keep pauses short, even at full stops and dashes. Pronounce English names the English way: "
    "Perseverance, Marswalk Planner, NASA as 'НАСА'."
)

# One phrase per shot, in order.
SHOTS = [
    "Кратер Езеро по данным НАСА. Куда здесь дойдёт человек?",
    "Отмечаем цели - маршрут сам обходит опасные склоны.",
    "План сразу проверяется: уклоны, кислород, скафандр, свет и связь.",
    "Карта показывает, куда можно дойти - и вернуться.",
    "Повтор в 3D: кислород тает на каждом шаге.",
    "Marswalk Planner. Сначала маршрут - потом выход.",
]


def api_key():
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]
    env = ROOT.parent / "app" / ".env.local"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("OPENAI_API_KEY not found")


def tts(text, key):
    body = json.dumps({"model": MODEL, "voice": VOICE, "input": text, "instructions": STYLE, "response_format": "pcm"}).encode()
    req = urllib.request.Request("https://api.openai.com/v1/audio/speech", data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


# The API streams WAV with a placeholder length, so ask for raw PCM: 24 kHz, 16-bit, mono.
RATE, WIDTH = 24000, 2


def save_wav(path, frames):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(WIDTH)
        w.setframerate(RATE)
        w.writeframes(frames)


def trim(frames, thresh=400, pad=0.06):
    """Cut silence at both ends, keeping a short pad so consonants are not clipped."""
    n = len(frames) // WIDTH
    loud = [i for i in range(0, n, 48) if abs(int.from_bytes(frames[i * WIDTH:(i + 1) * WIDTH], "little", signed=True)) > thresh]
    if not loud:
        return frames
    a = max(0, loud[0] - int(pad * RATE))
    b = min(n, loud[-1] + int(pad * RATE))
    return frames[a * WIDTH:b * WIDTH]


def tighten(frames, thresh=400, longest=0.22):
    """Shorten pauses inside a phrase: any silence longer than `longest` s is cut down to it."""
    win = RATE // 100  # 10 ms
    chunks = [frames[i:i + win * WIDTH] for i in range(0, len(frames), win * WIDTH)]
    quiet = [max(abs(int.from_bytes(c[j:j + WIDTH], "little", signed=True)) for j in range(0, len(c), WIDTH * 4)) < thresh for c in chunks]
    keep, out, run = int(longest * 100), bytearray(), []
    for c, q in zip(chunks, quiet):
        if q:
            run.append(c)
            continue
        if run:  # keep both edges of a long pause so the fade-out and fade-in stay intact
            out += b"".join(run if len(run) <= keep else run[: keep // 2] + run[-(keep - keep // 2):])
            run = []
        out += c
    out += b"".join(run)
    return bytes(out)


def main():
    key = api_key()
    OUT.mkdir(exist_ok=True)
    silence = lambda sec: bytes(int(sec * RATE) * WIDTH)
    track, t = bytearray(silence(LEAD)), LEAD
    for i, text in enumerate(SHOTS, 1):
        frames = tighten(trim(tts(text, key)))
        save_wav(OUT / f"shot{i}_{VOICE}.wav", frames)
        dur = len(frames) / (RATE * WIDTH)
        print(f"shot{i}: voice {t:5.2f}-{t + dur:5.2f} s  {text}")
        track += frames + silence(GAP)
        t += dur + GAP
    save_wav(OUT / f"voiceover_{VOICE}.wav", bytes(track))
    print(f"total {t:.2f} s -> {OUT / f'voiceover_{VOICE}.wav'}")


if __name__ == "__main__":
    main()
