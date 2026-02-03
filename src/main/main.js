const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { ensureDatabase } = require('./db');
const { registerIpcHandlers } = require('./ipc');
const { initLogger } = require('./logger');
const { JobRunner } = require('./jobRunner');
const { getLocalIps, startScannerServer } = require('./scannerServer');
const { fetchCardDetails } = require('./scraper');
const { CARD_STATUSES } = require('../shared/constants');

const isDev = !app.isPackaged;

let mainWindow;
let jobRunner;
let scannerServer;

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

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

  if (isDev) {
    mainWindow.loadURL(devUrl);
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
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const userAgent = settings.find((row) => row.key === 'user_agent')?.value || 'YGO-Card-Manager/0.1';
  const maxCandidates = Number(settings.find((row) => row.key === 'max_candidates_passcode_match')?.value || 5);
  scannerServer = startScannerServer({
    port: 8787,
    onScan: async (card, socket) => {
      if (!mainWindow) return;
      mainWindow.webContents.send('scanner:incoming', card);
      if (!card?.passcode) return;
      const fetchResult = await fetchCardDetails({
        passcode: card.passcode,
        en_name: '',
        de_name: '',
        userAgent,
        maxCandidates
      }).catch(() => null);
      if (!fetchResult || fetchResult.status !== CARD_STATUSES.OK_DETAILS || !fetchResult.cardDetails) {
        return;
      }
      const detail = fetchResult.cardDetails;
      const response = {
        type: 'scanResult',
        card: {
          passcode: detail.passcode || card.passcode || '',
          en_name: detail.name || detail.en_name || '',
          de_name: detail.de_name || ''
        }
      };
      if (socket?.readyState === 1) {
        socket.send(JSON.stringify(response));
      }
    },
    onResolve: async (card, socket) => {
      const passcode = String(card?.passcode || '').trim();
      const enName = String(card?.en_name || '').trim();
      const deName = String(card?.de_name || '').trim();
      const fetchResult = await fetchCardDetails({
        passcode,
        en_name: enName,
        de_name: deName,
        userAgent,
        maxCandidates
      }).catch(() => null);
      if (!fetchResult || fetchResult.status !== CARD_STATUSES.OK_DETAILS || !fetchResult.cardDetails) {
        if (socket?.readyState === 1) {
          socket.send(JSON.stringify({ type: 'resolveResult', ok: false }));
        }
        return;
      }
      const detail = fetchResult.cardDetails;
      const response = {
        type: 'resolveResult',
        ok: true,
        card: {
          passcode: detail.passcode || passcode || '',
          en_name: detail.name || detail.en_name || enName || '',
          de_name: detail.de_name || deName || ''
        }
      };
      if (socket?.readyState === 1) {
        socket.send(JSON.stringify(response));
      }
    },
    onSync: (socket) => {
      const cards = db.prepare(`
        SELECT id, de_name, en_name, passcode, source_url, cardcluster_url
        FROM cards
        ORDER BY id ASC
      `).all();
      const response = { type: 'sync', cards };
      if (socket?.readyState === 1) {
        socket.send(JSON.stringify(response));
      }
    }
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (scannerServer) {
      scannerServer.close();
    }
    app.quit();
  }
});
