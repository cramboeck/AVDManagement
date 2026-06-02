<#
.SYNOPSIS
    Detection script for Windows 11 localization configuration (Intune Win32 app).

.DESCRIPTION
    Checks if localization has been configured by verifying registry marker.
    Returns exit code 0 if configured, exit code 1 if not configured.

.NOTES
    Version:        1.0
    Author:         Autopilot Deployment Team
    Creation Date:  2025-10-26

    Intune Detection Rule:
    - Use this script as custom detection script for Win32 app
    - Exit code 0 = Detected (configured)
    - Exit code 1 = Not detected (needs configuration)
#>

try {
    $MarkerPath = "HKLM:\SOFTWARE\AutopilotDeployment\Localization"

    # Check if marker exists
    if (Test-Path $MarkerPath) {
        $CountryCode = (Get-ItemProperty -Path $MarkerPath -Name "CountryCode" -ErrorAction SilentlyContinue).CountryCode
        $ConfiguredDate = (Get-ItemProperty -Path $MarkerPath -Name "ConfiguredDate" -ErrorAction SilentlyContinue).ConfiguredDate

        if ($CountryCode) {
            Write-Output "Localization configured for country: $CountryCode on $ConfiguredDate"
            exit 0  # Detected
        }
    }

    Write-Output "Localization not configured"
    exit 1  # Not detected
}
catch {
    Write-Output "Detection failed: $($_.Exception.Message)"
    exit 1  # Not detected
}
