param(
	[switch]$Doctor,
	[switch]$SkipInstall,
	[switch]$SkipTests,
	[switch]$FullTests,
	[switch]$NoFrozenLockfile,
	[switch]$BuildBundle,
	[switch]$Dev,
	[string]$LogPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$IsNativeWindows = ($env:OS -eq "Windows_NT")
if (-not $IsNativeWindows) {
	throw "Run this from native Windows PowerShell, not WSL. From this checkout: scripts\test-windows.cmd"
}

$ScriptDir = if ($PSScriptRoot) {
	$PSScriptRoot
} elseif ($env:HELMOR_WINDOWS_TEST_SCRIPT_DIR) {
	$env:HELMOR_WINDOWS_TEST_SCRIPT_DIR
} else {
	throw "Unable to resolve script directory. Run through: scripts\test-windows.cmd"
}
$Root = Resolve-Path (Join-Path $ScriptDir "..")
$script:WindowsTestLogPath = $null
$script:WindowsTestTranscriptStarted = $false

function Start-WindowsTestLog {
	if ($LogPath) {
		$resolvedLogPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($LogPath)
	} else {
		$logsDir = Join-Path $Root "logs\windows-tests"
		$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
		$resolvedLogPath = Join-Path $logsDir "test-windows-$timestamp.log"
	}

	$logDir = Split-Path -Parent $resolvedLogPath
	if ($logDir) {
		New-Item -ItemType Directory -Force -Path $logDir | Out-Null
	}

	$script:WindowsTestLogPath = $resolvedLogPath
	Start-Transcript -Path $script:WindowsTestLogPath -Force | Out-Null
	$script:WindowsTestTranscriptStarted = $true
	Write-Host "log: $script:WindowsTestLogPath" -ForegroundColor DarkGray
}

function Stop-WindowsTestLog {
	if ($script:WindowsTestTranscriptStarted) {
		try {
			Stop-Transcript | Out-Null
		} catch {
			Write-Host "warning: failed to stop transcript: $_" -ForegroundColor Yellow
		}
		$script:WindowsTestTranscriptStarted = $false
	}
	if ($script:WindowsTestLogPath) {
		Write-Host "log saved: $script:WindowsTestLogPath" -ForegroundColor DarkGray
	}
}

function Write-Section {
	param([string]$Message)
	Write-Host ""
	Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Step {
	param(
		[string]$Name,
		[scriptblock]$Script
	)
	Write-Section $Name
	$sw = [Diagnostics.Stopwatch]::StartNew()
	$global:LASTEXITCODE = $null
	& $Script
	$exitCode = $global:LASTEXITCODE
	$sw.Stop()
	if ($null -ne $exitCode -and $exitCode -ne 0) {
		throw "$Name failed with exit code $exitCode"
	}
	Write-Host "ok: $Name ($([math]::Round($sw.Elapsed.TotalSeconds, 1))s)" -ForegroundColor Green
}

function Invoke-ProcessWithHeartbeat {
	param(
		[string]$FilePath,
		[string[]]$ArgumentList,
		[int]$HeartbeatSeconds = 30
	)

	$commandLine = "$FilePath $($ArgumentList -join ' ')"
	Write-Host "$ $commandLine"
	$process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -NoNewWindow -PassThru
	$sw = [Diagnostics.Stopwatch]::StartNew()
	while (-not $process.HasExited) {
		Start-Sleep -Seconds $HeartbeatSeconds
		if (-not $process.HasExited) {
			$elapsed = [math]::Round($sw.Elapsed.TotalMinutes, 1)
			Write-Host "still running: $commandLine (${elapsed}m elapsed)" -ForegroundColor DarkGray
		}
	}
	$process.WaitForExit()
	$process.Refresh()
	$sw.Stop()
	$exitCode = $process.ExitCode
	if ($null -eq $exitCode) {
		Write-Host "warning: $commandLine finished but Windows did not report an exit code; continuing." -ForegroundColor Yellow
		return
	}
	if ($exitCode -ne 0) {
		throw "$commandLine failed with exit code $exitCode"
	}
}

function Require-Command {
	param(
		[string]$Name,
		[string]$Hint
	)
	if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
		throw "Missing required command '$Name'. $Hint"
	}
}

function Add-BunToPath {
	$candidates = @()
	if ($env:BUN_INSTALL) {
		$candidates += (Join-Path $env:BUN_INSTALL "bin")
	}
	if ($env:USERPROFILE) {
		$candidates += (Join-Path $env:USERPROFILE ".bun\bin")
	}
	if ($env:LOCALAPPDATA) {
		$candidates += (Join-Path $env:LOCALAPPDATA "Programs\Bun")
	}

	foreach ($candidate in $candidates) {
		if ($candidate -and (Test-Path (Join-Path $candidate "bun.exe"))) {
			if (($env:PATH -split ";") -notcontains $candidate) {
				$env:PATH = "$candidate;$env:PATH"
			}
			return
		}
	}
}

function Ensure-Bun {
	Add-BunToPath
	if (Get-Command "bun" -ErrorAction SilentlyContinue) {
		return
	}

	Invoke-Step "Installing Bun for Windows" {
		$installer = Invoke-WebRequest -Uri "https://bun.sh/install.ps1" -UseBasicParsing
		Invoke-Expression $installer.Content
	}

	Add-BunToPath
	if (-not (Get-Command "bun" -ErrorAction SilentlyContinue)) {
		throw "Bun installed, but bun.exe is still not on PATH. Open a new PowerShell or add %USERPROFILE%\.bun\bin to PATH."
	}
}

function Add-CargoBinToPath {
	if (-not $env:USERPROFILE) {
		return
	}
	$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
	if (Test-Path $cargoBin) {
		if (($env:PATH -split ";") -notcontains $cargoBin) {
			$env:PATH = "$cargoBin;$env:PATH"
		}
	}
}

function Ensure-Sccache {
	Add-CargoBinToPath
	if (Get-Command "sccache" -ErrorAction SilentlyContinue) {
		return
	}

	Invoke-Step "Installing sccache" {
		cargo install sccache --locked
	}

	Add-CargoBinToPath
	Require-Command "sccache" "cargo install sccache completed, but sccache.exe is still not on PATH. Open a new PowerShell or add %USERPROFILE%\.cargo\bin to PATH."
}

function Ensure-HelmorWindowsDataEnv {
	if (-not $env:HOME) {
		if (-not $env:USERPROFILE) {
			throw "Neither HOME nor USERPROFILE is set; Helmor cannot resolve a data directory."
		}
		$env:HOME = $env:USERPROFILE
	}

	if (-not $env:HELMOR_DATA_DIR) {
		$env:HELMOR_DATA_DIR = Join-Path $env:HOME "helmor-dev"
	}
}

function Set-BundledAgentEnv {
	$vendorRoot = Join-Path $Root "sidecar\dist\vendor"
	$codexBin = Join-Path $vendorRoot "codex\codex.exe"
	$bunBin = Join-Path $vendorRoot "bun\bun.exe"
	$claudeCli = Join-Path $vendorRoot "claude-code\cli.js"

	if (Test-Path $codexBin) {
		$env:HELMOR_CODEX_BIN_PATH = $codexBin
	}
	if (Test-Path $bunBin) {
		$env:HELMOR_BUN_PATH = $bunBin
	}
	if (Test-Path $claudeCli) {
		$env:HELMOR_CLAUDE_CODE_CLI_PATH = $claudeCli
	}
}

function Invoke-Doctor {
	Write-Section "Checking Windows toolchain"
	Ensure-Bun
	Ensure-HelmorWindowsDataEnv
	Require-Command "cargo" "Install Rust with the MSVC toolchain from https://rustup.rs/."
	Require-Command "rustc" "Install Rust with the MSVC toolchain from https://rustup.rs/."
	Require-Command "git" "Install Git for Windows and reopen PowerShell."
	Ensure-Sccache

	$bunVersion = (bun --version).Trim()
	$cargoVersion = (cargo --version).Trim()
	$sccacheVersion = (sccache --version).Trim()
	$rustHost = ((rustc -vV) | Select-String "^host:").ToString()
	Write-Host "bun:   $bunVersion"
	Write-Host "cargo: $cargoVersion"
	Write-Host "sccache: $sccacheVersion"
	Write-Host "rust:  $rustHost"
	Write-Host "data:  $env:HELMOR_DATA_DIR"

	if ($rustHost -notmatch "windows-msvc") {
		throw "Rust host must be an MSVC Windows target. Current $rustHost"
	}

	Write-Host "ok: toolchain is ready" -ForegroundColor Green
}

Start-WindowsTestLog
try {
	Set-Location $Root

	Invoke-Doctor

	if (-not $Doctor) {
		if (-not $SkipInstall) {
			Invoke-Step "Installing dependencies" {
				Write-Host "First Windows install can look quiet for several minutes while Bun unpacks packages and Windows Defender scans node_modules." -ForegroundColor Yellow
				$installArgs = @("install")
				if (-not $NoFrozenLockfile) {
					$installArgs += "--frozen-lockfile"
				}
				Invoke-ProcessWithHeartbeat -FilePath "bun" -ArgumentList $installArgs -HeartbeatSeconds 30
			}
		}

		if ($Dev) {
			Invoke-Step "Preparing Windows sidecar vendor binaries" {
				bun run dev:prepare
			}
			Set-BundledAgentEnv
			Write-Section "Starting Helmor dev app"
			bun run dev
			if ($LASTEXITCODE) {
				exit $LASTEXITCODE
			}
		} else {
			if (-not $SkipTests) {
				Invoke-Step "Typechecking frontend and sidecar" {
					bun run typecheck
				}
			}

			if ($FullTests -and -not $SkipTests) {
				Write-Host "Full frontend/sidecar/Rust test suites are currently opt-in on Windows; expect failures until the Windows test port is complete." -ForegroundColor Yellow
				Invoke-Step "Running frontend tests" {
					bun run test:frontend
				}
				Invoke-Step "Running sidecar tests" {
					bun run test:sidecar
				}
				Invoke-Step "Compiling Rust tests" {
					cargo test --manifest-path src-tauri/Cargo.toml --all-targets --no-run
				}
			} elseif (-not $SkipTests) {
				Write-Host "Skipping full unit suites on Windows smoke run. Use -FullTests to run them." -ForegroundColor Yellow
			}

			Invoke-Step "Building Windows sidecar and bundled vendor CLIs" {
				Push-Location sidecar
				try {
					bun run build:windows
				} finally {
					Pop-Location
				}
			}

			Set-BundledAgentEnv

			if ($BuildBundle) {
				Invoke-Step "Building Windows Tauri debug bundle" {
					bun x tauri build --debug
				}
			}

			Write-Host ""
			Write-Host "Windows smoke test complete." -ForegroundColor Green
			Write-Host "Next: bun run dev:windows"
		}
	}
} finally {
	Stop-WindowsTestLog
}
