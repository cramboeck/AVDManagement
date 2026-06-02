<#
.SYNOPSIS
    Automatically installs required software during Autopilot v2 process

.DESCRIPTION
    This script automatically downloads and installs:
    - .NET Framework 3.5 (if not present)
    - .NET Framework 4.8 (if not present)
    - Visual C++ Redistributable (latest versions x64 and x86)

.NOTES
    Filename: Install-AutopilotSoftware-EN.ps1
    Author: PowerShell Automation
    Version: 2.0
    Language: English
#>

[CmdletBinding()]
param()

# Logging function
$LogPath = "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs"
$LogFile = "$LogPath\AutopilotSoftwareInstall_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

if (-not (Test-Path $LogPath)) {
    New-Item -Path $LogPath -ItemType Directory -Force | Out-Null
}

function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $false)]
        [ValidateSet('Info', 'Warning', 'Error', 'Success')]
        [string]$Level = 'Info'
    )

    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $LogEntry = "[$Timestamp] [$Level] $Message"

    Add-Content -Path $LogFile -Value $LogEntry

    switch ($Level) {
        'Error'   { Write-Host $LogEntry -ForegroundColor Red }
        'Warning' { Write-Host $LogEntry -ForegroundColor Yellow }
        'Success' { Write-Host $LogEntry -ForegroundColor Green }
        default   { Write-Host $LogEntry }
    }
}

# Temporary download folder
$TempPath = "$env:TEMP\AutopilotSoftwareInstall"
if (-not (Test-Path $TempPath)) {
    New-Item -Path $TempPath -ItemType Directory -Force | Out-Null
}

Write-Log "=== Autopilot Software Installation Started ===" -Level Info

#region .NET Framework 3.5 Installation
try {
    Write-Log "Checking .NET Framework 3.5 installation..." -Level Info

    # Check if .NET Framework 3.5 is already installed
    $DotNet35Feature = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue

    if ($null -eq $DotNet35Feature -or $DotNet35Feature.State -ne 'Enabled') {
        Write-Log ".NET Framework 3.5 not found. Starting installation..." -Level Warning

        try {
            # OPTION 1: DISM with Windows Update (Recommended for Autopilot)
            # Requires Internet, but no local sources needed
            Write-Log "Installing .NET Framework 3.5 via Windows Update (DISM)..." -Level Info

            $DismArgs = @(
                "/Online",
                "/Enable-Feature",
                "/FeatureName:NetFx3",
                "/All",
                "/NoRestart",
                "/Quiet"
            )

            $DismLog = "$TempPath\DotNet35_DISM.log"
            $Process = Start-Process -FilePath "dism.exe" -ArgumentList $DismArgs -Wait -PassThru -NoNewWindow -RedirectStandardOutput $DismLog

            if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
                Write-Log ".NET Framework 3.5 installed successfully (Exit Code: $($Process.ExitCode))" -Level Success

                if ($Process.ExitCode -eq 3010) {
                    Write-Log "Restart required after .NET 3.5 installation" -Level Warning
                }
            }
            elseif ($Process.ExitCode -eq 1) {
                # Error, try alternative method with PowerShell
                Write-Log "DISM installation failed, trying alternative method..." -Level Warning

                # OPTION 2: PowerShell Enable-WindowsOptionalFeature
                Write-Log "Installing .NET Framework 3.5 via PowerShell..." -Level Info

                $EnableResult = Enable-WindowsOptionalFeature -Online -FeatureName NetFx3 -All -NoRestart -ErrorAction Stop

                if ($EnableResult.RestartNeeded) {
                    Write-Log ".NET Framework 3.5 installed, restart required" -Level Warning
                }
                else {
                    Write-Log ".NET Framework 3.5 installed successfully" -Level Success
                }
            }
            else {
                Write-Log "Error installing .NET Framework 3.5 (Exit Code: $($Process.ExitCode))" -Level Error

                # Show log details
                if (Test-Path $DismLog) {
                    $LogContent = Get-Content $DismLog -Raw
                    Write-Log "DISM Log Details:`n$LogContent" -Level Error
                }
            }
        }
        catch {
            Write-Log "Error installing .NET Framework 3.5: $($_.Exception.Message)" -Level Error

            # OPTION 3: As fallback - information for manual installation
            Write-Log "Alternative: .NET Framework 3.5 can be installed manually via:" -Level Info
            Write-Log "  - Windows Settings > Apps > Optional Features" -Level Info
            Write-Log "  - Or: DISM /Online /Enable-Feature /FeatureName:NetFx3 /All" -Level Info
        }
    }
    else {
        Write-Log ".NET Framework 3.5 is already installed and enabled" -Level Success
    }
}
catch {
    Write-Log "Error checking .NET Framework 3.5: $($_.Exception.Message)" -Level Error
}
#endregion

#region .NET Framework 4.8 Installation
try {
    Write-Log "Checking .NET Framework installation..." -Level Info

    # Check if .NET Framework 4.8 or higher is installed
    $DotNetVersion = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue

    if ($null -eq $DotNetVersion -or $DotNetVersion.Release -lt 528040) {
        Write-Log ".NET Framework 4.8 not found. Starting download..." -Level Warning

        $DotNetUrl = "https://go.microsoft.com/fwlink/?linkid=2088631"
        $DotNetInstaller = "$TempPath\ndp48-web.exe"

        # Download .NET Framework
        Write-Log "Downloading .NET Framework 4.8..." -Level Info
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $DotNetUrl -OutFile $DotNetInstaller -UseBasicParsing
        $ProgressPreference = 'Continue'

        if (Test-Path $DotNetInstaller) {
            Write-Log "Download successful. Starting installation..." -Level Info

            # Install .NET Framework
            $InstallArgs = "/q /norestart /log `"$TempPath\DotNet48_Install.log`""
            $Process = Start-Process -FilePath $DotNetInstaller -ArgumentList $InstallArgs -Wait -PassThru -NoNewWindow

            if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010) {
                Write-Log ".NET Framework 4.8 installed successfully (Exit Code: $($Process.ExitCode))" -Level Success

                if ($Process.ExitCode -eq 3010) {
                    Write-Log "Restart required after .NET installation" -Level Warning
                }
            }
            else {
                Write-Log "Error installing .NET (Exit Code: $($Process.ExitCode))" -Level Error
            }

            # Cleanup
            Remove-Item -Path $DotNetInstaller -Force -ErrorAction SilentlyContinue
        }
        else {
            Write-Log "Error downloading .NET Framework" -Level Error
        }
    }
    else {
        Write-Log ".NET Framework 4.8 or higher is already installed (Release: $($DotNetVersion.Release))" -Level Success
    }
}
catch {
    Write-Log "Error installing .NET Framework: $($_.Exception.Message)" -Level Error
}
#endregion

#region Visual C++ Redistributable Installation
try {
    Write-Log "Starting Visual C++ Redistributable installation..." -Level Info

    # Download URLs for latest VC++ Redistributables
    $VCRedistPackages = @(
        @{
            Name = "Visual C++ 2015-2022 Redistributable (x64)"
            Url  = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
            File = "vc_redist.x64.exe"
            Arch = "x64"
        },
        @{
            Name = "Visual C++ 2015-2022 Redistributable (x86)"
            Url  = "https://aka.ms/vs/17/release/vc_redist.x86.exe"
            File = "vc_redist.x86.exe"
            Arch = "x86"
        }
    )

    foreach ($Package in $VCRedistPackages) {
        Write-Log "Downloading $($Package.Name)..." -Level Info

        $InstallerPath = "$TempPath\$($Package.File)"

        try {
            # Download
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $Package.Url -OutFile $InstallerPath -UseBasicParsing
            $ProgressPreference = 'Continue'

            if (Test-Path $InstallerPath) {
                Write-Log "Download successful. Starting installation of $($Package.Name)..." -Level Info

                # Install VC++ Redistributable
                # /install = Install mode
                # /quiet = Quiet mode (no UI)
                # /norestart = Don't restart
                $InstallArgs = "/install /quiet /norestart"
                $Process = Start-Process -FilePath $InstallerPath -ArgumentList $InstallArgs -Wait -PassThru -NoNewWindow

                # Exit Codes:
                # 0 = Success
                # 3010 = Success, reboot required
                # 1638 = Already installed (newer version)
                if ($Process.ExitCode -eq 0 -or $Process.ExitCode -eq 3010 -or $Process.ExitCode -eq 1638) {
                    Write-Log "$($Package.Name) installed successfully (Exit Code: $($Process.ExitCode))" -Level Success

                    if ($Process.ExitCode -eq 3010) {
                        Write-Log "Restart required after $($Package.Name) installation" -Level Warning
                    }
                    elseif ($Process.ExitCode -eq 1638) {
                        Write-Log "$($Package.Name) - Newer version already installed" -Level Info
                    }
                }
                else {
                    Write-Log "Error installing $($Package.Name) (Exit Code: $($Process.ExitCode))" -Level Error
                }

                # Cleanup
                Remove-Item -Path $InstallerPath -Force -ErrorAction SilentlyContinue
            }
            else {
                Write-Log "Error downloading $($Package.Name)" -Level Error
            }
        }
        catch {
            Write-Log "Error with $($Package.Name): $($_.Exception.Message)" -Level Error
        }
    }
}
catch {
    Write-Log "Error installing Visual C++ Redistributable: $($_.Exception.Message)" -Level Error
}
#endregion

# Cleanup temporary folder
Write-Log "Cleaning up temporary files..." -Level Info
try {
    Remove-Item -Path $TempPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log "Temporary files removed successfully" -Level Info
}
catch {
    Write-Log "Warning: Could not remove all temporary files: $($_.Exception.Message)" -Level Warning
}

Write-Log "=== Autopilot Software Installation Completed ===" -Level Success
Write-Log "Log file: $LogFile" -Level Info

# Exit with success
exit 0
