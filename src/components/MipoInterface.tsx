import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic, MicOff, Send, Globe, Wifi, Activity,
  Settings, X, Check, Monitor, Shield, Search, Camera,
  Eye, EyeOff, Volume2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────
// ТИПЫ
// ─────────────────────────────────────────────

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'mipo';
  timestamp: Date;
  screenshot?: string; // base64 PNG
  screenFrame?: string; // base64 JPEG — кадр экрана приложенный к сообщению
}

// Голоса Edge-TTS сгруппированные для UI
const VOICE_OPTIONS = {
  ru: [
    { id: 'ru-RU-DmitryNeural',    label: 'Дмитрий (мужской)',   flag: '🇷🇺' },
    { id: 'ru-RU-SvetlanaNeural',  label: 'Светлана (женский)',  flag: '🇷🇺' },
    { id: 'ru-RU-DariyaNeural',    label: 'Дарья (женский)',     flag: '🇷🇺' },
  ],
  en: [
    { id: 'en-US-ChristopherNeural', label: 'Christopher (male)',  flag: '🇺🇸' },
    { id: 'en-US-JennyNeural',       label: 'Jenny (female)',      flag: '🇺🇸' },
    { id: 'en-US-GuyNeural',         label: 'Guy (male)',          flag: '🇺🇸' },
    { id: 'en-GB-RyanNeural',        label: 'Ryan UK (male)',      flag: '🇬🇧' },
    { id: 'en-GB-SoniaNeural',       label: 'Sonia UK (female)',   flag: '🇬🇧' },
  ],
};

// ─────────────────────────────────────────────
// КОНСТАНТЫ
// ─────────────────────────────────────────────

const DEFAULT_ENGINE_URL = 'http://localhost:8000';
const DEFAULT_BRIDGE_URL = 'http://localhost:3001';
const KEY_ENGINE_URL     = 'mipo_engine_url';
const KEY_BRIDGE_URL     = 'mipo_bridge_url';
const KEY_HISTORY        = 'mipo_history';
const KEY_VOICE          = 'mipo_voice';

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

// ─────────────────────────────────────────────
// КОМПОНЕНТ
// ─────────────────────────────────────────────

export default function MipoInterface() {
  const [initialized, setInitialized]       = useState(false);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [inputText, setInputText]           = useState('');
  const [isListening, setIsListening]       = useState(false);
  const [isProcessing, setIsProcessing]     = useState(false);
  const [isSpeaking, setIsSpeaking]         = useState(false);
  const [location, setLocation]             = useState('НЕИЗВЕСТНО');
  const [liveTranscript, setLiveTranscript] = useState('');

  // Видение экрана
  const [screenWatching, setScreenWatching]     = useState(false);   // захват активен
  const [screenPreview, setScreenPreview]       = useState<string>(''); // последний кадр
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef  = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // URL серверов
  const [engineUrl, setEngineUrl] = useState(
    () => localStorage.getItem(KEY_ENGINE_URL) || DEFAULT_ENGINE_URL
  );
  const [bridgeUrl, setBridgeUrl] = useState(
    () => localStorage.getItem(KEY_BRIDGE_URL) || DEFAULT_BRIDGE_URL
  );

  // Голос
  const [selectedVoice, setSelectedVoice] = useState(
    () => localStorage.getItem(KEY_VOICE) || 'ru-RU-DmitryNeural'
  );

  // Настройки
  const [showSettings, setShowSettings]   = useState(false);
  const [settingsTab, setSettingsTab]     = useState<'servers' | 'voice'>('servers');
  const [engineInput, setEngineInput]     = useState(engineUrl);
  const [bridgeInput, setBridgeInput]     = useState(bridgeUrl);
  const [engineStatus, setEngineStatus]   = useState<'unknown'|'online'|'offline'>('unknown');
  const [bridgeStatus, setBridgeStatus]   = useState<'unknown'|'online'|'offline'>('unknown');

  // Refs
  const messagesEndRef      = useRef<HTMLDivElement>(null);
  const messagesRef         = useRef<Message[]>([]);
  const recognitionRef      = useRef<any>(null);
  const audioContextRef     = useRef<AudioContext | null>(null);
  const vizCanvasRef        = useRef<HTMLCanvasElement>(null);
  const visualizerStreamRef = useRef<MediaStream | null>(null);
  const visualizerAnimRef   = useRef<number>(0);
  const analyserRef         = useRef<AnalyserNode | null>(null);
  const dataArrayRef        = useRef<Uint8Array | null>(null);
  const isSpeakingRef       = useRef(false);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ── ИСТОРИЯ ──────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem(KEY_HISTORY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      const map = new Map<string, Message>();
      parsed
        .map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        .forEach((m: Message) => map.set(m.id, m));
      setMessages(Array.from(map.values()));
    } catch {}
  }, []);

  useEffect(() => {
    const save = () => {
      if (messagesRef.current.length > 0) {
        const toSave = messagesRef.current.map(m => ({
          ...m, screenshot: undefined, screenFrame: undefined
        }));
        localStorage.setItem(KEY_HISTORY, JSON.stringify(toSave));
      }
    };
    const interval = setInterval(save, 30000);
    window.addEventListener('beforeunload', save);
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', save); save(); };
  }, []);

  // ── ПИНГ СЕРВЕРОВ ────────────────────────────────

  const pingServer = async (url: string, setter: (s: 'online'|'offline') => void) => {
    try {
      const r = await fetch(`${url}/health`, { headers: BASE_HEADERS, signal: AbortSignal.timeout(3000) });
      setter(r.ok ? 'online' : 'offline');
    } catch { setter('offline'); }
  };

  useEffect(() => {
    if (!initialized) return;
    pingServer(engineUrl, setEngineStatus);
    pingServer(bridgeUrl, setBridgeStatus);
    const t = setInterval(() => {
      pingServer(engineUrl, setEngineStatus);
      pingServer(bridgeUrl, setBridgeStatus);
    }, 30000);
    return () => clearInterval(t);
  }, [engineUrl, bridgeUrl, initialized]);

  // ── ВИДЕНИЕ ЭКРАНА ───────────────────────────────

  const captureScreenFrame = useCallback((): string | null => {
    const video  = screenVideoRef.current;
    const canvas = screenCanvasRef.current;
    if (!video || !canvas || !screenWatching) return null;
    if (video.readyState < 2) return null;

    // Захватываем кадр 640×360 (достаточно для анализа, мало весит)
    canvas.width  = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 640, 360);
    // JPEG 60% — хороший баланс качество/размер
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    return dataUrl.split(',')[1]; // возвращаем только base64 без префикса
  }, [screenWatching]);

  // Обновляем превью каждые 2 секунды
  useEffect(() => {
    if (!screenWatching) { setScreenPreview(''); return; }
    const t = setInterval(() => {
      const frame = captureScreenFrame();
      if (frame) setScreenPreview(frame);
    }, 2000);
    return () => clearInterval(t);
  }, [screenWatching, captureScreenFrame]);

  const startScreenWatch = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2, width: 1280, height: 720 },
        audio: false,
      });

      // Создаём скрытый video элемент для захвата кадров
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      screenStreamRef.current = stream;
      screenVideoRef.current  = video;

      // Создаём offscreen canvas
      const canvas = document.createElement('canvas');
      screenCanvasRef.current = canvas;

      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenWatch();
      });

      setScreenWatching(true);
    } catch (err) {
      console.error('Захват экрана не удался:', err);
    }
  };

  const stopScreenWatch = () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    screenVideoRef.current  = null;
    setScreenWatching(false);
    setScreenPreview('');
  };

  // ── SPEECH RECOGNITION ───────────────────────────

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const r  = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'ru-RU';
    r.onresult = (e: any) => {
      if (!e.results?.length) return;
      const res = e.results[e.results.length - 1];
      const t   = res[0]?.transcript ?? '';
      setLiveTranscript(t);
      if (res.isFinal) {
        setInputText(t);
        window.dispatchEvent(new CustomEvent('mipo-voice', { detail: t }));
        setLiveTranscript('');
      }
    };
    r.onerror = () => { setIsListening(false); stopVisualizer(); };
    recognitionRef.current = r;
  }, []);

  useEffect(() => {
    const h = (e: any) => handleSend(e.detail);
    window.addEventListener('mipo-voice', h);
    return () => window.removeEventListener('mipo-voice', h);
  }, [isProcessing, screenWatching]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── АУДИО ────────────────────────────────────────

  const initAudio = () => {
    if (!audioContextRef.current)
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
  };

  const playBeep = (type: 'send'|'receive') => {
    if (!audioContextRef.current) return;
    const osc  = audioContextRef.current.createOscillator();
    const gain = audioContextRef.current.createGain();
    osc.connect(gain); gain.connect(audioContextRef.current.destination);
    const now = audioContextRef.current.currentTime;
    if (type === 'send') {
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(); osc.stop(now + 0.1);
    } else {
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
      gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(); osc.stop(now + 0.15);
    }
  };

  // ── ВИЗУАЛИЗАТОР ─────────────────────────────────

  const drawVisualizer = () => {
    visualizerAnimRef.current = requestAnimationFrame(drawVisualizer);
    const canvas = vizCanvasRef.current; if (!canvas) return;
    const ctx    = canvas.getContext('2d'); if (!ctx) return;
    let da = dataArrayRef.current;
    if (analyserRef.current && da) {
      analyserRef.current.getByteFrequencyData(da);
    } else if (isSpeakingRef.current) {
      if (!da || da.length !== 64) { da = new Uint8Array(64); dataArrayRef.current = da; }
      const t = Date.now() / 100;
      for (let i = 0; i < 64; i++)
        da[i] = Math.min(255, Math.max(0, Math.sin(i * 0.2 + t) * 50 + Math.cos(i * 0.5 - t) * 30 + Math.random() * 20 + 80));
    } else { da?.fill(0); }

    ctx.clearRect(0, 0, 80, 80);
    const cx = 40, cy = 40, r = 30;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(6,182,212,0.3)'; ctx.lineWidth = 1; ctx.stroke();

    if (da) {
      const step = (Math.PI * 2) / 64;
      for (let i = 0; i < 64; i++) {
        const v = da[i] || 0, h = (v / 255) * 50, a = i * step;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * (r + h), cy + Math.sin(a) * (r + h));
        ctx.strokeStyle = `rgba(6,182,212,${v > 10 ? v / 200 : 0.1})`;
        ctx.lineWidth = 2; ctx.stroke();
      }
    }
  };

  const startVisualizer = async () => {
    try {
      if (!visualizerStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        visualizerStreamRef.current = stream;
        if (!audioContextRef.current)
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
        const analyser = audioContextRef.current.createAnalyser();
        audioContextRef.current.createMediaStreamSource(stream).connect(analyser);
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      if (!visualizerAnimRef.current) drawVisualizer();
    } catch {}
  };

  const stopVisualizer = () => {
    visualizerStreamRef.current?.getTracks().forEach(t => t.stop());
    visualizerStreamRef.current = null; analyserRef.current = null;
    if (!isSpeakingRef.current) {
      cancelAnimationFrame(visualizerAnimRef.current); visualizerAnimRef.current = 0;
      vizCanvasRef.current?.getContext('2d')?.clearRect(0, 0, 80, 80);
    }
  };

  const checkStopVisualizer = () => {
    if (!isSpeakingRef.current && !visualizerStreamRef.current) {
      cancelAnimationFrame(visualizerAnimRef.current); visualizerAnimRef.current = 0;
      vizCanvasRef.current?.getContext('2d')?.clearRect(0, 0, 80, 80);
    }
  };

  // ── ОЗВУЧКА ──────────────────────────────────────

  const playBase64Audio = async (b64: string) => {
    setIsSpeaking(true); isSpeakingRef.current = true;
    if (!visualizerAnimRef.current) drawVisualizer();
    const audio = new Audio(`data:audio/mpeg;base64,${b64}`);
    audio.onended = () => { setIsSpeaking(false); isSpeakingRef.current = false; checkStopVisualizer(); };
    audio.onerror = () => { setIsSpeaking(false); isSpeakingRef.current = false; checkStopVisualizer(); };
    await audio.play().catch(() => { setIsSpeaking(false); isSpeakingRef.current = false; });
  };

  const speak = async (text: string) => {
    if (!text.trim()) return;
    setIsSpeaking(true); isSpeakingRef.current = true;
    if (!visualizerAnimRef.current) drawVisualizer();
    try {
      const r = await fetch(`${engineUrl}/api/tts`, {
        method: 'POST', headers: BASE_HEADERS,
        body: JSON.stringify({ text, voice: selectedVoice }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      await playBase64Audio(d.audio);
    } catch {
      setIsSpeaking(false); isSpeakingRef.current = false; checkStopVisualizer();
    }
  };

  // ── БЫСТРЫЕ КОМАНДЫ ──────────────────────────────

  const quickScan       = () => handleSend('Запусти антивирусную проверку моего компьютера');
  const quickScreenshot = () => handleSend('Сделай скриншот моего экрана');
  const quickStats      = () => handleSend('Покажи статистику системы — CPU, RAM, uptime');

  // ── ОТПРАВКА СООБЩЕНИЯ ───────────────────────────

  const buildHistory = (msgs: Message[]) =>
    msgs.slice(-20).map(m => ({ role: m.sender === 'user' ? 'user' : 'mipo', text: m.text }));

  const handleSend = async (text: string = inputText) => {
    if (!text.trim() || isProcessing) return;
    setIsProcessing(true);
    playBeep('send');

    // Захватываем текущий кадр экрана если видение активно
    const screenFrame = captureScreenFrame();

    const userMsg: Message = {
      id: crypto.randomUUID(), text, sender: 'user', timestamp: new Date(),
      screenFrame: screenFrame || undefined,
    };
    const history = buildHistory(messagesRef.current);
    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    try {
      const r = await fetch(`${engineUrl}/api/chat`, {
        method: 'POST', headers: BASE_HEADERS,
        body: JSON.stringify({
          message:      text,
          history,
          bridge_url:   bridgeStatus === 'online' ? bridgeUrl : null,
          voice:        selectedVoice,
          screen_frame: screenFrame || null,  // base64 JPEG кадра экрана или null
        }),
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      playBeep('receive');

      const mipoMsg: Message = {
        id: crypto.randomUUID(),
        text: data.reply,
        sender: 'mipo',
        timestamp: new Date(),
        screenshot: data.screenshot || undefined,
      };
      setMessages(prev => [...prev, mipoMsg]);

      if (data.audio) await playBase64Audio(data.audio);
      else await speak(data.reply);

    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        text: `Сбой подключения к MIPO Engine (${engineUrl}). Проверь что Colab запущен и URL актуален.`,
        sender: 'mipo',
        timestamp: new Date(),
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      try { recognitionRef.current?.stop(); } catch {}
      stopVisualizer();
    } else {
      setIsListening(true);
      try { recognitionRef.current?.start(); } catch {}
      startVisualizer();
    }
  };

  // ── НАСТРОЙКИ ────────────────────────────────────

  const saveSettings = () => {
    const eng = engineInput.trim().replace(/\/$/, '');
    const bri = bridgeInput.trim().replace(/\/$/, '');
    setEngineUrl(eng); localStorage.setItem(KEY_ENGINE_URL, eng);
    setBridgeUrl(bri); localStorage.setItem(KEY_BRIDGE_URL, bri);
    setEngineStatus('unknown'); setBridgeStatus('unknown');
    setShowSettings(false);
    pingServer(eng, setEngineStatus);
    pingServer(bri, setBridgeStatus);
  };

  const saveVoice = (voiceId: string) => {
    setSelectedVoice(voiceId);
    localStorage.setItem(KEY_VOICE, voiceId);
  };

  // ── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────

  const initializeSystem = () => {
    initAudio(); setInitialized(true);
    pingServer(engineUrl, setEngineStatus);
    pingServer(bridgeUrl, setBridgeStatus);
    navigator.geolocation?.getCurrentPosition(
      pos => setLocation(`${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`),
      () => setLocation('НЕДОСТУПНО')
    );
    setTimeout(() => {
      const msg: Message = {
        id: 'init', text: 'Системы MIPO в сети. Готов к работе.',
        sender: 'mipo', timestamp: new Date(),
      };
      setMessages(prev => prev.find(m => m.id === 'init') ? prev : [...prev, msg]);
      speak(msg.text);
    }, 800);
  };

  const sc = (s: string) =>
    s === 'online' ? 'text-green-400' : s === 'offline' ? 'text-red-400' : 'text-cyan-700';

  // ── ЭКРАН ИНИЦИАЛИЗАЦИИ ──────────────────────────

  if (!initialized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-8">
          <div>
            <div className="text-cyan-400 text-7xl font-bold tracking-widest mb-2">MIPO</div>
            <div className="text-cyan-700 text-xs tracking-[0.5em]">ПЕРСОНАЛЬНЫЙ ИИ-АССИСТЕНТ</div>
          </div>
          <div className="text-[10px] text-cyan-800 space-y-1">
            <div>● Голосовое управление</div>
            <div>● Видение вашего экрана</div>
            <div>● Управление компьютером</div>
            <div>● Поиск в интернете</div>
            <div>● Антивирусная защита</div>
          </div>
          <button
            onClick={initializeSystem}
            className="px-10 py-4 border border-cyan-500/50 text-cyan-400 text-sm tracking-[0.3em] hover:bg-cyan-950/30 hover:border-cyan-400/70 transition-all"
          >
            ИНИЦИАЛИЗАЦИЯ
          </button>
        </div>
      </div>
    );
  }

  // ── ОСНОВНОЙ РЕНДЕР ──────────────────────────────

  return (
    <div className="min-h-screen bg-black text-cyan-400 flex flex-col p-4 gap-3 font-mono">

      {/* Шапка */}
      <header className="flex items-center justify-between border-b border-cyan-900/30 pb-3">
        <div className="flex items-center gap-4">
          <canvas ref={vizCanvasRef} width={80} height={80} className="opacity-80 flex-shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-widest text-cyan-100">MIPO</h1>
            <div className="text-[10px] text-cyan-700 tracking-[0.2em] mt-0.5">
              {screenWatching
                ? <span className="text-green-500 animate-pulse">● ВИДЕНИЕ ЭКРАНА АКТИВНО</span>
                : <span>ИНТЕРФЕЙС MARK VII</span>
              }
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px] md:text-xs flex-wrap justify-end">
          <div className="flex items-center gap-1 text-cyan-800">
            <Globe className="w-3 h-3" /><span>{location}</span>
          </div>

          {/* Кнопка видения экрана */}
          <button
            onClick={screenWatching ? stopScreenWatch : startScreenWatch}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded border transition-all',
              screenWatching
                ? 'border-green-500/50 text-green-400 bg-green-950/20 animate-pulse'
                : 'border-cyan-900/50 text-cyan-700 hover:text-cyan-400'
            )}
            title={screenWatching ? 'Остановить видение экрана' : 'Включить видение экрана'}
          >
            {screenWatching ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>{screenWatching ? 'ЭКРАН ●' : 'ЭКРАН'}</span>
          </button>

          {/* Engine статус */}
          <button
            onClick={() => { setShowSettings(true); setSettingsTab('servers'); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="flex items-center gap-1 hover:text-cyan-300 transition-colors"
          >
            <Wifi className="w-3 h-3" />
            <span className={sc(engineStatus)}>ENGINE {engineStatus==='online'?'●':engineStatus==='offline'?'○':'…'}</span>
          </button>

          {/* Bridge статус */}
          <button
            onClick={() => { setShowSettings(true); setSettingsTab('servers'); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="flex items-center gap-1 hover:text-cyan-300 transition-colors"
          >
            <Monitor className="w-3 h-3" />
            <span className={sc(bridgeStatus)}>BRIDGE {bridgeStatus==='online'?'●':bridgeStatus==='offline'?'○':'…'}</span>
          </button>

          {/* Голос */}
          <button
            onClick={() => { setShowSettings(true); setSettingsTab('voice'); }}
            className="flex items-center gap-1 hover:text-cyan-300 transition-colors"
            title="Выбор голоса"
          >
            <Volume2 className="w-3 h-3" />
            <span className="text-cyan-700 max-w-[80px] truncate">
              {[...VOICE_OPTIONS.ru, ...VOICE_OPTIONS.en].find(v => v.id === selectedVoice)?.label?.split(' ')[0] || 'ГОЛОС'}
            </span>
          </button>

          <button
            onClick={() => { setShowSettings(true); setSettingsTab('servers'); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="text-cyan-800 hover:text-cyan-600 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {/* Статус обработки */}
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            <span className={isSpeaking ? 'text-cyan-300 animate-pulse' : isProcessing ? 'text-yellow-500 animate-pulse' : 'text-cyan-800'}>
              {isSpeaking ? 'РЕЧЬ' : isProcessing ? 'ОБРАБОТКА' : 'ОЖИДАНИЕ'}
            </span>
          </div>
        </div>
      </header>

      {/* Превью экрана (если активно) */}
      {screenWatching && screenPreview && (
        <div className="relative border border-green-900/50 rounded overflow-hidden bg-black/50">
          <div className="absolute top-1 left-2 text-[9px] text-green-600 z-10 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
            ВИДЕНИЕ ЭКРАНА — MIPO ВИДИТ ЭТО
          </div>
          <img
            src={`data:image/jpeg;base64,${screenPreview}`}
            alt="Screen preview"
            className="w-full max-h-32 object-contain opacity-60"
          />
        </div>
      )}

      {/* Настройки */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-black border border-cyan-800/50 rounded-lg p-6 w-full max-w-md"
            >
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-cyan-300 font-bold tracking-widest text-sm">НАСТРОЙКИ</h2>
                <button onClick={() => setShowSettings(false)} className="text-cyan-700 hover:text-cyan-400">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Вкладки */}
              <div className="flex gap-1 mb-5">
                {(['servers', 'voice'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setSettingsTab(tab)}
                    className={cn(
                      'flex-1 py-1.5 text-[10px] tracking-widest border rounded transition-all',
                      settingsTab === tab
                        ? 'border-cyan-500/60 text-cyan-300 bg-cyan-950/30'
                        : 'border-cyan-900/30 text-cyan-700 hover:text-cyan-500'
                    )}
                  >
                    {tab === 'servers' ? 'СЕРВЕРЫ' : 'ГОЛОС'}
                  </button>
                ))}
              </div>

              {/* Вкладка Серверы */}
              {settingsTab === 'servers' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-cyan-600 tracking-widest flex items-center gap-2">
                      <Wifi className="w-3 h-3" /> MIPO ENGINE (Colab)
                      <span className={`ml-auto ${sc(engineStatus)}`}>
                        {engineStatus==='online'?'ОНЛАЙН':engineStatus==='offline'?'ОФЛАЙН':'...'}
                      </span>
                    </label>
                    <input
                      type="text" value={engineInput} onChange={e => setEngineInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveSettings()}
                      placeholder="https://xxxx.ngrok.io"
                      className="w-full bg-black/50 border border-cyan-800/50 text-cyan-100 text-sm px-3 py-2 rounded outline-none focus:border-cyan-500/70"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-cyan-600 tracking-widest flex items-center gap-2">
                      <Monitor className="w-3 h-3" /> LOCAL BRIDGE (ПК)
                      <span className={`ml-auto ${sc(bridgeStatus)}`}>
                        {bridgeStatus==='online'?'ОНЛАЙН':bridgeStatus==='offline'?'ОФЛАЙН':'...'}
                      </span>
                    </label>
                    <input
                      type="text" value={bridgeInput} onChange={e => setBridgeInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveSettings()}
                      placeholder="http://localhost:3001"
                      className="w-full bg-black/50 border border-cyan-800/50 text-cyan-100 text-sm px-3 py-2 rounded outline-none focus:border-cyan-500/70"
                    />
                    <p className="text-[10px] text-cyan-800">
                      Запусти <code className="text-cyan-600">node local-bridge.cjs</code> на ПК
                    </p>
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button onClick={saveSettings}
                      className="flex items-center gap-2 px-4 py-2 border border-cyan-500/50 text-cyan-400 text-xs hover:bg-cyan-950/30 rounded transition-all">
                      <Check className="w-3 h-3" /> СОХРАНИТЬ
                    </button>
                    <button onClick={() => { setEngineInput(DEFAULT_ENGINE_URL); setBridgeInput(DEFAULT_BRIDGE_URL); }}
                      className="px-4 py-2 border border-cyan-900/30 text-cyan-700 text-xs hover:text-cyan-500 rounded transition-all">
                      СБРОСИТЬ
                    </button>
                  </div>
                </div>
              )}

              {/* Вкладка Голос */}
              {settingsTab === 'voice' && (
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] text-cyan-600 tracking-widest mb-2">🇷🇺 РУССКИЕ ГОЛОСА</div>
                    <div className="space-y-1.5">
                      {VOICE_OPTIONS.ru.map(v => (
                        <button key={v.id} onClick={() => saveVoice(v.id)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded border text-xs transition-all flex items-center gap-2',
                            selectedVoice === v.id
                              ? 'border-cyan-500/60 text-cyan-200 bg-cyan-950/40'
                              : 'border-cyan-900/30 text-cyan-700 hover:border-cyan-800/50 hover:text-cyan-500'
                          )}>
                          <span>{v.flag}</span>
                          <span>{v.label}</span>
                          {selectedVoice === v.id && <span className="ml-auto text-cyan-500 text-[10px]">● активен</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-cyan-600 tracking-widest mb-2">🇺🇸 АНГЛИЙСКИЕ ГОЛОСА</div>
                    <div className="space-y-1.5">
                      {VOICE_OPTIONS.en.map(v => (
                        <button key={v.id} onClick={() => saveVoice(v.id)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded border text-xs transition-all flex items-center gap-2',
                            selectedVoice === v.id
                              ? 'border-cyan-500/60 text-cyan-200 bg-cyan-950/40'
                              : 'border-cyan-900/30 text-cyan-700 hover:border-cyan-800/50 hover:text-cyan-500'
                          )}>
                          <span>{v.flag}</span>
                          <span>{v.label}</span>
                          {selectedVoice === v.id && <span className="ml-auto text-cyan-500 text-[10px]">● активен</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => speak('Привет! Я MIPO, ваш персональный ассистент. Как дела?')}
                    disabled={isSpeaking}
                    className="w-full py-2 border border-cyan-900/30 text-cyan-700 text-xs hover:text-cyan-500 rounded transition-all disabled:opacity-40"
                  >
                    🔊 ПРОВЕРИТЬ ГОЛОС
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Быстрые действия */}
      {(bridgeStatus === 'online' || true) && (
        <div className="flex gap-2 flex-wrap">
          {bridgeStatus === 'online' && (
            <>
              <button onClick={quickScan} disabled={isProcessing}
                className="flex items-center gap-1 px-3 py-1.5 border border-red-900/50 text-red-500 text-[10px] hover:bg-red-950/20 rounded transition-all disabled:opacity-40">
                <Shield className="w-3 h-3" /> СКАНИРОВАНИЕ
              </button>
              <button onClick={quickScreenshot} disabled={isProcessing}
                className="flex items-center gap-1 px-3 py-1.5 border border-cyan-900/50 text-cyan-700 text-[10px] hover:bg-cyan-950/20 rounded transition-all disabled:opacity-40">
                <Camera className="w-3 h-3" /> СКРИНШОТ
              </button>
              <button onClick={quickStats} disabled={isProcessing}
                className="flex items-center gap-1 px-3 py-1.5 border border-cyan-900/50 text-cyan-700 text-[10px] hover:bg-cyan-950/20 rounded transition-all disabled:opacity-40">
                <Activity className="w-3 h-3" /> СТАТИСТИКА
              </button>
            </>
          )}
          <button onClick={() => handleSend('Найди в интернете последние новости технологий')} disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 border border-cyan-900/50 text-cyan-700 text-[10px] hover:bg-cyan-950/20 rounded transition-all disabled:opacity-40">
            <Search className="w-3 h-3" /> ПОИСК
          </button>
          <button onClick={screenWatching ? stopScreenWatch : startScreenWatch}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 border text-[10px] rounded transition-all',
              screenWatching
                ? 'border-green-700/50 text-green-500 hover:bg-green-950/20'
                : 'border-cyan-900/50 text-cyan-700 hover:bg-cyan-950/20'
            )}>
            {screenWatching ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {screenWatching ? 'ВЫКЛ ЭКРАН' : 'СМОТРЕТЬ ЭКРАН'}
          </button>
        </div>
      )}

      {/* Чат */}
      <main className="flex-1 flex flex-col bg-black/20 border border-cyan-900/30 rounded-lg backdrop-blur-sm overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
          <AnimatePresence>
            {messages.map(msg => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'flex flex-col max-w-[85%]',
                  msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
                )}
              >
                <div className={cn(
                  'px-4 py-3 rounded-lg border text-sm leading-relaxed',
                  msg.sender === 'user'
                    ? 'bg-cyan-950/30 border-cyan-700/30 text-cyan-100'
                    : 'bg-black/40 border-cyan-900/30 text-cyan-300'
                )}>
                  <span className="whitespace-pre-wrap">{msg.text}</span>

                  {/* Кадр экрана который был отправлен вместе с сообщением */}
                  {msg.screenFrame && (
                    <div className="mt-2 opacity-50">
                      <img
                        src={`data:image/jpeg;base64,${msg.screenFrame}`}
                        alt="Screen frame sent"
                        className="max-w-[200px] rounded border border-green-900/30"
                      />
                      <p className="text-[9px] text-green-800 mt-0.5">экран отправлен MIPO</p>
                    </div>
                  )}

                  {/* Скриншот сделанный MIPO через bridge */}
                  {msg.screenshot && (
                    <div className="mt-3">
                      <img
                        src={`data:image/png;base64,${msg.screenshot}`}
                        alt="Скриншот"
                        className="max-w-full rounded border border-cyan-900/30 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => {
                          const w = window.open();
                          if (w) w.document.write(`<img src="data:image/png;base64,${msg.screenshot}" style="max-width:100%">`);
                        }}
                      />
                      <p className="text-[10px] text-cyan-700 mt-1">Нажми для увеличения</p>
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-cyan-900 mt-1">
                  {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Строка ввода */}
        <div className="p-4 border-t border-cyan-900/30 bg-black/40 flex-shrink-0">
          {liveTranscript && (
            <div className="text-xs text-cyan-600 italic mb-2 px-1">🎙 {liveTranscript}</div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={toggleListening}
              className={cn('p-3 rounded-full border transition-all flex-shrink-0',
                isListening
                  ? 'bg-red-950/30 border-red-500/50 text-red-400 animate-pulse'
                  : 'bg-cyan-950/20 border-cyan-600/50 text-cyan-400 hover:bg-cyan-950/40'
              )}>
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <input type="text" value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={screenWatching ? 'MIPO видит ваш экран. Задайте вопрос...' : 'Введите команду или вопрос...'}
              className="flex-1 bg-transparent border-b border-cyan-800/50 text-cyan-100 placeholder-cyan-800 text-sm py-2 px-1 outline-none focus:border-cyan-500/70 transition-colors"
            />

            <button onClick={() => handleSend()} disabled={!inputText.trim() || isProcessing}
              className={cn('p-3 rounded-full border transition-all flex-shrink-0',
                inputText.trim() && !isProcessing
                  ? 'bg-cyan-950/30 border-cyan-500/50 text-cyan-400 hover:bg-cyan-950/60'
                  : 'border-cyan-900/30 text-cyan-900 cursor-not-allowed'
              )}>
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
