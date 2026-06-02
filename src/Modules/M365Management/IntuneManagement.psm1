# Intune Management Module
# Manages devices, policies, apps, and compliance in Microsoft Intune

# Note: Authentication module must be imported before this module

$script:GraphBaseUri = "https://graph.microsoft.com/v1.0"
$script:GraphBetaUri = "https://graph.microsoft.com/beta"
$script:Cache = @{}

function Get-IntuneDevice {
    <#
    .SYNOPSIS
    Gets Intune managed devices

    .PARAMETER DeviceId
    Specific device ID

    .PARAMETER Filter
    OData filter query

    .PARAMETER Top
    Number of results to return
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$DeviceId,

        [Parameter(Mandatory = $false)]
        [string]$Filter,

        [Parameter(Mandatory = $false)]
        [int]$Top = 100
    )

    if ($DeviceId) {
        $uri = "$script:GraphBetaUri/deviceManagement/managedDevices/$DeviceId"
    }
    else {
        $uri = "$script:GraphBetaUri/deviceManagement/managedDevices?`$top=$Top"

        if ($Filter) {
            $uri += "&`$filter=$Filter"
        }
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-IntuneDeviceComplianceStatus {
    <#
    .SYNOPSIS
    Gets compliance status for a device

    .PARAMETER DeviceId
    Device ID
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeviceId
    )

    $uri = "$script:GraphBetaUri/deviceManagement/managedDevices/$DeviceId/deviceCompliancePolicyStates"
    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Sync-IntuneDevice {
    <#
    .SYNOPSIS
    Triggers a sync for an Intune managed device

    .PARAMETER DeviceId
    Device ID
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeviceId
    )

    $uri = "$script:GraphBetaUri/deviceManagement/managedDevices/$DeviceId/syncDevice"
    return Invoke-GraphRequest -Uri $uri -Method POST
}

function Restart-IntuneDevice {
    <#
    .SYNOPSIS
    Remotely restarts an Intune managed device

    .PARAMETER DeviceId
    Device ID
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeviceId
    )

    $uri = "$script:GraphBetaUri/deviceManagement/managedDevices/$DeviceId/rebootNow"
    return Invoke-GraphRequest -Uri $uri -Method POST
}

function Lock-IntuneDevice {
    <#
    .SYNOPSIS
    Remotely locks an Intune managed device

    .PARAMETER DeviceId
    Device ID
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeviceId
    )

    $uri = "$script:GraphBetaUri/deviceManagement/managedDevices/$DeviceId/remoteLock"
    return Invoke-GraphRequest -Uri $uri -Method POST
}

function Clear-IntuneDevice {
    <#
    .SYNOPSIS
    Wipes an Intune managed device

    .PARAMETER DeviceId
    Device ID

    .PARAMETER KeepEnrollmentData
    Keep enrollment data and user account

    .PARAMETER KeepUserData
    Keep user data (only for Windows devices)
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeviceId,

        [Parameter(Mandatory = $false)]
        [bool]$KeepEnrollmentData = $false,

        [Parameter(Mandatory = $false)]
        [bool]$KeepUserData = $false
    )

    $uri = "$script:GraphBetaUri/deviceManagement/managedDevices/$DeviceId/wipe"

    $body = @{
        keepEnrollmentData = $KeepEnrollmentData
        keepUserData       = $KeepUserData
    }

    return Invoke-GraphRequest -Uri $uri -Method POST -Body $body
}

function Remove-IntuneDevice {
    <#
    .SYNOPSIS
    Deletes a device from Intune

    .PARAMETER DeviceId
    Device ID
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DeviceId
    )

    $uri = "$script:GraphBetaUri/deviceManagement/managedDevices/$DeviceId"
    return Invoke-GraphRequest -Uri $uri -Method DELETE
}

function Get-IntuneDeviceConfiguration {
    <#
    .SYNOPSIS
    Gets device configuration policies

    .PARAMETER PolicyId
    Specific policy ID
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$PolicyId
    )

    if ($PolicyId) {
        $uri = "$script:GraphBetaUri/deviceManagement/deviceConfigurations/$PolicyId"
    }
    else {
        $uri = "$script:GraphBetaUri/deviceManagement/deviceConfigurations"
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-IntuneCompliancePolicy {
    <#
    .SYNOPSIS
    Gets device compliance policies

    .PARAMETER PolicyId
    Specific policy ID
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$PolicyId
    )

    if ($PolicyId) {
        $uri = "$script:GraphBetaUri/deviceManagement/deviceCompliancePolicies/$PolicyId"
    }
    else {
        $uri = "$script:GraphBetaUri/deviceManagement/deviceCompliancePolicies"
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-IntuneApplication {
    <#
    .SYNOPSIS
    Gets Intune managed applications

    .PARAMETER AppId
    Specific application ID

    .PARAMETER Filter
    OData filter query
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$AppId,

        [Parameter(Mandatory = $false)]
        [string]$Filter
    )

    if ($AppId) {
        $uri = "$script:GraphBetaUri/deviceAppManagement/mobileApps/$AppId"
    }
    else {
        $uri = "$script:GraphBetaUri/deviceAppManagement/mobileApps"

        if ($Filter) {
            $uri += "?`$filter=$Filter"
        }
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-IntuneApplicationStatus {
    <#
    .SYNOPSIS
    Gets installation status for an application

    .PARAMETER AppId
    Application ID
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$AppId
    )

    $uri = "$script:GraphBetaUri/deviceAppManagement/mobileApps/$AppId/deviceStatuses"
    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-IntuneManagedAppPolicy {
    <#
    .SYNOPSIS
    Gets managed app protection policies

    .PARAMETER PolicyId
    Specific policy ID
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$PolicyId
    )

    if ($PolicyId) {
        $uri = "$script:GraphBetaUri/deviceAppManagement/managedAppPolicies/$PolicyId"
    }
    else {
        $uri = "$script:GraphBetaUri/deviceAppManagement/managedAppPolicies"
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-IntuneAutopilotDevice {
    <#
    .SYNOPSIS
    Gets Windows Autopilot devices

    .PARAMETER DeviceId
    Specific device ID
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$DeviceId
    )

    if ($DeviceId) {
        $uri = "$script:GraphBetaUri/deviceManagement/windowsAutopilotDeviceIdentities/$DeviceId"
    }
    else {
        $uri = "$script:GraphBetaUri/deviceManagement/windowsAutopilotDeviceIdentities"
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Import-IntuneAutopilotDevice {
    <#
    .SYNOPSIS
    Imports a device into Windows Autopilot

    .PARAMETER SerialNumber
    Device serial number

    .PARAMETER HardwareHash
    Hardware hash

    .PARAMETER GroupTag
    Group tag for the device
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$SerialNumber,

        [Parameter(Mandatory = $true)]
        [string]$HardwareHash,

        [Parameter(Mandatory = $false)]
        [string]$GroupTag
    )

    $uri = "$script:GraphBetaUri/deviceManagement/importedWindowsAutopilotDeviceIdentities"

    $body = @{
        serialNumber = $SerialNumber
        hardwareIdentifier = $HardwareHash
    }

    if ($GroupTag) {
        $body.groupTag = $GroupTag
    }

    return Invoke-GraphRequest -Uri $uri -Method POST -Body $body
}

function Sync-IntuneAutopilot {
    <#
    .SYNOPSIS
    Triggers an Autopilot sync
    #>

    $uri = "$script:GraphBetaUri/deviceManagement/windowsAutopilotSettings/sync"
    return Invoke-GraphRequest -Uri $uri -Method POST
}

function Get-IntuneDashboard {
    <#
    .SYNOPSIS
    Gets a comprehensive Intune dashboard overview
    #>

    $dashboard = @{
        Timestamp = Get-Date
        Devices   = @{
            Total      = 0
            Compliant  = 0
            NonCompliant = 0
            Unknown    = 0
            ByPlatform = @{}
        }
        Policies  = @{
            Configuration = 0
            Compliance    = 0
            AppProtection = 0
        }
        Apps      = @{
            Total     = 0
            Installed = 0
            Failed    = 0
        }
        Autopilot = @{
            Total       = 0
            Registered  = 0
        }
    }

    try {
        # Get device counts
        $devices = (Invoke-GraphRequest -Uri "$script:GraphBetaUri/deviceManagement/managedDevices?`$top=999" -Method GET).value
        $dashboard.Devices.Total = $devices.Count
        $dashboard.Devices.Compliant = ($devices | Where-Object { $_.complianceState -eq 'compliant' }).Count
        $dashboard.Devices.NonCompliant = ($devices | Where-Object { $_.complianceState -eq 'noncompliant' }).Count
        $dashboard.Devices.Unknown = ($devices | Where-Object { $_.complianceState -eq 'unknown' -or $null -eq $_.complianceState }).Count

        # Group by platform
        $platformGroups = $devices | Group-Object -Property operatingSystem
        foreach ($group in $platformGroups) {
            $dashboard.Devices.ByPlatform[$group.Name] = $group.Count
        }

        # Get policy counts
        $configPolicies = Invoke-GraphRequest -Uri "$script:GraphBetaUri/deviceManagement/deviceConfigurations" -Method GET
        $dashboard.Policies.Configuration = $configPolicies.value.Count

        $compliancePolicies = Invoke-GraphRequest -Uri "$script:GraphBetaUri/deviceManagement/deviceCompliancePolicies" -Method GET
        $dashboard.Policies.Compliance = $compliancePolicies.value.Count

        # Get app counts
        $apps = Invoke-GraphRequest -Uri "$script:GraphBetaUri/deviceAppManagement/mobileApps?`$top=999" -Method GET
        $dashboard.Apps.Total = $apps.value.Count

        # Get Autopilot counts
        $autopilot = Invoke-GraphRequest -Uri "$script:GraphBetaUri/deviceManagement/windowsAutopilotDeviceIdentities?`$top=999" -Method GET
        $dashboard.Autopilot.Total = $autopilot.value.Count
        $dashboard.Autopilot.Registered = ($autopilot.value | Where-Object { $_.deploymentProfileAssignmentStatus -eq 'assigned' }).Count
    }
    catch {
        Write-Warning "Error gathering dashboard data: $_"
    }

    return $dashboard
}

# Export functions
Export-ModuleMember -Function @(
    'Get-IntuneDevice',
    'Get-IntuneDeviceComplianceStatus',
    'Sync-IntuneDevice',
    'Restart-IntuneDevice',
    'Lock-IntuneDevice',
    'Clear-IntuneDevice',
    'Remove-IntuneDevice',
    'Get-IntuneDeviceConfiguration',
    'Get-IntuneCompliancePolicy',
    'Get-IntuneApplication',
    'Get-IntuneApplicationStatus',
    'Get-IntuneManagedAppPolicy',
    'Get-IntuneAutopilotDevice',
    'Import-IntuneAutopilotDevice',
    'Sync-IntuneAutopilot',
    'Get-IntuneDashboard'
)
