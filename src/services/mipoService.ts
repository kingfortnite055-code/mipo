// src/services/mipoService.ts

export interface MipoResponse {
  reply: string;
  audioBase64?: string; // Добавляем поле для аудио
}

export async function askJarvis(message: string): Promise<MipoResponse> {
  try {
    const response = await fetch('http://localhost:8000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error('Локальный агент Mipo недоступен');
    }

    // Возвращаем полный объект ответа (текст + звук)
    const data = await response.json();
    return data; 
  } catch (error) {
    console.error('Mipo Communication Error:', error);
    return { 
      reply: "СИСТЕМНЫЙ СБОЙ: Локальный агент не отвечает." 
    };
  }
}