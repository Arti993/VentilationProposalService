# Запуск n8n для разработки.
#
#   .\scripts\start-n8n.ps1
#
# Зачем скрипт, а не одна команда: у n8n десяток переменных окружения,
# и без них он падает или работает не так, как нужно. Держать их в
# голове — значит каждый раз наступать на те же грабли.
#
# ЧТО ЗДЕСЬ НАСТРОЕНО И ПОЧЕМУ
#
# N8N_PUBLIC_API_DISABLED=false
#   Включает REST API /api/v1. Без него сценарии нельзя заливать
#   программно, только мышкой. По умолчанию API выключен.
#
# N8N_PUBLIC_API_ENDPOINT=api/v1
#   Префикс пути. Без него эндпоинт отвечает 404.
#
# N8N_USER_FOLDER
#   Куда n8n кладёт базу и настройки. Держим внутри проекта, чтобы
#   удалить папку и начать с чистого листа, не трогая систему.
#
# N8N_DIAGNOSTICS_ENABLED / VERSION_NOTIFICATIONS / PERSONALIZATION
#   Учётки телеметрии. Выключено: в учебном проекте незачем.
#
# NODE_PATH
#   n8n установлен глобально, а sqlite3 пришлось собрать отдельно и
#   подложить в его node_modules. NODE_PATH помогает их найти.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$n8nModules = Join-Path $env:APPDATA "npm\node_modules\n8n\node_modules"

$env:N8N_USER_FOLDER = Join-Path $root ".n8n-data"
$env:N8N_DIAGNOSTICS_ENABLED = "false"
$env:N8N_VERSION_NOTIFICATIONS_ENABLED = "false"
$env:N8N_PERSONALIZATION_ENABLED = "false"
$env:N8N_PUBLIC_API_DISABLED = "false"

if (Test-Path $n8nModules) {
    $env:NODE_PATH = $n8nModules
    Write-Host "NODE_PATH: $n8nModules"
}

Write-Host "Данные n8n: $env:N8N_USER_FOLDER"
Write-Host "Открывайте: http://localhost:5678"
Write-Host ""

$n8n = (Get-Command n8n -ErrorAction SilentlyContinue)
if (-not $n8n) {
    Write-Host "n8n не найден. Установите: npm install -g n8n" -ForegroundColor Red
    exit 1
}

& $n8n start
