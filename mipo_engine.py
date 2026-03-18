import os
import io
import base64
import asyncio
import edge_tts
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from langdetect import detect

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

class ChatRequest(BaseModel):
    message: str

class TTSRequest(BaseModel):
    text: str

# Голоса Edge-TTS по языку
VOICES = {
    'ru': 'ru-RU-DmitryNeural',
    'en': 'en-US-ChristopherNeural',
    'zh': 'zh-CN-YunxiNeural'
}

async def generate_audio(text: str) -> str:
    """Генерирует аудио через Edge-TTS и возвращает base64-строку."""
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

@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """Эндпоинт для озвучки текста. Возвращает аудио в base64."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Текст пустой")
    try:
        audio_b64 = await generate_audio(request.text)
        return {"audio": audio_b64}
    except Exception as e:
        print(f"Ошибка TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def handle_chat(request: ChatRequest):
    """
    Эндпоинт для чата. Принимает текст от фронтенда и возвращает ответ + аудио.
    Здесь будет вызов обученной модели (Qwen или другой).
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Сообщение пустое")

    # TODO: заменить на вызов локальной модели (Qwen и т.д.)
    reply = f"Запрос принят. Вы сказали: {request.message}"

    # Генерируем аудио для ответа
    try:
        audio_b64 = await generate_audio(reply)
    except Exception:
        audio_b64 = None

    return {"reply": reply, "audio": audio_b64}

if __name__ == "__main__":
    print(">>> MIPO Engine запущен на порту 8000...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
