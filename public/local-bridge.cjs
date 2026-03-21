/**
 * MIPO Local Bridge v4.0
 * Запуск: node local-bridge.cjs
 * Порт:   3001 (или BRIDGE_PORT=xxxx node local-bridge.cjs)
 *
 * Новое в v4.0: управление браузером через Playwright
 * Установка: npm install playwright && npx playwright install chromium
 */

const express  = require('express');
const { exec } = require('child_process');
const cors     = require('cors');
const os       = require('os');
const fs       = require('fs');
const path     = require('path');

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
// PLAYWRIGHT — управление браузером
// Установка: npm install playwright
//            npx playwright install chromium
// ─────────────────────────────────────────────

let playwright = null;
let browser    = null;
let page       = null;

// Ленивая загрузка Playwright — только если установлен
async function getPlaywright() {
  if (!playwright) {
    try {
      playwright = require('playwright');
    } catch {
      return null;
    }
  }
  return playwright;
}

// Получить активную страницу, открыв браузер если нужно
async function getPage() {
  const pw = await getPlaywright();
  if (!pw) throw new Error('Playwright не установлен. Запусти: npm install playwright && npx playwright install chromium');
  if (!browser || !browser.isConnected()) {
    browser = await pw.chromium.launch({ headless: false });
    page    = await browser.newPage();
  }
  if (!page || page.isClosed()) {
    page = await browser.newPage();
  }
  return page;
}

// Закрыть браузер
async function closeBrowser() {
  try { await browser?.close(); } catch {}
  browser = null;
  page    = null;
}

// ── POST /browser/open — открыть URL ──────────
app.post('/browser/open', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url обязателен' });
  try {
    const p = await getPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await p.title();
    res.json({ status: 'success', url: p.url(), title });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /browser/click — кликнуть по селектору или координатам ──
app.post('/browser/click', async (req, res) => {
  const { selector, x, y, text } = req.body;
  try {
    const p = await getPage();
    if (text) {
      // Клик по тексту на странице
      await p.getByText(text, { exact: false }).first().click({ timeout: 5000 });
    } else if (selector) {
      await p.click(selector, { timeout: 5000 });
    } else if (x !== undefined && y !== undefined) {
      await p.mouse.click(x, y);
    } else {
      return res.status(400).json({ error: 'Укажи selector, text или x/y' });
    }
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /browser/type — ввести текст в поле ──
app.post('/browser/type', async (req, res) => {
  const { selector, text, press } = req.body;
  try {
    const p = await getPage();
    if (selector && text !== undefined) {
      await p.fill(selector, text, { timeout: 5000 });
    }
    if (press) {
      await p.keyboard.press(press);
    }
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /browser/read — прочитать текст страницы ──
app.get('/browser/read', async (req, res) => {
  const { selector } = req.query;
  try {
    const p = await getPage();
    let content;
    if (selector) {
      content = await p.locator(selector).innerText({ timeout: 5000 });
    } else {
      // Весь видимый текст страницы (до 5000 символов)
      content = await p.evaluate(() => {
        const el = document.body;
        if (!el) return '';
        return el.innerText.replace(/\s+/g, ' ').trim().slice(0, 5000);
      });
    }
    const title = await p.title();
    const url   = p.url();
    res.json({ status: 'success', url, title, content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /browser/screenshot — скриншот текущей страницы ──
app.get('/browser/screenshot', async (req, res) => {
  try {
    const p    = await getPage();
    const buf  = await p.screenshot({ type: 'png', fullPage: false });
    res.json({ status: 'success', screenshot: buf.toString('base64') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /browser/scroll — прокрутить страницу ──
app.post('/browser/scroll', async (req, res) => {
  const { direction = 'down', amount = 500 } = req.body;
  try {
    const p = await getPage();
    const dy = direction === 'up' ? -amount : amount;
    await p.mouse.wheel(0, dy);
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /browser/eval — выполнить JS на странице ──
app.post('/browser/eval', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code обязателен' });
  try {
    const p      = await getPage();
    const result = await p.evaluate(code);
    res.json({ status: 'success', result: String(result ?? '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /browser/tabs — список открытых вкладок ──
app.get('/browser/tabs', async (req, res) => {
  const pw = await getPlaywright();
  if (!pw || !browser) return res.json({ tabs: [] });
  try {
    const pages = browser.contexts().flatMap(c => c.pages());
    const tabs  = await Promise.all(pages.map(async (p, i) => ({
      index: i, url: p.url(), title: await p.title().catch(() => ''),
    })));
    res.json({ tabs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /browser/tab — переключиться на вкладку ──
app.post('/browser/tab', async (req, res) => {
  const { index } = req.body;
  try {
    const pages = browser.contexts().flatMap(c => c.pages());
    if (index === undefined || !pages[index]) {
      return res.status(400).json({ error: `Вкладка ${index} не найдена` });
    }
    page = pages[index];
    await page.bringToFront();
    res.json({ status: 'success', url: page.url(), title: await page.title() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /browser/back, /browser/forward ──────
app.post('/browser/back',    async (req, res) => {
  try { const p = await getPage(); await p.goBack();    res.json({ status: 'success', url: p.url() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/browser/forward', async (req, res) => {
  try { const p = await getPage(); await p.goForward(); res.json({ status: 'success', url: p.url() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /browser/close — закрыть браузер ─────
app.post('/browser/close', async (req, res) => {
  await closeBrowser();
  res.json({ status: 'success' });
});

// ── GET /browser/status — состояние браузера ──
app.get('/browser/status', async (req, res) => {
  const pw = await getPlaywright();
  if (!pw) return res.json({ available: false, reason: 'playwright не установлен' });
  const open = browser?.isConnected() ?? false;
  res.json({
    available: true,
    open,
    url:   open && page && !page.isClosed() ? page.url()   : null,
    title: open && page && !page.isClosed() ? await page.title().catch(() => null) : null,
  });
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║        MIPO LOCAL BRIDGE v4.0 ONLINE         ║
╠══════════════════════════════════════════════╣
║  Port:     ${String(PORT).padEnd(32)}║
║  Platform: ${process.platform.padEnd(32)}║
║  Host:     ${os.hostname().slice(0, 32).padEnd(32)}║
╠══════════════════════════════════════════════╣
║  GET  /health           — статус             ║
║  GET  /stats            — CPU, RAM, uptime   ║
║  GET  /processes        — процессы           ║
║  GET  /screenshot       — скриншот экрана    ║
║  GET  /ls?dir=          — файлы в папке      ║
║  GET  /read?file=       — читать файл        ║
║  POST /write            — записать файл      ║
║  POST /delete           — удалить файл       ║
║  POST /rename           — переименовать      ║
║  POST /mkdir            — создать папку      ║
║  POST /scan             — антивирус          ║
║  POST /shell            — команда            ║
║  POST /open             — открыть файл/URL   ║
║  POST /type             — ввод текста        ║
║  POST /notify           — уведомление        ║
╠══════════════════════════════════════════════╣
║  БРАУЗЕР (Playwright):                       ║
║  GET  /browser/status   — состояние          ║
║  POST /browser/open     — открыть URL        ║
║  POST /browser/click    — клик               ║
║  POST /browser/type     — ввод текста        ║
║  GET  /browser/read     — текст страницы     ║
║  GET  /browser/screenshot — снимок           ║
║  POST /browser/scroll   — прокрутка          ║
║  POST /browser/eval     — выполнить JS       ║
║  GET  /browser/tabs     — список вкладок     ║
║  POST /browser/tab      — сменить вкладку    ║
║  POST /browser/back     — назад              ║
║  POST /browser/forward  — вперёд             ║
║  POST /browser/close    — закрыть браузер    ║
╚══════════════════════════════════════════════╝
  `);
});
