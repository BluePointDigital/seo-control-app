# Windows Install

This package is prepared for a fresh Windows machine.

## Fast path
1. Install Node.js `24.x`.
2. Open this folder.
3. Double-click `install-windows.cmd`.
4. After install finishes, run `npm run dev`.
5. Open `http://localhost:5173`.

## What the installer does
- checks that Node `24+` is installed
- runs `npm install`
- creates `.env` from `.env.example` if it does not exist
- runs `npm run doctor` to validate the runtime

## Optional
- You can also run `powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -StartAfterInstall` to install and immediately start the app.
- If you need Google integrations, add your Google OAuth settings to `.env` after install.
