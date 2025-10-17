# Deployment Guide

Complete deployment guide for ComfyUI Image Manager covering standard, portable, and production deployments.

[한국어](#한국어) | [English](#english)

---

## 한국어

### 📋 시스템 요구사항

**최소 사양:**
- OS: Windows 10+, Linux (Ubuntu 20.04+), macOS 11+
- RAM: 2GB
- 디스크: 10GB+ (이미지 저장 공간 별도)
- 네트워크: 포트 1566 사용 가능

**권장 사양:**
- RAM: 4GB+
- 디스크: SSD 권장
- 네트워크: 1Gbps LAN

### 🚀 배포 방법

#### 1. Portable 배포 (권장)

**특징:**
- ✅ Node.js 설치 불필요
- ✅ 압축 해제 후 즉시 실행
- ✅ 모든 플랫폼 지원
- ✅ 자동 의존성 다운로드

**다운로드 옵션:**

**Lite 버전** (~10-20MB, 권장):
- 첫 실행 시 인터넷 필요
- 의존성 자동 다운로드 (~50MB, 1-2분)
- 대부분의 사용자에게 적합

**Full 버전** (~150-200MB):
- 모든 의존성 포함
- 오프라인 즉시 실행 가능
- 오프라인 환경, 서버 배포용

**실행 방법:**
```bash
# Windows
start.bat

# Linux/Mac
chmod +x start.sh
./start.sh
```

**첫 실행 (Lite 버전):**
```
========================================================================
            ComfyUI Image Manager
========================================================================

Missing dependencies detected:
  - sharp
  - sqlite3

Installing missing dependencies...
This may take a few minutes on first run.

[npm 다운로드 진행]

✓ Dependencies installed successfully!
Starting server...
```

**이후 실행:**
```
✓ All dependencies are installed and ready!
Starting server...
```

#### 2. 소스 빌드

```bash
git clone <repository>
cd comfyui-image-manager
npm run install:all
npm run build:full
```

**Portable 패키지 생성:**
```bash
npm run build:integrated    # Backend + Frontend 빌드
npm run build:bundle        # 단일 JS 파일 생성
npm run build:portable      # Portable 패키지 생성
```

**결과물:**
```
portable-output/
├── node.exe (or node)          # Node.js 런타임
├── start.bat / start.sh        # 시작 스크립트
├── app/
│   ├── bundle.js              # 번들된 애플리케이션
│   ├── bootstrap.js           # 의존성 자동 설치기
│   ├── python/                # Python 스크립트 (WD Tagger)
│   ├── frontend/              # 프론트엔드
│   └── node_modules/          # [첫 실행 시 생성]
├── database/                   # [첫 실행 시 생성]
├── uploads/                    # [첫 실행 시 생성]
└── models/                     # [첫 실행 시 생성]
```

### 🌐 원격 접속 설정

#### 로컬 네트워크 (같은 Wi-Fi)

기본 설정으로 바로 사용 가능!

```
서버 시작 시:
🏠 Local:    http://localhost:1566
🌐 Network:  http://192.168.1.100:1566  ← 다른 기기에서 사용
```

#### 외부 인터넷 접속 (집 밖에서)

**1. 공유기 포트 포워딩**

공유기 관리 페이지 접속 (보통 http://192.168.0.1 또는 http://192.168.1.1):

```
서비스 포트: 1566
내부 IP: 192.168.1.100 (서버 PC IP)
프로토콜: TCP
```

**2. 외부 IP 확인**

Windows:
```powershell
Invoke-WebRequest -Uri "https://api.ipify.org"
```

Linux/Mac:
```bash
curl https://api.ipify.org
```

또는 https://whatismyipaddress.com 방문

**3. 환경변수 설정**

`.env` 파일:
```env
PUBLIC_BASE_URL=http://YOUR_EXTERNAL_IP:1566
BACKEND_HOST=YOUR_EXTERNAL_IP
ENABLE_EXTERNAL_IP=true
```

**4. DDNS 사용 (권장)**

외부 IP가 자주 변경되는 경우:

1. 무료 DDNS 서비스 가입
   - No-IP: https://www.noip.com
   - DuckDNS: https://www.duckdns.org
   - Dynu: https://www.dynu.com

2. 도메인 생성 (예: `my-images.ddns.net`)

3. 공유기 DDNS 설정 또는 DDNS 클라이언트 설치

4. 환경변수 업데이트:
   ```env
   PUBLIC_BASE_URL=http://my-images.ddns.net:1566
   BACKEND_HOST=my-images.ddns.net
   ```

### 🔒 보안 설정

#### HTTPS 설정

**자체 서명 인증서 (개발/테스트):**
```env
BACKEND_PROTOCOL=https
```

단점: 브라우저 보안 경고 표시

**Let's Encrypt (프로덕션, 권장):**

Caddy 사용 (자동 HTTPS):
```bash
# Caddy 설치
# Windows: https://caddyserver.com/download
# Linux: sudo apt install caddy

# Caddyfile
my-images.ddns.net {
  reverse_proxy localhost:1566
}

# 실행
caddy run
```

#### 방화벽 설정

**Windows:**
```powershell
netsh advfirewall firewall add rule name="ComfyUI Image Manager" dir=in action=allow protocol=TCP localport=1566
```

**Linux (UFW):**
```bash
sudo ufw allow 1566/tcp
sudo ufw enable
```

#### 보안 권장사항

⚠️ 현재 버전은 인증 기능이 없습니다. 외부 노출 시:

1. 강력한 방화벽 규칙 사용
2. VPN 사용
3. Nginx 리버스 프록시 + Basic Auth

### 📦 데이터 관리

#### 데이터 저장 위치

실행 파일과 같은 폴더에 자동 생성:
```
portable-output/
├── uploads/          # 원본 이미지
├── database/         # SQLite 데이터베이스
├── logs/             # 로그 파일
└── .env              # 설정 파일
```

#### 커스텀 데이터 경로

`.env` 파일:
```env
RUNTIME_BASE_PATH=D:\MyImages
```

#### 백업

**Windows 백업 스크립트:**
```batch
@echo off
set BACKUP_DIR=D:\Backups\ComfyUI_%date:~0,4%%date:~5,2%%date:~8,2%
mkdir "%BACKUP_DIR%"
xcopy /E /I uploads "%BACKUP_DIR%\uploads"
xcopy /E /I database "%BACKUP_DIR%\database"
echo Backup completed: %BACKUP_DIR%
```

**Linux/Mac 백업 스크립트:**
```bash
#!/bin/bash
BACKUP_DIR="$HOME/backups/comfyui-$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
cp -r uploads "$BACKUP_DIR/"
cp -r database "$BACKUP_DIR/"
echo "Backup completed: $BACKUP_DIR"
```

**복원:**
1. 서버 중지
2. `uploads/` 및 `database/` 폴더를 백업에서 복사
3. 서버 재시작

### 🚀 자동 시작 설정

#### Windows (작업 스케줄러)

1. **작업 스케줄러 열기** (taskschd.msc)
2. **작업 만들기**
   - 이름: ComfyUI Image Manager
   - 트리거: 시스템 시작 시
   - 작업: `C:\path\to\start.bat`
   - 시작 위치: `C:\path\to\portable-output`

#### Linux (systemd)

`/etc/systemd/system/comfyui-image-manager.service`:
```ini
[Unit]
Description=ComfyUI Image Manager
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/portable-output
ExecStart=/path/to/portable-output/start.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

활성화:
```bash
sudo systemctl enable comfyui-image-manager
sudo systemctl start comfyui-image-manager
sudo systemctl status comfyui-image-manager
```

#### macOS (launchd)

`~/Library/LaunchAgents/com.comfyui.imagemanager.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.comfyui.imagemanager</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/start.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/portable-output</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

활성화:
```bash
launchctl load ~/Library/LaunchAgents/com.comfyui.imagemanager.plist
```

### 🔧 문제 해결

#### 포트가 이미 사용 중

`.env` 파일에서 포트 변경:
```env
PORT=3000
```

또는 프로세스 종료:
```bash
# Windows
netstat -ano | findstr :1566
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:1566 | xargs kill
```

#### 외부에서 접속 안 됨

체크리스트:
- [ ] 포트 포워딩 설정 완료
- [ ] 방화벽에서 포트 허용
- [ ] 공유기 재시작
- [ ] 외부 IP 정확한지 확인
- [ ] ISP가 포트를 차단하지 않는지 확인

테스트: https://www.yougetsignal.com/tools/open-ports/

#### Bootstrap 실패 (Lite 버전)

**"npm not found" 오류:**
- Node.js 설치 필요: https://nodejs.org/
- 또는 Full 버전 사용

**네트워크 오류:**
```bash
# npm 프록시 설정
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080
```

또는 Full 버전 사용

#### 데이터베이스 오류

```bash
# 서버 중지 후
cd database
mv images.db images.db.backup
# 서버 재시작 (자동으로 새 DB 생성)
```

복구:
```bash
sqlite3 images.db ".recover" | sqlite3 images_recovered.db
```

### 📊 모니터링

#### 로그 확인

```bash
# Linux/Mac
tail -f logs/app.log

# Windows PowerShell
Get-Content -Path "logs\app.log" -Wait
```

#### Health Check

```bash
curl http://localhost:1566/health
```

응답:
```json
{
  "status": "OK",
  "timestamp": "2025-10-10T12:00:00.000Z",
  "uptime": 3600
}
```

### 🔄 업데이트

1. **백업**
   ```bash
   cp -r uploads uploads_backup
   cp -r database database_backup
   ```

2. **실행 파일 교체**
   - 기존 실행 파일 삭제
   - 새 버전 복사

3. **서버 재시작**

**중요:** `uploads/`, `database/`, `.env` 파일은 그대로 유지!

---

## English

### 📋 System Requirements

**Minimum:**
- OS: Windows 10+, Linux (Ubuntu 20.04+), macOS 11+
- RAM: 2GB
- Disk: 10GB+ (excluding image storage)
- Network: Port 1566 available

**Recommended:**
- RAM: 4GB+
- Disk: SSD recommended
- Network: 1Gbps LAN

### 🚀 Deployment Methods

#### 1. Portable Deployment (Recommended)

**Features:**
- ✅ No Node.js installation required
- ✅ Extract and run immediately
- ✅ Cross-platform support
- ✅ Automatic dependency download

**Download Options:**

**Lite Version** (~10-20MB, recommended):
- Requires internet on first run
- Auto-downloads dependencies (~50MB, 1-2 min)
- Best for most users

**Full Version** (~150-200MB):
- All dependencies included
- Works offline immediately
- Best for offline environments, server deployments

**Running:**
```bash
# Windows
start.bat

# Linux/Mac
chmod +x start.sh
./start.sh
```

**First Run (Lite):**
```
========================================================================
            ComfyUI Image Manager
========================================================================

Missing dependencies detected:
  - sharp
  - sqlite3

Installing missing dependencies...
This may take a few minutes on first run.

[npm download progress]

✓ Dependencies installed successfully!
Starting server...
```

**Subsequent Runs:**
```
✓ All dependencies are installed and ready!
Starting server...
```

#### 2. Source Build

```bash
git clone <repository>
cd comfyui-image-manager
npm run install:all
npm run build:full
```

**Create Portable Package:**
```bash
npm run build:integrated    # Build backend + frontend
npm run build:bundle        # Create single JS bundle
npm run build:portable      # Create portable package
```

**Output:**
```
portable-output/
├── node.exe (or node)          # Node.js runtime
├── start.bat / start.sh        # Startup script
├── app/
│   ├── bundle.js              # Bundled application
│   ├── bootstrap.js           # Dependency installer
│   ├── python/                # Python scripts (WD Tagger)
│   ├── frontend/              # Frontend assets
│   └── node_modules/          # [Created on first run]
├── database/                   # [Created on first run]
├── uploads/                    # [Created on first run]
└── models/                     # [Created on first run]
```

### 🌐 Remote Access Setup

#### Local Network (Same Wi-Fi)

Works out of the box!

```
Server startup:
🏠 Local:    http://localhost:1566
🌐 Network:  http://192.168.1.100:1566  ← Use on other devices
```

#### External Internet Access

**1. Router Port Forwarding**

Access router admin page (usually http://192.168.0.1 or http://192.168.1.1):

```
Service Port: 1566
Internal IP: 192.168.1.100 (server PC IP)
Protocol: TCP
```

**2. Get External IP**

Windows:
```powershell
Invoke-WebRequest -Uri "https://api.ipify.org"
```

Linux/Mac:
```bash
curl https://api.ipify.org
```

Or visit https://whatismyipaddress.com

**3. Configure Environment**

`.env` file:
```env
PUBLIC_BASE_URL=http://YOUR_EXTERNAL_IP:1566
BACKEND_HOST=YOUR_EXTERNAL_IP
ENABLE_EXTERNAL_IP=true
```

**4. Use DDNS (Recommended)**

For dynamic IPs:

1. Register free DDNS service
   - No-IP: https://www.noip.com
   - DuckDNS: https://www.duckdns.org
   - Dynu: https://www.dynu.com

2. Create domain (e.g., `my-images.ddns.net`)

3. Configure router DDNS or install DDNS client

4. Update environment:
   ```env
   PUBLIC_BASE_URL=http://my-images.ddns.net:1566
   BACKEND_HOST=my-images.ddns.net
   ```

### 🔒 Security Setup

#### HTTPS Configuration

**Self-signed Certificate (dev/test):**
```env
BACKEND_PROTOCOL=https
```

Downside: Browser security warnings

**Let's Encrypt (production, recommended):**

Using Caddy (automatic HTTPS):
```bash
# Install Caddy
# Windows: https://caddyserver.com/download
# Linux: sudo apt install caddy

# Caddyfile
my-images.ddns.net {
  reverse_proxy localhost:1566
}

# Run
caddy run
```

#### Firewall Configuration

**Windows:**
```powershell
netsh advfirewall firewall add rule name="ComfyUI Image Manager" dir=in action=allow protocol=TCP localport=1566
```

**Linux (UFW):**
```bash
sudo ufw allow 1566/tcp
sudo ufw enable
```

#### Security Recommendations

⚠️ Current version has no authentication. For external access:

1. Use strong firewall rules
2. Use VPN
3. Use Nginx reverse proxy + Basic Auth

### 📦 Data Management

#### Data Storage Location

Auto-created in same folder as executable:
```
portable-output/
├── uploads/          # Original images
├── database/         # SQLite database
├── logs/             # Log files
└── .env              # Configuration
```

#### Custom Data Path

`.env` file:
```env
RUNTIME_BASE_PATH=D:\MyImages
```

#### Backup

**Windows Backup Script:**
```batch
@echo off
set BACKUP_DIR=D:\Backups\ComfyUI_%date:~0,4%%date:~5,2%%date:~8,2%
mkdir "%BACKUP_DIR%"
xcopy /E /I uploads "%BACKUP_DIR%\uploads"
xcopy /E /I database "%BACKUP_DIR%\database"
echo Backup completed: %BACKUP_DIR%
```

**Linux/Mac Backup Script:**
```bash
#!/bin/bash
BACKUP_DIR="$HOME/backups/comfyui-$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
cp -r uploads "$BACKUP_DIR/"
cp -r database "$BACKUP_DIR/"
echo "Backup completed: $BACKUP_DIR"
```

**Restore:**
1. Stop server
2. Copy `uploads/` and `database/` from backup
3. Restart server

### 🚀 Auto-Start Configuration

#### Windows (Task Scheduler)

1. **Open Task Scheduler** (taskschd.msc)
2. **Create Task**
   - Name: ComfyUI Image Manager
   - Trigger: At system startup
   - Action: `C:\path\to\start.bat`
   - Start in: `C:\path\to\portable-output`

#### Linux (systemd)

`/etc/systemd/system/comfyui-image-manager.service`:
```ini
[Unit]
Description=ComfyUI Image Manager
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/portable-output
ExecStart=/path/to/portable-output/start.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl enable comfyui-image-manager
sudo systemctl start comfyui-image-manager
sudo systemctl status comfyui-image-manager
```

#### macOS (launchd)

`~/Library/LaunchAgents/com.comfyui.imagemanager.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.comfyui.imagemanager</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/start.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/portable-output</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Enable:
```bash
launchctl load ~/Library/LaunchAgents/com.comfyui.imagemanager.plist
```

### 🔧 Troubleshooting

#### Port Already in Use

Change port in `.env`:
```env
PORT=3000
```

Or kill process:
```bash
# Windows
netstat -ano | findstr :1566
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:1566 | xargs kill
```

#### External Access Not Working

Checklist:
- [ ] Port forwarding configured
- [ ] Firewall port allowed
- [ ] Router restarted
- [ ] External IP correct
- [ ] ISP not blocking port

Test: https://www.yougetsignal.com/tools/open-ports/

#### Bootstrap Fails (Lite Version)

**"npm not found" error:**
- Install Node.js: https://nodejs.org/
- Or use Full version

**Network error:**
```bash
# Configure npm proxy
npm config set proxy http://proxy.company.com:8080
npm config set https-proxy http://proxy.company.com:8080
```

Or use Full version

#### Database Error

```bash
# Stop server
cd database
mv images.db images.db.backup
# Restart server (creates new DB)
```

Recover:
```bash
sqlite3 images.db ".recover" | sqlite3 images_recovered.db
```

### 📊 Monitoring

#### View Logs

```bash
# Linux/Mac
tail -f logs/app.log

# Windows PowerShell
Get-Content -Path "logs\app.log" -Wait
```

#### Health Check

```bash
curl http://localhost:1566/health
```

Response:
```json
{
  "status": "OK",
  "timestamp": "2025-10-10T12:00:00.000Z",
  "uptime": 3600
}
```

### 🔄 Updates

1. **Backup**
   ```bash
   cp -r uploads uploads_backup
   cp -r database database_backup
   ```

2. **Replace Executable**
   - Delete old executable
   - Copy new version

3. **Restart Server**

**Important:** Keep `uploads/`, `database/`, `.env` files!

---

## 📚 Related Documentation

- [Features Guide](features.md) - WD Tagger, video features
- [API Documentation](../development/api.md) - REST API reference
- [Architecture](../development/architecture.md) - System design
- [Setup Guide](../../SETUP.md) - Initial setup
