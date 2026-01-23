const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { ensureDatabase } = require('./db');
const { registerIpcHandlers } = require('./ipc');
const { initLogger } = require('./logger');
const { JobRunner } = require('./jobRunner');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let jobRunner;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const db = ensureDatabase(app.getPath('userData'));
  const logger = initLogger(app.getPath('userData'));
  jobRunner = new JobRunner(db, logger);
  registerIpcHandlers(ipcMain, db, jobRunner, logger);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
