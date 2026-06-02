#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Starts the Cloud Management Portal server locally

.DESCRIPTION
    This script starts the Pode web server for the Cloud Management Portal.
    It checks for required dependencies and configuration before starting.

.EXAMPLE
    ./Start-Portal.ps1
#>

[CmdletBinding()]
param()

# Check PowerShell version
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Error "PowerShell 7 or higher is required. Current version: $($PSVersionTable.PSVersion)"
    exit 1
}

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Cloud Management Portal" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check for required modules
Write-Host "Checking dependencies..." -ForegroundColor Yellow

$requiredModules = @('Pode')
foreach ($module in $requiredModules) {
    if (-not (Get-Module -ListAvailable -Name $module)) {
        Write-Host "Installing $module..." -ForegroundColor Yellow
        Install-Module -Name $module -Scope CurrentUser -Force
    }
}

# Check for configuration file
$configPath = Join-Path $PSScriptRoot "config/appsettings.json"
if (-not (Test-Path $configPath)) {
    Write-Error "Configuration file not found: $configPath"
    Write-Host "Please copy config/appsettings.example.json to config/appsettings.json and configure it." -ForegroundColor Yellow
    exit 1
}

# Create necessary directories
$logsDir = Join-Path $PSScriptRoot "logs"
$cacheDir = Join-Path $PSScriptRoot "cache"

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir | Out-Null
}

Write-Host "Starting server..." -ForegroundColor Green
Write-Host ""

# Start the server
$serverScript = Join-Path $PSScriptRoot "src/API/Server.ps1"
& $serverScript
