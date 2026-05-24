import { app, BrowserWindow, ipcMain, screen, safeStorage, session, dialog } from "electron";
import * as path from "path";
import { pathToFileURL } from "url";
import { autoUpdater } from "electron-updater";
import Store from "electron-store";
import { createTray, setTrayStatus } from "./tray";
import { setupMediaIPC } from "./ipc/media.ipc";
import { setupPTTIPC } from "./ipc/ptt.ipc";

const store = new Store();

let mainWindow: BrowserWindow | null = null;
let ringtoneWindow: BrowserWindow | null = null;
let forceQuit = false;

// Apply command line switches for background performance and WebRTC quality
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("webrtc-max-cpu-consumption-percentage", "100");
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");
app.commandLine.appendSwitch("force-fieldtrials", "WebRTC-VP9-Dependency-Descriptor/Enabled/");

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

function createRingtoneWindow() {
  ringtoneWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // Load a minimal HTML that exposes play/stop for ringtone using web audio
  const ringtoneHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>Ringtone</title></head>
    <body>
      <audio id="ringtone" src="./assets/ringtone.ogg" loop></audio>
      <script>
        const audio = document.getElementById('ringtone');
        window.play = () => audio.play().catch(e => console.error(e));
        window.stop = () => { audio.pause(); audio.currentTime = 0; };
      </script>
    </body>
    </html>
  `;
  ringtoneWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ringtoneHtml)}`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // Critical to keep WebSockets & timers alive
      webSecurity: false, // Bypasses CORS check in desktop shell
    },
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (e) => {
    if (!forceQuit) {
      e.preventDefault();
      mainWindow?.hide();
      setTrayStatus("Running in background");
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Window Controls IPC
  ipcMain.on("window-minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.on("window-maximize-toggle", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow?.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on("window-close", () => {
    mainWindow?.close(); // Triggers the 'close' event (hide to tray)
  });

  // Ringtone control IPC from renderer to RingtoneWindow
  ipcMain.on("play-ringtone", () => {
    ringtoneWindow?.webContents.executeJavaScript("window.play()");
  });

  ipcMain.on("stop-ringtone", () => {
    ringtoneWindow?.webContents.executeJavaScript("window.stop()");
  });

  // Setup other IPC modules
  setupMediaIPC(mainWindow);
  setupPTTIPC(mainWindow);

  // Secure session storage handlers
  ipcMain.handle("get-secure-session", () => {
    const encryptedHex = store.get("session") as string;
    if (!encryptedHex) return null;

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("Encryption is not available, returning plaintext");
      return encryptedHex;
    }

    try {
      const encryptedBuffer = Buffer.from(encryptedHex, "hex");
      return safeStorage.decryptString(encryptedBuffer);
    } catch (e) {
      console.error("Failed to decrypt session:", e);
      return null;
    }
  });

  ipcMain.on("set-secure-session", (event, value: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      store.set("session", value);
      return;
    }

    try {
      const encryptedBuffer = safeStorage.encryptString(value);
      store.set("session", encryptedBuffer.toString("hex"));
    } catch (e) {
      console.error("Failed to encrypt session:", e);
    }
  });

  ipcMain.on("remove-secure-session", () => {
    store.delete("session");
  });

  // Initialize tray
  createTray(mainWindow, () => {
    forceQuit = true;
    app.quit();
  });
}

function setupAutoUpdater() {
  if (isDev) {
    console.log("[AutoUpdater] Disabled in development mode");
    return;
  }

  autoUpdater.autoDownload = false;

  autoUpdater.on("update-available", (info) => {
    dialog.showMessageBox({
      type: "info",
      title: "Update Available",
      message: `A new version (${info.version}) of Callu is available. Would you like to download it now?`,
      buttons: ["Yes", "Later"],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox({
      type: "info",
      title: "Update Ready",
      message: "The update has been downloaded. Restart Callu to apply the update now?",
      buttons: ["Restart", "Later"],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("Error in auto-updater: ", err);
  });

  // Check for updates immediately, then every hour
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 60 * 60 * 1000);
}

app.on("ready", () => {
  // Redirect absolute local requests (like file:///avatars/...) to files inside the dist directory
  const distPath = path.join(__dirname, "../../dist");
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["file:///*"] },
    (details, callback) => {
      const urlStr = details.url;
      const prefixes = [
        "file:///avatars/",
        "file:///music/",
        "file:///Lotties/",
        "file:///Verification-Blue-Tick-PNG.webp",
        "file:///Verification-Blue-Tick-PNG.png",
        "file:///file.svg",
        "file:///globe.svg",
        "file:///next.svg",
        "file:///vercel.svg",
        "file:///window.svg"
      ];

      for (const prefix of prefixes) {
        if (urlStr.startsWith(prefix)) {
          const relativePath = urlStr.substring(8); // remove 'file:///'
          const targetPath = path.join(distPath, relativePath);
          const redirectURL = pathToFileURL(targetPath).href;
          callback({ redirectURL });
          return;
        }
      }
      callback({});
    }
  );

  createMainWindow();
  createRingtoneWindow();
  setupAutoUpdater();

  // Setup auto launch item settings (openAtLogin)
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });
});

app.on("before-quit", () => {
  forceQuit = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});
