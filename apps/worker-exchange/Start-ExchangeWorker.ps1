<#
.SYNOPSIS
    ZeroStress Cockpit Exchange worker: runs mailbox operations through Exchange Online PowerShell.

.DESCRIPTION
    Polls the Cockpit API for Exchange jobs, connects to the customer tenant
    with app-only certificate authentication (Exchange.ManageAsApp), executes
    exactly one named operation from a fixed list and reports the result.
    No free-form PowerShell ever comes from the API. The certificate stays on
    this machine; the API only knows the worker token.

    Windows PowerShell 5.1 or PowerShell 7 with the ExchangeOnlineManagement
    module (3.x). ASCII only, no aliases.

.PARAMETER ConfigPath
    Path to worker.config.json (see worker.config.example.json).

.PARAMETER Once
    Process at most one job, then exit.
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path -Path $PSScriptRoot -ChildPath 'worker.config.json'),
    [switch]$Once
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$script:LogLines = New-Object -TypeName System.Collections.Generic.List[string]
$script:Config = $null
$script:Token = $null
$script:Connected = $null

$IdentityPattern = '^[^\s@\\/]{1,64}@[A-Za-z0-9.-]{1,255}$'
$QuotaPattern = '^[0-9]{1,3}(\.[0-9])?GB$'
$MaxFactsMailboxes = 2000
$MaxPermissionMailboxes = 500

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] [' + $Level + '] ' + $Message
    $script:LogLines.Add($line)
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red }
    elseif ($Level -eq 'WARN') { Write-Host $line -ForegroundColor Yellow }
    else { Write-Host $line }
}

function Read-Config {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw ('Config not found: ' + $Path + ' (copy worker.config.example.json)') }
    $cfg = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $Path -Raw)
    foreach ($name in @('apiUrl', 'appId')) {
        if (-not ($cfg.PSObject.Properties.Name -contains $name) -or [string]::IsNullOrWhiteSpace([string]$cfg.$name)) { throw ('Config value missing: ' + $name) }
    }
    $hasThumb = ($cfg.PSObject.Properties.Name -contains 'certificateThumbprint') -and -not [string]::IsNullOrWhiteSpace([string]$cfg.certificateThumbprint)
    $hasFile = ($cfg.PSObject.Properties.Name -contains 'certificateFilePath') -and -not [string]::IsNullOrWhiteSpace([string]$cfg.certificateFilePath)
    if (-not $hasThumb -and -not $hasFile) { throw 'Config needs certificateThumbprint (Windows cert store) or certificateFilePath (.pfx, password from ZSC_EXO_CERT_PASSWORD)' }
    if (-not $hasThumb) { Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'certificateThumbprint' -Value $null -Force }
    if (-not $hasFile) { Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'certificateFilePath' -Value $null -Force }
    if (-not ($cfg.PSObject.Properties.Name -contains 'workerId') -or [string]::IsNullOrWhiteSpace([string]$cfg.workerId)) {
        Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'workerId' -Value ('EXO-' + $env:COMPUTERNAME) -Force
    }
    if (-not ($cfg.PSObject.Properties.Name -contains 'pollSeconds') -or -not $cfg.pollSeconds) { Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'pollSeconds' -Value 30 -Force }
    if ($cfg.workerId -notmatch '^[A-Za-z0-9._-]{1,100}$') { throw 'workerId may only contain letters, digits, dot, underscore and dash' }
    $cfg.apiUrl = ([string]$cfg.apiUrl).TrimEnd('/')
    if ($cfg.apiUrl -notmatch '^https://' -and $cfg.apiUrl -notmatch '^http://(localhost|127\.0\.0\.1)') { throw 'apiUrl must use https (http only for localhost)' }
    if ($cfg.appId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'appId must be the application (client) id GUID' }
    return $cfg
}

function Read-Token {
    if (-not [string]::IsNullOrWhiteSpace($env:ZSC_WORKER_TOKEN)) { return $env:ZSC_WORKER_TOKEN }
    $tokenFile = Join-Path -Path $PSScriptRoot -ChildPath 'worker.token'
    if ((Test-Path -LiteralPath $tokenFile -PathType Leaf) -and ($env:OS -eq 'Windows_NT')) {
        $secure = ConvertTo-SecureString -String (Get-Content -LiteralPath $tokenFile -Raw).Trim()
        $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    throw 'No worker token: set ZSC_WORKER_TOKEN or run Set-WorkerToken.ps1 (Windows)'
}

function Invoke-Api {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [object]$Body = $null
    )
    $params = @{
        Method = $Method
        Uri = ($script:Config.apiUrl + $Path)
        Headers = @{ 'Authorization' = ('Bearer ' + $script:Token); 'X-Worker-Id' = [string]$script:Config.workerId }
        UseBasicParsing = $true
        TimeoutSec = 600
    }
    if ($null -ne $Body) {
        $params['Body'] = (ConvertTo-Json -InputObject $Body -Depth 8 -Compress)
        $params['ContentType'] = 'application/json; charset=utf-8'
    }
    $response = Invoke-WebRequest @params
    if ($response.StatusCode -eq 204 -or [string]::IsNullOrWhiteSpace($response.Content)) { return $null }
    return ConvertFrom-Json -InputObject $response.Content
}

function Send-JobLog {
    param([string]$JobId, [string]$Message)
    try { Invoke-Api -Method 'POST' -Path ('/worker/exchange/' + $JobId + '/log') -Body @{ message = $Message } | Out-Null }
    catch { Write-Log -Message ('Progress report failed: ' + $_.Exception.Message) -Level 'WARN' }
}

function Write-Step {
    param([string]$JobId, [string]$Message)
    Write-Log -Message $Message
    Send-JobLog -JobId $JobId -Message $Message
}

function Connect-Tenant {
    param([string]$Organization)
    if ($script:Connected -eq $Organization) { return }
    Disconnect-Tenant
    $connectParams = @{ AppId = [string]$script:Config.appId; Organization = $Organization; ShowBanner = $false }
    if ($script:Config.certificateThumbprint) {
        $connectParams['CertificateThumbprint'] = [string]$script:Config.certificateThumbprint
    }
    else {
        $password = $env:ZSC_EXO_CERT_PASSWORD
        if ([string]::IsNullOrEmpty($password)) { throw 'ZSC_EXO_CERT_PASSWORD is required for certificateFilePath' }
        $connectParams['CertificateFilePath'] = [string]$script:Config.certificateFilePath
        $connectParams['CertificatePassword'] = (ConvertTo-SecureString -String $password -AsPlainText -Force)
    }
    Connect-ExchangeOnline @connectParams
    $script:Connected = $Organization
}

function Disconnect-Tenant {
    if ($null -ne $script:Connected) {
        try { Disconnect-ExchangeOnline -Confirm:$false | Out-Null } catch { }
        $script:Connected = $null
    }
}

function Assert-Identity {
    param([string]$Value, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch $IdentityPattern) { throw ($Label + ' invalid') }
    return $Value.Trim().ToLowerInvariant()
}

function Get-Param {
    param([object]$Parameters, [string]$Name)
    if ($Parameters.PSObject.Properties.Name -contains $Name) { return $Parameters.$Name }
    return $null
}

function Get-QuotaText {
    param([object]$Value)
    if ($null -eq $Value) { return $null }
    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return (($text -split ' \(')[0]).Trim()
}

function ConvertTo-Addresses {
    param([object]$Value)
    $list = New-Object -TypeName System.Collections.Generic.List[string]
    if ($null -eq $Value) { return $list }
    foreach ($item in @($Value)) {
        $text = [string]$item
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        if ($text -like 'NT AUTHORITY\*' -or $text -like 'S-1-5-*') { continue }
        $list.Add($text.Trim().ToLowerInvariant())
    }
    return $list
}

function Invoke-CollectFacts {
    param([string]$JobId)
    Write-Step -JobId $JobId -Message 'Reading mailboxes'
    $properties = @('UserPrincipalName', 'DisplayName', 'PrimarySmtpAddress', 'RecipientTypeDetails', 'ForwardingSmtpAddress', 'ForwardingAddress', 'DeliverToMailboxAndForward', 'IssueWarningQuota', 'ProhibitSendQuota', 'ProhibitSendReceiveQuota', 'ArchiveStatus', 'LitigationHoldEnabled', 'LitigationHoldDuration', 'RetentionPolicy', 'HiddenFromAddressListsEnabled', 'AuditEnabled', 'GrantSendOnBehalfTo')
    $mailboxes = @(Get-EXOMailbox -ResultSize $MaxFactsMailboxes -RecipientTypeDetails UserMailbox, SharedMailbox, RoomMailbox, EquipmentMailbox -Properties $properties)
    Write-Step -JobId $JobId -Message ('Mailboxes: ' + $mailboxes.Count)

    $autoForwarding = $null
    try {
        $policy = Get-HostedOutboundSpamFilterPolicy | Where-Object { $_.IsDefault -eq $true } | Select-Object -First 1
        if ($policy) { $autoForwarding = [string]$policy.AutoForwardingMode }
    }
    catch { Write-Step -JobId $JobId -Message ('Outbound spam policy not readable: ' + $_.Exception.Message) }

    $result = New-Object -TypeName System.Collections.Generic.List[object]
    $index = 0
    foreach ($mailbox in $mailboxes) {
        $index += 1
        $upn = [string]$mailbox.UserPrincipalName
        $fullAccess = New-Object -TypeName System.Collections.Generic.List[string]
        $sendAs = New-Object -TypeName System.Collections.Generic.List[string]
        if ($index -le $MaxPermissionMailboxes) {
            try {
                $permissions = @(Get-EXOMailboxPermission -Identity $upn -ErrorAction Stop | Where-Object { ($_.AccessRights -contains 'FullAccess') -and (-not $_.IsInherited) -and ([string]$_.User -notlike 'NT AUTHORITY\*') })
                foreach ($p in $permissions) { $fullAccess.Add(([string]$p.User).ToLowerInvariant()) }
            }
            catch { Write-Log -Message ('FullAccess not readable for one mailbox: ' + $_.Exception.Message) -Level 'WARN' }
            try {
                $recipientPermissions = @(Get-EXORecipientPermission -Identity $upn -ErrorAction Stop | Where-Object { ($_.AccessRights -contains 'SendAs') -and ([string]$_.Trustee -notlike 'NT AUTHORITY\*') })
                foreach ($p in $recipientPermissions) { $sendAs.Add(([string]$p.Trustee).ToLowerInvariant()) }
            }
            catch { Write-Log -Message ('SendAs not readable for one mailbox: ' + $_.Exception.Message) -Level 'WARN' }
        }
        if ($index % 50 -eq 0) { Send-JobLog -JobId $JobId -Message ('Permissions read for ' + $index + ' mailboxes') }
        $result.Add([ordered]@{
            userPrincipalName = $upn
            displayName = [string]$mailbox.DisplayName
            primarySmtpAddress = [string]$mailbox.PrimarySmtpAddress
            recipientTypeDetails = [string]$mailbox.RecipientTypeDetails
            forwardingSmtpAddress = $(if ($mailbox.ForwardingSmtpAddress) { [string]$mailbox.ForwardingSmtpAddress } else { $null })
            forwardingAddress = $(if ($mailbox.ForwardingAddress) { [string]$mailbox.ForwardingAddress } else { $null })
            deliverToMailboxAndForward = [bool]$mailbox.DeliverToMailboxAndForward
            issueWarningQuota = Get-QuotaText -Value $mailbox.IssueWarningQuota
            prohibitSendQuota = Get-QuotaText -Value $mailbox.ProhibitSendQuota
            prohibitSendReceiveQuota = Get-QuotaText -Value $mailbox.ProhibitSendReceiveQuota
            archiveStatus = $(if ($mailbox.ArchiveStatus) { [string]$mailbox.ArchiveStatus } else { $null })
            litigationHoldEnabled = [bool]$mailbox.LitigationHoldEnabled
            litigationHoldDuration = $(if ($mailbox.LitigationHoldDuration) { [string]$mailbox.LitigationHoldDuration } else { $null })
            retentionPolicy = $(if ($mailbox.RetentionPolicy) { [string]$mailbox.RetentionPolicy } else { $null })
            hiddenFromAddressLists = [bool]$mailbox.HiddenFromAddressListsEnabled
            auditEnabled = $(if ($null -ne $mailbox.AuditEnabled) { [bool]$mailbox.AuditEnabled } else { $null })
            fullAccess = @($fullAccess)
            sendAs = @($sendAs)
            sendOnBehalf = @(ConvertTo-Addresses -Value $mailbox.GrantSendOnBehalfTo)
        })
    }
    if ($mailboxes.Count -gt $MaxPermissionMailboxes) { Write-Step -JobId $JobId -Message ('Permissions read only for the first ' + $MaxPermissionMailboxes + ' mailboxes') }
    return @{ autoForwardingMode = $autoForwarding; mailboxes = @($result) }
}

function Invoke-Operation {
    param([object]$Claim)
    $jobId = [string]$Claim.jobId
    $p = $Claim.parameters
    switch ([string]$Claim.operation) {
        'collect-facts' {
            return Invoke-CollectFacts -JobId $jobId
        }
        'set-quota' {
            $identity = Assert-Identity -Value (Get-Param -Parameters $p -Name 'identity') -Label 'identity'
            $warn = [string](Get-Param -Parameters $p -Name 'issueWarningQuota')
            $send = [string](Get-Param -Parameters $p -Name 'prohibitSendQuota')
            $receive = [string](Get-Param -Parameters $p -Name 'prohibitSendReceiveQuota')
            foreach ($q in @($warn, $send, $receive)) { if ($q -notmatch $QuotaPattern) { throw ('Quota value invalid: ' + $q) } }
            Write-Step -JobId $jobId -Message ('Set-Mailbox quotas for ' + $identity)
            Set-Mailbox -Identity $identity -IssueWarningQuota $warn -ProhibitSendQuota $send -ProhibitSendReceiveQuota $receive -ErrorAction Stop
            return @{ identity = $identity; issueWarningQuota = $warn; prohibitSendQuota = $send; prohibitSendReceiveQuota = $receive }
        }
        'set-forwarding' {
            $identity = Assert-Identity -Value (Get-Param -Parameters $p -Name 'identity') -Label 'identity'
            $address = Get-Param -Parameters $p -Name 'forwardingSmtpAddress'
            if ([string]::IsNullOrWhiteSpace([string]$address)) {
                Write-Step -JobId $jobId -Message ('Remove forwarding on ' + $identity)
                Set-Mailbox -Identity $identity -ForwardingSmtpAddress $null -ForwardingAddress $null -DeliverToMailboxAndForward $false -ErrorAction Stop
                return @{ identity = $identity; forwardingSmtpAddress = $null }
            }
            $target = Assert-Identity -Value ([string]$address) -Label 'forwardingSmtpAddress'
            $keep = [bool](Get-Param -Parameters $p -Name 'deliverToMailboxAndForward')
            Write-Step -JobId $jobId -Message ('Set forwarding on ' + $identity + ' to ' + $target)
            Set-Mailbox -Identity $identity -ForwardingSmtpAddress $target -DeliverToMailboxAndForward $keep -ErrorAction Stop
            return @{ identity = $identity; forwardingSmtpAddress = $target; deliverToMailboxAndForward = $keep }
        }
        'set-full-access' {
            $identity = Assert-Identity -Value (Get-Param -Parameters $p -Name 'identity') -Label 'identity'
            $trustee = Assert-Identity -Value (Get-Param -Parameters $p -Name 'trustee') -Label 'trustee'
            $grant = [bool](Get-Param -Parameters $p -Name 'grant')
            if ($grant) {
                $auto = $true
                $autoValue = Get-Param -Parameters $p -Name 'autoMapping'
                if ($null -ne $autoValue) { $auto = [bool]$autoValue }
                Write-Step -JobId $jobId -Message ('Add FullAccess for ' + $trustee + ' on ' + $identity)
                Add-MailboxPermission -Identity $identity -User $trustee -AccessRights FullAccess -AutoMapping $auto -Confirm:$false -ErrorAction Stop | Out-Null
            }
            else {
                Write-Step -JobId $jobId -Message ('Remove FullAccess for ' + $trustee + ' on ' + $identity)
                Remove-MailboxPermission -Identity $identity -User $trustee -AccessRights FullAccess -Confirm:$false -ErrorAction Stop | Out-Null
            }
            return @{ identity = $identity; trustee = $trustee; grant = $grant }
        }
        'set-send-as' {
            $identity = Assert-Identity -Value (Get-Param -Parameters $p -Name 'identity') -Label 'identity'
            $trustee = Assert-Identity -Value (Get-Param -Parameters $p -Name 'trustee') -Label 'trustee'
            $grant = [bool](Get-Param -Parameters $p -Name 'grant')
            if ($grant) {
                Write-Step -JobId $jobId -Message ('Add SendAs for ' + $trustee + ' on ' + $identity)
                Add-RecipientPermission -Identity $identity -Trustee $trustee -AccessRights SendAs -Confirm:$false -ErrorAction Stop | Out-Null
            }
            else {
                Write-Step -JobId $jobId -Message ('Remove SendAs for ' + $trustee + ' on ' + $identity)
                Remove-RecipientPermission -Identity $identity -Trustee $trustee -AccessRights SendAs -Confirm:$false -ErrorAction Stop | Out-Null
            }
            return @{ identity = $identity; trustee = $trustee; grant = $grant }
        }
        'enable-archive' {
            $identity = Assert-Identity -Value (Get-Param -Parameters $p -Name 'identity') -Label 'identity'
            Write-Step -JobId $jobId -Message ('Enable archive on ' + $identity)
            Enable-Mailbox -Identity $identity -Archive -ErrorAction Stop | Out-Null
            return @{ identity = $identity; archive = 'enabled' }
        }
        'convert-mailbox' {
            $identity = Assert-Identity -Value (Get-Param -Parameters $p -Name 'identity') -Label 'identity'
            $type = [string](Get-Param -Parameters $p -Name 'type')
            if ($type -ne 'Shared' -and $type -ne 'Regular') { throw ('Mailbox type invalid: ' + $type) }
            Write-Step -JobId $jobId -Message ('Convert ' + $identity + ' to ' + $type)
            Set-Mailbox -Identity $identity -Type $type -ErrorAction Stop
            return @{ identity = $identity; type = $type }
        }
        'set-litigation-hold' {
            $identity = Assert-Identity -Value (Get-Param -Parameters $p -Name 'identity') -Label 'identity'
            $enabled = [bool](Get-Param -Parameters $p -Name 'enabled')
            if ($enabled) {
                $days = Get-Param -Parameters $p -Name 'durationDays'
                Write-Step -JobId $jobId -Message ('Enable litigation hold on ' + $identity)
                if ($null -ne $days -and [int]$days -gt 0) {
                    Set-Mailbox -Identity $identity -LitigationHoldEnabled $true -LitigationHoldDuration ([int]$days) -ErrorAction Stop
                }
                else {
                    Set-Mailbox -Identity $identity -LitigationHoldEnabled $true -ErrorAction Stop
                }
            }
            else {
                Write-Step -JobId $jobId -Message ('Disable litigation hold on ' + $identity)
                Set-Mailbox -Identity $identity -LitigationHoldEnabled $false -ErrorAction Stop
            }
            return @{ identity = $identity; litigationHoldEnabled = $enabled }
        }
        default { throw ('Operation not allowed: ' + [string]$Claim.operation) }
    }
}

function Complete-Job {
    param([string]$JobId, [bool]$Success, [string]$ErrorMessage, [object]$Result)
    $body = @{ success = $Success; log = ($script:LogLines -join "`n"); error = $ErrorMessage; result = $Result }
    Invoke-Api -Method 'POST' -Path ('/worker/exchange/' + $JobId + '/complete') -Body $body | Out-Null
}

function Invoke-Job {
    param([object]$Claim)
    $script:LogLines.Clear()
    $jobId = [string]$Claim.jobId
    $success = $false
    $errorMessage = $null
    $result = $null
    try {
        Write-Step -JobId $jobId -Message ('Job ' + $jobId + ': ' + [string]$Claim.operation + ' in ' + [string]$Claim.organization)
        Connect-Tenant -Organization ([string]$Claim.organization)
        $result = Invoke-Operation -Claim $Claim
        $success = $true
        Write-Log -Message 'Done'
    }
    catch {
        $errorMessage = $_.Exception.Message
        Write-Log -Message ('Failed: ' + $errorMessage) -Level 'ERROR'
        # Nach einem Fehler die Sitzung neu aufbauen, damit kein halber Zustand haengt
        Disconnect-Tenant
    }
    finally {
        try { Complete-Job -JobId $jobId -Success $success -ErrorMessage $errorMessage -Result $result }
        catch { Write-Log -Message ('Could not report result: ' + $_.Exception.Message) -Level 'ERROR' }
    }
    return $success
}

# ---- main ----

if (-not (Get-Module -ListAvailable -Name 'ExchangeOnlineManagement')) {
    throw 'Module ExchangeOnlineManagement missing: Install-Module ExchangeOnlineManagement -Scope CurrentUser'
}
Import-Module -Name 'ExchangeOnlineManagement' -MinimumVersion '3.0.0' -ErrorAction Stop

$script:Config = Read-Config -Path $ConfigPath
$script:Token = Read-Token

$ping = Invoke-Api -Method 'GET' -Path '/worker/ping'
Write-Host ('Connected to ' + $script:Config.apiUrl + ' as worker ' + $ping.workerId)

$idleDelay = [int]$script:Config.pollSeconds
$failures = 0
try {
    while ($true) {
        $claim = $null
        try {
            $claim = Invoke-Api -Method 'POST' -Path '/worker/exchange/claim'
            $failures = 0
        }
        catch {
            $failures += 1
            $wait = [math]::Min(300, $idleDelay * [math]::Pow(2, [math]::Min($failures, 4)))
            Write-Host ('Claim failed (' + $_.Exception.Message + '); retry in ' + $wait + ' s') -ForegroundColor Yellow
            if ($Once) { exit 2 }
            Start-Sleep -Seconds $wait
            continue
        }
        if ($null -eq $claim) {
            if ($Once) { Write-Host 'No job waiting'; exit 0 }
            # Verbindung nicht ewig offen halten
            Disconnect-Tenant
            Start-Sleep -Seconds $idleDelay
            continue
        }
        $ok = Invoke-Job -Claim $claim
        if ($Once) {
            if ($ok) { exit 0 } else { exit 1 }
        }
    }
}
finally {
    Disconnect-Tenant
}
