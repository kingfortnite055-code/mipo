import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic, MicOff, Send, Globe, Wifi, Activity,
  Settings, X, Check, Monitor, Shield, Search, Camera,
  Eye, EyeOff, Volume2, Cpu, HardDrive, Clock,
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
  screenshot?: string;
  screenFrame?: string;
  toolResults?: string;
}

interface SystemStats {
  cpu: number;
  ram: number;
  totalMem: string;
  freeMem: string;
  uptime: number;
  hostname: string;
  cpuModel: string;
  cpuCores: number;
}

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
// SYSTEM MONITOR
// ─────────────────────────────────────────────

function SystemMonitor({ bridgeUrl, bridgeStatus }: {
  bridgeUrl: string;
  bridgeStatus: 'unknown' | 'online' | 'offline';
}) {
  const [stats, setStats]       = useState<SystemStats | null>(null);
  const [history, setHistory]   = useState<{ cpu: number; ram: number }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const intervalRef             = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    if (bridgeStatus !== 'online') return;
    try {
      const r = await fetch(`${bridgeUrl}/stats`, {
        headers: BASE_HEADERS,
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return;
      const data: SystemStats = await r.json();
      setStats(data);
      setHistory(prev => [...prev.slice(-29), { cpu: data.cpu, ram: data.ram }]);
    } catch {}
  }, [bridgeUrl, bridgeStatus]);

  useEffect(() => {
    if (bridgeStatus !== 'online') { setStats(null); return; }
    fetchStats();
    intervalRef.current = setInterval(fetchStats, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [bridgeUrl, bridgeStatus, fetchStats]);

  if (bridgeStatus !== 'online' || !stats) return null;

  const cpuColor = stats.cpu > 80 ? 'text-red-400'  : stats.cpu > 50 ? 'text-yellow-500' : 'text-green-400';
  const ramColor = stats.ram > 85 ? 'text-red-400'  : stats.ram > 60 ? 'text-yellow-500' : 'text-green-400';
  const cpuBg    = stats.cpu > 80 ? 'bg-red-400'    : stats.cpu > 50 ? 'bg-yellow-500'   : 'bg-green-400';
  const ramBg    = stats.ram > 85 ? 'bg-red-400'    : stats.ram > 60 ? 'bg-yellow-500'   : 'bg-green-400';
  const upH      = Math.floor(stats.uptime / 60);
  const upM      = stats.uptime % 60;
  const uptimeStr = upH > 0 ? `${upH}ч ${upM}м` : `${upM}м`;

  return (
    <div className="border border-white/60 rounded-lg bg-black/20 overflow-hidden">
      {/* Строка-заголовок — всегда видна */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <Activity className="w-3 h-3 text-white/50 flex-shrink-0" />

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/70">CPU</span>
          <div className="w-14 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-500', cpuBg)} style={{ width: `${stats.cpu}%`, opacity: 0.8 }} />
          </div>
          <span className={cn('text-[10px] font-mono w-7', cpuColor)}>{stats.cpu}%</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-white/70">RAM</span>
          <div className="w-14 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-500', ramBg)} style={{ width: `${stats.ram}%`, opacity: 0.8 }} />
          </div>
          <span className={cn('text-[10px] font-mono w-7', ramColor)}>{stats.ram}%</span>
        </div>

        <span className="text-[10px] text-white/70 ml-auto hidden sm:block truncate max-w-[120px]">{stats.hostname}</span>
        <span className={cn('text-[9px] text-white/70 transition-transform inline-block', expanded && 'rotate-180')}>▼</span>
      </button>

      {/* Расширенная панель */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/60 pt-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-white/50 rounded p-2 space-y-1">
              <div className="flex items-center gap-1 text-[10px] text-white/50"><Cpu className="w-3 h-3" /> CPU</div>
              <div className={cn('text-lg font-bold font-mono', cpuColor)}>{stats.cpu}%</div>
              <div className="text-[9px] text-white/70">{stats.cpuCores} ядер</div>
            </div>
            <div className="border border-white/50 rounded p-2 space-y-1">
              <div className="flex items-center gap-1 text-[10px] text-white/50"><HardDrive className="w-3 h-3" /> RAM</div>
              <div className={cn('text-lg font-bold font-mono', ramColor)}>{stats.ram}%</div>
              <div className="text-[9px] text-white/70">{stats.freeMem} GB свободно</div>
            </div>
          </div>

          {history.length > 1 && (
            <div>
              <div className="text-[9px] text-white/70 mb-1 tracking-widest">ИСТОРИЯ (30с)</div>
              <svg width="100%" height="32" viewBox={`0 0 ${history.length * 4} 32`} preserveAspectRatio="none">
                <polyline
                  points={history.map((h, i) => `${i * 4},${32 - (h.cpu / 100) * 32}`).join(' ')}
                  fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1"
                />
                <polyline
                  points={history.map((h, i) => `${i * 4},${32 - (h.ram / 100) * 32}`).join(' ')}
                  fill="none" stroke="rgba(234,179,8,0.4)" strokeWidth="1"
                />
              </svg>
              <div className="flex gap-3 mt-0.5">
                <span className="text-[9px] text-white/50">— CPU</span>
                <span className="text-[9px] text-yellow-800">— RAM</span>
              </div>
            </div>
          )}

          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between text-white/70">
              <span>Процессор</span>
              <span className="text-white/50 text-right max-w-[180px] truncate">{stats.cpuModel}</span>
            </div>
            <div className="flex justify-between text-white/70">
              <span>Память</span>
              <span className="text-white/50">{stats.freeMem} / {stats.totalMem} GB</span>
            </div>
            <div className="flex justify-between text-white/70">
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Uptime</span>
              <span className="text-white/50">{uptimeStr}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ГЛАВНЫЙ КОМПОНЕНТ
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
  const [screenWatching, setScreenWatching]     = useState(false);
  const [screenPreview, setScreenPreview]       = useState<string>('');
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
    canvas.width  = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 640, 360);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    return dataUrl.split(',')[1];
  }, [screenWatching]);

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
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      screenStreamRef.current = stream;
      screenVideoRef.current  = video;
      screenCanvasRef.current = document.createElement('canvas');
      stream.getVideoTracks()[0].addEventListener('ended', () => stopScreenWatch());
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
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.stroke();

    if (da) {
      const step = (Math.PI * 2) / 64;
      for (let i = 0; i < 64; i++) {
        const v = da[i] || 0, h = (v / 255) * 50, a = i * step;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * (r + h), cy + Math.sin(a) * (r + h));
        ctx.strokeStyle = `rgba(255,255,255,${v > 10 ? v / 180 : 0.06})`;
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
    msgs.map(m => ({ role: m.sender === 'user' ? 'user' : 'mipo', text: m.text }));

  const handleSend = async (text: string = inputText) => {
    if (!text.trim() || isProcessing) return;
    setIsProcessing(true);
    playBeep('send');

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
          screen_frame: screenFrame || null,
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
        toolResults: data.tool_results || undefined,
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
    s === 'online' ? 'text-green-400' : s === 'offline' ? 'text-red-400' : 'text-white/60';

  // ── ЭКРАН ИНИЦИАЛИЗАЦИИ ──────────────────────────

  if (!initialized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-8">
          <div>
            <div className="text-white text-7xl font-bold tracking-widest mb-2">MIPO</div>
            <div className="text-white/60 text-xs tracking-[0.5em]">ПЕРСОНАЛЬНЫЙ ИИ-АССИСТЕНТ</div>
          </div>
          <div className="text-[10px] text-white/50 space-y-1">
            <div>● Голосовое управление</div>
            <div>● Видение вашего экрана</div>
            <div>● Управление компьютером</div>
            <div>● Поиск в интернете</div>
            <div>● Антивирусная защита</div>
          </div>
          <button
            onClick={initializeSystem}
            className="px-10 py-4 border border-white/60 text-white text-sm tracking-[0.3em] hover:bg-white/10 hover:border-white/60 transition-all"
          >
            ИНИЦИАЛИЗАЦИЯ
          </button>
        </div>
      </div>
    );
  }

  // ── ОСНОВНОЙ РЕНДЕР ──────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white flex flex-col p-4 gap-3 font-mono">

      {/* Шапка */}
      <header className="flex items-center justify-between border-b border-white/60 pb-3">
        <div className="flex items-center gap-4">
          <canvas ref={vizCanvasRef} width={80} height={80} className="opacity-80 flex-shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-widest text-white">MIPO</h1>
            <div className="text-[10px] text-white/60 tracking-[0.2em] mt-0.5">
              {screenWatching
                ? <span className="text-green-500 animate-pulse">● ВИДЕНИЕ ЭКРАНА АКТИВНО</span>
                : <span>ИНТЕРФЕЙС MARK VII</span>
              }
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px] md:text-xs flex-wrap justify-end">
          <div className="flex items-center gap-1 text-white/50">
            <Globe className="w-3 h-3" /><span>{location}</span>
          </div>

          <button
            onClick={screenWatching ? stopScreenWatch : startScreenWatch}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded border transition-all',
              screenWatching
                ? 'border-green-500/50 text-green-400 bg-green-950/20 animate-pulse'
                : 'border-white/60 text-white/60 hover:text-white'
            )}
            title={screenWatching ? 'Остановить видение экрана' : 'Включить видение экрана'}
          >
            {screenWatching ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            <span>{screenWatching ? 'ЭКРАН ●' : 'ЭКРАН'}</span>
          </button>

          <button
            onClick={() => { setShowSettings(true); setSettingsTab('servers'); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <Wifi className="w-3 h-3" />
            <span className={sc(engineStatus)}>ENGINE {engineStatus==='online'?'●':engineStatus==='offline'?'○':'…'}</span>
          </button>

          <button
            onClick={() => { setShowSettings(true); setSettingsTab('servers'); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="flex items-center gap-1 hover:text-white transition-colors"
          >
            <Monitor className="w-3 h-3" />
            <span className={sc(bridgeStatus)}>BRIDGE {bridgeStatus==='online'?'●':bridgeStatus==='offline'?'○':'…'}</span>
          </button>

          <button
            onClick={() => { setShowSettings(true); setSettingsTab('voice'); }}
            className="flex items-center gap-1 hover:text-white transition-colors"
            title="Выбор голоса"
          >
            <Volume2 className="w-3 h-3" />
            <span className="text-white/60 max-w-[80px] truncate">
              {[...VOICE_OPTIONS.ru, ...VOICE_OPTIONS.en].find(v => v.id === selectedVoice)?.label?.split(' ')[0] || 'ГОЛОС'}
            </span>
          </button>

          <button
            onClick={() => { setShowSettings(true); setSettingsTab('servers'); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="text-white/50 hover:text-white/70 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            <span className={isSpeaking ? 'text-white animate-pulse' : isProcessing ? 'text-yellow-500 animate-pulse' : 'text-white/50'}>
              {isSpeaking ? 'РЕЧЬ' : isProcessing ? 'ОБРАБОТКА' : 'ОЖИДАНИЕ'}
            </span>
          </div>
        </div>
      </header>

      {/* Превью экрана */}
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
              className="bg-black border border-white/50 rounded-lg p-6 w-full max-w-md"
            >
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-white font-bold tracking-widest text-sm">НАСТРОЙКИ</h2>
                <button onClick={() => setShowSettings(false)} className="text-white/60 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-1 mb-5">
                {(['servers', 'voice'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setSettingsTab(tab)}
                    className={cn(
                      'flex-1 py-1.5 text-[10px] tracking-widest border rounded transition-all',
                      settingsTab === tab
                        ? 'border-white/60 text-white bg-white/10'
                        : 'border-white/60 text-white/60 hover:text-white/80'
                    )}
                  >
                    {tab === 'servers' ? 'СЕРВЕРЫ' : 'ГОЛОС'}
                  </button>
                ))}
              </div>

              {settingsTab === 'servers' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-white/70 tracking-widest flex items-center gap-2">
                      <Wifi className="w-3 h-3" /> MIPO ENGINE (Colab)
                      <span className={`ml-auto ${sc(engineStatus)}`}>
                        {engineStatus==='online'?'ОНЛАЙН':engineStatus==='offline'?'ОФЛАЙН':'...'}
                      </span>
                    </label>
                    <input
                      type="text" value={engineInput} onChange={e => setEngineInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveSettings()}
                      placeholder="https://xxxx.ngrok.io"
                      className="w-full bg-black/50 border border-white/50 text-white text-sm px-3 py-2 rounded outline-none focus:border-white/60"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-white/70 tracking-widest flex items-center gap-2">
                      <Monitor className="w-3 h-3" /> LOCAL BRIDGE (ПК)
                      <span className={`ml-auto ${sc(bridgeStatus)}`}>
                        {bridgeStatus==='online'?'ОНЛАЙН':bridgeStatus==='offline'?'ОФЛАЙН':'...'}
                      </span>
                    </label>
                    <input
                      type="text" value={bridgeInput} onChange={e => setBridgeInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveSettings()}
                      placeholder="http://localhost:3001"
                      className="w-full bg-black/50 border border-white/50 text-white text-sm px-3 py-2 rounded outline-none focus:border-white/60"
                    />
                    <p className="text-[10px] text-white/50">
                      Запусти <code className="text-white/70">node local-bridge.cjs</code> на ПК
                    </p>
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button onClick={saveSettings}
                      className="flex items-center gap-2 px-4 py-2 border border-white/60 text-white text-xs hover:bg-white/10 rounded transition-all">
                      <Check className="w-3 h-3" /> СОХРАНИТЬ
                    </button>
                    <button onClick={() => { setEngineInput(DEFAULT_ENGINE_URL); setBridgeInput(DEFAULT_BRIDGE_URL); }}
                      className="px-4 py-2 border border-white/60 text-white/60 text-xs hover:text-white/80 rounded transition-all">
                      СБРОСИТЬ
                    </button>
                  </div>
                </div>
              )}

              {settingsTab === 'voice' && (
                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] text-white/70 tracking-widest mb-2">🇷🇺 РУССКИЕ ГОЛОСА</div>
                    <div className="space-y-1.5">
                      {VOICE_OPTIONS.ru.map(v => (
                        <button key={v.id} onClick={() => saveVoice(v.id)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded border text-xs transition-all flex items-center gap-2',
                            selectedVoice === v.id
                              ? 'border-white/60 text-white bg-white/12'
                              : 'border-white/60 text-white/60 hover:border-white/50 hover:text-white/80'
                          )}>
                          <span>{v.flag}</span>
                          <span>{v.label}</span>
                          {selectedVoice === v.id && <span className="ml-auto text-white/80 text-[10px]">● активен</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-white/70 tracking-widest mb-2">🇺🇸 АНГЛИЙСКИЕ ГОЛОСА</div>
                    <div className="space-y-1.5">
                      {VOICE_OPTIONS.en.map(v => (
                        <button key={v.id} onClick={() => saveVoice(v.id)}
                          className={cn(
                            'w-full text-left px-3 py-2 rounded border text-xs transition-all flex items-center gap-2',
                            selectedVoice === v.id
                              ? 'border-white/60 text-white bg-white/12'
                              : 'border-white/60 text-white/60 hover:border-white/50 hover:text-white/80'
                          )}>
                          <span>{v.flag}</span>
                          <span>{v.label}</span>
                          {selectedVoice === v.id && <span className="ml-auto text-white/80 text-[10px]">● активен</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => speak('Привет! Я MIPO, ваш персональный ассистент. Как дела?')}
                    disabled={isSpeaking}
                    className="w-full py-2 border border-white/60 text-white/60 text-xs hover:text-white/80 rounded transition-all disabled:opacity-40"
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
                className="flex items-center gap-1 px-3 py-1.5 border border-white/60 text-white/60 text-[10px] hover:bg-white/10rounded transition-all disabled:opacity-40">
                <Camera className="w-3 h-3" /> СКРИНШОТ
              </button>
              <button onClick={quickStats} disabled={isProcessing}
                className="flex items-center gap-1 px-3 py-1.5 border border-white/60 text-white/60 text-[10px] hover:bg-white/10rounded transition-all disabled:opacity-40">
                <Activity className="w-3 h-3" /> СТАТИСТИКА
              </button>
            </>
          )}
          <button onClick={() => handleSend('Найди в интернете последние новости технологий')} disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 border border-white/60 text-white/60 text-[10px] hover:bg-white/10rounded transition-all disabled:opacity-40">
            <Search className="w-3 h-3" /> ПОИСК
          </button>
          <button onClick={screenWatching ? stopScreenWatch : startScreenWatch}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 border text-[10px] rounded transition-all',
              screenWatching
                ? 'border-green-700/50 text-green-500 hover:bg-green-950/20'
                : 'border-white/60 text-white/60 hover:bg-white/10
            )}>
            {screenWatching ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {screenWatching ? 'ВЫКЛ ЭКРАН' : 'СМОТРЕТЬ ЭКРАН'}
          </button>
        </div>
      )}

      {/* Монитор системы в реальном времени */}
      <SystemMonitor bridgeUrl={bridgeUrl} bridgeStatus={bridgeStatus} />

      {/* Чат */}
      <main className="flex-1 flex flex-col bg-black/20 border border-white/60 rounded-lg backdrop-blur-sm overflow-hidden min-h-0">
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
                    ? 'bg-white/10 border-white/60 text-white'
                    : 'bg-black/40 border-white/60 text-white'
                )}>
                  <span className="whitespace-pre-wrap">{msg.text}</span>

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

                  {msg.screenshot && (
                    <div className="mt-3">
                      <img
                        src={`data:image/png;base64,${msg.screenshot}`}
                        alt="Скриншот"
                        className="max-w-full rounded border border-white/60 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => {
                          const w = window.open();
                          if (w) w.document.write(`<img src="data:image/png;base64,${msg.screenshot}" style="max-width:100%">`);
                        }}
                      />
                      <p className="text-[10px] text-white/60 mt-1">Нажми для увеличения</p>
                    </div>
                  )}

                  {msg.toolResults && (
                    <details className="mt-2">
                      <summary className="text-[10px] text-white/50 cursor-pointer hover:text-white/70 transition-colors select-none">
                        ⚙ данные инструментов
                      </summary>
                      <pre className="mt-1.5 text-[10px] text-white/70 bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto border border-white/60">
                        {msg.toolResults}
                      </pre>
                    </details>
                  )}
                </div>
                <span className="text-[10px] text-white/70 mt-1">
                  {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Строка ввода */}
        <div className="p-4 border-t border-white/60 bg-black/40 flex-shrink-0">
          {liveTranscript && (
            <div className="text-xs text-white/70 italic mb-2 px-1">🎙 {liveTranscript}</div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={toggleListening}
              className={cn('p-3 rounded-full border transition-all flex-shrink-0',
                isListening
                  ? 'bg-red-950/30 border-red-500/50 text-red-400 animate-pulse'
                  : 'bg-white/10border-white/60 text-white hover:bg-white/12'
              )}>
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <input type="text" value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={screenWatching ? 'MIPO видит ваш экран. Задайте вопрос...' : 'Введите команду или вопрос...'}
              className="flex-1 bg-transparent border-b border-white/50 text-white placeholder-white/20 text-sm py-2 px-1 outline-none focus:border-white/60 transition-colors"
            />

            <button onClick={() => handleSend()} disabled={!inputText.trim() || isProcessing}
              className={cn('p-3 rounded-full border transition-all flex-shrink-0',
                inputText.trim() && !isProcessing
                  ? 'bg-white/10 border-white/60 text-white hover:bg-white/18'
                  : 'border-white/60 text-white/70 cursor-not-allowed'
              )}>
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
