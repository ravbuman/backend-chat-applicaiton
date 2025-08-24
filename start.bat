@echo off
setlocal enabledelayedexpansion

:: Chat Application Backend Startup Script for Windows
:: This script sets up and starts the chat application backend

echo.
echo ================================
echo Chat Application Backend Setup
echo ================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed. Please install Node.js 18+ and try again.
    pause
    exit /b 1
)

:: Check Node.js version
for /f "tokens=1 delims=v" %%i in ('node -v') do set NODE_VERSION=%%i
echo [SUCCESS] Node.js version %NODE_VERSION% found

:: Check if npm is available
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed. Please install npm and try again.
    pause
    exit /b 1
)

echo [SUCCESS] npm is available

:: Check if we're in the correct directory
if not exist "package.json" (
    echo [ERROR] package.json not found. Please run this script from the backend directory.
    pause
    exit /b 1
)

:: Check if MongoDB is running (simplified check)
echo [INFO] Checking MongoDB connection...
:: Note: This is a simplified check. In a real environment, you might want to use MongoDB tools
echo [WARNING] Please ensure MongoDB is running on your system
echo [INFO] You can start MongoDB with: mongod
echo.

:: Check if .env file exists
if not exist ".env" (
    echo [WARNING] .env file not found
    
    if exist ".env.example" (
        echo [INFO] Copying .env.example to .env...
        copy ".env.example" ".env" >nul
        echo [SUCCESS] .env file created from template
        echo [WARNING] Please edit .env file with your configuration before starting the server
    ) else (
        echo [ERROR] .env.example file not found. Please create a .env file manually.
        pause
        exit /b 1
    )
)

:: Check if node_modules exists
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
    echo [SUCCESS] Dependencies installed
) else (
    echo [INFO] Dependencies already installed
)

:: Create logs directory if it doesn't exist
if not exist "logs" (
    echo [INFO] Creating logs directory...
    mkdir logs
    echo [SUCCESS] Logs directory created
)

:: Load environment variables (simplified)
if exist ".env" (
    echo [INFO] Loading environment configuration...
    for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
        if not "%%a"=="" if not "%%a:~0,1%%"=="#" (
            set "%%a=%%b"
        )
    )
)

echo [SUCCESS] Environment configuration loaded

:: Check for development mode
if "%1"=="--dev" (
    echo [INFO] Starting in development mode with auto-reload...
    echo [INFO] Server will be available at: http://localhost:5000
    echo [INFO] Health check: http://localhost:5000/health
    echo [INFO] API documentation: http://localhost:5000/api
    echo.
    echo Press Ctrl+C to stop the server
    echo.
    call npm run dev
) else if "%1"=="--test" (
    echo [INFO] Running tests...
    call npm test
    if %errorlevel% neq 0 (
        echo [ERROR] Tests failed
        pause
        exit /b 1
    )
    echo [SUCCESS] All tests passed
    echo [INFO] Starting server...
    call npm start
) else (
    echo [SUCCESS] Setup complete! Starting the chat application backend...
    echo [INFO] Server will be available at: http://localhost:5000
    echo [INFO] Health check: http://localhost:5000/health
    echo [INFO] API documentation: http://localhost:5000/api
    echo.
    echo Press Ctrl+C to stop the server
    echo.
    call npm start
)

:: Keep window open if there's an error
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server failed to start. Check the logs for more information.
    pause
)

endlocal
