<#
.SYNOPSIS
    Azure Virtual Desktop Management Module

.DESCRIPTION
    Provides comprehensive management capabilities for Azure Virtual Desktop including:
    - Host Pool management
    - Session Host operations (start, stop, restart, drain mode)
    - User Session management (disconnect, logoff, messaging)
    - Image creation and management
    - Dashboard and monitoring functions

.NOTES
    Version:        1.0.0
    Author:         Cloud Management Portal
    Creation Date:  2024
    Dependencies:   Authentication Module
#>

# Note: Authentication module must be imported before this module

#region Module Variables

# Microsoft Graph API base URI
$script:GraphBaseUri = "https://graph.microsoft.com/v1.0"

# Azure Resource Manager API base URI
$script:ArmBaseUri = "https://management.azure.com"

# Application configuration
$script:Config = $null

# Cache for performance optimization
$script:Cache = @{}

#endregion

#region Initialization Functions

function Initialize-AVDManagement {
    <#
    .SYNOPSIS
        Initializes the AVD Management module with configuration

    .DESCRIPTION
        Loads configuration from JSON file containing Azure subscription details
        and AVD-specific settings required for resource management

    .PARAMETER ConfigPath
        Path to the configuration file (default: config/appsettings.json)

    .EXAMPLE
        Initialize-AVDManagement -ConfigPath "config/appsettings.json"

    .NOTES
        Must be called before using any other AVD management functions
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [string]$ConfigPath = "config/appsettings.json"
    )

    if (Test-Path $ConfigPath) {
        $script:Config = Get-Content $ConfigPath | ConvertFrom-Json
        Write-Verbose "AVD Management configuration loaded successfully from: $ConfigPath"
    }
    else {
        throw "Configuration file not found: $ConfigPath. Please ensure the file exists."
    }
}

#endregion

#region Host Pool Management Functions

function Get-AVDHostPool {
    <#
    .SYNOPSIS
        Retrieves Azure Virtual Desktop host pools

    .DESCRIPTION
        Gets one or all AVD host pools from the configured resource group.
        Supports caching for improved performance.

    .PARAMETER HostPoolName
        Specific host pool name to retrieve (optional)

    .PARAMETER UseCache
        Use cached results if available (default: false)

    .EXAMPLE
        Get-AVDHostPool
        Gets all host pools in the configured resource group

    .EXAMPLE
        Get-AVDHostPool -HostPoolName "Production-HostPool"
        Gets a specific host pool by name

    .OUTPUTS
        System.Object
        Returns host pool information
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [string]$HostPoolName,

        [Parameter(Mandatory = $false)]
        [switch]$UseCache
    )

    $cacheKey = "HostPools_$HostPoolName"

    # Check cache if enabled
    if ($UseCache -and $script:Cache.ContainsKey($cacheKey)) {
        $cached = $script:Cache[$cacheKey]
        if ($cached.Timestamp -gt (Get-Date).AddMinutes(-5)) {
            Write-Verbose "Returning cached host pool data"
            return $cached.Data
        }
    }

    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    # Build API URI
    if ($HostPoolName) {
        $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName`?api-version=2022-09-09"
    }
    else {
        $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools?api-version=2022-09-09"
    }

    Write-Verbose "Fetching host pool(s) from: $uri"
    $result = Invoke-AzureRequest -Uri $uri -Method GET

    # Cache the result
    $script:Cache[$cacheKey] = @{
        Data      = $result
        Timestamp = Get-Date
    }

    return $result
}

#endregion

#region Session Host Management Functions

function Get-AVDSessionHost {
    <#
    .SYNOPSIS
        Retrieves session hosts from an AVD host pool

    .DESCRIPTION
        Gets one or all session hosts within a specified host pool

    .PARAMETER HostPoolName
        Host pool name (required)

    .PARAMETER SessionHostName
        Specific session host name (optional)

    .EXAMPLE
        Get-AVDSessionHost -HostPoolName "Production-HostPool"
        Gets all session hosts in the specified host pool

    .OUTPUTS
        System.Object
        Returns session host information including status and sessions
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $false)]
        [string]$SessionHostName
    )

    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    # Build API URI
    if ($SessionHostName) {
        $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/sessionHosts/$SessionHostName`?api-version=2022-09-09"
    }
    else {
        $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/sessionHosts?api-version=2022-09-09"
    }

    Write-Verbose "Fetching session host(s) from: $uri"
    return Invoke-AzureRequest -Uri $uri -Method GET
}

function Start-AVDSessionHost {
    <#
    .SYNOPSIS
        Starts a stopped AVD session host virtual machine

    .DESCRIPTION
        Initiates a start operation on the underlying VM of a session host

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host name

    .EXAMPLE
        Start-AVDSessionHost -HostPoolName "Production-HostPool" -SessionHostName "host01.domain.com"

    .OUTPUTS
        System.Object
        Returns the operation result
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName
    )

    # Extract VM name from session host name (format: hostpool/vmname.domain)
    $vmName = ($SessionHostName -split '\.')[0]
    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.Compute/virtualMachines/$vmName/start?api-version=2023-03-01"

    Write-Verbose "Starting session host VM: $vmName"
    return Invoke-AzureRequest -Uri $uri -Method POST
}

function Stop-AVDSessionHost {
    <#
    .SYNOPSIS
        Stops a running AVD session host virtual machine

    .DESCRIPTION
        Initiates a stop operation on the underlying VM of a session host.
        Can perform either graceful deallocate or forced power off.

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host name

    .PARAMETER Force
        Force shutdown without graceful shutdown (default: false)

    .EXAMPLE
        Stop-AVDSessionHost -HostPoolName "Production-HostPool" -SessionHostName "host01.domain.com"

    .OUTPUTS
        System.Object
        Returns the operation result
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName,

        [Parameter(Mandatory = $false)]
        [switch]$Force
    )

    $vmName = ($SessionHostName -split '\.')[0]
    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    # Use powerOff for force, deallocate for graceful
    $action = if ($Force) { "powerOff" } else { "deallocate" }
    $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.Compute/virtualMachines/$vmName/$action`?api-version=2023-03-01"

    Write-Verbose "Stopping session host VM: $vmName (Action: $action)"
    return Invoke-AzureRequest -Uri $uri -Method POST
}

function Restart-AVDSessionHost {
    <#
    .SYNOPSIS
        Restarts an AVD session host virtual machine

    .DESCRIPTION
        Initiates a restart operation on the underlying VM of a session host

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host name

    .EXAMPLE
        Restart-AVDSessionHost -HostPoolName "Production-HostPool" -SessionHostName "host01.domain.com"

    .OUTPUTS
        System.Object
        Returns the operation result
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName
    )

    $vmName = ($SessionHostName -split '\.')[0]
    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.Compute/virtualMachines/$vmName/restart?api-version=2023-03-01"

    Write-Verbose "Restarting session host VM: $vmName"
    return Invoke-AzureRequest -Uri $uri -Method POST
}

function Set-AVDSessionHostDrainMode {
    <#
    .SYNOPSIS
        Enables or disables drain mode on a session host

    .DESCRIPTION
        Drain mode prevents new user sessions from connecting to a session host,
        allowing existing sessions to complete before maintenance or shutdown.

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host name

    .PARAMETER Enable
        Enable drain mode (true) or disable (false)

    .EXAMPLE
        Set-AVDSessionHostDrainMode -HostPoolName "Production-HostPool" -SessionHostName "host01.domain.com" -Enable $true
        Enables drain mode

    .EXAMPLE
        Set-AVDSessionHostDrainMode -HostPoolName "Production-HostPool" -SessionHostName "host01.domain.com" -Enable $false
        Disables drain mode

    .OUTPUTS
        System.Object
        Returns the updated session host configuration
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName,

        [Parameter(Mandatory = $true)]
        [bool]$Enable
    )

    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/sessionHosts/$SessionHostName`?api-version=2022-09-09"

    $body = @{
        properties = @{
            allowNewSession = -not $Enable
        }
    }

    $action = if ($Enable) { "Enabling" } else { "Disabling" }
    Write-Verbose "$action drain mode for session host: $SessionHostName"
    return Invoke-AzureRequest -Uri $uri -Method PATCH -Body $body
}

#endregion

#region User Session Management Functions

function Get-AVDUserSession {
    <#
    .SYNOPSIS
        Retrieves active user sessions from an AVD host pool

    .DESCRIPTION
        Gets all user sessions within a host pool or specific session host

    .PARAMETER HostPoolName
        Host pool name (required)

    .PARAMETER SessionHostName
        Filter by specific session host (optional)

    .EXAMPLE
        Get-AVDUserSession -HostPoolName "Production-HostPool"
        Gets all user sessions across the host pool

    .OUTPUTS
        System.Object
        Returns user session information including state and user details
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $false)]
        [string]$SessionHostName
    )

    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    if ($SessionHostName) {
        $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/sessionHosts/$SessionHostName/userSessions?api-version=2022-09-09"
    }
    else {
        $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/userSessions?api-version=2022-09-09"
    }

    Write-Verbose "Fetching user sessions from: $uri"
    return Invoke-AzureRequest -Uri $uri -Method GET
}

function Disconnect-AVDUserSession {
    <#
    .SYNOPSIS
        Disconnects a user session without logging off the user

    .DESCRIPTION
        Disconnects the remote session but leaves applications running.
        User can reconnect to the same session later.

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host name

    .PARAMETER SessionId
        User session ID

    .EXAMPLE
        Disconnect-AVDUserSession -HostPoolName "Production-HostPool" -SessionHostName "host01.domain.com" -SessionId "2"

    .OUTPUTS
        System.Object
        Returns the operation result
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionId
    )

    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/sessionHosts/$SessionHostName/userSessions/$SessionId/disconnect?api-version=2022-09-09"

    Write-Verbose "Disconnecting user session: $SessionId on $SessionHostName"
    return Invoke-AzureRequest -Uri $uri -Method POST
}

function Remove-AVDUserSession {
    <#
    .SYNOPSIS
        Logs off a user session (force logoff)

    .DESCRIPTION
        Forcefully logs off a user, terminating all applications and closing the session.
        This action cannot be undone and may result in data loss.

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host name

    .PARAMETER SessionId
        User session ID

    .EXAMPLE
        Remove-AVDUserSession -HostPoolName "Production-HostPool" -SessionHostName "host01.domain.com" -SessionId "2"

    .OUTPUTS
        System.Object
        Returns the operation result
    #>
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionId
    )

    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/sessionHosts/$SessionHostName/userSessions/$SessionId`?api-version=2022-09-09"

    if ($PSCmdlet.ShouldProcess("Session $SessionId on $SessionHostName", "Force Logoff")) {
        Write-Verbose "Logging off user session: $SessionId on $SessionHostName"
        return Invoke-AzureRequest -Uri $uri -Method DELETE
    }
}

function Send-AVDUserSessionMessage {
    <#
    .SYNOPSIS
        Sends a message to a user session

    .DESCRIPTION
        Displays a message dialog to the user in their remote session.
        Useful for sending notifications or warnings before maintenance.

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host name

    .PARAMETER SessionId
        User session ID

    .PARAMETER MessageTitle
        Message title

    .PARAMETER MessageBody
        Message body text

    .EXAMPLE
        Send-AVDUserSessionMessage -HostPoolName "Prod" -SessionHostName "host01" -SessionId "2" -MessageTitle "Maintenance" -MessageBody "System will restart in 10 minutes"

    .OUTPUTS
        System.Object
        Returns the operation result
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionId,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$MessageTitle,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$MessageBody
    )

    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    $uri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$HostPoolName/sessionHosts/$SessionHostName/userSessions/$SessionId/sendMessage?api-version=2022-09-09"

    $body = @{
        messageTitle = $MessageTitle
        messageBody  = $MessageBody
    }

    Write-Verbose "Sending message to session: $SessionId on $SessionHostName"
    return Invoke-AzureRequest -Uri $uri -Method POST -Body $body
}

#endregion

#region Image Management Functions

function New-AVDImage {
    <#
    .SYNOPSIS
        Creates a new VM image from a session host

    .DESCRIPTION
        Captures a generalized image from a session host VM.
        The source VM must be prepared with sysprep before capturing.

    .PARAMETER HostPoolName
        Host pool name

    .PARAMETER SessionHostName
        Session host to capture

    .PARAMETER ImageName
        Name for the new image

    .PARAMETER ImageResourceGroup
        Resource group for the image (defaults to AVD resource group)

    .EXAMPLE
        New-AVDImage -HostPoolName "Prod" -SessionHostName "host01" -ImageName "Win11-Prod-v1.0"

    .OUTPUTS
        System.Object
        Returns the created image resource
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$HostPoolName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$SessionHostName,

        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$ImageName,

        [Parameter(Mandatory = $false)]
        [string]$ImageResourceGroup
    )

    if (-not $ImageResourceGroup) {
        $ImageResourceGroup = $script:Config.AVD.ResourceGroup
    }

    $vmName = ($SessionHostName -split '\.')[0]
    $subscriptionId = $script:Config.AVD.SubscriptionId
    $resourceGroup = $script:Config.AVD.ResourceGroup

    # Get VM details
    $vmUri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.Compute/virtualMachines/$vmName`?api-version=2023-03-01"
    Write-Verbose "Fetching VM details for: $vmName"
    $vm = Invoke-AzureRequest -Uri $vmUri -Method GET

    # Create image from VM
    $imageUri = "$script:ArmBaseUri/subscriptions/$subscriptionId/resourceGroups/$ImageResourceGroup/providers/Microsoft.Compute/images/$ImageName`?api-version=2023-03-01"

    $imageBody = @{
        location   = $vm.location
        properties = @{
            sourceVirtualMachine = @{
                id = $vm.id
            }
        }
    }

    Write-Verbose "Creating image: $ImageName from VM: $vmName"
    return Invoke-AzureRequest -Uri $imageUri -Method PUT -Body $imageBody
}

#endregion

#region Dashboard and Monitoring Functions

function Get-AVDDashboard {
    <#
    .SYNOPSIS
        Gets comprehensive AVD dashboard overview

    .DESCRIPTION
        Retrieves aggregated statistics and health information across all
        host pools, session hosts, and active sessions. Useful for monitoring
        and capacity planning.

    .PARAMETER HostPoolName
        Filter by specific host pool (optional, defaults to all)

    .EXAMPLE
        Get-AVDDashboard
        Gets dashboard data for all host pools

    .EXAMPLE
        Get-AVDDashboard -HostPoolName "Production-HostPool"
        Gets dashboard data for a specific host pool

    .OUTPUTS
        System.Object
        Returns dashboard object with aggregated statistics
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [string]$HostPoolName
    )

    $dashboard = @{
        Timestamp      = Get-Date
        HostPools      = @()
        TotalHosts     = 0
        ActiveHosts    = 0
        TotalSessions  = 0
        ActiveSessions = 0
    }

    # Get host pools
    $hostPools = if ($HostPoolName) {
        @(Get-AVDHostPool -HostPoolName $HostPoolName)
    }
    else {
        (Get-AVDHostPool).value
    }

    # Process each host pool
    foreach ($pool in $hostPools) {
        $poolName = $pool.name
        Write-Verbose "Processing host pool: $poolName"
        $sessionHosts = (Get-AVDSessionHost -HostPoolName $poolName).value

        $poolData = @{
            Name           = $poolName
            Type           = $pool.properties.hostPoolType
            LoadBalancer   = $pool.properties.loadBalancerType
            MaxSessions    = $pool.properties.maxSessionLimit
            SessionHosts   = @()
            TotalHosts     = $sessionHosts.Count
            ActiveHosts    = ($sessionHosts | Where-Object { $_.properties.status -eq 'Available' }).Count
            DrainModeHosts = ($sessionHosts | Where-Object { $_.properties.allowNewSession -eq $false }).Count
            ActiveSessions = 0
        }

        # Process each session host
        foreach ($host in $sessionHosts) {
            $hostData = @{
                Name            = $host.name
                Status          = $host.properties.status
                AllowNewSession = $host.properties.allowNewSession
                Sessions        = $host.properties.sessions
                LastHeartBeat   = $host.properties.lastHeartBeat
            }
            $poolData.SessionHosts += $hostData
            $poolData.ActiveSessions += $host.properties.sessions
        }

        $dashboard.HostPools += $poolData
        $dashboard.TotalHosts += $poolData.TotalHosts
        $dashboard.ActiveHosts += $poolData.ActiveHosts
        $dashboard.TotalSessions += $poolData.ActiveSessions
    }

    Write-Verbose "Dashboard compiled: $($dashboard.TotalHosts) hosts, $($dashboard.TotalSessions) sessions"
    return $dashboard
}

#endregion

#region Module Exports

# Export public functions
Export-ModuleMember -Function @(
    'Initialize-AVDManagement',
    'Get-AVDHostPool',
    'Get-AVDSessionHost',
    'Get-AVDUserSession',
    'Disconnect-AVDUserSession',
    'Remove-AVDUserSession',
    'Send-AVDUserSessionMessage',
    'Set-AVDSessionHostDrainMode',
    'Start-AVDSessionHost',
    'Stop-AVDSessionHost',
    'Restart-AVDSessionHost',
    'New-AVDImage',
    'Get-AVDDashboard'
)

#endregion
