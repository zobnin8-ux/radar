const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const launcherDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const PROJECT_ROOT = path.resolve(launcherDir, "..");
const PORT = readPort();
const URL = `http://localhost:${PORT}/api/health`;

function readPort() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return 3847;
  const raw = fs.readFileSync(envPath, "utf8");
  const match = raw.match(/^DASHBOARD_PORT=(\d+)/m);
  return match ? Number(match[1]) : 3847;
}

function showError(message) {
  try {
    execSync(
      `powershell -NoProfile -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show('${message.replace(/'/g, "''")}','Radar Future','OK','Error')"`,
      { stdio: "ignore", windowsHide: true }
    );
  } catch {
    // ignore
  }
}

function isListening() {
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(timeoutMs = 90000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await isListening()) {
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 600);
    };
    tick();
  });
}

function launchSilent() {
  const ps1 = path.join(PROJECT_ROOT, "launch-radar.ps1");
  if (!fs.existsSync(ps1)) {
    showError("launch-radar.ps1 not found in project root.");
    process.exit(1);
  }

  spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1, "-Silent"],
    {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }
  ).unref();
}

async function main() {
  if (!(await isListening())) {
    launchSilent();
    const ready = await waitForServer();
    if (!ready) {
      showError(
        "Bot did not start within 90 s.\\nCheck data\\\\launch.log and data\\\\server.log"
      );
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch(() => {
  showError("Failed to start Radar Future.");
  process.exit(1);
});
