<#
.SYNOPSIS
    Stores the worker token DPAPI-protected next to the worker config.

.DESCRIPTION
    The token is bound to the Windows account that runs this script. Run it
    as the same account that later runs Start-BuildWorker.ps1 (for example
    the scheduled task account). The file worker.token is ignored by git.
    Alternatively set the environment variable ZSC_WORKER_TOKEN.
#>
[CmdletBinding()]
param(
    [string]$TokenFile = (Join-Path -Path $PSScriptRoot -ChildPath 'worker.token')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$secure = Read-Host -Prompt 'Worker token (input hidden)' -AsSecureString
$encrypted = ConvertFrom-SecureString -SecureString $secure
Set-Content -Path $TokenFile -Value $encrypted -Encoding ASCII
Write-Host ('Token stored in ' + $TokenFile + ' for user ' + $env:USERNAME)
