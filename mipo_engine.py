"""
MIPO Engine — локальный бэкенд на FastAPI
Модель: Qwen3-14B с адаптером mipo_adapter.gguf (Unsloth merged GGUF)
Запуск: python mipo_engine.py
"""

import os
import base64
import asyncio
from pathlib import Path
from typing import List

import edge_tts
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langdetect import detect
from llama_cpp import Llama

# ─────────────────────────────────────────────
# КОНФИГУРАЦИЯ — поправь пути под себя
# ─────────────────────────────────────────────

# Если mipo_adapter.gguf — это merged модель (скорее всего так после Unsloth):
MIPO_MODEL_PATH = "./mipo_adapter.gguf"

# Если вдруг это отдельный LoRA адаптер, укажи путь к базовой модели:
# BASE_MODEL_PATH = "./Qwen3-14B-Q4_K_M.gguf"
# LORA_PATH = "./mipo_adapter.gguf"

# Параметры загрузки
N_GPU_LAYERS = 20       # Сколько слоёв на GPU (при 2-4GB VRAM — от 10 до 25, подбери)
N_CTX = 4096            # Контекстное окно
N_THREADS = 6           # Потоки CPU (подбери под свой проц)
MAX_TOKENS = 512        # Максимум токенов в ответе

# Системный промпт — личность MIPO
SYSTEM_PROMPT = """Ты — MIPO, персональный ИИ-ассистент. 
Ты умный, лаконичный, иногда с юмором. 
Отвечаешь на языке пользователя (русский или английский).
Ты работаешь локально на компьютере пользователя и помогаешь с любыми задачами."""

# ─────────────────────────────────────────────
# ЗАГРУЗКА МОДЕЛИ
# ─────────────────────────────────────────────

print(">>> Загружаю MIPO модель...")

if not Path(MIPO_MODEL_PATH).exists():
    raise FileNotFoundError(
        f"Модель не найдена: {MIPO_MODEL_PATH}\n"
        "Убедись что mipo_adapter.gguf лежит рядом с mipo_engine.py"
    )

llm = Llama(
    model_path=MIPO_MODEL_PATH,
    n_gpu_layers=N_GPU_LAYERS,   # Слои на GPU для ускорения
    n_ctx=N_CTX,
    n_threads=N_THREADS,
    verbose=False,               # True если хочешь видеть логи модели
    use_mlock=False,             # True = держать модель в RAM (осторожно при 16GB)
)

# Если mipo_adapter.gguf — это отдельный LoRA (раскомментируй если нужно):
# llm = Llama(
#     model_path=BASE_MODEL_PATH,
#     lora_path=LORA_PATH,
#     n_gpu_layers=N_GPU_LAYERS,
#     n_ctx=N_CTX,
#     n_threads=N_THREADS,
#     verbose=False,
# )

print(">>> Модель загружена успешно!")

# ─────────────────────────────────────────────
# FASTAPI
# ─────────────────────────────────────────────

app = FastAPI(title="MIPO Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# МОДЕЛИ ЗАПРОСОВ
# ─────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str   # "user" или "assistant"
    text: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []  # История предыдущих сообщений

class TTSRequest(BaseModel):
    text: str

# ─────────────────────────────────────────────
# ГОЛОСА TTS
# ─────────────────────────────────────────────

VOICES = {
    'ru': 'ru-RU-DmitryNeural',
    'en': 'en-US-ChristopherNeural',
    'zh': 'zh-CN-YunxiNeural',
}

async def generate_audio(text: str) -> str:
    """Генерирует аудио через Edge-TTS, возвращает base64."""
    try:
        lang_code = detect(text)
        if 'zh' in lang_code:
            lang = 'zh'
        elif lang_code == 'ru':
            lang = 'ru'
        else:
            lang = 'en'
    except Exception:
        lang = 'ru'

    voice = VOICES.get(lang, VOICES['en'])
    communicate = edge_tts.Communicate(text, voice)
    audio_data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]

    return base64.b64encode(audio_data).decode('utf-8')

# ─────────────────────────────────────────────
# ГЕНЕРАЦИЯ ОТВЕТА МОДЕЛИ
# ─────────────────────────────────────────────

def build_prompt(message: str, history: List[ChatMessage]) -> str:
    """
    Строит промпт в формате ChatML (стандарт для Qwen3).
    """
    prompt = f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"

    # Добавляем историю (последние 10 сообщений чтобы не переполнить контекст)
    recent_history = history[-10:] if len(history) > 10 else history
    for msg in recent_history:
        role = "user" if msg.role == "user" else "assistant"
        prompt += f"<|im_start|>{role}\n{msg.text}<|im_end|>\n"

    # Текущее сообщение
    prompt += f"<|im_start|>user\n{message}<|im_end|>\n"
    prompt += "<|im_start|>assistant\n"

    return prompt

def generate_response(message: str, history: List[ChatMessage]) -> str:
    """Запускает инференс модели синхронно."""
    prompt = build_prompt(message, history)

    output = llm(
        prompt,
        max_tokens=MAX_TOKENS,
        temperature=0.7,
        top_p=0.9,
        top_k=40,
        repeat_penalty=1.1,
        stop=["<|im_end|>", "<|im_start|>"],
        echo=False,
    )

    reply = output["choices"][0]["text"].strip()
    return reply if reply else "..."

# ─────────────────────────────────────────────
# ЭНДПОИНТЫ
# ─────────────────────────────────────────────

@app.post("/api/chat")
async def handle_chat(request: ChatRequest):
    """
    Принимает сообщение + историю, возвращает ответ модели + аудио.
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Сообщение пустое")

    # Запускаем модель в отдельном потоке (не блокируем event loop)
    loop = asyncio.get_event_loop()
    reply = await loop.run_in_executor(
        None, generate_response, request.message, request.history
    )

    # Генерируем аудио
    try:
        audio_b64 = await generate_audio(reply)
    except Exception as e:
        print(f"Ошибка TTS: {e}")
        audio_b64 = None

    return {"reply": reply, "audio": audio_b64}


@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """Отдельный эндпоинт для озвучки текста."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Текст пустой")
    try:
        audio_b64 = await generate_audio(request.text)
        return {"audio": audio_b64}
    except Exception as e:
        print(f"Ошибка TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Проверка состояния сервера."""
    return {"status": "ok", "model": MIPO_MODEL_PATH}


# ─────────────────────────────────────────────
# ЗАПУСК
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════╗
║         MIPO ENGINE v1.0 ONLINE          ║
╠══════════════════════════════════════════╣
║  Port:   8000                            ║
║  Model:  mipo_adapter.gguf               ║
║  GPU:    {N_GPU_LAYERS} layers offloaded{' ' * (27 - len(str(N_GPU_LAYERS)))}║
╚══════════════════════════════════════════╝
    """)

    uvicorn.run(app, host="0.0.0.0", port=8000)
