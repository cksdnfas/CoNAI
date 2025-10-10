# ComfyUI Image Manager - Deployment Guide

언제 어디서든 나의 이미지를 접근할 수 있는 개인 이미지 관리 서비스 배포 가이드

---

## 🚀 Quick Start (5분 배포)

### Windows

1. **실행 파일 다운로드**
   - `pkg-output` 폴더를 원하는 위치에 복사

2. **실행**
   ```batch
   cd pkg-output
   comfyui-image-manager.exe
   ```

3. **접속**
   - 로컬: http://localhost:1566
   - 네트워크: 콘솔에 표시된 네트워크 URL 사용

### Linux/Mac

1. **실행 권한 부여**
   ```bash
   chmod +x comfyui-image-manager
   ```

2. **실행**
   ```bash
   ./comfyui-image-manager
   ```

---

## 📋 시스템 요구사항

### 최소 사양
- **OS**: Windows 10+, Linux (Ubuntu 20.04+), macOS 11+
- **RAM**: 2GB
- **디스크**: 10GB+ (이미지 저장 공간 별도)
- **네트워크**: 포트 1566 사용 가능

### 권장 사양
- **RAM**: 4GB+
- **디스크**: SSD 권장
- **네트워크**: 1Gbps LAN

---

## 🌐 원격 접속 설정

### 1. 로컬 네트워크 접속 (같은 Wi-Fi)

기본 설정으로 이미 가능합니다!

**서버 시작 시 표시되는 URL 확인:**
```
🏠 Local:    http://localhost:1566
🌐 Network:  http://192.168.1.100:1566  ← 이 주소 사용
```

**다른 기기에서 접속:**
- 스마트폰, 태블릿에서 네트워크 URL로 접속
- 같은 Wi-Fi에 연결되어 있어야 함

### 2. 외부 인터넷 접속 (집 밖에서도 접속)

#### 2-1. 공유기 포트 포워딩 설정

1. **공유기 관리 페이지 접속**
   - 보통 http://192.168.0.1 또는 http://192.168.1.1
   - ID/PW는 공유기 설명서 참조

2. **포트 포워딩 규칙 추가**
   ```
   서비스 포트: 1566
   내부 IP: 192.168.1.100 (서버 PC의 로컬 IP)
   프로토콜: TCP
   ```

3. **공유기 재시작** (필요시)

#### 2-2. 외부 IP 확인

**Windows:**
```powershell
Invoke-WebRequest -Uri "https://api.ipify.org"
```

**Linux/Mac:**
```bash
curl https://api.ipify.org
```

또는 https://whatismyipaddress.com 방문

#### 2-3. 환경변수 설정

`.env` 파일 생성 (실행 파일과 같은 폴더):
```env
# 외부 접속용 설정
PUBLIC_BASE_URL=http://YOUR_EXTERNAL_IP:1566
BACKEND_HOST=YOUR_EXTERNAL_IP

# 외부 IP 자동 감지 활성화 (선택사항)
ENABLE_EXTERNAL_IP=true
```

**주의:** 외부 IP가 변경될 수 있으므로 고정 IP 또는 DDNS 사용 권장

#### 2-4. DDNS 사용 (고정 도메인)

외부 IP가 자주 변경되는 경우:

1. **무료 DDNS 서비스 가입**
   - No-IP: https://www.noip.com
   - DuckDNS: https://www.duckdns.org
   - Dynu: https://www.dynu.com

2. **도메인 생성**
   - 예: `my-images.ddns.net`

3. **공유기 DDNS 설정** 또는 **DDNS 클라이언트 설치**

4. **환경변수 업데이트**
   ```env
   PUBLIC_BASE_URL=http://my-images.ddns.net:1566
   BACKEND_HOST=my-images.ddns.net
   ```

### 3. HTTPS 설정 (보안 연결)

외부 접속 시 HTTPS 사용 권장

#### 3-1. 자체 서명 인증서 (개발/테스트용)

`.env` 파일:
```env
BACKEND_PROTOCOL=https
```

서버가 자동으로 자체 서명 인증서 생성

**단점:** 브라우저에서 보안 경고 표시

#### 3-2. Let's Encrypt (프로덕션용)

**요구사항:**
- 공인 도메인 필요 (DDNS 가능)
- 80, 443 포트 사용 가능

**Caddy 사용 (권장):**
```bash
# Caddy 설치 (자동 HTTPS)
# Windows: https://caddyserver.com/download
# Linux: sudo apt install caddy

# Caddyfile 생성
cat > Caddyfile << EOF
my-images.ddns.net {
  reverse_proxy localhost:1566
}
EOF

# Caddy 실행
caddy run
```

---

## 🔒 보안 설정

### 방화벽 설정

**Windows Firewall:**
```powershell
# 포트 열기
netsh advfirewall firewall add rule name="ComfyUI Image Manager" dir=in action=allow protocol=TCP localport=1566
```

**Linux (UFW):**
```bash
sudo ufw allow 1566/tcp
sudo ufw enable
```

### 인증 추가 (향후 지원 예정)

현재는 인증이 없으므로, **외부 노출 시 주의 필요**

**임시 보안 조치:**
1. 강력한 방화벽 규칙 사용
2. VPN 사용
3. Nginx 리버스 프록시 + Basic Auth

---

## 📦 데이터 관리

### 데이터 저장 위치

실행 파일과 같은 폴더에 자동 생성:
```
pkg-output/
├── comfyui-image-manager.exe
├── uploads/          ← 원본 이미지
├── database/         ← SQLite 데이터베이스
├── logs/             ← 로그 파일
└── .env              ← 설정 파일
```

### 커스텀 데이터 경로

`.env` 파일:
```env
RUNTIME_BASE_PATH=D:\MyImages
```

모든 데이터가 `D:\MyImages` 폴더에 저장됨

### 백업

**중요 데이터:**
- `uploads/` - 모든 이미지
- `database/` - 데이터베이스

**백업 스크립트 (Windows):**
```batch
@echo off
set BACKUP_DIR=D:\Backups\ComfyUI_%date:~0,4%%date:~5,2%%date:~8,2%
mkdir "%BACKUP_DIR%"
xcopy /E /I uploads "%BACKUP_DIR%\uploads"
xcopy /E /I database "%BACKUP_DIR%\database"
echo Backup completed: %BACKUP_DIR%
```

**백업 스크립트 (Linux/Mac):**
```bash
#!/bin/bash
BACKUP_DIR="$HOME/backups/comfyui-$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
cp -r uploads "$BACKUP_DIR/"
cp -r database "$BACKUP_DIR/"
echo "Backup completed: $BACKUP_DIR"
```

### 복원

1. 서버 중지
2. `uploads/` 및 `database/` 폴더를 백업에서 복사
3. 서버 재시작

---

## 🚀 자동 시작 설정

### Windows (작업 스케줄러)

1. **작업 스케줄러 열기** (taskschd.msc)
2. **작업 만들기**
   - 이름: ComfyUI Image Manager
   - 트리거: 시스템 시작 시
   - 작업: `C:\path\to\comfyui-image-manager.exe`
   - 시작 위치: `C:\path\to\pkg-output`
3. **저장**

### Linux (systemd)

`/etc/systemd/system/comfyui-image-manager.service` 생성:
```ini
[Unit]
Description=ComfyUI Image Manager
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/pkg-output
ExecStart=/path/to/pkg-output/comfyui-image-manager
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

### macOS (launchd)

`~/Library/LaunchAgents/com.comfyui.imagemanager.plist` 생성:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.comfyui.imagemanager</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/comfyui-image-manager</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/pkg-output</string>
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

---

## 📊 모니터링

### 로그 확인

로그 파일 위치: `logs/`

**실시간 로그 보기 (Linux/Mac):**
```bash
tail -f logs/app.log
```

**Windows:**
PowerShell에서:
```powershell
Get-Content -Path "logs\app.log" -Wait
```

### Health Check

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

---

## 🔧 문제 해결

### 포트가 이미 사용 중

**문제:** `Port 1566 is already in use`

**해결:**

1. `.env` 파일에서 포트 변경:
   ```env
   PORT=3000
   ```

2. 또는 다른 프로그램 종료:
   ```bash
   # Windows
   netstat -ano | findstr :1566
   taskkill /PID <PID> /F

   # Linux/Mac
   lsof -ti:1566 | xargs kill
   ```

### 외부에서 접속 안 됨

**체크리스트:**
- [ ] 포트 포워딩 설정 완료
- [ ] 방화벽에서 포트 허용
- [ ] 공유기 재시작
- [ ] 외부 IP 정확한지 확인
- [ ] ISP가 포트를 막지 않는지 확인 (일부 ISP는 80, 443 외 포트 차단)

**테스트:**
```bash
# 외부에서 포트 열려있는지 확인
# https://www.yougetsignal.com/tools/open-ports/
```

### 데이터베이스 오류

**해결:**
1. 서버 중지
2. `database/` 폴더 백업
3. `database/` 폴더 삭제
4. 서버 재시작 (자동으로 새 데이터베이스 생성)

**복구 필요 시:**
```bash
# SQLite 복구 시도
sqlite3 database/images.db ".recover" | sqlite3 database/images_recovered.db
```

### 메모리 부족

**증상:** 서버가 느리거나 크래시

**해결:**
- 이미지 업로드 크기 제한 조정
- 더 많은 RAM 할당
- 오래된 이미지 아카이브

---

## 📱 모바일 접근

### PWA 설치 (Progressive Web App)

1. 모바일 브라우저에서 접속
2. "홈 화면에 추가" 선택
3. 앱처럼 사용 가능

### 모바일 최적화 팁

- 로컬 네트워크 사용 시: 빠른 로딩
- 외부 접속 시: 업로드 대역폭 주의

---

## 🔄 업데이트

### 새 버전으로 업데이트

1. **백업**
   ```bash
   # 데이터 백업
   cp -r uploads uploads_backup
   cp -r database database_backup
   ```

2. **실행 파일 교체**
   - 기존 실행 파일 삭제
   - 새 실행 파일 복사

3. **서버 재시작**

**데이터는 유지됩니다** - `uploads/`, `database/`, `.env` 파일은 그대로 두세요!

---

## 📚 추가 리소스

- **API 문서:** [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- **개발 가이드:** [CLAUDE.md](./CLAUDE.md)
- **GitHub Issues:** 문제 보고 및 기능 제안
- **Discord/Community:** 커뮤니티 지원 (향후)

---

## 💡 사용 사례

### 1. 개인 AI 아트 갤러리
- 모든 AI 생성 이미지를 한 곳에 저장
- 프롬프트, 설정 자동 기록
- 언제 어디서든 포트폴리오 확인

### 2. 팀 리소스 라이브러리
- 로컬 네트워크에서 팀 공유
- 자동 그룹핑으로 정리
- API를 통한 자동화

### 3. ComfyUI 워크플로우 관리
- 생성 이미지 자동 수집
- 프롬프트 재사용
- 워크플로우 결과 추적

---

## 🎯 Next Steps

배포 완료 후:
1. ✅ API 문서 확인
2. ✅ 백업 스케줄 설정
3. ✅ 모바일에서 접속 테스트
4. ✅ ComfyUI 연동 (향후)
5. ✅ 커스터마이징 및 확장

---

**문제가 있으신가요?**
GitHub Issues에 올려주세요. 커뮤니티가 도와드립니다! 🚀
