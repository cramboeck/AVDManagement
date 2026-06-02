# Microsoft 365 Management Module
# Manages users, groups, licenses, and Office 365 services

# Note: Authentication module must be imported before this module

$script:GraphBaseUri = "https://graph.microsoft.com/v1.0"
$script:Cache = @{}

function Get-M365User {
    <#
    .SYNOPSIS
    Gets Microsoft 365 users

    .PARAMETER UserId
    Specific user ID or UPN

    .PARAMETER Filter
    OData filter query

    .PARAMETER Top
    Number of results to return
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$UserId,

        [Parameter(Mandatory = $false)]
        [string]$Filter,

        [Parameter(Mandatory = $false)]
        [int]$Top = 100
    )

    if ($UserId) {
        $uri = "$script:GraphBaseUri/users/$UserId"
    }
    else {
        $uri = "$script:GraphBaseUri/users?`$top=$Top"

        if ($Filter) {
            $uri += "&`$filter=$Filter"
        }
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function New-M365User {
    <#
    .SYNOPSIS
    Creates a new Microsoft 365 user

    .PARAMETER DisplayName
    User's display name

    .PARAMETER UserPrincipalName
    User's UPN

    .PARAMETER MailNickname
    Mail nickname

    .PARAMETER Password
    Initial password
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DisplayName,

        [Parameter(Mandatory = $true)]
        [string]$UserPrincipalName,

        [Parameter(Mandatory = $true)]
        [string]$MailNickname,

        [Parameter(Mandatory = $true)]
        [string]$Password
    )

    $uri = "$script:GraphBaseUri/users"

    $body = @{
        accountEnabled    = $true
        displayName       = $DisplayName
        userPrincipalName = $UserPrincipalName
        mailNickname      = $MailNickname
        passwordProfile   = @{
            password                      = $Password
            forceChangePasswordNextSignIn = $true
        }
    }

    return Invoke-GraphRequest -Uri $uri -Method POST -Body $body
}

function Set-M365User {
    <#
    .SYNOPSIS
    Updates a Microsoft 365 user

    .PARAMETER UserId
    User ID or UPN

    .PARAMETER Properties
    Hashtable of properties to update
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$UserId,

        [Parameter(Mandatory = $true)]
        [hashtable]$Properties
    )

    $uri = "$script:GraphBaseUri/users/$UserId"
    return Invoke-GraphRequest -Uri $uri -Method PATCH -Body $Properties
}

function Remove-M365User {
    <#
    .SYNOPSIS
    Deletes a Microsoft 365 user

    .PARAMETER UserId
    User ID or UPN
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$UserId
    )

    $uri = "$script:GraphBaseUri/users/$UserId"
    return Invoke-GraphRequest -Uri $uri -Method DELETE
}

function Get-M365Group {
    <#
    .SYNOPSIS
    Gets Microsoft 365 groups

    .PARAMETER GroupId
    Specific group ID

    .PARAMETER Filter
    OData filter query
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$GroupId,

        [Parameter(Mandatory = $false)]
        [string]$Filter
    )

    if ($GroupId) {
        $uri = "$script:GraphBaseUri/groups/$GroupId"
    }
    else {
        $uri = "$script:GraphBaseUri/groups"

        if ($Filter) {
            $uri += "?`$filter=$Filter"
        }
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function New-M365Group {
    <#
    .SYNOPSIS
    Creates a new Microsoft 365 group

    .PARAMETER DisplayName
    Group display name

    .PARAMETER MailNickname
    Mail nickname

    .PARAMETER Description
    Group description

    .PARAMETER GroupType
    Type of group (Microsoft365, Security, Distribution)
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$DisplayName,

        [Parameter(Mandatory = $true)]
        [string]$MailNickname,

        [Parameter(Mandatory = $false)]
        [string]$Description,

        [Parameter(Mandatory = $false)]
        [ValidateSet('Microsoft365', 'Security', 'Distribution')]
        [string]$GroupType = 'Microsoft365'
    )

    $uri = "$script:GraphBaseUri/groups"

    $body = @{
        displayName     = $DisplayName
        mailNickname    = $MailNickname
        mailEnabled     = ($GroupType -eq 'Microsoft365' -or $GroupType -eq 'Distribution')
        securityEnabled = ($GroupType -eq 'Security' -or $GroupType -eq 'Microsoft365')
    }

    if ($Description) {
        $body.description = $Description
    }

    if ($GroupType -eq 'Microsoft365') {
        $body.groupTypes = @('Unified')
    }

    return Invoke-GraphRequest -Uri $uri -Method POST -Body $body
}

function Add-M365GroupMember {
    <#
    .SYNOPSIS
    Adds a member to a group

    .PARAMETER GroupId
    Group ID

    .PARAMETER UserId
    User ID to add
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$GroupId,

        [Parameter(Mandatory = $true)]
        [string]$UserId
    )

    $uri = "$script:GraphBaseUri/groups/$GroupId/members/`$ref"

    $body = @{
        "@odata.id" = "$script:GraphBaseUri/directoryObjects/$UserId"
    }

    return Invoke-GraphRequest -Uri $uri -Method POST -Body $body
}

function Remove-M365GroupMember {
    <#
    .SYNOPSIS
    Removes a member from a group

    .PARAMETER GroupId
    Group ID

    .PARAMETER UserId
    User ID to remove
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$GroupId,

        [Parameter(Mandatory = $true)]
        [string]$UserId
    )

    $uri = "$script:GraphBaseUri/groups/$GroupId/members/$UserId/`$ref"
    return Invoke-GraphRequest -Uri $uri -Method DELETE
}

function Get-M365License {
    <#
    .SYNOPSIS
    Gets available licenses in the tenant
    #>

    $uri = "$script:GraphBaseUri/subscribedSkus"
    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-M365UserLicense {
    <#
    .SYNOPSIS
    Gets licenses assigned to a user

    .PARAMETER UserId
    User ID or UPN
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$UserId
    )

    $uri = "$script:GraphBaseUri/users/$UserId/licenseDetails"
    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Set-M365UserLicense {
    <#
    .SYNOPSIS
    Assigns licenses to a user

    .PARAMETER UserId
    User ID or UPN

    .PARAMETER AddLicenses
    Array of license SKU IDs to add

    .PARAMETER RemoveLicenses
    Array of license SKU IDs to remove
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$UserId,

        [Parameter(Mandatory = $false)]
        [string[]]$AddLicenses,

        [Parameter(Mandatory = $false)]
        [string[]]$RemoveLicenses
    )

    $uri = "$script:GraphBaseUri/users/$UserId/assignLicense"

    $body = @{
        addLicenses    = @()
        removeLicenses = @()
    }

    if ($AddLicenses) {
        foreach ($sku in $AddLicenses) {
            $body.addLicenses += @{ skuId = $sku }
        }
    }

    if ($RemoveLicenses) {
        $body.removeLicenses = $RemoveLicenses
    }

    return Invoke-GraphRequest -Uri $uri -Method POST -Body $body
}

function Get-M365AuditLog {
    <#
    .SYNOPSIS
    Gets audit log entries

    .PARAMETER StartDate
    Start date for audit logs

    .PARAMETER EndDate
    End date for audit logs

    .PARAMETER RecordType
    Type of audit record
    #>
    param(
        [Parameter(Mandatory = $false)]
        [datetime]$StartDate = (Get-Date).AddDays(-1),

        [Parameter(Mandatory = $false)]
        [datetime]$EndDate = (Get-Date),

        [Parameter(Mandatory = $false)]
        [string]$RecordType
    )

    $uri = "$script:GraphBaseUri/auditLogs/directoryAudits?`$filter=activityDateTime ge $($StartDate.ToString('yyyy-MM-dd')) and activityDateTime le $($EndDate.ToString('yyyy-MM-dd'))"

    if ($RecordType) {
        $uri += " and activityDisplayName eq '$RecordType'"
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-M365SignInLog {
    <#
    .SYNOPSIS
    Gets sign-in logs

    .PARAMETER UserId
    Filter by user ID

    .PARAMETER Top
    Number of results
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$UserId,

        [Parameter(Mandatory = $false)]
        [int]$Top = 100
    )

    $uri = "$script:GraphBaseUri/auditLogs/signIns?`$top=$Top"

    if ($UserId) {
        $uri += "&`$filter=userId eq '$UserId'"
    }

    return Invoke-GraphRequest -Uri $uri -Method GET
}

function Get-M365Dashboard {
    <#
    .SYNOPSIS
    Gets a comprehensive M365 dashboard overview
    #>

    $dashboard = @{
        Timestamp = Get-Date
        Users     = @{
            Total    = 0
            Active   = 0
            Guests   = 0
            Licensed = 0
        }
        Groups    = @{
            Total        = 0
            Microsoft365 = 0
            Security     = 0
        }
        Licenses  = @{
            Total     = 0
            Consumed  = 0
            Available = 0
            Details   = @()
        }
    }

    try {
        # Get user counts
        $users = (Invoke-GraphRequest -Uri "$script:GraphBaseUri/users?`$top=999&`$select=id,userType,assignedLicenses,accountEnabled" -Method GET).value
        $dashboard.Users.Total = $users.Count
        $dashboard.Users.Active = ($users | Where-Object { $_.accountEnabled }).Count
        $dashboard.Users.Guests = ($users | Where-Object { $_.userType -eq 'Guest' }).Count
        $dashboard.Users.Licensed = ($users | Where-Object { $_.assignedLicenses.Count -gt 0 }).Count

        # Get group counts
        $groups = (Invoke-GraphRequest -Uri "$script:GraphBaseUri/groups?`$top=999" -Method GET).value
        $dashboard.Groups.Total = $groups.Count
        $dashboard.Groups.Microsoft365 = ($groups | Where-Object { $_.groupTypes -contains 'Unified' }).Count
        $dashboard.Groups.Security = ($groups | Where-Object { $_.securityEnabled -and $_.groupTypes -notcontains 'Unified' }).Count

        # Get license information
        $licenses = (Invoke-GraphRequest -Uri "$script:GraphBaseUri/subscribedSkus" -Method GET).value
        foreach ($license in $licenses) {
            $total = $license.prepaidUnits.enabled
            $consumed = $license.consumedUnits

            $dashboard.Licenses.Total += $total
            $dashboard.Licenses.Consumed += $consumed
            $dashboard.Licenses.Available += ($total - $consumed)

            $dashboard.Licenses.Details += @{
                Name      = $license.skuPartNumber
                Total     = $total
                Consumed  = $consumed
                Available = ($total - $consumed)
            }
        }
    }
    catch {
        Write-Warning "Error gathering dashboard data: $_"
    }

    return $dashboard
}

# Export functions
Export-ModuleMember -Function @(
    'Get-M365User',
    'New-M365User',
    'Set-M365User',
    'Remove-M365User',
    'Get-M365Group',
    'New-M365Group',
    'Add-M365GroupMember',
    'Remove-M365GroupMember',
    'Get-M365License',
    'Get-M365UserLicense',
    'Set-M365UserLicense',
    'Get-M365AuditLog',
    'Get-M365SignInLog',
    'Get-M365Dashboard'
)
