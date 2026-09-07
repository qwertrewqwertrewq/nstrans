@echo off
title NSTrans Virtual USB Camera Streamer
cd /d "%~dp0"
echo Starting Virtual USB Camera Streamer...
".build\windows\venv\Scripts\python.exe" -u scripts\start-virtualcam-test.py
pause
