const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');
const { getBackendEnv, resolveRuntimeBasePath } = require('./electron-env');

const iconPath = (() => {
  if (process.platform === 'win32') {
    return path.join(__dirname, 'assets', 'app-icon.ico');
  }
  if (process.platform === 'darwin') {
    return path.join(__dirname, 'assets', 'app-icon.icns');
  }
  return path.join(__dirname, 'assets', 'app-icon.png');
})();

let mainWindow;
let backendProcess;

// Backend 서버 시작 (별도 프로세스로 실행)
function startBackend() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting backend server...');

    const isDev = !app.isPackaged;
    const runtimeBasePath = resolveRuntimeBasePath();
    console.log('📂 Runtime data path:', runtimeBasePath);

    const frontendDistPath = app.isPackaged
      ? path.join(process.resourcesPath, 'frontend', 'dist')
      : path.join(__dirname, '..', 'frontend', 'dist');

    const backendEnv = getBackendEnv(
      {
        PORT: '1566',
        NODE_ENV: isDev ? 'development' : 'production',
        FRONTEND_DIST_PATH: frontendDistPath
      },
      runtimeBasePath
    );

    process.env.BACKEND_ORIGIN = backendEnv.BACKEND_ORIGIN;
    process.env.PUBLIC_BASE_URL = backendEnv.PUBLIC_BASE_URL;
    process.env.RUNTIME_BASE_PATH = backendEnv.RUNTIME_BASE_PATH;
    process.env.API_BASE_URL = backendEnv.BACKEND_ORIGIN;


    if (isDev) {
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const args = ['run', 'dev:backend'];
      const cwd = path.join(__dirname, '..');

      console.log(`📍 Executing: ${command} ${args.join(' ')}`);
      console.log(`📂 Working directory: ${cwd}`);

      backendProcess = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: backendEnv
      });
    } else {
      const backendPath = path.join(process.resourcesPath, 'backend');
      const entryPoint = path.join(backendPath, 'dist', 'index.js');

      console.log('🧠 Backend entry point:', entryPoint);
      console.log('📂 Backend working directory:', backendPath);

      backendProcess = fork(entryPoint, {
        cwd: backendPath,
        env: backendEnv,
        silent: true
      });
    }

    const attachStream = (stream, logger) => {
      if (!stream) {
        return;
      }

      stream.on('data', (data) => {
        const text = data.toString().trim();
        if (text.length > 0) {
          logger(text);
        }
      });
    };

    attachStream(backendProcess.stdout, (msg) => console.log(`[Backend] ${msg}`));
    attachStream(backendProcess.stderr, (msg) => console.error(`[Backend Error] ${msg}`));

    backendProcess.on('error', (error) => {
      console.error('❌ Failed to start backend:', error);
      reject(error);
    });

    backendProcess.on('exit', (code, signal) => {
      console.log(`⚠️ Backend process exited with code ${code}, signal ${signal}`);
      if (code !== 0 && code !== null) {
        console.error(`Backend crashed with code ${code}`);
      }
    });

    setTimeout(() => {
      console.log('✅ Backend server should be running now');
      resolve();
    }, 5000);
  });
}

// Electron 창 생성
function createWindow() {
  console.log('🪟 Creating main window...');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // 준비될 때까지 숨김
    icon: iconPath,
    title: 'ComfyUI Image Manager',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // 창이 준비되면 표시
  mainWindow.once('ready-to-show', () => {
    console.log('✅ Window ready to show');
    mainWindow.show();
  });

  if (isDev) {
    // 개발 모드: localhost 로드 (재시도 로직)
    console.log('📱 Loading frontend from http://localhost:5173');

    const loadWithRetry = (retries = 10) => {
      mainWindow.loadURL('http://localhost:5173').catch((err) => {
        console.log(`⏳ Waiting for frontend... (${retries} retries left)`);
        if (retries > 0) {
          setTimeout(() => loadWithRetry(retries - 1), 2000);
        } else {
          console.error('❌ Failed to load frontend after multiple retries');
        }
      });
    };

    loadWithRetry();
  } else {
    // 프로덕션: app.asar 내부의 빌드된 파일 로드
    const frontendPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    console.log('📄 Loading frontend from:', frontendPath);
    mainWindow.loadFile(frontendPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 앱 시작
app.whenReady().then(async () => {
  console.log('🎬 Electron app ready');
  console.log('📦 Is packaged:', app.isPackaged);
  console.log('📍 App path:', app.getAppPath());

  // Single instance lock
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    console.log('⚠️ Another instance is already running');
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  try {
    // Backend 시작
    await startBackend();

    // 창 생성
    createWindow();
  } catch (error) {
    console.error('❌ Failed to initialize app:', error);
    // 에러가 있어도 창은 표시 (디버깅 가능하도록)
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 앱 종료
app.on('window-all-closed', () => {
  console.log('🚪 All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  console.log('👋 App quitting...');
  if (backendProcess) {
    console.log('🛑 Killing backend process');
    backendProcess.kill();
  }
});






