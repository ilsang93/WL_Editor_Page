# PowerShell script for local server
Write-Host "================================" -ForegroundColor Cyan
Write-Host " Rhythm Chart Editor - Local Server" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Change to script directory
Set-Location -Path $PSScriptRoot

# Check Node.js
try {
    $nodeVersion = node --version 2>$null
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
    Write-Host ""
    
    Write-Host "Starting server on port 8080..." -ForegroundColor Yellow
    Write-Host "Open browser: http://localhost:8080" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop server" -ForegroundColor Yellow
    Write-Host ""
    
    # Open browser after 3 seconds
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:8080"
    
    # Start server
    npx http-server -p 8080 -c-1 --cors
    
} catch {
    Write-Host "[ERROR] Node.js not found. Trying Python..." -ForegroundColor Red
    Write-Host ""
    
    try {
        $pythonVersion = python --version 2>$null
        Write-Host "Python version: $pythonVersion" -ForegroundColor Green
        Write-Host ""
        
        Write-Host "Starting Python server on port 8000..." -ForegroundColor Yellow
        Write-Host "Open browser: http://localhost:8000" -ForegroundColor Green
        Write-Host "Press Ctrl+C to stop server" -ForegroundColor Yellow
        Write-Host ""
        
        # Open browser after 3 seconds
        Start-Sleep -Seconds 3
        Start-Process "http://localhost:8000"
        
        # Start Python server
        python -m http.server 8000
        
    } catch {
        Write-Host "[ERROR] Neither Node.js nor Python found!" -ForegroundColor Red
        Write-Host ""
        Write-Host "Please install one of the following:" -ForegroundColor Yellow
        Write-Host "1. Node.js: https://nodejs.org" -ForegroundColor White
        Write-Host "2. Python: https://www.python.org" -ForegroundColor White
        Write-Host ""
    }
}

Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
Read-Host