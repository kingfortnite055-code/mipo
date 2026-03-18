import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Send, Globe, Wifi, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'jarvis';
  timestamp: Date;
}

const MIPO_ENGINE_URL = 'http://localhost:8000';

export default function MipoInterface() {
  const [initialized, setInitialized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [location, setLocation] = useState<string>('НЕИЗВЕСТНО');
  const [liveTranscript, setLiveTranscript] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerStreamRef = useRef<MediaStream | null>(null);
  const visualizerAnimationRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const isSpeakingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Загрузка истории
  useEffect(() => {
    const saved = localStorage.getItem('mipo_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const hydrated = parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
        const uniqueMap = new Map();
        hydrated.forEach((m: any) => uniqueMap.set(m.id, m));
        setMessages(Array.from(uniqueMap.values()));
      } catch (e) {
        console.error('Ошибка загрузки истории:', e);
      }
    }
  }, []);

  // Сохранение истории
  useEffect(() => {
    const saveHistory = () => {
      if (messagesRef.current.length > 0) {
        localStorage.setItem('mipo_history', JSON.stringify(messagesRef.current));
      }
    };
    const interval = setInterval(saveHistory, 30000);
    window.addEventListener('beforeunload', saveHistory);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', saveHistory);
      saveHistory();
    };
  }, []);

  // Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition =
        (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'ru-RU';

      recognitionRef.current.onresult = (event: any) => {
        if (!event.results || event.results.length === 0) return;
        const result = event.results[event.results.length - 1];
        if (!result || !result[0]) return;
        const transcript = result[0].transcript;
        setLiveTranscript(transcript);
        if (result.isFinal) {
          setInputText(transcript);
          window.dispatchEvent(new CustomEvent('mipo-voice-command', { detail: transcript }));
          setLiveTranscript('');
        }
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
        stopVisualizer();
      };
    }
  }, []);

  // Голосовые команды
  useEffect(() => {
    const handleVoiceCommand = (e: any) => { handleSendMessage(e.detail); };
    window.addEventListener('mipo-voice-command', handleVoiceCommand);
    return () => window.removeEventListener('mipo-voice-command', handleVoiceCommand);
  }, [isProcessing]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── АУДИО ──────────────────────────────────────────────

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const playBeep = (type: 'send' | 'receive') => {
    if (!audioContextRef.current) return;
    const osc = audioContextRef.current.createOscillator();
    const gain = audioContextRef.current.createGain();
    osc.connect(gain);
    gain.connect(audioContextRef.current.destination);
    const now = audioContextRef.current.currentTime;
    if (type === 'send') {
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(); osc.stop(now + 0.1);
    } else {
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc.start(); osc.stop(now + 0.15);
    }
  };

  // ── ВИЗУАЛИЗАТОР ────────────────────────────────────────

  const drawVisualizer = () => {
    visualizerAnimationRef.current = requestAnimationFrame(drawVisualizer);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dataArray = dataArrayRef.current;
    if (analyserRef.current && dataArray) {
      analyserRef.current.getByteFrequencyData(dataArray);
    } else if (isSpeakingRef.current) {
      if (!dataArray || dataArray.length !== 64) {
        dataArray = new Uint8Array(64);
        dataArrayRef.current = dataArray;
      }
      const time = Date.now() / 100;
      for (let i = 0; i < 64; i++) {
        dataArray[i] = Math.min(255, Math.max(0,
          Math.sin(i * 0.2 + time) * 50 + Math.cos(i * 0.5 - time) * 30 + Math.random() * 20 + 80
        ));
      }
    } else {
      dataArray?.fill(0);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2, r = 30;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (dataArray) {
      const step = (Math.PI * 2) / 64;
      for (let i = 0; i < 64; i++) {
        const v = dataArray[i] || 0;
        const h = (v / 255) * 50;
        const a = i * step;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * (r + h), cy + Math.sin(a) * (r + h));
        ctx.strokeStyle = `rgba(6, 182, 212, ${v > 10 ? v / 200 : 0.1})`;
        ctx.lineWidth = 2;
        ctx.stroke();
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
        if (audioContextRef.current.state === 'suspended')
          await audioContextRef.current.resume();
        const analyser = audioContextRef.current.createAnalyser();
        audioContextRef.current.createMediaStreamSource(stream).connect(analyser);
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      if (!visualizerAnimationRef.current) drawVisualizer();
    } catch (err) {
      console.error('Ошибка визуализатора:', err);
    }
  };

  const stopVisualizer = () => {
    visualizerStreamRef.current?.getTracks().forEach(t => t.stop());
    visualizerStreamRef.current = null;
    analyserRef.current = null;
    if (!isSpeakingRef.current) {
      cancelAnimationFrame(visualizerAnimationRef.current);
      visualizerAnimationRef.current = 0;
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const checkStopVisualizer = () => {
    if (!isSpeakingRef.current && !visualizerStreamRef.current) {
      cancelAnimationFrame(visualizerAnimationRef.current);
      visualizerAnimationRef.current = 0;
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // ── ОЗВУЧКА ─────────────────────────────────────────────

  const playAudio = async (base64: string) => {
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    if (!visualizerAnimationRef.current) drawVisualizer();

    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    audio.onended = () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      checkStopVisualizer();
    };
    await audio.play();
  };

  const speak = async (text: string) => {
    if (!text.trim()) return;
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    if (!visualizerAnimationRef.current) drawVisualizer();

    try {
      const res = await fetch(`${MIPO_ENGINE_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('TTS не отвечает');
      const data = await res.json();
      await playAudio(data.audio);
    } catch (err) {
      console.error('Ошибка озвучки:', err);
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      checkStopVisualizer();
    }
  };

  // ── ОТПРАВКА СООБЩЕНИЯ ──────────────────────────────────

  /**
   * Конвертируем messages[] в формат истории для бэкенда.
   * Берём последние 20 сообщений, кроме текущего.
   */
  const buildHistory = (currentMessages: Message[]) => {
    return currentMessages.slice(-20).map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      text: m.text,
    }));
  };

  const handleSendMessage = async (textToProcess: string = inputText) => {
    if (!textToProcess.trim() || isProcessing) return;

    setIsProcessing(true);
    playBeep('send');

    const userMsg: Message = {
      id: crypto.randomUUID(),
      text: textToProcess,
      sender: 'user',
      timestamp: new Date(),
    };

    // Снимаем историю ДО добавления нового сообщения
    const history = buildHistory(messagesRef.current);

    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    try {
      const res = await fetch(`${MIPO_ENGINE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToProcess,
          history,          // передаём историю диалога
        }),
      });

      if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);

      const data = await res.json();
      playBeep('receive');

      const mipoMsg: Message = {
        id: crypto.randomUUID(),
        text: data.reply,
        sender: 'jarvis',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, mipoMsg]);

      // Воспроизводим аудио (пришло сразу или запрашиваем отдельно)
      if (data.audio) {
        await playAudio(data.audio);
      } else {
        await speak(data.reply);
      }
    } catch (err) {
      console.error('Ошибка MIPO Engine:', err);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        text: 'Сбой подключения к MIPO Engine. Проверьте, запущен ли mipo_engine.py на порту 8000.',
        sender: 'jarvis',
        timestamp: new Date(),
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      try { recognitionRef.current?.stop(); } catch (_) {}
      stopVisualizer();
    } else {
      setIsListening(true);
      try { recognitionRef.current?.start(); } catch (_) {}
      startVisualizer();
    }
  };

  // ── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────────────

  const initializeSystem = () => {
    initAudio();
    setInitialized(true);
    playBeep('receive');

    navigator.geolocation?.getCurrentPosition(
      pos => setLocation(`${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`),
      () => setLocation('НЕДОСТУПНО')
    );

    setTimeout(() => {
      const initMsg: Message = {
        id: 'init',
        text: 'Системы MIPO в сети. Локальный сервер подключён на порту 8000.',
        sender: 'jarvis',
        timestamp: new Date(),
      };
      setMessages(prev => prev.find(m => m.id === 'init') ? prev : [...prev, initMsg]);
      speak(initMsg.text);
    }, 1000);
  };

  // ── РЕНДЕР ───────────────────────────────────────────────

  if (!initialized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-6">
          <div className="text-cyan-400 text-6xl font-bold tracking-widest">MIPO</div>
          <div className="text-cyan-600 text-sm tracking-[0.4em]">ИНТЕРФЕЙС MARK VII</div>
          <button
            onClick={initializeSystem}
            className="px-8 py-3 border border-cyan-500/50 text-cyan-400 text-sm tracking-widest hover:bg-cyan-950/30 transition-all"
          >
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
        <div className="flex gap-6 text-[10px] md:text-xs">
          <div className="flex items-center gap-2 text-cyan-600">
            <Globe className="w-3 h-3" /><span>{location}</span>
          </div>
          <div className="flex items-center gap-2 text-cyan-600">
            <Wifi className="w-3 h-3" /><span>MIPO:8000</span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3" />
            <span className={isSpeaking ? 'text-cyan-300 animate-pulse' : isProcessing ? 'text-yellow-500 animate-pulse' : 'text-cyan-700'}>
              {isSpeaking ? 'РЕЧЬ' : isProcessing ? 'ОБРАБОТКА' : 'ОЖИДАНИЕ'}
            </span>
          </div>
        </div>
      </header>

      {/* Чат */}
      <main className="flex-1 flex flex-col bg-black/20 border border-cyan-900/30 rounded-lg backdrop-blur-sm overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          <AnimatePresence>
            {messages.map(msg => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
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
                  {msg.text}
                </div>
                <span className="text-[10px] text-cyan-800 mt-1">
                  {msg.timestamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Ввод */}
        <div className="p-4 border-t border-cyan-900/30 bg-black/40">
          {liveTranscript && (
            <div className="text-xs text-cyan-600 italic mb-2 px-1">🎙 {liveTranscript}</div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleListening}
              className={cn(
                'p-3 rounded-full border transition-all',
                isListening
                  ? 'bg-red-950/30 border-red-500/50 text-red-400 animate-pulse'
                  : 'bg-cyan-950/20 border-cyan-600/50 text-cyan-400 hover:bg-cyan-950/40'
              )}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
              }}
              placeholder="Введите команду..."
              className="flex-1 bg-transparent border-b border-cyan-800/50 text-cyan-100 placeholder-cyan-800 text-sm py-2 px-1 outline-none focus:border-cyan-500/70 transition-colors"
            />

            <button
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim() || isProcessing}
              className={cn(
                'p-3 rounded-full border transition-all',
                inputText.trim() && !isProcessing
                  ? 'bg-cyan-950/30 border-cyan-500/50 text-cyan-400 hover:bg-cyan-950/60'
                  : 'border-cyan-900/30 text-cyan-900 cursor-not-allowed'
              )}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
