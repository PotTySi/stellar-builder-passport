$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ContractDir = Join-Path $Root "builder-passport-contract"
$EnvPath = Join-Path $Root ".env"
$AppPath = Join-Path $Root "src\App.jsx"

$Identity = "deployer"
$Network = "testnet"

Write-Host ""
Write-Host "=== Stellar Builder Passport Auto Deploy ===" -ForegroundColor Cyan

if (!(Test-Path $ContractDir)) {
    throw "Contract folder not found: $ContractDir"
}

# 1. Check or create deployer identity
Write-Host ""
Write-Host "Checking deployer identity..." -ForegroundColor Yellow

try {
    $AdminAddress = (cmd /c "stellar keys address $Identity 2>&1").Trim()

    if ($AdminAddress -notmatch "^G[A-Z0-9]{55}$") {
        throw "Invalid deployer address"
    }

    Write-Host "Found deployer: $AdminAddress" -ForegroundColor Green
}
catch {
    Write-Host "Deployer not found. Creating deployer..." -ForegroundColor Yellow

    cmd /c "stellar keys generate $Identity --network $Network"
    cmd /c "stellar keys fund $Identity --network $Network"

    $AdminAddress = (cmd /c "stellar keys address $Identity 2>&1").Trim()

    if ($AdminAddress -notmatch "^G[A-Z0-9]{55}$") {
        throw "Failed to create deployer identity."
    }

    Write-Host "Created deployer: $AdminAddress" -ForegroundColor Green
}

# 2. Build contract
Write-Host ""
Write-Host "Building contract..." -ForegroundColor Yellow

Push-Location $ContractDir

cmd /c "stellar contract build"

if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "Contract build failed."
}

# 3. Find newest wasm file
$WasmFile = Get-ChildItem -Path (Join-Path $ContractDir "target") -Recurse -Filter "*.wasm" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $WasmFile) {
    Pop-Location
    throw "No WASM file found after build."
}

Write-Host "Using WASM file:" -ForegroundColor Green
Write-Host $WasmFile.FullName -ForegroundColor Green

# 4. Deploy contract
Write-Host ""
Write-Host "Deploying contract to Stellar Testnet..." -ForegroundColor Yellow

$DeployCommand = 'stellar contract deploy --wasm "' + $WasmFile.FullName + '" --source-account ' + $Identity + ' --network ' + $Network + ' 2>&1'
$DeployOutput = cmd /c $DeployCommand
$DeployText = $DeployOutput | Out-String

Write-Host $DeployText

$ContractMatches = [regex]::Matches($DeployText, "C[A-Z0-9]{55}")

if ($ContractMatches.Count -eq 0) {
    Pop-Location
    throw "Could not find Contract ID in deploy output."
}

$ContractId = $ContractMatches[$ContractMatches.Count - 1].Value

Write-Host ""
Write-Host "New Contract ID: $ContractId" -ForegroundColor Green

# 5. Initialize contract
Write-Host ""
Write-Host "Initializing contract..." -ForegroundColor Yellow

$InitCommand = 'stellar contract invoke --id ' + $ContractId + ' --source ' + $Identity + ' --network ' + $Network + ' --send=yes -- initialize --admin ' + $AdminAddress + ' 2>&1'
$InitOutput = cmd /c $InitCommand
$InitText = $InitOutput | Out-String

Write-Host $InitText

if ($InitText -notmatch "Transaction submitted successfully") {
    Pop-Location
    throw "Initialize failed."
}

# 6. Create default badge
Write-Host ""
Write-Host "Creating default badge..." -ForegroundColor Yellow

$BadgeCommand = 'stellar contract invoke --id ' + $ContractId + ' --source ' + $Identity + ' --network ' + $Network + ' --send=yes -- create_badge --badge_id 1 --name "Stellar Explorer" --required_points 50 2>&1'
$BadgeOutput = cmd /c $BadgeCommand
$BadgeText = $BadgeOutput | Out-String

Write-Host $BadgeText

if ($BadgeText -notmatch "Transaction submitted successfully") {
    Pop-Location
    throw "Create badge failed."
}

Pop-Location

# 7. Write .env
Write-Host ""
Write-Host "Writing Contract ID to .env..." -ForegroundColor Yellow

Set-Content -Path $EnvPath -Value "VITE_CONTRACT_ID=$ContractId"

Write-Host ".env updated:" -ForegroundColor Green
Write-Host "VITE_CONTRACT_ID=$ContractId" -ForegroundColor Green

# 8. Update App.jsx to read from .env
if (Test-Path $AppPath) {
    Write-Host ""
    Write-Host "Updating App.jsx..." -ForegroundColor Yellow

    $AppContent = Get-Content $AppPath -Raw

    $HardcodedPattern = 'const\s+CONTRACT_ID\s*=\s*["''][^"'']+["'']\s*;'
    $EnvPattern = 'const\s+CONTRACT_ID\s*=\s*import\.meta\.env\.VITE_CONTRACT_ID\s*;'
    $Replacement = 'const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID;'

    if ($AppContent -match $EnvPattern) {
        Write-Host "App.jsx already reads Contract ID from .env" -ForegroundColor Green
    }
    elseif ($AppContent -match $HardcodedPattern) {
        $UpdatedContent = [regex]::Replace($AppContent, $HardcodedPattern, $Replacement)
        Set-Content -Path $AppPath -Value $UpdatedContent
        Write-Host "App.jsx updated to read Contract ID from .env" -ForegroundColor Green
    }
    else {
        Write-Host "Could not find CONTRACT_ID line in App.jsx. Please check manually once." -ForegroundColor Yellow
    }
}
else {
    Write-Host "App.jsx not found. Skipping frontend update." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Cyan
Write-Host "Contract ID: $ContractId" -ForegroundColor Green
Write-Host "Admin: $AdminAddress" -ForegroundColor Green
Write-Host ""
Write-Host "Next step:" -ForegroundColor Yellow
Write-Host "1. Stop Vite if it is running: Ctrl + C"
Write-Host "2. Start again: npm run dev"
Write-Host ""