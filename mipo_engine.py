"""
MIPO Engine — локальный бэкенд на FastAPI
Модель: Qwen3-14B с адаптером mipo_adapter.gguf (Unsloth merged GGUF)
Запуск: python mipo_engine.py
"""

import os
import re
import json
import base64
import asyncio
import httpx
from pathlib import Path
from typing import List, Optional, Any

import edge_tts
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from llama_cpp import Llama

# ─────────────────────────────────────────────
# КОНФИГУРАЦИЯ — поправь пути под себя
# ─────────────────────────────────────────────

MIPO_MODEL_PATH = "/mipo_adapter.gguf"

N_GPU_LAYERS = 20
N_CTX = 8192
N_THREADS = 6
MAX_TOKENS = 1024

# Опциональный Tavily API ключ для лучшего поиска
# Бесплатно 1000 запросов/мес: https://tavily.com
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

SYSTEM_PROMPT = """Ты — MIPO, персональный ИИ-ассистент. 
Ты умный, лаконичный, иногда с юмором. 
Отвечаешь на языке пользователя (русский или английский).
Ты работаешь локально на компьютере пользователя и помогаешь с любыми задачами.

## Доступные инструменты:
Когда нужно — вызывай инструменты в формате: <tool>{"name": "tool_name", "args": {...}}</tool>

### Интернет:
- web_search(query) — поиск актуальной информации в интернете

### Файлы и папки:
- list_files(dir) — список файлов в папке (dir опционален, по умолчанию домашняя)
- read_file(path) — прочитать содержимое файла (текстовые, до 50KB)
- write_file(path, content) — создать или перезаписать файл
- delete_file(path) — удалить файл или папку
- rename_file(from, to) — переименовать или переместить файл/папку
- mkdir(dir) — создать папку
- open_file(path) — открыть файл или папку в системе

### Система:
- system_stats() — CPU, RAM, uptime, модель процессора
- screenshot() — сделать скриншот экрана
- shell(command) — выполнить команду в терминале

### Браузер (требует Playwright):
- browser_open(url) — открыть URL в браузере
- browser_click(selector?, text?, x?, y?) — кликнуть по элементу или координатам
- browser_type(selector, text, press?) — ввести текст в поле (press: "Enter", "Tab" и т.д.)
- browser_read(selector?) — прочитать текст страницы или конкретного элемента
- browser_screenshot() — скриншот текущей страницы браузера
- browser_scroll(direction?, amount?) — прокрутить страницу (direction: up/down)
- browser_eval(code) — выполнить JS на странице, получить результат
- browser_tabs() — список открытых вкладок
- browser_tab(index) — переключиться на вкладку по номеру
- browser_back() — кнопка «Назад»
- browser_forward() — кнопка «Вперёд»
- browser_close() — закрыть браузер

## Правила:
- При write_file, delete_file, rename_file — всегда спрашивай подтверждение у пользователя перед выполнением, если он явно не сказал "сделай"
- Системные пути защищены bridge и вернут ошибку — не пытайся их трогать
- Для поиска в интернете всегда используй web_search, не выдумывай актуальные данные
- Shell команды выполняй осторожно, объясняй что делаешь"""

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
    n_gpu_layers=N_GPU_LAYERS,
    n_ctx=N_CTX,
    n_threads=N_THREADS,
    verbose=False,
    use_mlock=False,
)

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
    role: str
    text: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    bridge_url: Optional[str] = None
    voice: Optional[str] = "ru-RU-DmitryNeural"
    screen_frame: Optional[str] = None

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "ru-RU-DmitryNeural"

# ─────────────────────────────────────────────
# ВЕБ-ПОИСК
# ─────────────────────────────────────────────

async def web_search(query: str, max_results: int = 5) -> str:
    """Поиск через Tavily (если есть ключ) или DuckDuckGo (бесплатно)."""

    if TAVILY_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": TAVILY_API_KEY, "query": query, "max_results": max_results, "search_depth": "basic"}
                )
                if resp.status_code == 200:
                    results = resp.json().get("results", [])
                    snippets = [f"[{r['title']}] {r['content'][:300]}" for r in results[:max_results]]
                    return "\n\n".join(snippets) if snippets else "Результаты не найдены."
        except Exception as e:
            print(f"Tavily error: {e}")

    # Fallback: DuckDuckGo без API ключа
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(
                "https://ddg-webapp-aagd.vercel.app/search",
                params={"q": query, "max_results": max_results}
            )
            if resp.status_code == 200:
                data = resp.json()
                snippets = [
                    f"[{r.get('title', '')}] {r.get('body', '')[:300]}"
                    for r in data[:max_results] if r.get('body')
                ]
                return "\n\n".join(snippets) if snippets else "Результаты не найдены."
    except Exception as e:
        print(f"DDG error: {e}")

    return "Поиск временно недоступен."

# ─────────────────────────────────────────────
# ВЫЗОВ BRIDGE
# ─────────────────────────────────────────────

async def call_bridge(bridge_url: str, endpoint: str, method: str = "GET", data: dict = None) -> Any:
    url = f"{bridge_url.rstrip('/')}/{endpoint.lstrip('/')}"
    headers = {"ngrok-skip-browser-warning": "true", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if method == "POST":
                resp = await client.post(url, json=data or {}, headers=headers)
            else:
                resp = await client.get(url, params=data or {}, headers=headers)
            if resp.status_code == 200:
                return resp.json()
            return {"error": f"Bridge вернул {resp.status_code}: {resp.text[:200]}"}
    except Exception as e:
        return {"error": str(e)}

# ─────────────────────────────────────────────
# ВЫПОЛНЕНИЕ ИНСТРУМЕНТОВ
# ─────────────────────────────────────────────

TOOL_PATTERN = re.compile(r'<tool>(.*?)</tool>', re.DOTALL)

async def execute_tool(tool_call: dict, bridge_url: Optional[str]) -> str:
    name = tool_call.get("name", "")
    args = tool_call.get("args", {})

    # ── Веб-поиск (не требует bridge) ──────────────
    if name == "web_search":
        result = await web_search(args.get("query", ""))
        return f"[Результат поиска]\n{result}"

    # ── Все остальные требуют bridge ────────────────
    if not bridge_url:
        return "[Ошибка] Local Bridge не подключён. Запусти node local-bridge.cjs на ПК."

    # ── Список файлов ───────────────────────────────
    if name == "list_files":
        r = await call_bridge(bridge_url, "ls", "GET", {"dir": args.get("dir", "")})
        if "error" in r:
            return f"[Ошибка] {r['error']}"
        items = r.get("items", [])
        lines = [f"{'📁' if i['type']=='folder' else '📄'} {i['name']}" + (f"  ({i['size']} б)" if i.get('size') else "") for i in items[:60]]
        return f"[Файлы в {r.get('dir', '')}]\n" + "\n".join(lines)

    # ── Чтение файла ────────────────────────────────
    if name == "read_file":
        r = await call_bridge(bridge_url, "read", "GET", {"file": args.get("path", "")})
        if "error" in r:
            return f"[Ошибка чтения] {r['error']}"
        content = r.get("content", "")
        return f"[Содержимое файла: {args.get('path', '')}]\n{content[:3000]}"

    # ── Запись файла ────────────────────────────────
    if name == "write_file":
        r = await call_bridge(bridge_url, "write", "POST", {
            "file": args.get("path", ""),
            "content": args.get("content", "")
        })
        if "error" in r:
            return f"[Ошибка записи] {r['error']}"
        return f"[Файл сохранён: {args.get('path', '')}]"

    # ── Удаление файла/папки ─────────────────────────
    if name == "delete_file":
        r = await call_bridge(bridge_url, "delete", "POST", {"file": args.get("path", "")})
        if "error" in r:
            return f"[Ошибка удаления] {r['error']}"
        return f"[Удалено: {args.get('path', '')}]"

    # ── Переименование/перемещение ───────────────────
    if name == "rename_file":
        r = await call_bridge(bridge_url, "rename", "POST", {
            "from": args.get("from", ""),
            "to":   args.get("to", "")
        })
        if "error" in r:
            return f"[Ошибка переименования] {r['error']}"
        return f"[Переименовано: {args.get('from', '')} → {args.get('to', '')}]"

    # ── Создание папки ──────────────────────────────
    if name == "mkdir":
        r = await call_bridge(bridge_url, "mkdir", "POST", {"dir": args.get("dir", "")})
        if "error" in r:
            return f"[Ошибка создания папки] {r['error']}"
        return f"[Папка создана: {args.get('dir', '')}]"

    # ── Открытие файла/папки ────────────────────────
    if name == "open_file":
        r = await call_bridge(bridge_url, "open", "POST", {"path": args.get("path", ""), "type": "file"})
        if "error" in r:
            return f"[Ошибка открытия] {r['error']}"
        return f"[Открыто: {args.get('path', '')}]"

    # ── Скриншот ────────────────────────────────────
    if name == "screenshot":
        r = await call_bridge(bridge_url, "screenshot", "GET")
        if "screenshot" in r:
            return f"[SCREENSHOT_B64]{r['screenshot']}[/SCREENSHOT_B64]"
        return f"[Ошибка скриншота] {r.get('error', '')}"

    # ── Статистика системы ──────────────────────────
    if name == "system_stats":
        r = await call_bridge(bridge_url, "stats", "GET")
        if "error" in r:
            return f"[Ошибка] {r['error']}"
        return (
            f"[Система]\n"
            f"CPU: {r.get('cpu', '?')}%\n"
            f"RAM: {r.get('ram', '?')}% ({r.get('freeMem', '?')} GB свободно из {r.get('totalMem', '?')} GB)\n"
            f"Uptime: {r.get('uptime', '?')} мин\n"
            f"ПК: {r.get('hostname', '?')} | {r.get('cpuModel', '?')} ({r.get('cpuCores', '?')} ядер)"
        )

    # ── Терминал ─────────────────────────────────────
    if name == "shell":
        r = await call_bridge(bridge_url, "shell", "POST", {"command": args.get("command", "")})
        output = r.get("output", r.get("error", "Нет вывода"))
        return f"[Терминал]\n{output}"

    # ── Браузер ───────────────────────────────────────
    if name == "browser_open":
        url = args.get("url", "")
        if not url: return "[Ошибка] url обязателен"
        r = await call_bridge(bridge_url, "browser/open", "POST", {"url": url})
        if "error" in r: return f"[Ошибка браузера] {r['error']}"
        return f"[Браузер открыт]\nURL: {r.get('url', url)}\nЗаголовок: {r.get('title', '')}"

    if name == "browser_click":
        r = await call_bridge(bridge_url, "browser/click", "POST", {
            "selector": args.get("selector"),
            "text":     args.get("text"),
            "x":        args.get("x"),
            "y":        args.get("y"),
        })
        if "error" in r: return f"[Ошибка клика] {r['error']}"
        return "[Клик выполнен]"

    if name == "browser_type":
        r = await call_bridge(bridge_url, "browser/type", "POST", {
            "selector": args.get("selector"),
            "text":     args.get("text", ""),
            "press":    args.get("press"),
        })
        if "error" in r: return f"[Ошибка ввода] {r['error']}"
        return "[Текст введён]"

    if name == "browser_read":
        r = await call_bridge(bridge_url, "browser/read", "GET",
                              {"selector": args.get("selector", "")})
        if "error" in r: return f"[Ошибка чтения] {r['error']}"
        return (f"[Страница: {r.get('title', '')}]\n"
                f"URL: {r.get('url', '')}\n\n"
                f"{r.get('content', '')}")

    if name == "browser_screenshot":
        r = await call_bridge(bridge_url, "browser/screenshot", "GET")
        if "screenshot" in r:
            return f"[SCREENSHOT_B64]{r['screenshot']}[/SCREENSHOT_B64]"
        return f"[Ошибка скриншота браузера] {r.get('error', '')}"

    if name == "browser_scroll":
        r = await call_bridge(bridge_url, "browser/scroll", "POST", {
            "direction": args.get("direction", "down"),
            "amount":    args.get("amount", 500),
        })
        if "error" in r: return f"[Ошибка прокрутки] {r['error']}"
        return f"[Прокрутка {args.get('direction', 'down')} на {args.get('amount', 500)}px]"

    if name == "browser_eval":
        code = args.get("code", "")
        if not code: return "[Ошибка] code обязателен"
        r = await call_bridge(bridge_url, "browser/eval", "POST", {"code": code})
        if "error" in r: return f"[Ошибка JS] {r['error']}"
        return f"[Результат JS]\n{r.get('result', '')}"

    if name == "browser_tabs":
        r = await call_bridge(bridge_url, "browser/tabs", "GET")
        if "error" in r: return f"[Ошибка] {r['error']}"
        tabs = r.get("tabs", [])
        if not tabs: return "[Браузер закрыт или нет вкладок]"
        lines = [f"[{t['index']}] {t['title']} — {t['url']}" for t in tabs]
        return "[Вкладки]\n" + "\n".join(lines)

    if name == "browser_tab":
        r = await call_bridge(bridge_url, "browser/tab", "POST", {"index": args.get("index", 0)})
        if "error" in r: return f"[Ошибка] {r['error']}"
        return f"[Переключено на: {r.get('title', '')}] {r.get('url', '')}"

    if name == "browser_back":
        r = await call_bridge(bridge_url, "browser/back", "POST")
        if "error" in r: return f"[Ошибка] {r['error']}"
        return f"[Назад] {r.get('url', '')}"

    if name == "browser_forward":
        r = await call_bridge(bridge_url, "browser/forward", "POST")
        if "error" in r: return f"[Ошибка] {r['error']}"
        return f"[Вперёд] {r.get('url', '')}"

    if name == "browser_close":
        r = await call_bridge(bridge_url, "browser/close", "POST")
        if "error" in r: return f"[Ошибка] {r['error']}"
        return "[Браузер закрыт]"

    return f"[Неизвестный инструмент: {name}]"

# ─────────────────────────────────────────────
# ГОЛОСА TTS
# ─────────────────────────────────────────────

async def generate_audio(text: str, voice: str = "ru-RU-DmitryNeural") -> str:
    """Генерирует аудио через Edge-TTS, возвращает base64."""
    clean = re.sub(r'<tool>.*?</tool>', '', text, flags=re.DOTALL).strip()
    clean = re.sub(r'\[SCREENSHOT_B64\].*?\[/SCREENSHOT_B64\]', '[скриншот]', clean, flags=re.DOTALL)
    if not clean:
        return ""
    try:
        communicate = edge_tts.Communicate(clean[:800], voice)
        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]
        return base64.b64encode(audio_data).decode('utf-8')
    except Exception as e:
        print(f"Ошибка TTS: {e}")
        return ""

# ─────────────────────────────────────────────
# ГЕНЕРАЦИЯ ОТВЕТА МОДЕЛИ
# ─────────────────────────────────────────────

def build_prompt(message: str, history: List[ChatMessage], tool_results: str = "", screen_frame: Optional[str] = None) -> str:
    system_block = f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"

    # Умная обрезка истории: влезает всё что помещается в контекст.
    # Оставляем первые 2 сообщения (начало разговора) + максимум последних.
    # Грубая оценка: 1 токен ≈ 4 символа. Резервируем 1500 токенов под ответ и инструменты.
    MAX_HISTORY_CHARS = (N_CTX - 1500) * 4

    user_content = message
    if screen_frame:
        user_content = f"{message}\n\n[Пользователь поделился кадром своего экрана.]"
    if tool_results:
        user_content = f"{user_content}\n\n[Результаты инструментов]\n{tool_results}"

    current_msg_block = f"<|im_start|>user\n{user_content}<|im_end|>\n<|im_start|>assistant\n"
    used_chars = len(system_block) + len(current_msg_block)

    # Берём историю с конца, пока влезает
    selected = []
    for msg in reversed(history):
        role = "user" if msg.role == "user" else "assistant"
        block = f"<|im_start|>{role}\n{msg.text}<|im_end|>\n"
        if used_chars + len(block) < MAX_HISTORY_CHARS:
            selected.insert(0, block)
            used_chars += len(block)
        else:
            break

    prompt = system_block + "".join(selected) + current_msg_block
    return prompt

def generate_response(prompt: str) -> str:
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
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Сообщение пустое")

    loop = asyncio.get_event_loop()

    # Шаг 1: первый проход модели (с кадром экрана если есть)
    prompt = build_prompt(request.message, request.history, screen_frame=request.screen_frame)
    raw_reply = await loop.run_in_executor(None, generate_response, prompt)

    # Шаг 2: ищем вызовы инструментов
    tool_matches = TOOL_PATTERN.findall(raw_reply)
    screenshot_b64 = None
    tool_results_text = ""

    if tool_matches:
        results = []
        for match in tool_matches:
            try:
                tool_call = json.loads(match.strip())
                result = await execute_tool(tool_call, request.bridge_url)

                # Вытаскиваем скриншот отдельно для UI
                if "[SCREENSHOT_B64]" in result:
                    sc_match = re.search(r'\[SCREENSHOT_B64\](.*?)\[/SCREENSHOT_B64\]', result, re.DOTALL)
                    if sc_match:
                        screenshot_b64 = sc_match.group(1).strip()
                        result = "[скриншот сделан]"

                results.append(result)
            except json.JSONDecodeError:
                results.append("[Ошибка парсинга инструмента]")

        tool_results_text = "\n\n".join(results)

        # Шаг 3: второй проход с результатами инструментов
        prompt2 = build_prompt(request.message, request.history, tool_results_text, request.screen_frame)
        final_reply = await loop.run_in_executor(None, generate_response, prompt2)
    else:
        final_reply = raw_reply

    # Шаг 4: TTS
    voice = request.voice or "ru-RU-DmitryNeural"
    audio_b64 = await generate_audio(final_reply, voice)

    return {
        "reply": final_reply,
        "audio": audio_b64 or None,
        "screenshot": screenshot_b64,
        "tool_results": tool_results_text if tool_results_text else None,
    }


@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Текст пустой")
    voice = request.voice or "ru-RU-DmitryNeural"
    try:
        audio_b64 = await generate_audio(request.text, voice)
        return {"audio": audio_b64}
    except Exception as e:
        print(f"Ошибка TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/search")
async def search(body: dict):
    query = body.get("query", "")
    if not query:
        raise HTTPException(status_code=400, detail="query обязателен")
    result = await web_search(query)
    return {"result": result}


@app.get("/health")
async def health_check():
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
║  Search: {'Tavily' if TAVILY_API_KEY else 'DuckDuckGo (free)':<32}║
╚══════════════════════════════════════════╝
    """)

    uvicorn.run(app, host="0.0.0.0", port=8000)
