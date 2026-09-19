const { app, BrowserWindow, Menu, Tray } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let win;
let tray;
let updateCheckTimer;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    icon: path.join(__dirname, '../public/lord-phones-logo.png'),
    webPreferences: {
      contextIsolation: true
    }
  });

  const url =
    process.env.LORD_PHONES_POS_URL ||
    'https://lordphonesandaccessories.vercel.app';

  win.loadURL(url);

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log('Auto-update disabled in development mode.');
    return;
  }

  // Automatically download updates.
  autoUpdater.autoDownload = true;

  // Automatically install the downloaded update when the app quits.
  autoUpdater.autoInstallOnAppQuit = true;

  // Never ask the user whether to download an update.
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('LORD PHONES POS: checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(
      `LORD PHONES POS: update available ${info.version}`
    );
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log(
      `LORD PHONES POS: already running latest version ${info.version}`
    );
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(
      `LORD PHONES POS: downloading update ${Math.round(progress.percent)}%`
    );
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(
      `LORD PHONES POS: update ${info.version} downloaded. Installing automatically...`
    );

    // Give electron-updater a moment to finish its internal work,
    // then restart and install the new version automatically.
    setTimeout(() => {
      try {
        app.isQuitting = true;
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        console.error(
          'LORD PHONES POS: automatic update installation failed:',
          error
        );
      }
    }, 1500);
  });

  autoUpdater.on('error', (error) => {
    console.error(
      'LORD PHONES POS: auto-update error:',
      error
    );
  });

  // Check immediately when the packaged app starts.
  autoUpdater.checkForUpdatesAndNotify();

  // Check again every 30 minutes while the app is running.
  updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 30 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();

  tray = new Tray(
    path.join(__dirname, '../public/lord-phones-logo.png')
  );

  tray.setToolTip('LORD PHONES POS');

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open LORD PHONES POS',
        click: () => {
          win.show();
          win.focus();
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Check for Updates',
        click: () => {
          if (app.isPackaged) {
            autoUpdater.checkForUpdatesAndNotify();
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ])
  );

  tray.on('double-click', () => {
    win.show();
    win.focus();
  });

  setupAutoUpdater();
});

app.on('before-quit', () => {
  app.isQuitting = true;

  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
