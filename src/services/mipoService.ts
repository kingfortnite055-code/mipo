// src/services/mipoService.ts
// Утилита для прямого вызова MIPO Engine (опциональная, для переиспользования)

const MIPO_ENGINE_URL = 'http://localhost:8000';

export interface MipoResponse {
  reply: string;
  audio?: string; // base64 mp3
}

export async function sendMessage(message: string): Promise<MipoResponse> {
  try {
    const response = await fetch(`${MIPO_ENGINE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`Сервер MIPO вернул ошибку: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('MIPO Service Error:', error);
    return {
      reply: 'СИСТЕМНЫЙ СБОЙ: MIPO Engine не отвечает. Проверьте порт 8000.',
    };
  }
}

export async function synthesizeSpeech(text: string): Promise<string | null> {
  try {
    const response = await fetch(`${MIPO_ENGINE_URL}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw new Error('TTS недоступен');
    const data = await response.json();
    return data.audio ?? null;
  } catch (error) {
    console.error('TTS Error:', error);
    return null;
  }
}
