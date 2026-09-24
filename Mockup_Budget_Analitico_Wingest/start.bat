@echo off
setlocal
cd /d "%~dp0"

set "CODEX_PYTHON=C:\Users\Valentina.Rizzo\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%CODEX_PYTHON%" (
  "%CODEX_PYTHON%" server.py
  goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto :eof
)

echo Python 3 non trovato.
echo Installa Python 3 oppure configura un interprete Python in Visual Studio Code.
pause
