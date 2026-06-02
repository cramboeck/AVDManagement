#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Installs all required dependencies for the Cloud Management Portal

.DESCRIPTION
    This script installs all required PowerShell modules and dependencies
    needed to run the Cloud Management Portal.

.EXAMPLE
    ./scripts/Install-Dependencies.ps1
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('CurrentUser', 'AllUsers')]
    [string]$Scope = 'CurrentUser'
)

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Cloud Management Portal" -ForegroundColor Green
Write-Host "Dependency Installation" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check PowerShell version
Write-Host "Checking PowerShell version..." -ForegroundColor Yellow
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Error "PowerShell 7 or higher is required."
    Write-Host "Download from: https://github.com/PowerShell/PowerShell/releases" -ForegroundColor Yellow
    exit 1
}
Write-Host "  PowerShell version: $($PSVersionTable.PSVersion)" -ForegroundColor Green
Write-Host ""

# Set PSGallery as trusted
Write-Host "Configuring PSGallery..." -ForegroundColor Yellow
Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
Write-Host "  PSGallery configured" -ForegroundColor Green
Write-Host ""

# Required modules
$modules = @(
    @{ Name = 'Pode'; MinimumVersion = '2.10.0'; Description = 'Web server framework' }
)

# Install modules
Write-Host "Installing PowerShell modules..." -ForegroundColor Yellow
foreach ($module in $modules) {
    Write-Host "  Installing $($module.Name) ($($module.Description))..." -ForegroundColor Cyan

    $installedModule = Get-Module -ListAvailable -Name $module.Name |
        Where-Object { $_.Version -ge [version]$module.MinimumVersion } |
        Select-Object -First 1

    if ($installedModule) {
        Write-Host "    Already installed: $($installedModule.Version)" -ForegroundColor Green
    }
    else {
        try {
            Install-Module -Name $module.Name -MinimumVersion $module.MinimumVersion -Scope $Scope -Force -AllowClobber
            Write-Host "    Installed successfully" -ForegroundColor Green
        }
        catch {
            Write-Error "Failed to install $($module.Name): $_"
        }
    }
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Copy config/appsettings.example.json to config/appsettings.json"
Write-Host "2. Configure your Azure AD app credentials in appsettings.json"
Write-Host "3. Run ./Start-Portal.ps1 to start the server"
Write-Host ""
