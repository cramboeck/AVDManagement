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

# Modulpfade von PowerShell 7 aus einer 5.1-Sitzung entfernen: sonst findet 5.1
# die 7er-Fassung von Microsoft.PowerShell.Security/Utility zuerst und kann sie
# nicht laden (Get-ExecutionPolicy, Get-FileHash, ConvertFrom-SecureString fehlen)
if ($PSVersionTable.PSVersion.Major -le 5) {
    $cleanPaths = @($env:PSModulePath -split ';' | Where-Object { $_ -and ($_ -notlike '*\Program Files\PowerShell\*') })
    $env:PSModulePath = ($cleanPaths -join ';')
}

# DPAPI direkt ueber .NET statt ConvertFrom-SecureString: das Modul
# Microsoft.PowerShell.Security laesst sich auf manchen Systemen nicht laden
# (Ausfuehrungsrichtlinie, beschaedigter PSModulePath), ProtectedData braucht kein Modul.
Add-Type -AssemblyName System.Security
$secure = Read-Host -Prompt 'Worker token (input hidden)' -AsSecureString
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
}
finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if ([string]::IsNullOrWhiteSpace($plain) -or $plain.Trim().Length -lt 16) {
    throw 'Token is empty or too short'
}
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain.Trim())
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Array]::Clear($bytes, 0, $bytes.Length)
Set-Content -Path $TokenFile -Value ([Convert]::ToBase64String($protected)) -Encoding ASCII
Write-Host ('Token stored in ' + $TokenFile + ' for user ' + $env:USERNAME)
