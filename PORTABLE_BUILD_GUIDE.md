# Portable Build Guide

## Overview

The portable build system creates a standalone distribution that automatically downloads missing dependencies on first run. This allows for:

- ✅ Smaller Git repository (no `node_modules` committed)
- ✅ Automatic platform-specific binary downloads
- ✅ Works on Windows, Linux, and Mac
- ✅ Offline usage after first successful run

## Build Process

### Step 1: Build the Application

```bash
# Build backend and frontend
npm run build:integrated

# Create bundle (single JS file)
npm run build:bundle

# Create portable package
npm run build:portable
```

### Step 2: Portable Package Structure

```
portable-output/
├── node.exe (or node)          # Node.js runtime
├── start.bat                   # Windows startup script
├── start.sh                    # Linux/Mac startup script
├── .env.example                # Configuration template
├── README.txt                  # User documentation
├── app/
│   ├── bundle.js              # Application code (bundled)
│   ├── bootstrap.js           # Dependency installer
│   ├── package.json           # Dependency manifest
│   ├── migrations/            # Database migrations
│   ├── python/                # Python scripts (optional)
│   ├── frontend/              # Frontend assets
│   └── node_modules/          # [Created on first run]
├── database/                   # [Created on first run]
├── uploads/                    # [Created on first run]
├── logs/                       # [Created on first run]
└── models/                     # [Created on first run]
```

## How Auto-Download Works

### Bootstrap Process

1. **User runs** `start.bat` or `start.sh`
2. **Script executes** `node.exe app/bootstrap.js`
3. **Bootstrap checks** if `sharp` and `sqlite3` are installed
4. **If missing**, runs `npm install --production --no-save` in `app/` folder
5. **Dependencies download** from npm registry (~50-100MB)
6. **Installation completes** in 1-2 minutes
7. **Script continues** and starts the application with `node.exe app/bundle.js`

### First Run User Experience

```
========================================================================
            ComfyUI Image Manager
========================================================================

Missing dependencies detected:
  - sharp
  - sqlite3

Installing missing dependencies...
This may take a few minutes on first run.

Running: npm install --production --no-save

[npm output showing download progress]

✓ Dependencies installed successfully!

========================================================================
  Setup Complete!
========================================================================

Starting server...

✓ All dependencies are installed and ready!
Starting server...
```

### Subsequent Runs

```
========================================================================
            ComfyUI Image Manager
========================================================================

✓ All dependencies are installed and ready!

Starting server...
```

## Testing the Portable Build

### Test 1: With Dependencies (Normal Build)

```bash
cd portable-output
start.bat  # or ./start.sh on Linux/Mac
```

**Expected**: Immediate startup (all dependencies already present)

### Test 2: Without Dependencies (Auto-Download)

```bash
# Remove node_modules to simulate Git clone without dependencies
cd portable-output/app
rm -rf node_modules  # or rmdir /s /q node_modules on Windows

# Go back and start
cd ..
start.bat  # or ./start.sh
```

**Expected**: Bootstrap runs, downloads dependencies, then starts server

### Test 3: Offline After First Run

```bash
# After Test 2 completes successfully
# Disconnect internet or block npm
start.bat  # or ./start.sh
```

**Expected**: Immediate startup using cached dependencies

## Distribution Methods

### Method 1: GitHub Releases (Recommended)

**Without Dependencies** (Smaller, ~10-20MB):
```bash
cd portable-output
# Remove node_modules before zipping
rm -rf app/node_modules
zip -r ../comfyui-image-manager-portable-lite.zip .
```

**With Dependencies** (Larger, ~150-200MB):
```bash
cd portable-output
# Keep node_modules
zip -r ../comfyui-image-manager-portable-full.zip .
```

**Release Notes Template**:
```markdown
## Download Options

### Lite Version (10-20MB) - Recommended
- **Requires**: Internet connection on first run
- **Downloads**: Dependencies automatically (~50MB)
- **Best for**: Most users

### Full Version (150-200MB)
- **Includes**: All dependencies pre-installed
- **No internet needed**: Works offline immediately
- **Best for**: Offline environments, server deployments
```

### Method 2: Git Repository

**Commit to Git**:
```bash
# .gitignore already excludes node_modules
git add portable-output
git commit -m "Add portable distribution"
git push
```

**User clones and runs**:
```bash
git clone <repo-url>
cd <repo>/portable-output
./start.bat  # Dependencies download automatically
```

## Troubleshooting

### Bootstrap fails with "npm not found"

**Problem**: System doesn't have npm installed

**Solution**:
- User needs to install Node.js from https://nodejs.org/
- Alternatively, provide the "Full Version" with dependencies included

### Bootstrap fails with network error

**Problem**: Firewall or proxy blocking npm

**Solutions**:
1. Configure npm proxy:
   ```bash
   npm config set proxy http://proxy.company.com:8080
   npm config set https-proxy http://proxy.company.com:8080
   ```

2. Use the "Full Version" with dependencies

3. Manual installation:
   ```bash
   cd app
   npm install --production
   ```

### Wrong platform binaries

**Problem**: Built on Windows, running on Linux (or vice versa)

**How it works**:
- Bootstrap downloads platform-specific binaries automatically
- `sharp` and `sqlite3` include prebuilt binaries for all platforms
- npm automatically selects the correct binary for the current platform

**No action needed**: Auto-download handles this automatically

### Offline installation needed

**Solution**: Create platform-specific full builds

```bash
# On Windows
npm run build:portable
cd portable-output
zip -r ../comfyui-portable-windows-full.zip .

# On Linux
npm run build:portable
cd portable-output
tar -czf ../comfyui-portable-linux-full.tar.gz .

# On Mac
npm run build:portable
cd portable-output
tar -czf ../comfyui-portable-macos-full.tar.gz .
```

## Advanced Configuration

### Customize Bootstrap Behavior

Edit `scripts/bootstrap.js`:

```javascript
// Add more modules to check
const REQUIRED_MODULES = ['sharp', 'sqlite3', 'your-module'];

// Skip npm check (always install)
function bootstrap() {
  // ... install dependencies without checking
}
```

### Add Pre-Installation Hooks

Edit `start.bat`:

```batch
@echo off
REM Custom pre-checks
if not exist "config" mkdir config

REM Run bootstrap
node.exe app\bootstrap.js
```

### Create Multi-Platform Build Script

```javascript
// scripts/build-all-platforms.js
const platforms = ['win32', 'linux', 'darwin'];
const arches = ['x64', 'arm64'];

for (const platform of platforms) {
  for (const arch of arches) {
    console.log(`Building for ${platform}-${arch}...`);
    // Download Node.js for specific platform
    // Create platform-specific package
  }
}
```

## Maintenance

### Update Dependencies

1. Update `package.json` in root
2. Run `npm run build:portable`
3. New builds will use updated dependency versions

### Update Bootstrap Logic

1. Modify `scripts/bootstrap.js`
2. Run `npm run build:portable`
3. New portable builds will include updated bootstrap

### Monitor First-Run Experience

Add telemetry to bootstrap (optional):

```javascript
// scripts/bootstrap.js
function reportUsage(event) {
  // Send anonymous analytics
  // Track: first run, dependency download time, errors
}
```

## Best Practices

1. **Always test both scenarios**: with and without dependencies
2. **Document first-run requirements**: internet, npm, etc.
3. **Provide multiple download options**: lite and full versions
4. **Keep bootstrap simple**: avoid complex logic that might fail
5. **Handle errors gracefully**: clear messages, fallback options
6. **Version lock dependencies**: avoid surprise breaking changes

## Security Considerations

1. **Verify npm packages**: Bootstrap downloads from npm registry
2. **Use npm audit**: Check for vulnerabilities before building
3. **Consider vendoring**: For high-security environments, include dependencies
4. **Checksum verification**: Add integrity checks for downloaded modules (advanced)

```javascript
// Example: Verify downloaded module integrity
const crypto = require('crypto');
function verifyModule(modulePath, expectedHash) {
  const content = fs.readFileSync(modulePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return hash === expectedHash;
}
```

## Summary

The auto-download system provides:

✅ **Smaller Git repos**: ~10-20MB vs ~150-200MB
✅ **Cross-platform support**: Automatic platform-specific binaries
✅ **User-friendly**: One-click setup with automatic dependencies
✅ **Flexible distribution**: Offer both lite and full versions
✅ **Offline capable**: After first run, no internet needed

This approach is ideal for:
- Open source projects on GitHub
- Multi-platform desktop applications
- Internal tools with flexible deployment needs
