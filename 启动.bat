@echo off
chcp 65001 >nul
rem Forward to the hidden launcher; do not keep a console hosting the service.
wscript.exe //B "%~dp0启动.vbs"
exit /b
