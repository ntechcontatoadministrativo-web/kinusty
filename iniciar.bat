@echo off
chcp 65001 >nul
title Kinusty Volleyball - Servidor local
cd /d "%~dp0"
echo.
echo  Kinusty Volleyball (servidor local, usa o mesmo banco do site publicado)
echo  -------------------------------------------
echo  Neste computador:  http://localhost:3000
echo  Mantenha esta janela aberta. Para desligar, feche-a.
echo  -------------------------------------------
call npm start
pause
