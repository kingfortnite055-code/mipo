import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Send, Globe, Wifi, Activity, Settings, X, Check, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'jarvis';
  timestamp: Date;
}

const DEFAULT_ENGINE_URL = 'http://localhost:8000';
const DEFAULT_BRIDGE_URL = 'http://localhost:3001';
const KEY_ENGINE_URL     = 'mipo_engine_url';
const KEY_BRIDGE_URL     = 'mipo_bridge_url';
const KEY_HISTORY        = 'mipo_history';

// ngrok-skip-browser-warning убирает страницу-предупреждение ngrok для API запросов
const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

export default function MipoInterface() {
  const [initialized, setInitialized]   = useState(false);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [inputText, setInputText]       = useState('');
  const [isListening, setIsListening]   = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking]     = useState(false);
  const [location, setLocation]         = useState('НЕИЗВЕСТНО');
  const [liveTranscript, setLiveTranscript] = useState('');

  const [engineUrl, setEngineUrl] = useState(() => localStorage.getItem(KEY_ENGINE_URL) || DEFAULT_ENGINE_URL);
  const [bridgeUrl, setBridgeUrl] = useState(() => localStorage.getItem(KEY_BRIDGE_URL) || DEFAULT_BRIDGE_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [engineInput, setEngineInput]   = useState(engineUrl);
  const [bridgeInput, setBridgeInput]   = useState(bridgeUrl);
  const [engineStatus, setEngineStatus] = useState<'unknown'|'online'|'offline'>('unknown');
  const [bridgeStatus, setBridgeStatus] = useState<'unknown'|'online'|'offline'>('unknown');

  const messagesEndRef      = useRef<HTMLDivElement>(null);
  const messagesRef         = useRef<Message[]>([]);
  const recognitionRef      = useRef<any>(null);
  const audioContextRef     = useRef<AudioContext | null>(null);
  const canvasRef           = useRef<HTMLCanvasElement>(null);
  const visualizerStreamRef = useRef<MediaStream | null>(null);
  const visualizerAnimRef   = useRef<number>(0);
  const analyserRef         = useRef<AnalyserNode | null>(null);
  const dataArrayRef        = useRef<Uint8Array | null>(null);
  const isSpeakingRef       = useRef(false);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // История
  useEffect(() => {
    const saved = localStorage.getItem(KEY_HISTORY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      const map = new Map();
      parsed
        .map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        .forEach((m: any) => map.set(m.id, m));
      setMessages(Array.from(map.values()));
    } catch {}
  }, []);

  useEffect(() => {
    const save = () => {
      if (messagesRef.current.length > 0)
        localStorage.setItem(KEY_HISTORY, JSON.stringify(messagesRef.current));
    };
    const interval = setInterval(save, 30000);
    window.addEventListener('beforeunload', save);
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', save); save(); };
  }, []);

  // Пинг серверов
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

  // Speech Recognition
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'ru-RU';
    r.onresult = (e: any) => {
      if (!e.results?.length) return;
      const res = e.results[e.results.length - 1];
      const t = res[0]?.transcript ?? '';
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
  }, [isProcessing]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Аудио
  const initAudio = () => {
    if (!audioContextRef.current)
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
  };

  const playBeep = (type: 'send'|'receive') => {
    if (!audioContextRef.current) return;
    const osc = audioContextRef.current.createOscillator();
    const gain = audioContextRef.current.createGain();
    osc.connect(gain); gain.connect(audioContextRef.current.destination);
    const now = audioContextRef.current.currentTime;
    if (type === 'send') {
      osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(); osc.stop(now + 0.1);
    } else {
      osc.frequency.setValueAtTime(1200, now); osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
      gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(); osc.stop(now + 0.15);
    }
  };

  // Визуализатор
  const drawVisualizer = () => {
    visualizerAnimRef.current = requestAnimationFrame(drawVisualizer);
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let da = dataArrayRef.current;
    if (analyserRef.current && da) { analyserRef.current.getByteFrequencyData(da); }
    else if (isSpeakingRef.current) {
      if (!da || da.length !== 64) { da = new Uint8Array(64); dataArrayRef.current = da; }
      const t = Date.now() / 100;
      for (let i = 0; i < 64; i++)
        da[i] = Math.min(255, Math.max(0, Math.sin(i*.2+t)*50 + Math.cos(i*.5-t)*30 + Math.random()*20 + 80));
    } else { da?.fill(0); }
    ctx.clearRect(0, 0, 80, 80);
    const cx = 40, cy = 40, r = 30;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(6,182,212,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    if (da) {
      const step = (Math.PI*2)/64;
      for (let i = 0; i < 64; i++) {
        const v = da[i]||0, h = (v/255)*50, a = i*step;
        ctx.beginPath();
        ctx.moveTo(cx+Math.cos(a)*r, cy+Math.sin(a)*r);
        ctx.lineTo(cx+Math.cos(a)*(r+h), cy+Math.sin(a)*(r+h));
        ctx.strokeStyle = `rgba(6,182,212,${v>10?v/200:0.1})`;
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
        analyser.fftSize = 256; analyserRef.current = analyser;
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
      canvasRef.current?.getContext('2d')?.clearRect(0, 0, 80, 80);
    }
  };

  const checkStopVisualizer = () => {
    if (!isSpeakingRef.current && !visualizerStreamRef.current) {
      cancelAnimationFrame(visualizerAnimRef.current); visualizerAnimRef.current = 0;
      canvasRef.current?.getContext('2d')?.clearRect(0, 0, 80, 80);
    }
  };

  // Озвучка
  const playBase64 = async (b64: string) => {
    setIsSpeaking(true); isSpeakingRef.current = true;
    if (!visualizerAnimRef.current) drawVisualizer();
    const audio = new Audio(`data:audio/mpeg;base64,${b64}`);
    audio.onended = () => { setIsSpeaking(false); isSpeakingRef.current = false; checkStopVisualizer(); };
    await audio.play();
  };

  const speak = async (text: string) => {
    if (!text.trim()) return;
    setIsSpeaking(true); isSpeakingRef.current = true;
    if (!visualizerAnimRef.current) drawVisualizer();
    try {
      const r = await fetch(`${engineUrl}/api/tts`, { method: 'POST', headers: BASE_HEADERS, body: JSON.stringify({ text }) });
      if (!r.ok) throw new Error();
      const d = await r.json();
      await playBase64(d.audio);
    } catch { setIsSpeaking(false); isSpeakingRef.current = false; checkStopVisualizer(); }
  };

  // Отправка
  const buildHistory = (msgs: Message[]) =>
    msgs.slice(-20).map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', text: m.text }));

  const handleSend = async (text: string = inputText) => {
    if (!text.trim() || isProcessing) return;
    setIsProcessing(true); playBeep('send');
    const userMsg: Message = { id: crypto.randomUUID(), text, sender: 'user', timestamp: new Date() };
    const history = buildHistory(messagesRef.current);
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    try {
      const r = await fetch(`${engineUrl}/api/chat`, {
        method: 'POST', headers: BASE_HEADERS,
        body: JSON.stringify({
          message: text,
          history,
          bridge_url: bridgeStatus === 'online' ? bridgeUrl : null,
        }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const d = await r.json();
      playBeep('receive');
      setMessages(prev => [...prev, { id: crypto.randomUUID(), text: d.reply, sender: 'jarvis', timestamp: new Date() }]);
      if (d.audio) await playBase64(d.audio);
      else await speak(d.reply);
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        text: `Сбой подключения к MIPO Engine (${engineUrl}). Проверь что Colab запущен.`,
        sender: 'jarvis', timestamp: new Date(),
      }]);
    } finally { setIsProcessing(false); }
  };

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false); try { recognitionRef.current?.stop(); } catch {} stopVisualizer();
    } else {
      setIsListening(true); try { recognitionRef.current?.start(); } catch {} startVisualizer();
    }
  };

  // Сохранение настроек
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

  // Инициализация
  const initializeSystem = () => {
    initAudio(); setInitialized(true);
    pingServer(engineUrl, setEngineStatus);
    pingServer(bridgeUrl, setBridgeStatus);
    navigator.geolocation?.getCurrentPosition(
      pos => setLocation(`${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`),
      () => setLocation('НЕДОСТУПНО')
    );
    setTimeout(() => {
      const msg: Message = { id: 'init', text: 'Системы MIPO в сети. Готов к работе.', sender: 'jarvis', timestamp: new Date() };
      setMessages(prev => prev.find(m => m.id === 'init') ? prev : [...prev, msg]);
      speak(msg.text);
    }, 800);
  };

  const sc = (s: string) => s === 'online' ? 'text-green-400' : s === 'offline' ? 'text-red-400' : 'text-cyan-700';

  // Экран инициализации
  if (!initialized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-6">
          <div className="text-cyan-400 text-6xl font-bold tracking-widest">MIPO</div>
          <div className="text-cyan-600 text-sm tracking-[0.4em]">ИНТЕРФЕЙС MARK VII</div>
          <button onClick={initializeSystem}
            className="px-8 py-3 border border-cyan-500/50 text-cyan-400 text-sm tracking-widest hover:bg-cyan-950/30 transition-all">
            ИНИЦИАЛИЗАЦИЯ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-cyan-400 flex flex-col p-4 gap-4 font-mono">

      {/* Шапка */}
      <header className="flex items-center justify-between border-b border-cyan-900/30 pb-3">
        <div className="flex items-center gap-4">
          <canvas ref={canvasRef} width={80} height={80} className="opacity-80" />
          <div>
            <h1 className="text-2xl font-bold tracking-widest text-cyan-100">MIPO</h1>
            <p className="text-[10px] text-cyan-600 tracking-[0.3em]">ИНТЕРФЕЙС MARK VII</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[10px] md:text-xs">
          <div className="flex items-center gap-1 text-cyan-700">
            <Globe className="w-3 h-3" /><span>{location}</span>
          </div>
          <button onClick={() => { setShowSettings(true); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="flex items-center gap-1 hover:text-cyan-300 transition-colors">
            <Wifi className="w-3 h-3" />
            <span className={sc(engineStatus)}>ENGINE {engineStatus==='online'?'●':engineStatus==='offline'?'○':'…'}</span>
          </button>
          <button onClick={() => { setShowSettings(true); setEngineInput(engineUrl); setBridgeInput(bridgeUrl); }}
            className="flex items-center gap-1 hover:text-cyan-300 transition-colors">
            <Monitor className="w-3 h-3" />
            <span className={sc(bridgeStatus)}>BRIDGE {bridgeStatus==='online'?'●':bridgeStatus==='offline'?'○':'…'}</span>
            <Settings className="w-3 h-3 text-cyan-800" />
          </button>
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            <span className={isSpeaking?'text-cyan-300 animate-pulse':isProcessing?'text-yellow-500 animate-pulse':'text-cyan-700'}>
              {isSpeaking?'РЕЧЬ':isProcessing?'ОБРАБОТКА':'ОЖИДАНИЕ'}
            </span>
          </div>
        </div>
      </header>

      {/* Настройки */}
      <AnimatePresence>
        {showSettings && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}}
              className="bg-black border border-cyan-800/50 rounded-lg p-6 w-full max-w-md space-y-5">
              <div className="flex justify-between items-center">
                <h2 className="text-cyan-300 font-bold tracking-widest text-sm">НАСТРОЙКИ</h2>
                <button onClick={() => setShowSettings(false)} className="text-cyan-700 hover:text-cyan-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-cyan-600 tracking-widest flex items-center gap-2">
                  <Wifi className="w-3 h-3" /> MIPO ENGINE (Colab)
                  <span className={`ml-auto ${sc(engineStatus)}`}>{engineStatus==='online'?'ОНЛАЙН':engineStatus==='offline'?'ОФЛАЙН':'...'}</span>
                </label>
                <input type="text" value={engineInput} onChange={e=>setEngineInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&saveSettings()} placeholder="https://xxxx.ngrok.io"
                  className="w-full bg-black/50 border border-cyan-800/50 text-cyan-100 text-sm px-3 py-2 rounded outline-none focus:border-cyan-500/70" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-cyan-600 tracking-widest flex items-center gap-2">
                  <Monitor className="w-3 h-3" /> LOCAL BRIDGE (ПК)
                  <span className={`ml-auto ${sc(bridgeStatus)}`}>{bridgeStatus==='online'?'ОНЛАЙН':bridgeStatus==='offline'?'ОФЛАЙН':'...'}</span>
                </label>
                <input type="text" value={bridgeInput} onChange={e=>setBridgeInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&saveSettings()} placeholder="http://localhost:3001"
                  className="w-full bg-black/50 border border-cyan-800/50 text-cyan-100 text-sm px-3 py-2 rounded outline-none focus:border-cyan-500/70" />
                <p className="text-[10px] text-cyan-800">Запусти <code className="text-cyan-600">node local-bridge.cjs</code> на ПК</p>
              </div>
              <div className="flex gap-3">
                <button onClick={saveSettings}
                  className="flex items-center gap-2 px-4 py-2 border border-cyan-500/50 text-cyan-400 text-xs hover:bg-cyan-950/30 rounded transition-all">
                  <Check className="w-3 h-3" /> СОХРАНИТЬ
                </button>
                <button onClick={() => { setEngineInput(DEFAULT_ENGINE_URL); setBridgeInput(DEFAULT_BRIDGE_URL); }}
                  className="px-4 py-2 border border-cyan-900/30 text-cyan-700 text-xs hover:text-cyan-500 rounded transition-all">
                  СБРОСИТЬ
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Чат */}
      <main className="flex-1 flex flex-col bg-black/20 border border-cyan-900/30 rounded-lg backdrop-blur-sm overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          <AnimatePresence>
            {messages.map(msg => (
              <motion.div key={msg.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}
                className={cn('flex flex-col max-w-[85%]', msg.sender==='user'?'ml-auto items-end':'mr-auto items-start')}>
                <div className={cn('px-4 py-3 rounded-lg border text-sm leading-relaxed',
                  msg.sender==='user' ? 'bg-cyan-950/30 border-cyan-700/30 text-cyan-100' : 'bg-black/40 border-cyan-900/30 text-cyan-300')}>
                  {msg.text}
                </div>
                <span className="text-[10px] text-cyan-800 mt-1">
                  {msg.timestamp.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>
        <div className="p-4 border-t border-cyan-900/30 bg-black/40">
          {liveTranscript && <div className="text-xs text-cyan-600 italic mb-2 px-1">🎙 {liveTranscript}</div>}
          <div className="flex items-center gap-3">
            <button onClick={toggleListening}
              className={cn('p-3 rounded-full border transition-all',
                isListening ? 'bg-red-950/30 border-red-500/50 text-red-400 animate-pulse'
                            : 'bg-cyan-950/20 border-cyan-600/50 text-cyan-400 hover:bg-cyan-950/40')}>
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <input type="text" value={inputText} onChange={e=>setInputText(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();}}}
              placeholder="Введите команду..."
              className="flex-1 bg-transparent border-b border-cyan-800/50 text-cyan-100 placeholder-cyan-800 text-sm py-2 px-1 outline-none focus:border-cyan-500/70 transition-colors" />
            <button onClick={()=>handleSend()} disabled={!inputText.trim()||isProcessing}
              className={cn('p-3 rounded-full border transition-all',
                inputText.trim()&&!isProcessing ? 'bg-cyan-950/30 border-cyan-500/50 text-cyan-400 hover:bg-cyan-950/60'
                                                : 'border-cyan-900/30 text-cyan-900 cursor-not-allowed')}>
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
