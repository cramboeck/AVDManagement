# 🖨️ Enterprise Printer Management Portal

Professional self-service printer installation system with intelligent features and driver management.

## 🎯 Overview

A complete printer management solution designed for enterprise environments with:
- **Multi-site support** (Munich, London, Bangalore, etc.)
- **Intelligent driver management** (Point-and-Print, Universal Print, Pre-staged)
- **Location auto-detection** via IP subnet
- **Department-based filtering**
- **Modern GUI** with search and selection
- **JSON-based configuration** (no code changes needed!)

## 📦 What's Included

### Scripts

| Script | Purpose |
|--------|---------|
| `Install-PrintersPortal.ps1` | Main enterprise portal with GUI |
| `Select-Printers.ps1` | Simple server query tool |
| `PrinterConfig.json` | Configuration file (customize!) |

### Features Comparison

| Feature | Simple Tool | Enterprise Portal |
|---------|-------------|-------------------|
| Print server query | ✅ | ✅ |
| GUI selection | ✅ | ✅ Advanced |
| Driver management | ❌ | ✅ Full |
| Location detection | ❌ | ✅ Auto |
| JSON config | ❌ | ✅ Yes |
| Multi-site | ❌ | ✅ Yes |
| Department filter | ❌ | ✅ Yes |

## 🚀 Quick Start

### Enterprise Portal (Recommended)

```powershell
# 1. Customize PrinterConfig.json for your environment
# 2. Run the portal
.\Install-PrintersPortal.ps1

# Auto-detects location and shows available printers
```

### Simple Tool (Single Print Server)

```powershell
# Query a specific print server
.\Select-Printers.ps1 -PrintServer "printserver01"

# Shows all printers, user selects what to install
```

## 🔧 Configuration

### Edit PrinterConfig.json

The configuration file is **THE KEY** to customizing the portal. No PowerShell knowledge needed!

#### 1. Configure Locations

```json
{
  "locations": [
    {
      "name": "Munich",
      "subnet": "10.1.0.0/16",          // ← Your Munich subnet
      "printServer": "printserver-muc.company.com",
      "timezone": "W. Europe Standard Time",
      "country": "DE"
    },
    {
      "name": "Bangalore",
      "subnet": "10.3.0.0/16",          // ← Your Bangalore subnet
      "printServer": "printserver-blr.company.com",
      "timezone": "India Standard Time",
      "country": "IN"
    }
  ]
}
```

**How location detection works:**
- Script gets user's IP address
- Matches IP against subnet ranges
- Automatically filters printers for that location

#### 2. Add Printers

```json
{
  "printers": [
    {
      "id": "HP-LJ-MUC-F2",                    // Unique ID
      "name": "HP LaserJet Pro - Floor 2",     // Display name
      "server": "printserver-muc.company.com",
      "shareName": "HP-LJ-F2",                 // Share name on server
      "location": "Munich",                     // Must match location name
      "department": "All",                      // "All", "IT", "HR", "Finance", etc.
      "building": "Building A",
      "floor": "2",
      "room": "2.15",
      "driver": {
        "name": "HP Universal Printing PCL 6",
        "strategy": "PointAndPrint",           // See driver strategies below
        "fallback": "UniversalPrint"
      },
      "features": {
        "color": false,
        "duplex": true,
        "stapler": false,
        "maxPaperSize": "A4"
      },
      "description": "High-speed B&W printer with duplex",
      "contact": "IT Support ext. 2100",
      "enabled": true,
      "tags": ["high-volume", "duplex", "floor-2"]
    }
  ]
}
```

## 🎨 Driver Management (YOUR QUESTION!)

### The Driver Problem

Windows 11 has **strict driver requirements**:
- Drivers must be **signed**
- Point-and-Print has **security restrictions** (KB5005565)
- Users often **can't install drivers** without admin rights

### Our Solution: 4 Driver Strategies

#### Strategy 1: Point-and-Print (Default)

**Best for:** Windows Server print servers with published drivers

```json
"driver": {
  "name": "HP Universal Printing PCL 6",
  "strategy": "PointAndPrint",
  "fallback": "UniversalPrint"
}
```

**How it works:**
- Driver is on the print server
- Windows automatically downloads & installs driver
- **Requires:** Print server configured with driver
- **Security:** May require GPO changes for non-admin users

**GPO Settings (if needed):**
```
Computer Configuration > Policies > Administrative Templates > Printers
  - Point and Print Restrictions: Configure trusted servers
  - Package Point and Print: Allow non-admins to install drivers
```

#### Strategy 2: Universal Print Driver (Fallback)

**Best for:** Environments where Point-and-Print is restricted

```json
"driver": {
  "name": "Microsoft Print To PDF",  // Or any Universal driver
  "strategy": "UniversalPrint",
  "fallback": null
}
```

**How it works:**
- Uses Microsoft Universal Print Driver (included in Windows)
- Works with most modern printers
- No admin rights needed
- **Downside:** May lack vendor-specific features

**Pre-requisite:** Deploy Universal Print Driver via Intune first

#### Strategy 3: Pre-Staged Drivers

**Best for:** Enterprise with Intune/SCCM

```json
"driver": {
  "name": "HP Universal Printing PCL 6",
  "strategy": "PreStaged",
  "fallback": "UniversalPrint"
}
```

**How it works:**
1. **Admin:** Deploy driver package via Intune **BEFORE** printer installation
2. **User:** Runs portal, driver already present
3. **Printer:** Installs using local driver (no admin rights needed)

**Intune Setup:**
```powershell
# 1. Package driver as Win32 App or Driver Update
# 2. Deploy to device group
# 3. Detection: Check if driver exists
#    Get-PrinterDriver -Name "HP Universal Printing PCL 6"
```

#### Strategy 4: Local Repository (Advanced)

**Best for:** Offline environments or air-gapped networks

```json
"drivers": {
  "repository": "\\\\fileserver\\PrinterDrivers",
  "strategies": [...]
}
```

**How it works:**
- All drivers stored on network share
- Script copies driver to local system
- Installs via pnputil or Add-PrinterDriver
- **Requires:** Admin rights or Intune package

### Recommended Approach

**Small company (<100 users):**
```
Point-and-Print + GPO configuration
```

**Medium company (100-500 users):**
```
Pre-Staged Drivers via Intune + Universal Print fallback
```

**Large company (500+ users, multi-site):**
```
Pre-Staged Drivers + Universal Print + Point-and-Print mix
Different strategies per location
```

## 📍 Location Detection

### How It Works

```powershell
# Script gets IP
$IP = "10.1.5.42"

# Checks against subnets in config
"10.1.0.0/16"  → Matches! → Location = "Munich"
"10.2.0.0/16"  → No match
"10.3.0.0/16"  → No match
```

### Customize Subnets

Edit `PrinterConfig.json`:

```json
{
  "locations": [
    {
      "name": "YourOffice",
      "subnet": "YOUR.SUBNET.0.0/16",  // ← Change this!
      "printServer": "your-printserver",
      "country": "US"
    }
  ]
}
```

**Find your subnet:**
```powershell
# Run on client PC
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' }

# Look for IP like: 192.168.1.50
# Subnet would be: 192.168.0.0/16 or 192.168.1.0/24
```

## 🎯 Usage Scenarios

### Scenario 1: User Self-Service

Deploy as **Available** app in Intune Company Portal:

```
1. User opens Company Portal
2. Clicks "Printer Installation"
3. Portal auto-detects location (e.g., "Munich")
4. Shows only Munich printers
5. User selects desired printers
6. Printers install automatically
```

### Scenario 2: IT Support

IT desk uses simple tool for quick printer queries:

```powershell
.\Select-Printers.ps1 -PrintServer "printserver-muc"
# Shows all printers, IT selects and installs
```

### Scenario 3: Department-Specific

Filter by department:

```powershell
.\Install-PrintersPortal.ps1 -Department "Finance"
# Shows only Finance printers
```

### Scenario 4: Remote Worker

User connects via VPN:

```powershell
.\Install-PrintersPortal.ps1 -Location "Headquarters"
# Manually specify location since VPN IP won't match office subnet
```

## 📋 Intune Deployment

### Portal Deployment (Win32 App)

**Package:**
```
Files to package:
- Install-PrintersPortal.ps1
- PrinterConfig.json
- (Optional) Icon file
```

**Install Command:**
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\Install-PrintersPortal.ps1
```

**Detection Rule:**
```
Registry:
  Key: HKEY_CURRENT_USER\SOFTWARE\AutopilotDeployment\PrinterPortal
  Value: LastRun
  Type: String
  Detection: Key exists
```

**Assignment:**
- **Type:** Available
- **Context:** User
- **Display in Company Portal:** Yes

### Pre-Stage Drivers (Optional but Recommended)

**For each driver:**
```
1. Download vendor driver package
2. Create Win32 App
3. Install command: pnputil /add-driver DriverFolder\*.inf
4. Detection: Get-PrinterDriver -Name "DriverName"
5. Deploy to All Devices (before portal)
```

## 🔍 Troubleshooting

### Issue: No printers shown

**Check:**
1. Is `PrinterConfig.json` in same folder as script?
2. Is location detected correctly? (Check logs)
3. Are any printers configured for detected location?

**Solution:**
```powershell
# Show all printers (bypass filters)
.\Install-PrintersPortal.ps1 -ShowAll

# Check logs
Get-Content C:\ProgramData\Intune\Logs\PrinterPortal.log -Tail 50
```

### Issue: Driver not found

**Check:**
1. Is driver name correct in config?
2. Is driver installed on print server?
3. Is driver pre-staged (if using PreStaged strategy)?

**Solution:**
```powershell
# Check installed drivers
Get-PrinterDriver

# Try fallback
# Edit PrinterConfig.json, set fallback: "UniversalPrint"
```

### Issue: Access denied

**Check:**
1. Can user access print server? (network connectivity)
2. Is share configured correctly?
3. Does user have permissions?

**Solution:**
```powershell
# Test connection
Test-Connection printserver-muc -Count 1

# Test share access
Get-ChildItem "\\printserver-muc\HP-LJ-F2"
```

### Issue: Point-and-Print blocked

**Windows 11 restriction (KB5005565)**

**Solution:**
```
Option 1: Configure GPO
  Computer Config > Policies > Admin Templates > Printers
    Point and Print Restrictions: Configure trusted servers

Option 2: Use Pre-Staged strategy instead
  Deploy drivers via Intune beforehand

Option 3: Use Universal Print Driver
  Change strategy to "UniversalPrint"
```

## 📊 Monitoring & Reporting

### Usage Tracking

Portal saves usage data in registry:

```powershell
# Check user's printer portal usage
$Path = "HKCU:\SOFTWARE\AutopilotDeployment\PrinterPortal"
Get-ItemProperty -Path $Path

# Output:
# LastRun          : 2025-10-26 14:30:00
# Location         : Munich
# PrintersInstalled: 2
```

### Centralized Logging

All actions logged to:
```
C:\ProgramData\Intune\Logs\PrinterPortal.log
```

Collect via Intune Log Analytics or SIEM.

## 🎓 Best Practices

### 1. Start Simple
```
Week 1: Deploy simple tool (Select-Printers.ps1)
Week 2: Customize PrinterConfig.json
Week 3: Deploy Enterprise Portal
Week 4: Add driver pre-staging
```

### 2. Test Thoroughly
```powershell
# Test in pilot group first
- 10 users per location
- All departments represented
- Different scenarios (office, VPN, mobile)
```

### 3. Document Your Setup
```
Create internal wiki with:
- Your subnet ranges
- Print server names
- Supported printers
- How to request new printers
```

### 4. Driver Strategy

**Recommended:**
```
Primary:   Pre-Staged (via Intune)
Fallback:  Universal Print Driver
Emergency: Point-and-Print (with GPO)
```

## 📞 Support

**Users can:**
- Check logs: `C:\ProgramData\Intune\Logs\PrinterPortal.log`
- Re-run portal if installation fails
- Contact IT with printer ID from config

**Admins can:**
- Update `PrinterConfig.json` anytime (no script changes!)
- Add new printers by editing JSON
- Change driver strategies per printer
- Enable/disable printers via `"enabled": false`

## 🔄 Updates

### Adding New Printer

```json
// Edit PrinterConfig.json, add to "printers" array:
{
  "id": "NEW-PRINTER-ID",
  "name": "New Printer Name",
  "server": "printserver-muc.company.com",
  "shareName": "NewPrinter",
  "location": "Munich",
  "department": "All",
  "driver": {
    "name": "Driver Name",
    "strategy": "PointAndPrint",
    "fallback": "UniversalPrint"
  },
  "features": { ... },
  "enabled": true
}

// Re-deploy PrinterConfig.json to Intune
// Users see new printer immediately (no script update needed!)
```

### Disabling Printer

```json
// Find printer in config, set:
"enabled": false

// Printer hidden from portal immediately
```

## 📈 Roadmap

Future enhancements:
- [ ] Printer health monitoring (toner, paper)
- [ ] Test page printing after installation
- [ ] Favorites and recent printers
- [ ] Web-based admin portal for config management
- [ ] Automatic driver updates
- [ ] Cost tracking per user/department
- [ ] Print quota integration

## 💡 Pro Tips

1. **Use descriptive printer names:** Include location, floor, room
2. **Keep share names short:** Easier to type manually if needed
3. **Tag your printers:** Helps users find what they need
4. **Update contact info:** Users appreciate knowing who to call
5. **Test driver strategies:** Different printers may need different approaches

---

**Made with ❤️ for IT Administrators**

For questions or feature requests, contact your IT department.
