@echo off
chcp 65001 >nul
title 每周作业小管家
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有找到 Node.js。
  echo   请先到 https://nodejs.org 下载安装 LTS 版本，然后再双击本文件。
  echo.
  pause
  exit /b 1
)

echo   正在启动「每周作业小管家」，请稍候...
echo.
node server.js
echo.
echo   服务已停止。
pause
