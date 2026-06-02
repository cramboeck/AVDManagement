<#
.SYNOPSIS
    Detection script for Autopilot software installation

.DESCRIPTION
    Checks if .NET Framework 3.5, .NET Framework 4.8, and Visual C++ Redistributable are installed

.NOTES
    Filename: Detect-AutopilotSoftware-EN.ps1
    Author: PowerShell Automation
    Version: 2.0
    Language: English

    Exit Codes:
    0 = Software is installed (Detection successful)
    1 = Software is not installed (Detection failed - Installation required)
#>

[CmdletBinding()]
param()

$AllInstalled = $true

# Check .NET Framework 3.5
try {
    $DotNet35Feature = Get-WindowsOptionalFeature -Online -FeatureName NetFx3 -ErrorAction SilentlyContinue

    if ($null -eq $DotNet35Feature -or $DotNet35Feature.State -ne 'Enabled') {
        Write-Host ".NET Framework 3.5 not found or not enabled"
        $AllInstalled = $false
    }
    else {
        Write-Host ".NET Framework 3.5 is installed and enabled"
    }
}
catch {
    Write-Host "Error checking .NET Framework 3.5: $($_.Exception.Message)"
    $AllInstalled = $false
}

# Check .NET Framework 4.8
try {
    $DotNetVersion = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue

    if ($null -eq $DotNetVersion -or $DotNetVersion.Release -lt 528040) {
        Write-Host ".NET Framework 4.8 not found"
        $AllInstalled = $false
    }
    else {
        Write-Host ".NET Framework 4.8 or higher is installed (Release: $($DotNetVersion.Release))"
    }
}
catch {
    Write-Host "Error checking .NET Framework: $($_.Exception.Message)"
    $AllInstalled = $false
}

# Check Visual C++ Redistributable
try {
    # Check for VC++ 2015-2022 (x64)
    $VCRedist_x64 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                                            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' |
                    Where-Object { $_.DisplayName -like "*Visual C++ 2015-2022 Redistributable*" -and $_.DisplayName -like "*x64*" }

    if ($null -eq $VCRedist_x64) {
        Write-Host "Visual C++ 2015-2022 Redistributable (x64) not found"
        $AllInstalled = $false
    }
    else {
        Write-Host "Visual C++ 2015-2022 Redistributable (x64) is installed"
    }

    # Check for VC++ 2015-2022 (x86)
    $VCRedist_x86 = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                                            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' |
                    Where-Object { $_.DisplayName -like "*Visual C++ 2015-2022 Redistributable*" -and $_.DisplayName -like "*x86*" }

    if ($null -eq $VCRedist_x86) {
        Write-Host "Visual C++ 2015-2022 Redistributable (x86) not found"
        $AllInstalled = $false
    }
    else {
        Write-Host "Visual C++ 2015-2022 Redistributable (x86) is installed"
    }
}
catch {
    Write-Host "Error checking Visual C++ Redistributable: $($_.Exception.Message)"
    $AllInstalled = $false
}

# Return exit code
if ($AllInstalled) {
    Write-Host "All required components are installed"
    exit 0
}
else {
    Write-Host "Not all required components are installed"
    exit 1
}
