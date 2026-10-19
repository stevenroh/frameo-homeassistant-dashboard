# Builds build\homehq.apk without Gradle, with the dashboard page bundled as assets.
# Called by ../build.sh from a Windows-local staging copy (Resolve-Path breaks on \\wsl.localhost paths).
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Assets <dir with index.html, the page scripts, config.js>
# Uses the Android Studio JBR and the installed build-tools 36.1.0 + platform android-36.1.
param([Parameter(Mandatory = $true)][string]$Assets, [string]$Keystore)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
$bt  = "$sdk\build-tools\36.1.0"
$jar = "$sdk\platforms\android-36.1\android.jar"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
if (-not (Test-Path "$Assets\index.html")) { throw "index.html not found in $Assets" }
$ks  = if ($Keystore) { $Keystore } else { "$env:USERPROFILE\.android\debug.keystore" }
if (-not (Test-Path $jar)) { throw "android.jar not found at $jar" }

if (Test-Path build) { Remove-Item build -Recurse -Force }
New-Item -ItemType Directory build\gen, build\classes | Out-Null

function Run($exe, [string[]]$a) {
  & $exe @a
  if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" }
}

Run "$bt\aapt2.exe" @('compile', '--dir', 'res', '-o', 'build\res.zip')
Run "$bt\aapt2.exe" @('link', '-o', 'build\base.apk', '-I', $jar, '--manifest', 'AndroidManifest.xml', 'build\res.zip',
  '--java', 'build\gen', '-A', $Assets, '--min-sdk-version', '23', '--target-sdk-version', '23', '--version-code', '4', '--version-name', '1.3-denver')

$src = @(Get-ChildItem src -Recurse -Filter *.java | % FullName) + @('build\gen\com\wesbos\homehq\R.java')
Run 'javac' (@('-nowarn', '-source', '8', '-target', '8', '-classpath', $jar, '-d', 'build\classes') + $src)

$classes = Get-ChildItem build\classes -Recurse -Filter *.class | % FullName
Run "$bt\d8.bat" (@('--min-api', '23', '--lib', $jar, '--output', 'build') + $classes)

# Add classes.dex to the APK (it is a zip).
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open((Resolve-Path build\base.apk), 'Update')
[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-Path build\classes.dex), 'classes.dex') | Out-Null
$zip.Dispose()

Run "$bt\zipalign.exe" @('-f', '4', 'build\base.apk', 'build\aligned.apk')

if (-not (Test-Path $ks)) {
  New-Item -ItemType Directory -Force (Split-Path $ks) | Out-Null
  Run 'keytool' @('-genkeypair', '-keystore', $ks, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Android Debug,O=Android,C=US')
}
Run "$bt\apksigner.bat" @('sign', '--ks', $ks, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', 'build\homehq.apk', 'build\aligned.apk')
Write-Output "Built kiosk\build\homehq.apk"
