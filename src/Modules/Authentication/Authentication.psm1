<#
.SYNOPSIS
    Authentication Module for Microsoft Graph and Azure Resource Manager

.DESCRIPTION
    Handles OAuth 2.0 authentication using client credentials flow.
    Provides token caching and automatic refresh functionality for improved performance.

.NOTES
    Version:        1.0.0
    Author:         Cloud Management Portal
    Creation Date:  2024
#>

#region Module Variables

# Token cache for performance optimization
$script:TokenCache = @{}

# Application configuration
$script:Config = $null

#endregion

#region Initialization Functions

function Initialize-Authentication {
    <#
    .SYNOPSIS
        Initializes the authentication module with application configuration

    .DESCRIPTION
        Loads configuration from JSON file containing Azure AD app credentials
        and other authentication settings required for API access

    .PARAMETER ConfigPath
        Path to the configuration file (default: config/appsettings.json)

    .EXAMPLE
        Initialize-Authentication -ConfigPath "config/appsettings.json"

    .NOTES
        Must be called before using any other authentication functions
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [string]$ConfigPath = "config/appsettings.json"
    )

    if (Test-Path $ConfigPath) {
        $script:Config = Get-Content $ConfigPath | ConvertFrom-Json
        Write-Verbose "Authentication configuration loaded successfully from: $ConfigPath"
    }
    else {
        throw "Configuration file not found: $ConfigPath. Please ensure the file exists."
    }
}

#endregion

#region Token Management Functions

function Get-MsalToken {
    <#
    .SYNOPSIS
        Acquires an access token using OAuth 2.0 client credentials flow

    .DESCRIPTION
        Requests and caches access tokens for Microsoft Graph or other Azure services.
        Automatically refreshes tokens when expired. Uses intelligent caching to minimize
        token requests and improve performance.

    .PARAMETER Scopes
        The OAuth scopes to request (default: Microsoft Graph API)

    .PARAMETER ForceRefresh
        Forces a new token request even if a valid cached token exists

    .EXAMPLE
        $token = Get-MsalToken
        Gets a token for Microsoft Graph with default scopes

    .EXAMPLE
        $token = Get-MsalToken -Scopes @("https://graph.microsoft.com/.default") -ForceRefresh
        Forces a fresh token acquisition

    .OUTPUTS
        System.String
        Returns the access token as a string

    .NOTES
        Tokens are cached with a 5-minute safety buffer before expiration
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory = $false)]
        [string[]]$Scopes = @("https://graph.microsoft.com/.default"),

        [Parameter(Mandatory = $false)]
        [switch]$ForceRefresh
    )

    $cacheKey = ($Scopes -join ",")

    # Check cache for valid token
    if (-not $ForceRefresh -and $script:TokenCache.ContainsKey($cacheKey)) {
        $cached = $script:TokenCache[$cacheKey]

        # Return cached token if still valid (with 5-minute buffer)
        if ($cached.ExpiresOn -gt (Get-Date).AddMinutes(5)) {
            Write-Verbose "Using cached token for scopes: $($Scopes -join ', ')"
            return $cached.AccessToken
        }
        else {
            Write-Verbose "Cached token expired, acquiring new token"
        }
    }

    try {
        # Prepare OAuth 2.0 client credentials request
        $body = @{
            client_id     = $script:Config.Azure.ClientId
            client_secret = $script:Config.Azure.ClientSecret
            scope         = ($Scopes -join " ")
            grant_type    = "client_credentials"
        }

        $tokenEndpoint = "https://login.microsoftonline.com/$($script:Config.Azure.TenantId)/oauth2/v2.0/token"

        Write-Verbose "Acquiring new token from: $tokenEndpoint"
        $response = Invoke-RestMethod -Uri $tokenEndpoint -Method Post -Body $body -ContentType "application/x-www-form-urlencoded"

        # Cache the token with expiration time
        $script:TokenCache[$cacheKey] = @{
            AccessToken = $response.access_token
            ExpiresOn   = (Get-Date).AddSeconds($response.expires_in)
        }

        Write-Verbose "New token acquired and cached. Expires in $($response.expires_in) seconds"
        return $response.access_token
    }
    catch {
        $errorMessage = "Failed to acquire access token: $($_.Exception.Message)"
        Write-Error $errorMessage
        throw
    }
}

function Get-AzureManagementToken {
    <#
    .SYNOPSIS
        Acquires an access token for Azure Resource Manager API

    .DESCRIPTION
        Wrapper function that gets a token specifically scoped for Azure Resource Manager.
        Used for managing Azure resources like Virtual Machines, Virtual Desktop, etc.

    .PARAMETER ForceRefresh
        Forces a new token request even if a valid cached token exists

    .EXAMPLE
        $token = Get-AzureManagementToken
        Gets a token for Azure Resource Manager

    .OUTPUTS
        System.String
        Returns the access token as a string
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory = $false)]
        [switch]$ForceRefresh
    )

    return Get-MsalToken -Scopes @("https://management.azure.com/.default") -ForceRefresh:$ForceRefresh
}

function Clear-TokenCache {
    <#
    .SYNOPSIS
        Clears all cached authentication tokens

    .DESCRIPTION
        Removes all tokens from the cache. Useful for troubleshooting
        or when switching between different credentials.

    .EXAMPLE
        Clear-TokenCache
        Clears all cached tokens
    #>
    [CmdletBinding()]
    param()

    $script:TokenCache = @{}
    Write-Verbose "Token cache cleared successfully"
}

#endregion

#region API Request Functions

function Invoke-GraphRequest {
    <#
    .SYNOPSIS
        Makes an authenticated HTTP request to Microsoft Graph API

    .DESCRIPTION
        Wrapper function that handles authentication and request execution for Graph API.
        Automatically acquires and applies the access token, handles JSON serialization,
        and provides consistent error handling.

    .PARAMETER Uri
        The Microsoft Graph API endpoint URI (e.g., https://graph.microsoft.com/v1.0/users)

    .PARAMETER Method
        HTTP method to use (GET, POST, PATCH, DELETE, PUT)

    .PARAMETER Body
        Request body for POST/PATCH/PUT operations (will be converted to JSON)

    .EXAMPLE
        $users = Invoke-GraphRequest -Uri "https://graph.microsoft.com/v1.0/users"
        Gets all users from Microsoft Graph

    .EXAMPLE
        $body = @{ displayName = "John Doe" }
        Invoke-GraphRequest -Uri "https://graph.microsoft.com/v1.0/users" -Method POST -Body $body
        Creates a new user

    .OUTPUTS
        System.Object
        Returns the API response as a PowerShell object
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Uri,

        [Parameter(Mandatory = $false)]
        [ValidateSet('GET', 'POST', 'PATCH', 'DELETE', 'PUT')]
        [string]$Method = "GET",

        [Parameter(Mandatory = $false)]
        [object]$Body
    )

    # Acquire access token
    $token = Get-MsalToken

    # Prepare request headers
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }

    # Build request parameters
    $params = @{
        Uri     = $Uri
        Method  = $Method
        Headers = $headers
    }

    # Add body if provided
    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
        Write-Verbose "Request body: $($params.Body)"
    }

    try {
        Write-Verbose "Executing Graph API request: $Method $Uri"
        $response = Invoke-RestMethod @params
        Write-Verbose "Request completed successfully"
        return $response
    }
    catch {
        $errorMessage = "Graph API request failed: $($_.Exception.Message) | URI: $Uri"
        Write-Error $errorMessage
        throw
    }
}

function Invoke-AzureRequest {
    <#
    .SYNOPSIS
        Makes an authenticated HTTP request to Azure Resource Manager API

    .DESCRIPTION
        Wrapper function that handles authentication and request execution for Azure ARM.
        Automatically acquires and applies the access token, handles JSON serialization,
        and provides consistent error handling. Used for managing Azure resources.

    .PARAMETER Uri
        The Azure Resource Manager API endpoint URI

    .PARAMETER Method
        HTTP method to use (GET, POST, PATCH, DELETE, PUT)

    .PARAMETER Body
        Request body for POST/PATCH/PUT operations (will be converted to JSON)

    .EXAMPLE
        $vms = Invoke-AzureRequest -Uri "https://management.azure.com/subscriptions/{id}/providers/Microsoft.Compute/virtualMachines?api-version=2023-03-01"
        Gets all virtual machines in a subscription

    .EXAMPLE
        $body = @{ location = "eastus" }
        Invoke-AzureRequest -Uri $uri -Method PUT -Body $body
        Creates or updates an Azure resource

    .OUTPUTS
        System.Object
        Returns the API response as a PowerShell object
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string]$Uri,

        [Parameter(Mandatory = $false)]
        [ValidateSet('GET', 'POST', 'PATCH', 'DELETE', 'PUT')]
        [string]$Method = "GET",

        [Parameter(Mandatory = $false)]
        [object]$Body
    )

    # Acquire access token for Azure Resource Manager
    $token = Get-AzureManagementToken

    # Prepare request headers
    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type"  = "application/json"
    }

    # Build request parameters
    $params = @{
        Uri     = $Uri
        Method  = $Method
        Headers = $headers
    }

    # Add body if provided
    if ($Body) {
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
        Write-Verbose "Request body: $($params.Body)"
    }

    try {
        Write-Verbose "Executing Azure ARM request: $Method $Uri"
        $response = Invoke-RestMethod @params
        Write-Verbose "Request completed successfully"
        return $response
    }
    catch {
        $errorMessage = "Azure ARM API request failed: $($_.Exception.Message) | URI: $Uri"
        Write-Error $errorMessage
        throw
    }
}

#endregion

#region Module Exports

# Export public functions
Export-ModuleMember -Function @(
    'Initialize-Authentication',
    'Get-MsalToken',
    'Get-AzureManagementToken',
    'Invoke-GraphRequest',
    'Invoke-AzureRequest',
    'Clear-TokenCache'
)

#endregion
