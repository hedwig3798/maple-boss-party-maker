@echo off
chcp 65001 >nul
setlocal
title BossMaker
cd /d "%~dp0"

rem 저장 데이터(localStorage)는 주소별로 따로 저장되므로 포트를 고정한다.
set PORT=5173
set URL=http://localhost:%PORT%/

echo ============================================
echo   BossMaker - 메이플 파티 보스 메이커
echo ============================================
echo.

rem ---------- 1. 이미 실행 중이면 브라우저만 연다 ----------
netstat -ano | findstr /c:":%PORT% " | findstr LISTENING >nul
if not errorlevel 1 (
  echo 이미 실행 중입니다. 브라우저를 엽니다: %URL%
  start "" "%URL%"
  timeout /t 3 >nul
  exit /b 0
)

rem ---------- 2. Node.js 검사 / 설치 ----------
echo [1/3] Node.js 확인 중...
where node >nul 2>nul
if errorlevel 1 goto install_node
goto check_node_version

:install_node
echo Node.js가 없습니다. 설치를 시작합니다.
where winget >nul 2>nul
if errorlevel 1 goto no_winget
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto node_install_failed
rem 새로 설치한 경로는 이 창의 PATH에 아직 없으므로 직접 추가한다.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto node_install_failed
echo Node.js 설치 완료.

:check_node_version
set NODE_MAJOR=0
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
  echo Node.js 버전이 너무 낮습니다. 현재:
  node -v
  echo 18 이상이 필요합니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  goto fail
)
for /f "delims=" %%v in ('node -v') do echo Node.js %%v 사용

rem ---------- 3. 패키지 검사 / 설치 ----------
echo.
echo [2/3] 패키지 확인 중...
if exist "node_modules\.bin\vite.cmd" (
  echo 패키지가 이미 설치되어 있습니다.
) else (
  echo 패키지를 설치합니다. 처음 한 번만 1~2분 걸립니다...
  call npm ci
  if errorlevel 1 (
    echo 패키지 설치에 실패했습니다. 인터넷 연결을 확인하세요.
    goto fail
  )
)

rem ---------- 4. 실행 ----------
echo.
echo [3/3] 실행합니다: %URL%
echo 이 창을 닫으면 BossMaker가 종료됩니다.
echo.
call npm run dev -- --port %PORT% --strictPort --open
goto end

:no_winget
echo winget을 찾을 수 없어 자동 설치를 할 수 없습니다.
echo 열리는 페이지에서 Node.js LTS를 설치한 뒤 BossMaker.bat을 다시 실행하세요.
start "" "https://nodejs.org/ko/download"
goto fail

:node_install_failed
echo Node.js 설치에 실패했습니다.
echo https://nodejs.org 에서 LTS 버전을 직접 설치한 뒤 다시 실행하세요.
goto fail

:fail
echo.
pause
exit /b 1

:end
endlocal
