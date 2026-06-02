# Autopilot v2 Monitoring Tools

**Fast, real-time monitoring of Windows Autopilot v2 deployments - much faster than Intune Portal!**

## Problem

The Microsoft Intune Portal is very slow for monitoring Autopilot deployments in real-time. IT admins need faster visibility into:
- Current deployment phase
- Script execution status
- App installation progress
- Errors and failures
- Overall deployment progress

## Solution

This toolset provides three complementary monitoring solutions:

| Tool | Purpose | Location | Speed |
|------|---------|----------|-------|
| **Watch-AutopilotDeployment.ps1** | Real-time local monitoring | On deploying device | Instant updates (5s) |
| **Monitor-AutopilotDevices.ps1** | Multi-device remote monitoring | Admin workstation | Fast (30s via API) |
| **Get-AutopilotStatus.ps1** | Quick status snapshot | On deploying device | Immediate |

## Features

✅ **Real-Time Monitoring**
- Live progress updates every 5-30 seconds
- Much faster than Intune Portal (which can lag 5-15 minutes)
- See exact deployment phase and progress

✅ **Comprehensive Status**
- ESP (Enrollment Status Page) phases
- Device Preparation scripts
- Win32 app installations
- Error detection
- Compliance status

✅ **Beautiful Dashboard**
- Color-coded status indicators
- Progress bars
- Time tracking
- Error highlighting

✅ **Multi-Device Support**
- Monitor multiple devices simultaneously
- Filter by device name or group tag
- Summary statistics

✅ **Export Capabilities**
- JSON reports
- HTML reports
- Historical data

## Quick Start

### Option 1: Monitor Local Device (During Autopilot)

Run this on the device being deployed:

```powershell
# Basic monitoring
.\Watch-AutopilotDeployment.ps1

# With log display
.\Watch-AutopilotDeployment.ps1 -ShowLogs

# Export report when done
.\Watch-AutopilotDeployment.ps1 -ExportReport
```

**Use Case:** Tech sitting with device during deployment, troubleshooting issues

### Option 2: Monitor Remote Devices (From Admin Workstation)

Run this from your workstation:

```powershell
# Monitor all Autopilot devices
.\Monitor-AutopilotDevices.ps1

# Monitor specific devices
.\Monitor-AutopilotDevices.ps1 -DeviceNames @("LAPTOP001", "LAPTOP002")

# Monitor by group tag
.\Monitor-AutopilotDevices.ps1 -GroupTag "Batch-2025-Q1"

# Faster refresh (every 15 seconds)
.\Monitor-AutopilotDevices.ps1 -RefreshInterval 15
```

**Use Case:** IT admin monitoring batch deployment from office

### Option 3: Quick Status Check

```powershell
# Quick status
.\Get-AutopilotStatus.ps1

# Detailed status
.\Get-AutopilotStatus.ps1 -Detailed

# Export HTML report
.\Get-AutopilotStatus.ps1 -ExportHTML
```

**Use Case:** Quick check of deployment status, generate user-friendly report

## Tool Details

### 1. Watch-AutopilotDeployment.ps1 (Local Real-Time Monitor)

**Purpose:** Monitor deployment in real-time on the device itself

**Dashboard Shows:**
```
═══════════════════════════════════════════════════════════════════
    AUTOPILOT V2 DEPLOYMENT MONITOR - REAL-TIME
═══════════════════════════════════════════════════════════════════

Device: LAPTOP001
Started: 2025-10-25 09:00:00
Elapsed: 0h 15m 30s

───────────────────────────────────────────────────────────────────

╔═══ ENROLLMENT STATUS PAGE (ESP) ═══
║ Current Phase: Device Setup
║ Progress: [████████████████████░░░░░░░░░░░░░░░░░░░░] 60%
╚═══════════════════════════════════════════════════════

╔═══ DEVICE PREPARATION SCRIPTS ═══
║ ✓ Install-Prerequisites-DevicePrep.ps1 [09:05:23]
║ ✓ Apply-CISHardening-Win11.ps1 [09:10:45]
╚═══════════════════════════════════════════════════════

╔═══ WIN32 APPLICATIONS ═══
║ ✓ Microsoft Office 365 [09:12:10]
║ ⟳ Company VPN Client [09:14:25]
║ ? Custom LOB App [09:15:00]
╚═══════════════════════════════════════════════════════

───────────────────────────────────────────────────────────────────
Press CTRL+C to stop monitoring | Refresh every 5 seconds
═══════════════════════════════════════════════════════════════════
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-RefreshInterval` | Int | 5 | Seconds between updates |
| `-ShowLogs` | Switch | False | Display log entries |
| `-ExportReport` | Switch | False | Export JSON report on completion |

**Monitored Data:**
- ESP phase and progress %
- Device Preparation scripts (from logs)
- Win32 app installations (from IME logs)
- Errors and warnings
- Elapsed time

**Log Sources:**
```
C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\
├── IntuneManagementExtension.log
├── AgentExecutor.log
├── DevicePrep*.log
└── Provisioning\Diagnostics\*.log
```

**Requirements:**
- Run as Administrator or SYSTEM
- Local access to device
- Powershell 5.1+

---

### 2. Monitor-AutopilotDevices.ps1 (Remote Multi-Device Monitor)

**Purpose:** Monitor multiple devices from your admin workstation via Graph API

**Dashboard Shows:**
```
═══════════════════════════════════════════════════════════════════
    AUTOPILOT V2 MULTI-DEVICE MONITOR
═══════════════════════════════════════════════════════════════════

Monitoring: 5 device(s)
Updated: 2025-10-25 10:30:15

───────────────────────────────────────────────────────────────────

╔═══ LAPTOP001 ═══
║ Status: Enrolled
║ Compliance: Compliant ✓
║ Last Sync: 10:29:45 (0 min ago)
║ OS: Windows 11 23H2
║ Profile: Autopilot-Standard-Users
║ Enrolled: 2025-10-25 09:00:00
╚═══════════════════════════════════════════════════════

╔═══ LAPTOP002 ═══
║ Status: Enrolled
║ Compliance: Non-Compliant ✗
║ Last Sync: 10:15:22 (15 min ago)
║ OS: Windows 11 22H2
║ Profile: Autopilot-IT-Department
║ Enrolled: 2025-10-25 09:15:00
╚═══════════════════════════════════════════════════════

───────────────────────────────────────────────────────────────────
Summary: 5 enrolled | 4 compliant | 0 failed
───────────────────────────────────────────────────────────────────
Press CTRL+C to stop monitoring | Refresh every 30 seconds
═══════════════════════════════════════════════════════════════════
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-DeviceNames` | String[] | All | Specific devices to monitor |
| `-GroupTag` | String | None | Filter by Autopilot group tag |
| `-RefreshInterval` | Int | 30 | Seconds between API calls (min: 10) |
| `-ExportReport` | Switch | False | Export JSON report |

**Monitored Data:**
- Enrollment status
- Compliance state
- Last sync time
- OS version
- User assignment
- Enrollment profile
- Enrollment date/time

**API Used:**
- Microsoft Graph API (Beta)
- Endpoint: `/deviceManagement/managedDevices`

**Requirements:**
- Microsoft.Graph PowerShell module
- Graph API permissions:
  - `DeviceManagementManagedDevices.Read.All`
  - `DeviceManagementApps.Read.All`
- Internet connection
- PowerShell 5.1+

**Installation:**
```powershell
# Install Graph module
Install-Module Microsoft.Graph -Scope CurrentUser

# First run will prompt for authentication
.\Monitor-AutopilotDevices.ps1
```

---

### 3. Get-AutopilotStatus.ps1 (Quick Status Check)

**Purpose:** Quick snapshot of current deployment status

**Output Example:**
```
═══════════════════════════════════════════════════════════════════
    AUTOPILOT DEPLOYMENT STATUS
═══════════════════════════════════════════════════════════════════

Device Information:
  Computer Name: LAPTOP001
  User: SYSTEM
  Date/Time: 2025-10-25 10:45:30

Enrollment Status:
  Phase: Device Setup
  Progress: 75%
  Enrolled: 2025-10-25 09:00:00

Installed Applications: (3)
  ✓ Microsoft Office 365 v16.0.17328
  ✓ Company VPN Client v2.1.0
  ✓ Adobe Acrobat Reader DC v23.003

Executed Scripts: (2)
  • AutopilotSoftwareInstall_20251025_090523.log [09:05:23]
  • CISHardening_Win11_20251025_091045.log [09:10:45]

Log File Locations:
  IME: C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\
  Scripts: C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\*Autopilot*.log

═══════════════════════════════════════════════════════════════════
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Detailed` | Switch | False | Show additional system info |
| `-ExportHTML` | Switch | False | Generate HTML report |

**Use Cases:**
- Quick status check
- Generate user-friendly HTML report
- Verify deployment completed
- Check installed components

## Comparison with Intune Portal

| Feature | Intune Portal | Our Tools |
|---------|---------------|-----------|
| **Update Speed** | 5-15 minutes | 5-30 seconds |
| **Real-Time** | ❌ No | ✅ Yes |
| **Multi-Device** | Manual refresh | Auto-refresh |
| **Script Status** | Limited visibility | Detailed |
| **App Progress** | General status | Specific apps |
| **Error Details** | Basic | Detailed logs |
| **Export** | Limited | JSON/HTML |
| **Offline** | ❌ No | ✅ Yes (local tool) |

## Usage Scenarios

### Scenario 1: Single Device Deployment Troubleshooting

**Situation:** Device stuck during Autopilot, need to see what's happening

**Solution:**
```powershell
# On the device (SHIFT+F10 during OOBE for Command Prompt)
powershell.exe -ExecutionPolicy Bypass

# Navigate to USB stick with tools
cd D:\AutopilotTools

# Start monitoring
.\Watch-AutopilotDeployment.ps1 -ShowLogs -ExportReport
```

**Benefit:** See exactly which script/app is causing delay, view errors in real-time

### Scenario 2: Batch Deployment Monitoring

**Situation:** Deploying 50 devices overnight, need oversight

**Solution:**
```powershell
# On admin workstation
.\Monitor-AutopilotDevices.ps1 -GroupTag "Batch-2025-10-25" -ExportReport

# Leave running overnight
# Check summary in the morning
```

**Benefit:** One screen shows all 50 devices, immediate alert if any fail

### Scenario 3: End User Support

**Situation:** User calls saying "Autopilot is slow", need quick status

**Solution:**
```powershell
# Remote connect to device (TeamViewer/Quick Assist)
.\Get-AutopilotStatus.ps1 -ExportHTML

# Send HTML report to user
# Shows professional status report
```

**Benefit:** Quick check, professional report for user, no need to explain technical details

### Scenario 4: Compliance Verification

**Situation:** Need to verify CIS hardening applied during Autopilot

**Solution:**
```powershell
.\Get-AutopilotStatus.ps1 -Detailed

# Check output for:
# ✓ .NET Framework 4.8+ installed
# ✓ Windows Firewall enabled (all profiles)
# ✓ Windows Defender Real-Time Protection enabled
```

**Benefit:** Instant verification without manual registry checks

## Best Practices

### 1. Pre-Stage Tools on USB

Create a USB stick with all tools:
```
AutopilotTools/
├── Watch-AutopilotDeployment.ps1
├── Get-AutopilotStatus.ps1
└── README.md
```

Use during deployment:
- SHIFT+F10 during OOBE
- Map USB drive
- Run monitoring script

### 2. Automated Monitoring for Batches

For large deployments:
```powershell
# Create scheduled task on admin workstation
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument '-File C:\Scripts\Monitor-AutopilotDevices.ps1 -GroupTag "Production" -ExportReport'

$trigger = New-ScheduledTaskTrigger -Daily -At 6AM

Register-ScheduledTask -Action $action -Trigger $trigger -TaskName "Autopilot Batch Monitor"
```

### 3. Integration with Ticketing System

Export reports and attach to tickets:
```powershell
# Generate report
.\Get-AutopilotStatus.ps1 -ExportHTML

# Report saved to: C:\Users\ITAdmin\AppData\Local\Temp\AutopilotStatus_*.html
# Attach to ticket
```

### 4. Troubleshooting Workflow

```
1. User reports slow deployment
   ↓
2. Run Get-AutopilotStatus.ps1 (quick check)
   ↓
3. If stuck, run Watch-AutopilotDeployment.ps1 (detailed monitoring)
   ↓
4. Export report, check logs
   ↓
5. Identify stuck script/app
   ↓
6. Fix and re-deploy
```

## Troubleshooting

### Issue: "This script must be run as Administrator"

**Solution:**
```powershell
# Start PowerShell as Administrator
Start-Process PowerShell -Verb RunAs

# Or during OOBE: SHIFT+F10 gives SYSTEM context
```

### Issue: Graph API connection fails

**Solution:**
```powershell
# Install Graph module
Install-Module Microsoft.Graph -Scope CurrentUser -Force

# Manually connect
Connect-MgGraph -Scopes "DeviceManagementManagedDevices.Read.All"

# Test
Get-MgContext
```

### Issue: No devices found in remote monitoring

**Solution:**
```powershell
# Check filter criteria
.\Monitor-AutopilotDevices.ps1 -Verbose

# Try without filters
.\Monitor-AutopilotDevices.ps1

# Check device actually enrolled
# In Intune Portal: Devices > Windows > Windows devices
```

### Issue: Local monitoring shows "Unknown" phase

**Solution:**
- May be too early (before ESP starts)
- May be too late (ESP already finished)
- Check manually: `Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Enrollments\*\Status'`

## Performance Tips

### Local Monitoring (Watch-AutopilotDeployment.ps1)

- **Faster Updates:** Use `-RefreshInterval 3` (default: 5)
- **Less CPU:** Use `-RefreshInterval 10`
- **Balance:** Keep default 5 seconds

### Remote Monitoring (Monitor-AutopilotDevices.ps1)

- **Minimum Refresh:** 10 seconds (API throttling protection)
- **Recommended:** 30 seconds for production
- **Many Devices (50+):** 60 seconds to avoid throttling

### Batch Monitoring

- Filter by specific devices or group tags
- Don't monitor all devices in large org
- Use `-RefreshInterval 60` for large batches

## Export Formats

### JSON Export

```json
{
  "StartTime": "2025-10-25T09:00:00",
  "DeviceName": "LAPTOP001",
  "Phases": [
    {
      "Phase": "Device Preparation",
      "Progress": 25,
      "Time": "09:05:00"
    },
    {
      "Phase": "Device Setup",
      "Progress": 75,
      "Time": "09:15:00"
    }
  ],
  "Scripts": [
    {
      "Name": "Install-Prerequisites",
      "Status": "Completed",
      "Time": "09:05:23"
    }
  ],
  "Apps": [...],
  "Errors": [...]
}
```

### HTML Export

Professional HTML report with:
- Device information table
- Enrollment status
- Installed applications
- Color-coded status
- Timestamp
- Automatically opens in browser

## Integration Ideas

### 1. Teams Notifications

```powershell
# Add to monitoring script
$webhookUrl = "https://outlook.office.com/webhook/..."

if ($deploymentCompleted) {
    $body = @{
        text = "✅ Device $deviceName completed Autopilot deployment"
    } | ConvertTo-Json

    Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $body -ContentType 'application/json'
}
```

### 2. Email Alerts

```powershell
if ($errors.Count -gt 0) {
    Send-MailMessage -To "it@company.com" `
        -Subject "Autopilot Deployment Issue on $env:COMPUTERNAME" `
        -Body "Errors detected during deployment. See attached log." `
        -Attachments $LogFile `
        -SmtpServer "smtp.company.com"
}
```

### 3. Log Analytics

```powershell
# Send to Azure Log Analytics
$workspaceId = "..."
$sharedKey = "..."

# POST deployment data to custom log
```

## FAQ

**Q: Can I use these tools during OOBE (Out-of-Box Experience)?**

A: Yes! Press SHIFT+F10 to open Command Prompt, then run PowerShell and the monitoring scripts.

**Q: Do these tools slow down the deployment?**

A: No, negligible impact. They only read logs and registry, no heavy processing.

**Q: Can I monitor devices remotely without VPN?**

A: Yes, the remote monitoring tool uses Microsoft Graph API which works from anywhere with internet.

**Q: How do I stop monitoring?**

A: Press CTRL+C in the PowerShell window.

**Q: Can I run multiple monitoring tools simultaneously?**

A: Yes! Run local monitoring on device, remote monitoring on workstation.

**Q: Does this work with Autopilot v1?**

A: Partially. Some features are specific to v2 (Device Preparation scripts), but ESP monitoring works on both.

## Support & Feedback

- GitHub Issues: [Report issues here](../../issues)
- Documentation: See README files in each script
- Community: Microsoft Tech Community

## Changelog

### Version 1.0 (2025-10-25)
- Initial release
- Local real-time monitoring
- Remote multi-device monitoring
- Quick status check
- JSON/HTML export
- Colorful dashboards
- Error detection

---

**Remember:** These tools are much faster than the Intune Portal for real-time monitoring. Use them to save time and improve deployment visibility!
