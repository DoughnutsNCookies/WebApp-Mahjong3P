@echo off
rem Refreshes the training progress page and opens it. Doesn't touch the running training.
"%~dp0.venv\Scripts\python.exe" "%~dp0progress.py" main >nul && start "" "%~dp0runs\main\progress.html"
