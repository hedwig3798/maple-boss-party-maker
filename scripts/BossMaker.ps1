# BossMaker 실행기: 실행 환경(Node.js, 패키지)을 검사·설치한 뒤 앱을 띄운다.
param(
  # 저장 데이터(localStorage)는 주소별로 따로 저장되므로 포트를 고정한다.
  [int]$Port = 5173,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$url = "http://localhost:$Port/"
$host.UI.RawUI.WindowTitle = 'BossMaker'

function Fail([string]$msg) {
  Write-Host ''
  Write-Host $msg -ForegroundColor Red
  exit 1
}

Write-Host '============================================'
Write-Host '  BossMaker - 메이플 파티 보스 메이커'
Write-Host '============================================'
Write-Host ''

# ---------- 이미 실행 중이면 브라우저만 연다 ----------
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "이미 실행 중입니다. 브라우저를 엽니다: $url"
  if (-not $NoOpen) { Start-Process $url }
  Start-Sleep -Seconds 2
  exit 0
}

# ---------- 1. Node.js 검사 / 설치 ----------
Write-Host '[1/3] Node.js 확인 중...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js가 없습니다. 설치를 시작합니다.' -ForegroundColor Yellow
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Start-Process 'https://nodejs.org/ko/download'
    Fail '자동 설치를 할 수 없습니다(winget 없음). 열린 페이지에서 Node.js LTS를 설치한 뒤 다시 실행하세요.'
  }
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  # 새로 설치한 경로는 이 창의 PATH에 아직 없으므로 다시 읽어 온다.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'Node.js 설치에 실패했습니다. https://nodejs.org 에서 LTS 버전을 직접 설치한 뒤 다시 실행하세요.'
  }
  Write-Host 'Node.js 설치 완료.' -ForegroundColor Green
}

$nodeVersion = (node -v).Trim()
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
  Fail "Node.js 버전이 너무 낮습니다(현재 $nodeVersion, 18 이상 필요). https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
}
Write-Host "Node.js $nodeVersion 사용"

# ---------- 2. 패키지 검사 / 설치 ----------
Write-Host ''
Write-Host '[2/3] 패키지 확인 중...'
$vite = Join-Path $root 'node_modules\.bin\vite.cmd'
if (Test-Path $vite) {
  Write-Host '패키지가 이미 설치되어 있습니다.'
} else {
  Write-Host '패키지를 설치합니다. 처음 한 번만 1~2분 걸립니다...' -ForegroundColor Yellow
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $vite)) {
    Fail '패키지 설치에 실패했습니다. 인터넷 연결을 확인하세요.'
  }
  Write-Host '패키지 설치 완료.' -ForegroundColor Green
}

# ---------- 3. 실행 ----------
Write-Host ''
Write-Host "[3/3] 실행합니다: $url" -ForegroundColor Green
Write-Host '이 창을 닫으면 BossMaker가 종료됩니다.'
Write-Host ''
$viteArgs = @('--port', $Port, '--strictPort')
if (-not $NoOpen) { $viteArgs += '--open' }
& $vite @viteArgs
if ($LASTEXITCODE -ne 0) { Fail "실행에 실패했습니다. 포트 $Port 를 다른 프로그램이 쓰고 있는지 확인하세요." }
