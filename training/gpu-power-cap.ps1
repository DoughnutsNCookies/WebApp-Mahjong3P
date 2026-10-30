#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Caps the GPU's power for training runs (default 450 W of the RTX 5090's 575 W), or puts it back.
    A cap costs little speed, keeps the card cooler and eases the load on the 16-pin power connector.
    The cap lasts until -Reset or a reboot. Needs an administrator PowerShell.

.EXAMPLE
    powershell -File training\gpu-power-cap.ps1            # cap at 450 W
    powershell -File training\gpu-power-cap.ps1 -Watts 400
    powershell -File training\gpu-power-cap.ps1 -Reset     # back to the card's default
#>
param([int]$Watts = 450, [switch]$Reset)

$default = [int][double](nvidia-smi --query-gpu=power.default_limit --format=csv,noheader,nounits).Trim()
$target = $(if ($Reset) { $default } else { $Watts })
if ($target -lt 250 -or $target -gt $default) { throw "Choose a limit between 250 and $default W." }
nvidia-smi -pl $target
nvidia-smi --query-gpu=name,power.limit,power.default_limit --format=csv
