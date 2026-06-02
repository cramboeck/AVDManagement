# Cloud Management Portal - Pode Web Server
# Main API server with REST endpoints

using namespace Pode

# Import required modules
Import-Module Pode -MinimumVersion 2.10.0 -ErrorAction Stop

# Start Pode server
Start-PodeServer {

    # Load configuration inside Pode server block
    $configPath = Join-Path $PSScriptRoot "../../config/appsettings.json"
    $config = Get-Content $configPath | ConvertFrom-Json

    # Store config in Pode state for use in routes
    Set-PodeState -Name 'ConfigPath' -Value $configPath
    Set-PodeState -Name 'Config' -Value $config

    # Simple inline token functions - no module imports needed!

    # Graph API Token (for M365, Intune, etc.)
    $script:GetGraphToken = {
        $config = Get-PodeState -Name 'Config'

        $clientId = $config.Azure.ClientId
        $clientSecret = $config.Azure.ClientSecret
        $tenantId = $config.Azure.TenantId

        $body = @{
            client_id     = $clientId
            scope         = "https://graph.microsoft.com/.default"
            client_secret = $clientSecret
            grant_type    = "client_credentials"
        }

        $tokenResponse = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Body $body
        return $tokenResponse.access_token
    }

    # Azure Management Token (for AVD, VMs, etc.)
    $script:GetAzureToken = {
        $config = Get-PodeState -Name 'Config'

        $clientId = $config.Azure.ClientId
        $clientSecret = $config.Azure.ClientSecret
        $tenantId = $config.Azure.TenantId

        $body = @{
            client_id     = $clientId
            scope         = "https://management.azure.com/.default"
            client_secret = $clientSecret
            grant_type    = "client_credentials"
        }

        $tokenResponse = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Body $body
        return $tokenResponse.access_token
    }

    # Store both token functions in Pode state
    Set-PodeState -Name 'GetToken' -Value $script:GetGraphToken
    Set-PodeState -Name 'GetGraphToken' -Value $script:GetGraphToken
    Set-PodeState -Name 'GetAzureToken' -Value $script:GetAzureToken

    # Server configuration
    # For Docker: bind to 0.0.0.0 to accept external connections
    # For local: localhost/127.0.0.1 works fine
    $bindAddress = $config.Server.Host
    if ($bindAddress -eq 'localhost') {
        # Use 0.0.0.0 to bind to all interfaces (required for Docker)
        $bindAddress = '0.0.0.0'
    }
    Add-PodeEndpoint -Address $bindAddress -Port $config.Server.Port -Protocol Http

    # Enable request logging
    New-PodeLoggingMethod -File -Name 'requests' -Path $config.Logging.LogPath | Enable-PodeRequestLogging
    New-PodeLoggingMethod -File -Name 'errors' -Path $config.Logging.LogPath | Enable-PodeErrorLogging

    # Static content
    Add-PodeStaticRoute -Path '/static' -Source (Join-Path $PSScriptRoot "../Public")
    Add-PodeStaticRoute -Path '/' -Source (Join-Path $PSScriptRoot "../Public") -Defaults @('index.html')

    # CORS for development (disabled for Pode 2.12.1 compatibility - not needed for local testing)
    # Note: CORS can be added later via middleware if cross-origin requests are needed

    # ===== Health Check Endpoint =====
    Add-PodeRoute -Method Get -Path '/api/health' -ScriptBlock {
        Write-PodeJsonResponse -Value @{
            status    = 'healthy'
            timestamp = (Get-Date).ToString('o')
            version   = '1.0.0'
        }
    }

    # ===== Authentication Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/auth/status' -ScriptBlock {
        try {
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            Write-PodeJsonResponse -Value @{
                authenticated = $true
                timestamp     = (Get-Date).ToString('o')
            }
        }
        catch {
            Write-PodeJsonResponse -Value @{
                authenticated = $false
                error         = $_.Exception.Message
            } -StatusCode 401
        }
    }

    # ===== Dashboard Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/dashboard' -ScriptBlock {
        try {
            $m365Dashboard = Get-M365Dashboard
            $intuneDashboard = Get-IntuneDashboard
            $avdDashboard = Get-AVDDashboard

            Write-PodeJsonResponse -Value @{
                timestamp = (Get-Date).ToString('o')
                m365      = $m365Dashboard
                intune    = $intuneDashboard
                avd       = $avdDashboard
            }
        }
        catch {
            Write-PodeJsonResponse -Value @{
                error   = $_.Exception.Message
                details = $_.Exception.ToString()
            } -StatusCode 500
        }
    }

    # ===== M365 User Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/m365/users' -ScriptBlock {
        try {
            # Direct Graph API call
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }

            $top = $WebEvent.Query['top'] ?? 100
            $filter = $WebEvent.Query['filter']

            $uri = "https://graph.microsoft.com/v1.0/users?`$top=$top"
            if ($filter) {
                $uri += "&`$filter=$filter"
            }

            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Get -Path '/api/m365/users/:id' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/M365Management.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $user = Get-M365User -UserId $WebEvent.Parameters['id']
            Write-PodeJsonResponse -Value $user
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 404
        }
    }

    Add-PodeRoute -Method Post -Path '/api/m365/users' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/M365Management.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $body = $WebEvent.Data
            $user = New-M365User -DisplayName $body.displayName -UserPrincipalName $body.userPrincipalName -MailNickname $body.mailNickname -Password $body.password
            Write-PodeJsonResponse -Value $user -StatusCode 201
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    # ===== M365 Group Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/m365/groups' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/M365Management.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $filter = $WebEvent.Query['filter']
            $params = @{}
            if ($filter) { $params.Filter = $filter }

            $groups = Get-M365Group @params
            Write-PodeJsonResponse -Value $groups
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Post -Path '/api/m365/groups' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/M365Management.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $body = $WebEvent.Data
            $group = New-M365Group -DisplayName $body.displayName -MailNickname $body.mailNickname -Description $body.description -GroupType $body.groupType
            Write-PodeJsonResponse -Value $group -StatusCode 201
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    # ===== M365 License Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/m365/licenses' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/M365Management.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $licenses = Get-M365License
            Write-PodeJsonResponse -Value $licenses
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    # ===== Intune Device Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/intune/devices' -ScriptBlock {
        try {
            # Direct Graph API call
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }

            $top = $WebEvent.Query['top'] ?? 100
            $filter = $WebEvent.Query['filter']

            $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices?`$top=$top"
            if ($filter) {
                $uri += "&`$filter=$filter"
            }

            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Get -Path '/api/intune/devices/:id' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/IntuneManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $device = Get-IntuneDevice -DeviceId $WebEvent.Parameters['id']
            Write-PodeJsonResponse -Value $device
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 404
        }
    }

    Add-PodeRoute -Method Post -Path '/api/intune/devices/:id/sync' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/IntuneManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $result = Sync-IntuneDevice -DeviceId $WebEvent.Parameters['id']
            Write-PodeJsonResponse -Value @{ message = 'Sync initiated successfully' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Post -Path '/api/intune/devices/:id/restart' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/IntuneManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $result = Restart-IntuneDevice -DeviceId $WebEvent.Parameters['id']
            Write-PodeJsonResponse -Value @{ message = 'Restart initiated successfully' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Post -Path '/api/intune/devices/:id/lock' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/IntuneManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $result = Lock-IntuneDevice -DeviceId $WebEvent.Parameters['id']
            Write-PodeJsonResponse -Value @{ message = 'Lock initiated successfully' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Delete -Path '/api/intune/devices/:id' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/M365Management/IntuneManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath

            $result = Remove-IntuneDevice -DeviceId $WebEvent.Parameters['id']
            Write-PodeJsonResponse -Value @{ message = 'Device deleted successfully' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    # ===== Intune Policy Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/intune/policies/configuration' -ScriptBlock {
        try {
            # Direct Graph API call - no module needed
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }
            $uri = "https://graph.microsoft.com/beta/deviceManagement/deviceConfigurations"
            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Get -Path '/api/intune/policies/compliance' -ScriptBlock {
        try {
            # Direct Graph API call - no module needed
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }
            $uri = "https://graph.microsoft.com/beta/deviceManagement/deviceCompliancePolicies"
            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    # ===== Intune Application Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/intune/apps' -ScriptBlock {
        try {
            # Direct Graph API call - no module needed
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }
            $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps"

            $filter = $WebEvent.Query['filter']
            if ($filter) {
                $uri += "?`$filter=$filter"
            }

            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    # ===== App Management Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/apps/windows' -ScriptBlock {
        try {
            # Get Windows apps - filter by platform
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }

            $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?`$filter=isof('microsoft.graph.win32LobApp') or isof('microsoft.graph.windowsMobileMSI') or isof('microsoft.graph.officeSuiteApp')"
            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Get -Path '/api/apps/ios' -ScriptBlock {
        try {
            # Get iOS apps - filter by platform
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }

            $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?`$filter=isof('microsoft.graph.iosLobApp') or isof('microsoft.graph.iosStoreApp') or isof('microsoft.graph.iosVppApp')"
            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Get -Path '/api/apps/overview' -ScriptBlock {
        try {
            # Get overview of all apps grouped by platform
            $getToken = Get-PodeState -Name 'GetToken'
            $token = & $getToken
            $headers = @{ Authorization = "Bearer $token" }

            $uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps"
            $allApps = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get

            $overview = @{
                total = $allApps.value.Count
                windows = ($allApps.value | Where-Object { $_.'@odata.type' -match 'win32|windowsMobileMSI|officeSuiteApp' }).Count
                ios = ($allApps.value | Where-Object { $_.'@odata.type' -match 'ios' }).Count
                android = ($allApps.value | Where-Object { $_.'@odata.type' -match 'android' }).Count
                macos = ($allApps.value | Where-Object { $_.'@odata.type' -match 'macOS' }).Count
                web = ($allApps.value | Where-Object { $_.'@odata.type' -match 'webApp' }).Count
            }

            Write-PodeJsonResponse -Value $overview
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    # ===== AVD Host Pool Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/avd/hostpools' -ScriptBlock {
        try {
            # Direct Azure Management API call
            $config = Get-PodeState -Name 'Config'
            $getAzureToken = Get-PodeState -Name 'GetAzureToken'
            $token = & $getAzureToken
            $headers = @{ Authorization = "Bearer $token" }

            $subscriptionId = $config.AVD.SubscriptionId
            $resourceGroup = $config.AVD.ResourceGroup

            if (-not $subscriptionId -or -not $resourceGroup) {
                Write-PodeJsonResponse -Value @{
                    error = "AVD not configured. Please set SubscriptionId and ResourceGroup in appsettings.json"
                } -StatusCode 400
                return
            }

            $uri = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools?api-version=2022-02-10-preview"
            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Get -Path '/api/avd/hostpools/:name' -ScriptBlock {
        try {
            # Direct Azure Management API call
            $config = Get-PodeState -Name 'Config'
            $getAzureToken = Get-PodeState -Name 'GetAzureToken'
            $token = & $getAzureToken
            $headers = @{ Authorization = "Bearer $token" }

            $subscriptionId = $config.AVD.SubscriptionId
            $resourceGroup = $config.AVD.ResourceGroup
            $hostPoolName = $WebEvent.Parameters['name']

            $uri = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$hostPoolName`?api-version=2022-02-10-preview"
            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 404
        }
    }

    # ===== AVD Session Host Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/avd/hostpools/:name/sessionhosts' -ScriptBlock {
        try {
            # Direct Azure Management API call
            $config = Get-PodeState -Name 'Config'
            $getAzureToken = Get-PodeState -Name 'GetAzureToken'
            $token = & $getAzureToken
            $headers = @{ Authorization = "Bearer $token" }

            $subscriptionId = $config.AVD.SubscriptionId
            $resourceGroup = $config.AVD.ResourceGroup
            $hostPoolName = $WebEvent.Parameters['name']

            $uri = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$resourceGroup/providers/Microsoft.DesktopVirtualization/hostPools/$hostPoolName/sessionHosts?api-version=2022-02-10-preview"
            $result = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
            Write-PodeJsonResponse -Value $result
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Post -Path '/api/avd/hostpools/:hostpool/sessionhosts/:host/start' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $result = Start-AVDSessionHost -HostPoolName $WebEvent.Parameters['hostpool'] -SessionHostName $WebEvent.Parameters['host']
            Write-PodeJsonResponse -Value @{ message = 'Session host start initiated' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Post -Path '/api/avd/hostpools/:hostpool/sessionhosts/:host/stop' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $result = Stop-AVDSessionHost -HostPoolName $WebEvent.Parameters['hostpool'] -SessionHostName $WebEvent.Parameters['host']
            Write-PodeJsonResponse -Value @{ message = 'Session host stop initiated' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Post -Path '/api/avd/hostpools/:hostpool/sessionhosts/:host/restart' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $result = Restart-AVDSessionHost -HostPoolName $WebEvent.Parameters['hostpool'] -SessionHostName $WebEvent.Parameters['host']
            Write-PodeJsonResponse -Value @{ message = 'Session host restart initiated' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Post -Path '/api/avd/hostpools/:hostpool/sessionhosts/:host/drainmode' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $body = $WebEvent.Data
            $enable = $body.enable ?? $true

            $result = Set-AVDSessionHostDrainMode -HostPoolName $WebEvent.Parameters['hostpool'] -SessionHostName $WebEvent.Parameters['host'] -Enable $enable
            Write-PodeJsonResponse -Value @{ message = "Drain mode $(if($enable){'enabled'}else{'disabled'}) successfully" }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    # ===== AVD User Session Endpoints =====
    Add-PodeRoute -Method Get -Path '/api/avd/hostpools/:name/sessions' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $sessions = Get-AVDUserSession -HostPoolName $WebEvent.Parameters['name']
            Write-PodeJsonResponse -Value $sessions
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
        }
    }

    Add-PodeRoute -Method Post -Path '/api/avd/hostpools/:hostpool/sessionhosts/:host/sessions/:session/disconnect' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $result = Disconnect-AVDUserSession -HostPoolName $WebEvent.Parameters['hostpool'] -SessionHostName $WebEvent.Parameters['host'] -SessionId $WebEvent.Parameters['session']
            Write-PodeJsonResponse -Value @{ message = 'Session disconnected successfully' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Delete -Path '/api/avd/hostpools/:hostpool/sessionhosts/:host/sessions/:session' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $result = Remove-AVDUserSession -HostPoolName $WebEvent.Parameters['hostpool'] -SessionHostName $WebEvent.Parameters['host'] -SessionId $WebEvent.Parameters['session']
            Write-PodeJsonResponse -Value @{ message = 'Session logged off successfully' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Add-PodeRoute -Method Post -Path '/api/avd/hostpools/:hostpool/sessionhosts/:host/sessions/:session/message' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $body = $WebEvent.Data
            $result = Send-AVDUserSessionMessage -HostPoolName $WebEvent.Parameters['hostpool'] -SessionHostName $WebEvent.Parameters['host'] -SessionId $WebEvent.Parameters['session'] -MessageTitle $body.title -MessageBody $body.body
            Write-PodeJsonResponse -Value @{ message = 'Message sent successfully' }
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    # ===== AVD Image Management Endpoints =====
    Add-PodeRoute -Method Post -Path '/api/avd/images' -ScriptBlock {
        try {
            # Import and initialize modules in this scope
            Import-Module "/app/src/Modules/Authentication/Authentication.psm1" -Force -Scope Global
            Import-Module "/app/src/Modules/AVDManagement/AVDManagement.psm1" -Force -Scope Global
            $configPath = Get-PodeState -Name 'ConfigPath'
            Initialize-Authentication -ConfigPath $configPath
            Initialize-AVDManagement -ConfigPath $configPath

            $body = $WebEvent.Data
            $result = New-AVDImage -HostPoolName $body.hostPoolName -SessionHostName $body.sessionHostName -ImageName $body.imageName -ImageResourceGroup $body.imageResourceGroup

            $response = @{
                message = 'Image creation initiated'
                data = $result
            }
            Write-PodeJsonResponse -Value $response -StatusCode 201
        }
        catch {
            Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 400
        }
    }

    Write-Host "`n==================================" -ForegroundColor Cyan
    Write-Host "Cloud Management Portal Started" -ForegroundColor Green
    Write-Host "==================================" -ForegroundColor Cyan
    Write-Host "URL: http://$($config.Server.Host):$($config.Server.Port)" -ForegroundColor Yellow
    Write-Host "API: http://$($config.Server.Host):$($config.Server.Port)/api" -ForegroundColor Yellow
    Write-Host "Listening on: $bindAddress`:$($config.Server.Port)" -ForegroundColor Gray
    Write-Host "`nPress Ctrl+C to stop the server" -ForegroundColor Gray
    Write-Host "==================================`n" -ForegroundColor Cyan
}
