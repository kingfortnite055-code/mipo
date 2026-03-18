import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Send, Activity, Cpu, Wifi, Battery, Terminal, Globe, Shield, Power, Paperclip, X, Lock, Download, Info, Monitor, FolderOpen, Eye, Settings } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'jarvis';
  timestamp: Date;
}

export default function JarvisInterface() {
  const [initialized, setInitialized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [location, setLocation] = useState<string>('НЕИЗВЕСТНО');
  const [weather, setWeather] = useState<string>('--°C');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showInstallInfo, setShowInstallInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [fileHandle, setFileHandle] = useState<any>(null);
  const [fileList, setFileList] = useState<string[]>([]);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [systemStats, setSystemStats] = useState({ cpu: 0, ram: 0, totalMem: '0', uptime: 0 });
  const [statsHistory, setStatsHistory] = useState<{time: string, cpu: number, ram: number}[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const [isWakeWordActive, setIsWakeWordActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isWaitingForCommand, setIsWaitingForCommand] = useState(false);
  
  const wakeWordTriggeredRef = useRef(false);
  const wakeWordTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const visualizerStreamRef = useRef<MediaStream | null>(null);
  const visualizerAnimationRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const isSpeakingRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const wakeWordActiveRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    wakeWordActiveRef.current = isWakeWordActive;
    if (isWakeWordActive && !isListening) {
      setIsListening(true);
      try { recognitionRef.current?.start(); } catch (e) {}
      startVisualizer();
    } else if (!isWakeWordActive && isListening) {
      recognitionRef.current?.stop();
      stopVisualizer();
      setIsListening(false);
    }
  }, [isWakeWordActive]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const saved = localStorage.getItem('jarvis_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const hydrated = parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
        const uniqueMessagesMap = new Map();
        hydrated.forEach((m: any) => uniqueMessagesMap.set(m.id, m));
        setMessages(Array.from(uniqueMessagesMap.values()));
      } catch (e) { console.error("History load failed", e); }
    }
  }, []);

  useEffect(() => {
    const saveHistory = () => {
      if (messagesRef.current.length > 0) {
        localStorage.setItem('jarvis_history', JSON.stringify(messagesRef.current));
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

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult: any) => setDeferredPrompt(null));
    } else {
      setShowInstallInfo(true);
    }
  };

  const initAudio = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const playBeep = (type: 'send' | 'receive' | 'error' = 'send') => {
    if (!audioContextRef.current) return;
    const oscillator = audioContextRef.current.createOscillator();
    const gainNode = audioContextRef.current.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);
    
    if (type === 'send') {
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioContextRef.current.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1200, audioContextRef.current.currentTime + 0.1);
      gainNode.gain.setValueAtTime(0.1, audioContextRef.current.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.1);
      oscillator.start();
      oscillator.stop(audioContextRef.current.currentTime + 0.1);
    } else if (type === 'receive') {
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1200, audioContextRef.current.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(800, audioContextRef.current.currentTime + 0.15);
      gainNode.gain.setValueAtTime(0.1, audioContextRef.current.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.15);
      oscillator.start();
      oscillator.stop(audioContextRef.current.currentTime + 0.15);
    }
  };

  const initializeSystem = () => {
    initAudio();
    setInitialized(true);
    playBeep('receive');
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          setLocation(`${position.coords.latitude.toFixed(2)}, ${position.coords.longitude.toFixed(2)}`);
          setWeather('+20°C ЯСНО'); // Заглушка для стабильности
        },
        () => setLocation('НЕДОСТУПНО')
      );
    }

    setTimeout(() => {
      const initialMsg: Message = {
        id: 'init',
        text: 'Системы MIPO в сети. Локальный сервер подключен.',
        sender: 'jarvis',
        timestamp: new Date(),
      };
      setMessages([initialMsg]);
      speak(initialMsg.text);
    }, 1000);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
          const value = Math.sin(i * 0.2 + time) * 50 + Math.cos(i * 0.5 - time) * 30 + Math.random() * 20 + 80;
          dataArray[i] = Math.min(255, Math.max(0, value));
       }
    } else {
       if (dataArray) dataArray.fill(0);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 30;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const bars = 64;
    const step = (Math.PI * 2) / bars;

    if (dataArray) {
      for (let i = 0; i < bars; i++) {
        const value = dataArray[i] || 0;
        const barHeight = (value / 255) * 50;
        const angle = i * step;
        const x1 = centerX + Math.cos(angle) * radius;
        const y1 = centerY + Math.sin(angle) * radius;
        const x2 = centerX + Math.cos(angle) * (radius + barHeight);
        const y2 = centerY + Math.sin(angle) * (radius + barHeight);
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(6, 182, 212, ${value > 10 ? value / 200 : 0.1})`;
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
        
        if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
        
        const audioCtx = audioContextRef.current;
        const analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      if (!visualizerAnimationRef.current) drawVisualizer();
    } catch (err: any) {
      console.error("Ошибка визуализатора", err);
    }
  };

  const stopVisualizer = () => {
    if (visualizerStreamRef.current) {
      visualizerStreamRef.current.getTracks().forEach(track => track.stop());
      visualizerStreamRef.current = null;
    }
    analyserRef.current = null;
    if (!isSpeakingRef.current) {
      if (visualizerAnimationRef.current) {
        cancelAnimationFrame(visualizerAnimationRef.current);
        visualizerAnimationRef.current = 0;
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const startTTSVisualizer = () => { if (!visualizerAnimationRef.current) drawVisualizer(); };

  const checkStopVisualizer = () => {
    if (!isSpeakingRef.current && !visualizerStreamRef.current) {
       if (visualizerAnimationRef.current) {
        cancelAnimationFrame(visualizerAnimationRef.current);
        visualizerAnimationRef.current = 0;
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'ru-RU';

      recognitionRef.current.onresult = (event: any) => {
        if (!event.results || event.results.length === 0) return;
        const result = event.results[event.results.length - 1];
        if (!result || !result[0]) return;
        
        const transcript = result[0].transcript;
        const isFinal = result.isFinal;
        setLiveTranscript(transcript);

        if (isFinal) {
           setInputText(transcript);
           window.dispatchEvent(new CustomEvent('jarvis-voice-command', { detail: transcript }));
           setLiveTranscript('');
        }
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
        stopVisualizer();
      };
    }
  }, []);

  // --- ЛОКАЛЬНАЯ ОЗВУЧКА ---
  const speak = async (text: string) => {
    if (!text.trim()) return;
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    startTTSVisualizer();

    try {
      const response = await fetch('http://localhost:3001/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error('Бэкенд озвучки не отвечает');

      const data = await response.json();
      const audioUrl = `data:audio/mpeg;base64,${data.audio}`;
      const audio = new Audio(audioUrl);

      audio.onended = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        checkStopVisualizer();
      };

      await audio.play();
    } catch (error) {
      console.error("Ошибка озвучки:", error);
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      checkStopVisualizer();
    }
  };

  // --- ОТПРАВКА СООБЩЕНИЯ В PYTHON ---
  const handleSendMessage = async (textToProcess: string = inputText) => {
    if (!textToProcess.trim() || isProcessing) return;
    
    setIsProcessing(true);
    playBeep('send');

    // Добавляем сообщение юзера в чат
    const userMsg: Message = {
      id: crypto.randomUUID(),
      text: textToProcess,
      sender: 'user',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setSelectedImage(null); 

    try {
      // Отправляем текст в наш mipo_engine.py
      const chatResponse = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToProcess }),
      });

      if (!chatResponse.ok) throw new Error('Ошибка сервера 3001');

      const chatData = await chatResponse.json();
      const replyText = chatData.reply;

      playBeep('receive');
      const jarvisMsg: Message = {
        id: crypto.randomUUID(),
        text: replyText,
        sender: 'jarvis',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, jarvisMsg]);
      
      // Озвучиваем ответ
      speak(replyText);

    } catch (error) {
      console.error("Ошибка связи с Mipo Engine:", error);
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        text: "Сбой подключения к локальному ядру MIPO. Проверьте, запущен ли mipo_engine.py на порту 3001.",
        sender: 'jarvis',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    const handleVoiceCommand = (e: any) => { handleSendMessage(e.detail); };
    window.addEventListener('jarvis-voice-command', handleVoiceCommand);
    return () => window.removeEventListener('jarvis-voice-command', handleVoiceCommand);
  }, [messages, isProcessing]); // Dependencies updated

  const toggleListening = () => {
    if (isListening) {
      setIsWakeWordActive(false);
      try { recognitionRef.current?.stop(); } catch (e) {}
      stopVisualizer();
    } else {
      setIsListening(true);
      try { recognitionRef.current?.start(); } catch (e) {}
      startVisualizer();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsScreenSharing(true);
      stream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (err) {
      console.warn("Screen sharing unavailable");
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
  };

  if (!initialized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-cyan-500 font-mono relative overflow-hidden">
        <button onClick={initializeSystem} className="relative z-10 group flex flex-col items-center gap-6">
          <div className="w-24 h-24 rounded-full border-2 border-cyan-500/50 flex items-center justify-center group-hover:border-cyan-400">
            <Power className="w-10 h-10 animate-pulse" />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold tracking-[0.5em] group-hover:text-cyan-300">ИНИЦИАЛИЗАЦИЯ</h1>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-cyan-400 font-mono overflow-hidden relative">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
      
      <div className="relative z-10 flex flex-col h-screen max-w-7xl mx-auto p-4 md:p-6 gap-4">
        
        <header className="flex justify-between items-start border-b border-cyan-900/30 pb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full border border-cyan-500/50 flex items-center justify-center">
              <Cpu className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-widest text-cyan-100 font-display">MIPO</h1>
              <p className="text-[10px] text-cyan-600 tracking-[0.3em]">ИНТЕРФЕЙС MARK VII</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-6 text-[10px] md:text-xs">
              <div className="flex items-center gap-2 text-cyan-600"><Globe className="w-3 h-3" /><span>{location}</span></div>
              <div className="flex items-center gap-2 text-cyan-600"><Wifi className="w-3 h-3" /><span>СЕРВЕР 3001</span></div>
            </div>
          </div>
        </header>

        <main className="flex-1 flex gap-6 overflow-hidden">
          <div className="flex-1 flex flex-col bg-black/20 border border-cyan-900/30 rounded-lg backdrop-blur-sm relative">
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin">
              <AnimatePresence>
                {messages.map((msg) => (
                  <motion.div key={msg.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={cn("flex flex-col max-w-[85%]", msg.sender === 'user' ? "ml-auto items-end" : "mr-auto items-start")}>
                    <div className={cn("px-4 py-3 rounded-lg border backdrop-blur-md text-sm", msg.sender === 'user' ? "bg-cyan-950/30 border-cyan-700/30 text-cyan-100" : "bg-black/40 border-cyan-900/30 text-cyan-300")}>
                      {msg.text}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 border-t border-cyan-900/30 bg-black/40">
              <video ref={videoRef} className="hidden" />
              <div className="flex items-center gap-3">
                <button onClick={toggleListening} className={cn("p-3 rounded-full border", isListening ? "bg-red-950/30 border-red-500/50 text-red-500" : "bg-cyan-950/20 border-cyan-600/50 text-cyan-400")}>
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="ВВЕДИТЕ КОМАНДУ..."
                    className="w-full bg-black/40 border border-cyan-900/50 rounded-sm px-4 text-cyan-100 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <button onClick={() => handleSendMessage()} disabled={(!inputText.trim() && !selectedImage) || isProcessing} className="p-3 rounded-sm border border-cyan-600/50 text-cyan-400 disabled:opacity-30">
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex w-72 flex-col gap-4">
            <div className="h-48 bg-black/20 border border-cyan-900/30 rounded-lg flex items-center justify-center relative">
               <canvas ref={canvasRef} width={300} height={200} className="absolute inset-0 w-full h-full z-10" />
               {!isListening && (
                 <div className={cn("w-24 h-24 rounded-full border-2 border-cyan-500/30 flex items-center justify-center", isSpeaking && "scale-110 border-cyan-400/60")}>
                   <div className={cn("w-16 h-16 rounded-full bg-cyan-500/5", isSpeaking && "animate-pulse bg-cyan-400/10")} />
                 </div>
               )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}