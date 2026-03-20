/**
 * MIPO Local Bridge v3.0
 * Запуск: node local-bridge.cjs
 * Порт:   3001 (или BRIDGE_PORT=xxxx node local-bridge.cjs)
 */

const express  = require('express');
const { exec } = require('child_process');
const cors     = require('cors');
const os       = require('os');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.BRIDGE_PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─────────────────────────────────────────────
// ЗАЩИТА СИСТЕМНЫХ ПУТЕЙ
// ─────────────────────────────────────────────

const SYSTEM_PATHS = [
  // Windows
  'c:\\windows', 'c:\\program files', 'c:\\program files (x86)',
  'c:\\programdata\\microsoft', 'c:\\system volume information',
  // Linux / macOS
  '/etc', '/sys', '/proc', '/boot', '/usr/lib', '/usr/bin',
  '/bin', '/sbin', '/lib', '/lib64', '/dev',
  // macOS
  '/system', '/private/etc', '/private/var/db',
];

function isSystemPath(filePath) {
  const normalized = filePath.toLowerCase().replace(/\\/g, '/');
  return SYSTEM_PATHS.some(sp => normalized.startsWith(sp.replace(/\\/g, '/')));
}

function guardPath(filePath, res) {
  if (!filePath) {
    res.status(400).json({ error: 'Путь не указан' });
    return false;
  }
  if (isSystemPath(filePath)) {
    res.status(403).json({ error: `Доступ запрещён: системный путь (${filePath})` });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────
// CPU HELPER
// ─────────────────────────────────────────────

let previousCpus = os.cpus();

function getCpuUsage() {
  const currentCpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (let i = 0; i < currentCpus.length; i++) {
    const prev = previousCpus[i];
    const curr = currentCpus[i];
    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
    const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0);
    totalIdle += curr.times.idle - prev.times.idle;
    totalTick += currTotal - prevTotal;
  }
  previousCpus = currentCpus;
  return totalTick > 0 ? 100 - Math.floor((totalIdle / totalTick) * 100) : 0;
}

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    version:  '3.0.0',
    platform: process.platform,
    hostname: os.hostname(),
  });
});

// ─────────────────────────────────────────────
// STATS — CPU, RAM, uptime
// ─────────────────────────────────────────────

app.get('/stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  res.json({
    cpu:      getCpuUsage(),
    ram:      Math.floor(((totalMem - freeMem) / totalMem) * 100),
    totalMem: (totalMem / 1024 / 1024 / 1024).toFixed(1),
    freeMem:  (freeMem  / 1024 / 1024 / 1024).toFixed(1),
    uptime:   Math.floor(os.uptime() / 60),
    platform: process.platform,
    hostname: os.hostname(),
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    cpuCores: os.cpus().length,
  });
});

// ─────────────────────────────────────────────
// PROCESSES
// ─────────────────────────────────────────────

app.get('/processes', (req, res) => {
  const plt = process.platform;
  const cmd = plt === 'win32'
    ? 'tasklist /fo csv /nh'
    : 'ps -ax -o pid=,comm=,%cpu=,%mem= --sort=-%cpu';

  exec(cmd, (error, stdout) => {
    if (error) return res.status(500).json({ error: error.message });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const processes = lines.map(line => {
      if (plt === 'win32') {
        const parts = line.replace(/"/g, '').split(',');
        return { pid: parts[1]?.trim(), name: parts[0]?.trim(), cpu: '?', mem: parts[4]?.trim() };
      } else {
        const parts = line.trim().split(/\s+/);
        return { pid: parts[0], name: parts[1], cpu: parts[2], mem: parts[3] };
      }
    }).filter(p => p.name).slice(0, 50);
    res.json({ processes });
  });
});

// ─────────────────────────────────────────────
// SCREENSHOT
// ─────────────────────────────────────────────

app.get('/screenshot', (req, res) => {
  const plt     = process.platform;
  const tmpFile = path.join(os.tmpdir(), `mipo_screen_${Date.now()}.png`);

  let cmd;
  if (plt === 'win32') {
    cmd = `powershell -command "Add-Type -AssemblyName System.Windows.Forms; ` +
      `$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
      `$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); ` +
      `$gfx = [System.Drawing.Graphics]::FromImage($bmp); ` +
      `$gfx.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); ` +
      `$bmp.Save('${tmpFile}', [System.Drawing.Imaging.ImageFormat]::Png)"`;
  } else if (plt === 'darwin') {
    cmd = `screencapture -x ${tmpFile}`;
  } else {
    cmd = `scrot ${tmpFile}`;
  }

  exec(cmd, (error) => {
    if (error) {
      return res.status(500).json({
        error: `Скриншот не удался: ${error.message}`,
        hint: plt === 'linux' ? 'Установи scrot: sudo apt install scrot' : error.message,
      });
    }
    fs.readFile(tmpFile, (err, data) => {
      fs.unlink(tmpFile, () => {});
      if (err) return res.status(500).json({ error: err.message });
      res.json({ screenshot: data.toString('base64') });
    });
  });
});

// ─────────────────────────────────────────────
// ANTIVIRUS SCAN
// ─────────────────────────────────────────────

const SUSPICIOUS_PROCESS_PATTERNS = [
  /miner/i, /xmrig/i, /cryptonight/i, /stratum/i,
  /keylogger/i, /hookdll/i, /spyware/i,
  /njrat/i, /darkcomet/i, /nanocore/i, /quasar/i,
  /remcos/i, /asyncrat/i, /netbus/i, /subseven/i,
  /mimikatz/i, /procdump/i, /pwdump/i,
  /payload/i, /backdoor/i, /trojan/i, /malware/i,
  /rootkit/i, /botnet/i, /exploit/i,
];

const SUSPICIOUS_EXTENSIONS = ['.exe.tmp', '.vbs', '.bat.tmp', '.ps1.tmp'];

function isSuspiciousProcess(name) {
  return SUSPICIOUS_PROCESS_PATTERNS.some(p => p.test(name));
}

app.post('/scan', async (req, res) => {
  const plt = process.platform;
  const results = { threats: [], warnings: [], scanned: 0, status: 'clean' };

  try {
    await new Promise((resolve) => {
      const cmd = plt === 'win32' ? 'tasklist /fo csv /nh' : 'ps -ax -o comm= --sort=comm';
      exec(cmd, (err, stdout) => {
        if (err) { resolve(); return; }
        const lines = stdout.trim().split('\n').filter(Boolean);
        lines.forEach(line => {
          const name = plt === 'win32'
            ? line.replace(/"/g, '').split(',')[0]?.trim()
            : line.trim();
          results.scanned++;
          if (name && isSuspiciousProcess(name)) {
            results.threats.push({ type: 'process', name, description: `Подозрительный процесс: ${name}`, severity: 'high' });
          }
        });
        resolve();
      });
    });

    if (plt === 'win32') {
      await new Promise((resolve) => {
        exec('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', (err, stdout) => {
          if (err) { resolve(); return; }
          const lines = stdout.trim().split('\n').filter(l => l.includes('REG_SZ'));
          lines.forEach(line => {
            results.scanned++;
            const match = line.match(/REG_SZ\s+(.+)/);
            const val = match?.[1]?.trim() || '';
            if (val && SUSPICIOUS_EXTENSIONS.some(ext => val.toLowerCase().includes(ext))) {
              results.threats.push({ type: 'autorun', name: val, description: `Подозрительная автозагрузка: ${val}`, severity: 'medium' });
            }
            if (val.toLowerCase().includes('\\temp\\') || val.toLowerCase().includes('\\tmp\\')) {
              results.warnings.push({ type: 'autorun_temp', name: val, description: `Автозагрузка из TEMP: ${val}`, severity: 'medium' });
            }
          });
          resolve();
        });
      });
    }

    const tmpDir = os.tmpdir();
    await new Promise((resolve) => {
      fs.readdir(tmpDir, (err, files) => {
        if (err) { resolve(); return; }
        files.slice(0, 200).forEach(file => {
          results.scanned++;
          const ext = path.extname(file).toLowerCase();
          if (['.exe', '.dll', '.bat', '.vbs', '.ps1', '.cmd'].includes(ext)) {
            results.warnings.push({ type: 'temp_executable', name: file, description: `Исполняемый файл в TEMP: ${file}`, severity: 'low' });
          }
        });
        resolve();
      });
    });

    if (results.threats.length > 0) results.status = 'threats_found';
    else if (results.warnings.length > 0) results.status = 'warnings';
    else results.status = 'clean';

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// LS — список файлов
// ─────────────────────────────────────────────

app.get('/ls', (req, res) => {
  const dir = req.query.dir || os.homedir();

  fs.readdir(dir, { withFileTypes: true }, (error, entries) => {
    if (error) return res.status(500).json({ error: error.message });

    const items = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => {
        const fullPath = path.join(dir, e.name);
        let size = null;
        try {
          if (!e.isDirectory()) size = fs.statSync(fullPath).size;
        } catch {}
        return {
          name: e.name,
          type: e.isDirectory() ? 'folder' : 'file',
          ext:  path.extname(e.name).toLowerCase(),
          size,
          path: fullPath,
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    res.json({ dir, items, parent: path.dirname(dir) });
  });
});

// ─────────────────────────────────────────────
// READ — прочитать текстовый файл (до 50KB)
// ─────────────────────────────────────────────

app.get('/read', (req, res) => {
  const filePath = req.query.file;
  if (!filePath) return res.status(400).json({ error: 'Укажи ?file=путь' });

  fs.stat(filePath, (err, stat) => {
    if (err) return res.status(404).json({ error: 'Файл не найден' });
    if (stat.size > 50 * 1024) return res.status(413).json({ error: 'Файл слишком большой (>50KB)' });

    fs.readFile(filePath, 'utf8', (err, content) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ file: filePath, content, size: stat.size });
    });
  });
});

// ─────────────────────────────────────────────
// WRITE — записать/создать файл (с защитой)
// ─────────────────────────────────────────────

app.post('/write', (req, res) => {
  const { file, content } = req.body;
  if (!guardPath(file, res)) return;

  // Создаём папки если нужно
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return res.status(500).json({ error: `Не могу создать папку: ${e.message}` });
  }

  fs.writeFile(file, content || '', 'utf8', (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'success', file });
  });
});

// ─────────────────────────────────────────────
// DELETE — удалить файл или папку (с защитой)
// ─────────────────────────────────────────────

app.post('/delete', (req, res) => {
  const { file } = req.body;
  if (!guardPath(file, res)) return;

  fs.stat(file, (err, stat) => {
    if (err) return res.status(404).json({ error: 'Не найдено' });

    if (stat.isDirectory()) {
      fs.rm(file, { recursive: true, force: true }, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'success', deleted: file });
      });
    } else {
      fs.unlink(file, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'success', deleted: file });
      });
    }
  });
});

// ─────────────────────────────────────────────
// RENAME — переименовать / переместить (с защитой)
// ─────────────────────────────────────────────

app.post('/rename', (req, res) => {
  const { from, to } = req.body;
  if (!guardPath(from, res)) return;
  if (!guardPath(to, res)) return;

  // Создаём папку назначения если нужно
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
  } catch {}

  fs.rename(from, to, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'success', from, to });
  });
});

// ─────────────────────────────────────────────
// MKDIR — создать папку (с защитой)
// ─────────────────────────────────────────────

app.post('/mkdir', (req, res) => {
  const { dir } = req.body;
  if (!guardPath(dir, res)) return;

  fs.mkdir(dir, { recursive: true }, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ status: 'success', dir });
  });
});

// ─────────────────────────────────────────────
// SHELL — выполнить команду
// ─────────────────────────────────────────────

app.post('/shell', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'command обязателен' });
  console.log(`[SHELL] ${command}`);
  exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ status: 'error', output: stderr || error.message });
    res.json({ status: 'success', output: stdout.trim() });
  });
});

// ─────────────────────────────────────────────
// OPEN — открыть файл, папку или URL
// ─────────────────────────────────────────────

app.post('/open', (req, res) => {
  const { path: targetPath, type } = req.body;
  if (!targetPath) return res.status(400).json({ error: 'path обязателен' });
  console.log(`[OPEN] ${type}: ${targetPath}`);
  const plt = process.platform;
  const cmd = plt === 'win32'
    ? `start "" "${targetPath}"`
    : plt === 'darwin' ? `open "${targetPath}"` : `xdg-open "${targetPath}"`;
  exec(cmd, (error) => {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success' });
  });
});

// ─────────────────────────────────────────────
// TYPE — симулировать ввод с клавиатуры
// ─────────────────────────────────────────────

app.post('/type', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text обязателен' });
  const safeText = text.replace(/"/g, '\\"');
  const plt = process.platform;
  let cmd;
  if (plt === 'win32') {
    cmd = `powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${safeText}')"`;
  } else if (plt === 'darwin') {
    cmd = `osascript -e 'tell application "System Events" to keystroke "${safeText}"'`;
  } else {
    cmd = `xdotool type "${safeText}"`;
  }
  exec(cmd, (error) => {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success' });
  });
});

// ─────────────────────────────────────────────
// NOTIFY — системное уведомление
// ─────────────────────────────────────────────

app.post('/notify', (req, res) => {
  const { title = 'MIPO', message } = req.body;
  if (!message) return res.status(400).json({ error: 'message обязателен' });
  const plt = process.platform;
  let cmd;
  if (plt === 'win32') {
    cmd = `powershell -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${message}', '${title}')"`;
  } else if (plt === 'darwin') {
    cmd = `osascript -e 'display notification "${message}" with title "${title}"'`;
  } else {
    cmd = `notify-send "${title}" "${message}"`;
  }
  exec(cmd, (error) => {
    if (error) return res.status(500).json({ status: 'error', message: error.message });
    res.json({ status: 'success' });
  });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║        MIPO LOCAL BRIDGE v3.0 ONLINE         ║
╠══════════════════════════════════════════════╣
║  Port:     ${String(PORT).padEnd(32)}║
║  Platform: ${process.platform.padEnd(32)}║
║  Host:     ${os.hostname().slice(0, 32).padEnd(32)}║
╠══════════════════════════════════════════════╣
║  GET  /health      — статус                  ║
║  GET  /stats       — CPU, RAM, uptime        ║
║  GET  /processes   — процессы                ║
║  GET  /screenshot  — скриншот экрана         ║
║  GET  /ls?dir=     — файлы в папке           ║
║  GET  /read?file=  — читать файл             ║
║  POST /write       — записать файл           ║
║  POST /delete      — удалить файл/папку      ║
║  POST /rename      — переименовать/переместить║
║  POST /mkdir       — создать папку           ║
║  POST /scan        — антивирусная проверка   ║
║  POST /shell       — выполнить команду       ║
║  POST /open        — открыть файл/URL        ║
║  POST /type        — ввод текста             ║
║  POST /notify      — уведомление             ║
╚══════════════════════════════════════════════╝
  `);
});
