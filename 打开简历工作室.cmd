@echo off
cd /d "%~dp0"
start "" /min pythonw.exe "%~dp0server.py" --open
