# Cloud Management Portal - Docker Image
# Based on PowerShell Core 7.4

FROM mcr.microsoft.com/powershell:7.4-ubuntu-22.04

# Set working directory
WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY src/ /app/src/
COPY config/ /app/config/
COPY scripts/ /app/scripts/

# Install PowerShell modules
RUN pwsh -Command " \
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; \
    Install-Module -Name Pode -MinimumVersion 2.10.0 -Scope AllUsers -Force; \
    Write-Host 'PowerShell modules installed successfully' \
    "

# Create necessary directories
RUN mkdir -p /app/logs /app/cache

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

# Set entrypoint
ENTRYPOINT ["pwsh", "-File", "/app/src/API/Server.ps1"]
