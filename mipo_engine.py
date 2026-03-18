import os
import io
import base64
import subprocess
import edge_tts
import pygetwindow as gw
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from langdetect import detect

app = FastAPI()

# Настройка CORS, чтобы React мог общаться с Python
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

# Словарь голосов (Edge-TTS)
VOICES = {
    'ru': 'ru-RU-DmitryNeural',
    'en': 'en-US-ChristopherNeural',
    'zh': 'zh-CN-YunxiNeural'
}

async def generate_audio(text: str):
    # Определяем язык текста
    try:
        lang_code = detect(text)
        if 'zh' in lang_code: lang = 'zh'
        elif lang_code == 'ru': lang = 'ru'
        else: lang = 'en'
    except:
        lang = 'ru'

    voice = VOICES.get(lang, VOICES['en'])
    
    # Генерируем аудио
    communicate = edge_tts.Communicate(text, voice)
    audio_data = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data += chunk["data"]
            
    return base64.b64encode(audio_data).decode('utf-8')

@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """Эндпоинт для озвучки текста"""
    try:
        if not request.text:
            raise HTTPException(status_code=400, detail="Текст пустой")
        audio_b64 = await generate_audio(request.text)
        return {"audio": audio_b64}
    except Exception as e:
        print(f"Ошибка TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def handle_chat(request: ChatRequest):
    """Эндпоинт для чата (получает текст, собирает контекст, возвращает ответ)"""
    active_window = "Рабочий стол"
    try:
        win = gw.getActiveWindow()
        if win: active_window = win.title
    except: pass

    # Здесь позже будет вызов твоей обученной модели Qwen
    # Пока что Мипо просто отвечает, подтверждая, что видит твои окна
    reply = f"Запрос принят. Я вижу, что у вас открыто окно: {active_window}. Вы сказали: {request.message}"
    
    return {"reply": reply}

if __name__ == "__main__":
    print(">>> Сервер MIPO запущен на порту 3001. Жду команд...")
    uvicorn.run(app, host="0.0.0.0", port=3001)