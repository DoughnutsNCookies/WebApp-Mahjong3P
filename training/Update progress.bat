@echo off
rem Refreshes every run's progress page and the v1-vs-v2 comparison, then opens the comparison.
rem Only reads the logs: it never disturbs a running training.
"%~dp0.venv\Scripts\python.exe" "%~dp0progress.py" all >nul && start "" "%~dp0runs\compare.html"

