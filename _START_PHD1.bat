@echo off

cd "C:\Users\user\Desktop\phd.1"

start cmd /k "npm run dev"

powershell -Command "$wshell = New-Object -ComObject wscript.shell; $wshell.AppActivate('npm'); Start-Sleep -Milliseconds 500; $wshell.SendKeys('o~')"
