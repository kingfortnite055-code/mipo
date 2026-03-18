const express = require('express');
const { exec } = require('child_process');
const cors = require('cors');
const os = require('os');
const app = express();

app.use(cors());
app.use(express.json());

// Helper to calculate CPU usage
let previousCpus = os.cpus();
function getCpuUsage() {
  const currentCpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

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

// Endpoint to get system stats
app.get('/stats', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsage = Math.floor((usedMem / totalMem) * 100);
  const cpuUsage = getCpuUsage();

  res.json({
    cpu: cpuUsage,
    ram: memUsage,
    totalMem: (totalMem / 1024 / 1024 / 1024).toFixed(1), // GB
    uptime: Math.floor(os.uptime() / 60) // minutes
  });
});

// Endpoint to scan processes (Simulated "Virus Scan" source)
app.get('/processes', (req, res) => {
  const command = process.platform === 'win32' ? 'tasklist' : 'ps -ax -o comm';
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ status: 'error', message: error.message });
    }
    // Parse output to get just names for analysis
    const lines = stdout.split('\n').slice(process.platform === 'win32' ? 3 : 1);
    const processes = lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return parts[0];
    }).filter(p => p).slice(0, 50); // Limit to 50 for performance

    res.json({ processes });
  });
});

// Endpoint to open applications/files
app.post('/open', (req, res) => {
  const { path, type } = req.body;
  console.log(`Request to open ${type}: ${path}`);
  
  let command = '';
  const platform = process.platform;

  if (type === 'url') {
    command = platform === 'win32' ? `start "${path}"` : platform === 'darwin' ? `open "${path}"` : `xdg-open "${path}"`;
  } else {
    // For apps and files
    command = platform === 'win32' ? `start "" "${path}"` : platform === 'darwin' ? `open "${path}"` : `xdg-open "${path}"`;
  }

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.json({ status: 'success', output: stdout });
  });
});

// Endpoint to execute shell commands
app.post('/shell', (req, res) => {
  const { command } = req.body;
  console.log(`Shell command: ${command}`);
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ status: 'error', output: stderr || error.message });
    }
    res.json({ status: 'success', output: stdout });
  });
});

// Endpoint to simulate keyboard input (typing)
app.post('/type', (req, res) => {
  const { text } = req.body;
  console.log(`Request to type: ${text}`);
  
  let command = '';
  const platform = process.platform;

  // Escape double quotes for shell commands
  const safeText = text.replace(/"/g, '\\"');

  if (platform === 'win32') {
    // PowerShell SendKeys
    command = `powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${safeText}')"`;
  } else if (platform === 'darwin') {
    // AppleScript
    command = `osascript -e 'tell application "System Events" to keystroke "${safeText}"'`;
  } else {
    // Linux (xdotool) - assumes xdotool is installed
    command = `xdotool type "${safeText}"`;
  }

  exec(command, (error, stdout, stderr) => {
    if (error) {
      // On Windows, SendKeys might fail with some characters, but it's a basic implementation
      console.error(`Error typing: ${error.message}`);
      return res.status(500).json({ status: 'error', message: error.message });
    }
    res.json({ status: 'success' });
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════╗
  ║             J.A.R.V.I.S. LOCAL BRIDGE ONLINE               ║
  ╠════════════════════════════════════════════════════════════╣
  ║  Status:  Active                                           ║
  ║  Port:    ${PORT}                                             ║
  ║  Mode:    Remote Control & Monitoring Enabled              ║
  ╚════════════════════════════════════════════════════════════╝
  `);
});
