param([ValidateSet('host','serve','join')][string]$Mode='host',[string]$Target)
$launcher = Join-Path $PSScriptRoot 'launch.mjs'
if ($Target) { & node $launcher $Mode $Target } else { & node $launcher $Mode }
exit $LASTEXITCODE
