@echo off
chcp 65001 >nul
title Редактор сохранений RoR2
cd /d "%~dp0"
node tools\server.js --open
pause
