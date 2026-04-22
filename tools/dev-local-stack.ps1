#Requires -Version 5.1
<#
  Собирает и поднимает локальный стек Nest-сервисов без `nest start --watch`
  (меньше RAM; обходит проблемы `nest`/dist на путях с пробелами).

  Рекомендуется: `subst Z: "C:\path\to\Arbibot 2"` и запуск с `-RepoRoot Z:\`
  (см. README / AGENTS.md).

  Перед запуском: `docker compose -f infra/docker-compose.dev.yml up -d`
  и `npm run db:migrate` с рабочим DATABASE_URL.
#>
param(
  [string]$RepoRoot = "Z:\",
  [string]$DatabaseUrl = "postgres://arbibot:arbibot@127.0.0.1:15432/arbibot",
  [string]$RedisUrl = "redis://127.0.0.1:6379"
)

$ErrorActionPreference = "Stop"

function Test-RepoRoot {
  if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
    throw "RepoRoot не найден: $RepoRoot (ожидался корень монорепо с package.json). Укажите -RepoRoot или сделайте subst Z: -> каталог репозитория."
  }
}

function Build-App([string]$appName) {
  $dir = Join-Path $RepoRoot "apps\$appName"
  if (-not (Test-Path $dir)) { throw "Нет каталога: $dir" }
  Push-Location $dir
  try {
    Remove-Item "tsconfig.build.tsbuildinfo" -Force -ErrorAction SilentlyContinue
    & npx tsc -p tsconfig.build.json
    if (-not (Test-Path "dist\main.js")) {
      throw "После tsc нет dist\main.js в $dir"
    }
  }
  finally {
    Pop-Location
  }
}

function Start-ServiceCmd([string]$appName, [string]$extraSet) {
  $wd = Join-Path $RepoRoot "apps\$appName"
  $log = Join-Path $env:TEMP "arbibot-$appName.log"
  $baseSet = "set DATABASE_URL=$DatabaseUrl&& "
  $cmd = "$baseSet$extraSet" + "cd /d `"$wd`" && node dist\main.js"
  Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "$cmd > `"$log`" 2>&1") -WindowStyle Hidden | Out-Null
  Write-Host "Started $appName (log: $log)"
}

Test-RepoRoot

$apps = @(
  "config-service",
  "capital-service",
  "audit-service",
  "canonical-market-service",
  "portfolio-service",
  "reconciliation-service",
  "paper-trading-service",
  "execution-orchestrator",
  "opportunity-service",
  "market-intake-service",
  "openclaw-gateway",
  "risk-service"
)

Write-Host "Building $($apps.Count) apps with tsc..."
foreach ($a in $apps) {
  Write-Host "  build: $a"
  Build-App $a
}

Write-Host "Starting processes (config first, then the rest)..."
Start-ServiceCmd "config-service" "set REDIS_URL=$RedisUrl&& "

Start-Sleep -Seconds 4

Start-ServiceCmd "risk-service" "set REDIS_URL=$RedisUrl&& "
Start-ServiceCmd "capital-service" ""
Start-ServiceCmd "audit-service" ""
Start-ServiceCmd "canonical-market-service" ""
Start-ServiceCmd "portfolio-service" ""
Start-ServiceCmd "reconciliation-service" ""
Start-ServiceCmd "paper-trading-service" "set CONFIG_SERVICE_URL=http://127.0.0.1:3019&& "
Start-ServiceCmd "execution-orchestrator" "set CAPITAL_SERVICE_BASE_URL=http://127.0.0.1:3011&& set RISK_SERVICE_BASE_URL=http://127.0.0.1:3000&& "
Start-ServiceCmd "market-intake-service" "set CONFIG_SERVICE_URL=http://127.0.0.1:3019&& set RISK_SERVICE_URL=http://127.0.0.1:3000&& "
Start-ServiceCmd "openclaw-gateway" "set OPENCLAW_API_KEYS=dev-openclaw-local&& set OPERATOR_WEB_BFF_BASE=http://127.0.0.1:3005&& "
Start-ServiceCmd "opportunity-service" "set RISK_SERVICE_URL=http://127.0.0.1:3000&& set PAPER_TRADING_SERVICE_URL=http://127.0.0.1:3018&& "

Write-Host ""
Write-Host "Done. Default ports: risk 3000, opportunity 3010, capital 3011, execution 3012, audit 3013, canonical 3014, intake 3015, portfolio 3016, reconciliation 3017, paper 3018, config 3019, openclaw 3020."
Write-Host "Operator UI: from apps/web run: npm run dev -- -p 3005"
Write-Host ('Service logs: ' + $env:TEMP + '\arbibot-*.log')
