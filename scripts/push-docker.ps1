[CmdletBinding()]
param(
    [string]$Image = 'mrtrilb/gh-runner-manager',
    [string]$SourceTag = 'latest',
    [switch]$Build
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$metadataPath = Join-Path $repositoryRoot 'metadata.json'

function Invoke-Docker {
    param([string[]]$Arguments)

    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker command failed with exit code ${LASTEXITCODE}: docker $($Arguments -join ' ')"
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI was not found. Start Docker Desktop and ensure docker is on PATH.'
}

if (-not (Test-Path $metadataPath)) {
    throw "Could not find metadata.json at $metadataPath."
}

$metadata = Get-Content -Raw -Path $metadataPath | ConvertFrom-Json
$version = [string]$metadata.version
if ([string]::IsNullOrWhiteSpace($version) -or $version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
    throw "metadata.json contains an invalid release version: '$version'."
}

$sourceImage = "${Image}:${SourceTag}"
$versionImage = "${Image}:${version}"
$latestImage = "${Image}:latest"

Write-Host "Release version: $version"
Write-Host "Source image:    $sourceImage"
Write-Host "Version image:   $versionImage"

if ($Build) {
    Write-Host "Building $sourceImage..."
    Invoke-Docker @('build', '--tag', $sourceImage, $repositoryRoot)
}
else {
    & docker image inspect $sourceImage *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Source image '$sourceImage' was not found locally. Build it first or rerun with -Build."
    }
}

Invoke-Docker @('tag', $sourceImage, $versionImage)

$updateLatestAnswer = Read-Host 'Also update and push latest? [y/N]'
$updateLatest = $updateLatestAnswer -match '^(y|yes)$'

$imagesToPush = @($versionImage)
if ($updateLatest) {
    if ($sourceImage -ne $latestImage) {
        Invoke-Docker @('tag', $sourceImage, $latestImage)
    }
    $imagesToPush += $latestImage
}

Write-Host "Pushing: $($imagesToPush -join ', ')"
foreach ($imageToPush in $imagesToPush) {
    Invoke-Docker @('image', 'push', $imageToPush)
}

Write-Host "Docker release completed for $version."
