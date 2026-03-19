/**
 * MIPO Local Bridge — запускается на ПК пользователя
 * Предоставляет системный мониторинг и управление ПК
 * Запуск: node public/local-bridge.cjs
 */

const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());

let previousCpus = os.cpus();

function getCpuUsage() {
  const currentCpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (let i = 0; i < currentCpus.length; i++) {
    const prev = previousCpus[i], curr = currentCpus[i];
    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
    const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0);
    totalIdle += curr.times.idle - prev.times.idle;
    totalTick += currTotal - prevTotal;
  }
  previousCpus = currentCpus;
  return totalTick > 0 ? 100 - Math.floor((totalIdle / totalTick) * 100) : 0;
}

// Проверка доступности
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mipo-local-bridge' });
});

// Системная статистика
app.get('/stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  res.json({
    cpu: getCpuUsage(),
    ram: Math.floor(((totalMem - freeMem) / totalMem) * 100),
    totalMem: (totalMem / 1024 / 1024 / 1024).toFixed(1),
    uptime: Math.floor(os.uptime() / 60),
  });
});

// Список процессов
app.get('/processes', (req, res) => {
  const command = process.platform === 'win32' ? 'tasklist' : 'ps -ax -o comm';
  exec(command, (error, stdout) => {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    const lines = stdout.split('\n').slice(process.platform === 'win32' ? 3 : 1);
    const processes = lines.map(l => l.trim().split(/\s+/)[0]).filter(Boolean).slice(0, 50);
    res.json({ processes });
  });
});

// Открыть файл / приложение / URL
app.post('/open', (req, res) => {
  const { path, type } = req.body;
  if (!path) return res.status(400).json({ status: 'error', message: 'path обязателен' });
  const p = process.platform;
  const openCmd = p === 'win32' ? (type === 'url' ? `start "${path}"` : `start "" "${path}"`)
    : p === 'darwin' ? `open "${path}"` : `xdg-open "${path}"`;
  exec(openCmd, (error, stdout) => {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success', output: stdout });
  });
});

// Выполнить shell-команду
app.post('/shell', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ status: 'error', message: 'command обязателен' });
  exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ status: 'error', output: stderr || error.message });
    res.json({ status: 'success', output: stdout });
  });
});

// Симулировать ввод с клавиатуры
app.post('/type', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ status: 'error', message: 'text обязателен' });
  const safeText = text.replace(/"/g, '\\"');
  const p = process.platform;
  const cmd = p === 'win32'
    ? `powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${safeText}')"`
    : p === 'darwin'
    ? `osascript -e 'tell application "System Events" to keystroke "${safeText}"'`
    : `xdotool type "${safeText}"`;
  exec(cmd, (error) => {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success' });
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           MIPO LOCAL BRIDGE ONLINE           ║
  ╠══════════════════════════════════════════════╣
  ║  Port:  ${PORT}                                 ║
  ║  /health /stats /processes /open /shell      ║
  ╚══════════════════════════════════════════════╝
  `);
});
