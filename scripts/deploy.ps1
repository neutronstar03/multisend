param(
    [Parameter(Mandatory=$true)][string]$Account,
    [string]$RpcUrl = 'https://ethereum-rpc.publicnode.com',
    [int]$ChainId = 1,
    [decimal]$MaxFeeGwei,
    [decimal]$PriorityFeeGwei,
    [switch]$Broadcast
)
$ErrorActionPreference = 'Stop'
$feeArgs = @()
if ($PSBoundParameters.ContainsKey('MaxFeeGwei')) {
    if ($MaxFeeGwei -le 0) { throw 'MaxFeeGwei must be positive.' }
    $feeArgs += @('--gas-price', ($MaxFeeGwei.ToString([cultureinfo]::InvariantCulture) + 'gwei'))
}
if ($PSBoundParameters.ContainsKey('PriorityFeeGwei')) {
    if ($PriorityFeeGwei -lt 0) { throw 'PriorityFeeGwei must not be negative.' }
    if ($PSBoundParameters.ContainsKey('MaxFeeGwei') -and $PriorityFeeGwei -gt $MaxFeeGwei) {
        throw 'PriorityFeeGwei must not exceed MaxFeeGwei.'
    }
    $feeArgs += @('--priority-gas-price', ($PriorityFeeGwei.ToString([cultureinfo]::InvariantCulture) + 'gwei'))
}
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    bun run artifacts
    if ($LASTEXITCODE -ne 0) { throw 'Contract build failed.' }
    $env:MAINNET_RPC_URL = $RpcUrl
    $env:DEPLOY_CHAIN_ID = "$ChainId"
    bun scripts/prepare-deploy.ts
    if ($LASTEXITCODE -ne 0) { throw 'Deployment preflight failed.' }
    $plan = Get-Content -LiteralPath deployment-plan.json -Raw | ConvertFrom-Json
    if ($plan.state -eq 'already deployed, runtime matches') {
        Write-Output "Contract already deployed at $($plan.address). No transaction needed."
        return
    }
    $deployer = cast wallet address --account $Account
    if ($LASTEXITCODE -ne 0) { throw 'Could not open the Foundry deployer keystore.' }
    # cast estimate accepts raw calldata as its positional SIG argument, unlike cast send --data.
    $gas = cast estimate $plan.factory $plan.data --from $deployer --rpc-url $RpcUrl @feeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Deployment gas estimation failed.' }
    Write-Output "Deployer: $deployer"
    Write-Output "Chain: $ChainId | predicted contract: $($plan.address) | estimated gas: $gas"
    if ($feeArgs.Count -gt 0) { Write-Output "Fee overrides: $($feeArgs -join ' ')" }
    if (!$Broadcast) { Write-Output 'Preflight only. Add -Broadcast to sign and submit from this deployer keystore.'; return }
    cast send $plan.factory --data $plan.data --account $Account --rpc-url $RpcUrl --chain $ChainId @feeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Broadcast failed. Inspect wallet nonce and transaction before retrying.' }
    $runtime = cast code $plan.address --rpc-url $RpcUrl
    if ($LASTEXITCODE -ne 0) { throw 'Could not read deployed runtime.' }
    $runtimeHash = cast keccak $runtime
    if ($LASTEXITCODE -ne 0 -or $runtimeHash.Trim() -ne $plan.runtimeHash) { throw 'Deployed runtime does not match the build.' }
    Write-Output "Runtime matches. Verify source next: forge verify-contract --chain $ChainId --watch $($plan.address) contracts/MultiSend.sol:MultiSend"
} finally { Pop-Location }
