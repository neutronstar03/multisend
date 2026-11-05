import './style.css';
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc20Abi, formatEther, formatUnits, getAddress, http, isAddress, keccak256, parseAbi, zeroAddress, type Abi, type Address, type EIP1193Provider, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import artifact from './contract.json';
import { discoverTokens, type Token } from './lib/discovery';
import { approvalAmount, batchFingerprint, MAX_TOKENS, parseAmount, validateBatch, type SelectedToken } from './lib/batch';
import { BatchPresets, applyGroup } from './lib/presets';
import { normalizeManual, verifyManualToken } from './lib/manual-tokens';
import { PendingApprovals } from './lib/approvals';
import { WalletSession, type Wallet } from './lib/wallet-session';

type Settings = { rpc:string; alchemyKey:string; etherscanKey:string; contract:string; recipient:string; unlimited:boolean; manual:string[] };
const defaults: Settings = { rpc:'https://ethereum-rpc.publicnode.com',alchemyKey:'',etherscanKey:'',contract:'0x6dd1CFbea062D4a6843BbbEA16912b76d585BA94',recipient:'',unlimited:true,manual:[] };
function restore(): Settings {
  try {
    const value: unknown=JSON.parse(localStorage.getItem('multisend.settings')??'null');
    if(!value || typeof value!=='object') return {...defaults};
    const s=value as Record<string,unknown>;
    return {rpc:typeof s.rpc==='string'?s.rpc:defaults.rpc,alchemyKey:typeof s.alchemyKey==='string'?s.alchemyKey:'',etherscanKey:typeof s.etherscanKey==='string'?s.etherscanKey:'',contract:typeof s.contract==='string'&&s.contract.trim()?s.contract:defaults.contract,recipient:typeof s.recipient==='string'?s.recipient:'',unlimited:typeof s.unlimited==='boolean'?s.unlimited:true,manual:Array.isArray(s.manual)?s.manual.filter((x):x is string=>typeof x==='string'&&isAddress(x)):[]};
  } catch {return {...defaults};}
}
let settings=restore();
settings.manual=normalizeManual(settings.manual);
let manualFeedback='',inventoryReady=false;

let savedSet:string[]=[];
try{const value:unknown=JSON.parse(localStorage.getItem('multisend.tokenSet')??'[]');if(Array.isArray(value))savedSet=value.filter((a):a is string=>typeof a==='string'&&isAddress(a)).map(a=>a.toLowerCase());}catch{/* No saved token set. */}
const presets=new BatchPresets(localStorage,savedSet,settings.recipient);
let destinationsOpen=false;
let groupId=presets.groups[0]?.id??'',presetFeedback='',recipientReviewed=false;
let sessionEpoch=0;
let settingsOpen=false,chosenWallet='';
const session=new WalletSession(localStorage,state=>{
  sessionEpoch++;presetFeedback='';manualFeedback='';inventoryReady=false;wallet=state.wallet;owner=state.account;tokens=[];selected.clear();scanId++;invalidate();
  lastHash=null;discoveryIssues=[];contractVerified=false;
  status=state.message;statusError=false;render();
  if(state.phase==='connected'){
    const id=scanId;
    void load().catch(e=>{if(scanId===id+1)notice(errorText(e),true);});
  }
});
const wallets=session.wallets;
let wallet: Wallet|null=null, owner:Address|null=null, tokens:Token[]=[], busy=false, query='', status='Connect a wallet to load its Ethereum balances.', statusError=false;
let selected=new Map<string,string>(), lastHash:Hex|null=null, scanId=0, reviewed:string|null=null, gasEstimate:bigint|null=null, feeEstimate:bigint|null=null, contractVerified=false;
status=session.state.message;
let discoveryIssues:string[]=[];
const pendingApprovals=new PendingApprovals(localStorage);
const approvalKey=(account:Address,contract:Address,token:string)=>`1:${account.toLowerCase()}:${contract.toLowerCase()}:${token.toLowerCase()}`;
function pendingApproval(token:string){return owner&&isAddress(settings.contract)?pendingApprovals.transactions.get(approvalKey(owner,getAddress(settings.contract),token)):undefined;}
function activeApprovalCount(){return owner&&isAddress(settings.contract)?pendingApprovals.count(approvalKey(owner,getAddress(settings.contract),'')):0;}
const batchAbi=artifact.abi as Abi;
const escape=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const short=(v:string)=>`${v.slice(0,6)}…${v.slice(-4)}`;
const save=()=>localStorage.setItem('multisend.settings',JSON.stringify(settings));
function client(){
  const url=new URL(settings.rpc);
  if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('Use an HTTPS RPC endpoint (or localhost for development).');
  return createPublicClient({chain:mainnet,transport:http(settings.rpc),pollingInterval:2500});
}
function spender():Address {if(!isAddress(settings.contract)||getAddress(settings.contract)===zeroAddress)throw new Error('Configure a deployed Multisend contract first.');return getAddress(settings.contract);}
function checkArtifact(){if(!artifact.abi.length||artifact.bytecode==='0x'||artifact.runtimeHash==='0x')throw new Error('Contract artifact is not built. Run bun run artifacts before publishing this app.');}
function items():SelectedToken[]{return tokens.filter(t=>selected.has(t.address.toLowerCase())).map(token=>({token,amount:parseAmount(selected.get(token.address.toLowerCase())!,token.decimals,token.balance)}));}
function itemsSafe():SelectedToken[]|null{try{return items();}catch{return null;}}
function simulationBlockReason():string {
  if(busy||['restoring','connecting'].includes(session.state.phase))return 'Wait for the current operation to finish.';
  if(!wallet||!owner)return 'Connect the sending wallet to simulate a batch.';
  if(!settings.contract)return 'Save the Multisend contract address first.';
  const pending=itemsSafe();
  if(pending===null)return 'Correct the selected token amounts first.';
  if(!pending.length)return 'Select at least one token to simulate a batch.';
  const active=activeApprovalCount();
  if(active)return `Waiting for ${active} approval transaction${active===1?'':'s'} to confirm. You can approve other tokens meanwhile.`;
  const count=pending.filter(i=>i.token.allowance===null||i.token.allowance<i.amount).length;
  return count?`Approve ${count} selected token${count===1?'':'s'} using the Approve buttons in the table, then simulate. Already approved? Refresh balances.`:'';
}
function updateSimulationControls(){
  const reason=simulationBlockReason();
  el<HTMLButtonElement>('simulate').disabled=!!reason;
  el('simulation-help').textContent=reason;
  el<HTMLButtonElement>('send').disabled=!reviewed||!recipientReviewed||!!reason;
  el<HTMLInputElement>('destination-reviewed').checked=recipientReviewed;
}
function invalidate(){recipientReviewed=false;reviewed=null;gasEstimate=null;feeEstimate=null;}
function notice(message:string,error=false){status=message;statusError=error;render();}
function errorText(e:unknown){return e instanceof Error?e.message.slice(0,1800):String(e);}
async function run(fn:()=>Promise<void>){if(busy)return;const epoch=sessionEpoch;busy=true;try{const pending=fn();render();await pending;}catch(e){if(sessionEpoch===epoch)notice(errorText(e),true);}finally{busy=false;render();}}
async function checkWallet(expected:Address){
  if(!wallet||owner!==expected)throw new Error('Wallet account changed. Reconnect and refresh.');
  const [accounts,chain]=await Promise.all([wallet.provider.request({method:'eth_accounts'}),wallet.provider.request({method:'eth_chainId'})]);
  if(!Array.isArray(accounts)||!accounts.some(a=>typeof a==='string'&&a.toLowerCase()===expected.toLowerCase()))throw new Error('Wallet account changed. Reconnect and refresh.');
  if(typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==1n)throw new Error('Switch your wallet to Ethereum mainnet.');
  return createWalletClient({account:expected,chain:mainnet,transport:custom(wallet.provider)});
}
async function verifyContract(){
  const epoch=sessionEpoch;
  checkArtifact();
  contractVerified=false;
  const rpc=client();if(await rpc.getChainId()!==1)throw new Error('RPC is not Ethereum mainnet.');
  const code=await rpc.getCode({address:spender()});
  if(!code||code==='0x'||artifact.runtimeHash==='0x'||keccak256(code)!==artifact.runtimeHash)throw new Error('Contract bytecode does not match this tested build. Check the address and deployment version.');
  if(epoch===sessionEpoch)contractVerified=true;
}
async function load(){
  if(!owner)throw new Error('Connect a wallet first.');
  const id=++scanId,account=owner;
  inventoryReady=false;invalidate();status='Reading token balances, including unpriced assets…';render();
  const rpc=client();if(await rpc.getChainId()!==1)throw new Error('RPC is not Ethereum mainnet.');
  let address:Address|null=null;
  if(settings.contract){await verifyContract();address=spender();}
  if(id!==scanId||owner!==account)return;
  const allowanceRevision=pendingApprovals.revision;
  const result=await discoverTokens(rpc,account,{alchemyKey:settings.alchemyKey,etherscanKey:settings.etherscanKey,spender:address,manualAddresses:settings.manual.map(a=>getAddress(a))});
  if(id!==scanId||owner!==account)return;
  if(address)for(const token of result.tokens){
    const newer=pendingApprovals.allowanceSince(approvalKey(account,address,token.address),allowanceRevision);
    if(newer!==undefined)token.allowance=newer;
  }
  tokens=result.tokens.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  selected=new Map([...selected].filter(([a])=>tokens.some(t=>t.address.toLowerCase()===a)));
  discoveryIssues=result.issues;inventoryReady=true;
  status=`${tokens.length} tokens with positive balances. ${result.complete?'Indexed discovery completed.':'Inventory may be incomplete.'} ${result.issues.length?'See discovery details below.':''}`;
  statusError=false;render();reconcileApprovals();
}
async function connect(){
  const choice=wallets.find(w=>w.uuid===el<HTMLSelectElement>('wallet-choice').value);
  if(!choice)throw new Error('No injected wallet found. Enable Rabby or MetaMask and reload.');
  await session.connect(choice);
}
async function inspect(){
  const address=el<HTMLInputElement>('inspect-address').value.trim();
  if(!isAddress(address)||getAddress(address)===zeroAddress)throw new Error('Enter a valid Ethereum address to inspect.');
  session.disconnect();wallet=null;owner=getAddress(address);tokens=[];selected.clear();scanId++;invalidate();await load();
}
async function receipt(hash:Hex){
  lastHash=hash;status='Transaction submitted. Waiting for confirmation…';render();
  const result=await client().waitForTransactionReceipt({hash,confirmations:1,timeout:600000});
  if(result.status!=='success')throw new Error('Transaction reverted. Inspect the transaction on Etherscan.');
  return result;
}
async function approve(address:string,reset=false){
  if(!owner)throw new Error('Connect your wallet.');await verifyContract();
  const t=tokens.find(t=>t.address.toLowerCase()===address);if(!t)throw new Error('Token not found.');
  const amount=reset?0n:parseAmount(selected.get(address)??formatUnits(t.balance,t.decimals),t.decimals,t.balance);
  const account=owner,s=spender(),value=reset?0n:approvalAmount(amount,settings.unlimited);
  const key=approvalKey(account,s,address);
  if(pendingApprovals.transactions.has(key))throw new Error('This token already has a pending approval.');
  const rpc=client(),w=await checkWallet(account);
  status=`Review ${reset?'zero reset':settings.unlimited?'unlimited':'exact amount'} approval for ${t.symbol} in your wallet.`;render();
  const approveAbi=parseAbi(['function approve(address spender,uint256 amount)']);
  const raw=await rpc.call({to:t.address,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[s,value]}),account});
  if(raw.data&&raw.data!=='0x'&&(raw.data.length<66||BigInt(raw.data)!==1n))throw new Error('Token rejected the approval simulation.');
  const simulated=await rpc.simulateContract({address:t.address,abi:approveAbi,functionName:'approve',args:[s,value],account});
  await checkWallet(account);
  const hash=await w.writeContract(simulated.request);
  lastHash=hash;invalidate();
  status=`${t.symbol} approval submitted. You can approve the next token while it confirms.`;statusError=false;
  pendingApprovals.submit({chainId:1,account,spender:s,token:t.address},hash);
  // Receipt waits are independent and never hold the wallet prompt lock.
  void reconcileApproval(key,true);

}
async function reconcileApproval(key:string,wait=false){
  const epoch=sessionEpoch,rpc=client();
  await pendingApprovals.reconcile(key,{
    receipt:hash=>wait?rpc.waitForTransactionReceipt({hash,confirmations:1,timeout:600000,onReplaced:replacement=>{
      pendingApprovals.replace(key,replacement.transaction.hash,replacement.reason);render();
    }}):rpc.getTransactionReceipt({hash}),
    allowance:scope=>rpc.readContract({address:scope.token,abi:erc20Abi,functionName:'allowance',args:[scope.account,scope.spender]}),
  });
  if(epoch!==sessionEpoch)return;
  const record=pendingApprovals.records.get(key);
  if(record&&owner?.toLowerCase()===record.account.toLowerCase()&&settings.contract.toLowerCase()===record.spender.toLowerCase()){
    const token=tokens.find(t=>t.address.toLowerCase()===record.token.toLowerCase()),value=pendingApprovals.allowance(key);
    if(token&&record.allowanceFresh&&value!==undefined)token.allowance=value;
    invalidate();render();
  }
}
function currentApprovals(){
  if(!owner||!isAddress(settings.contract))return [];
  const prefix=approvalKey(owner,getAddress(settings.contract),'');
  return [...pendingApprovals.records].filter(([key])=>key.startsWith(prefix));
}
function reconcileApprovals(){for(const [key] of currentApprovals())void reconcileApproval(key).catch(e=>notice(errorText(e),true));}
async function simulate(){
  if(!owner)throw new Error('Connect your wallet.');await verifyContract();
  const id=scanId,account=owner,list=items(),recipient=validateBatch(settings.recipient,account,list),s=spender();
  if(recipient===s)throw new Error('Recipient cannot be the Multisend contract.');
  await checkWallet(account);const rpc=client();
  await rpc.simulateContract({address:s,abi:batchAbi,functionName:'batchTransfer',args:[recipient,list.map(i=>i.token.address),list.map(i=>i.amount)],account});
  const gas=await rpc.estimateContractGas({address:s,abi:batchAbi,functionName:'batchTransfer',args:[recipient,list.map(i=>i.token.address),list.map(i=>i.amount)],account});
  const fees=await rpc.estimateFeesPerGas();
  if(id!==scanId||owner!==account)return;
  gasEstimate=gas;feeEstimate=gas*(fees.maxFeePerGas??fees.gasPrice??0n);reviewed=batchFingerprint(account,s,recipient,list);
  status='Batch simulation passed. Review the recipient, amounts and wallet gas quote before sending.';statusError=false;
}
async function send(){
  if(!recipientReviewed)throw new Error('Review and confirm the complete destination address first.');
  if(!owner)throw new Error('Connect your wallet.');await verifyContract();
  const account=owner,list=items(),recipient=validateBatch(settings.recipient,account,list),s=spender();
  if(recipient===s)throw new Error('Recipient cannot be the Multisend contract.');
  if(reviewed!==batchFingerprint(account,s,recipient,list))throw new Error('Simulate this exact batch first.');
  const w=await checkWallet(account),rpc=client();
  const simulated=await rpc.simulateContract({address:s,abi:batchAbi,functionName:'batchTransfer',args:[recipient,list.map(i=>i.token.address),list.map(i=>i.amount)],account});
  const before=await Promise.all(list.map(i=>rpc.readContract({address:i.token.address,abi:erc20Abi,functionName:'balanceOf',args:[recipient]})));
  await checkWallet(account);status='Review the batch in your wallet. All transfers succeed together or revert together.';render();
  invalidate();
  const result=await receipt(await w.writeContract(simulated.request));
  selected.clear();
  try{
    const after=await Promise.all(list.map(i=>rpc.readContract({address:i.token.address,abi:erc20Abi,functionName:'balanceOf',args:[recipient],blockNumber:result.blockNumber})));
    const differences=list.filter((i,n)=>after[n]-before[n]!==i.amount).map(i=>i.token.symbol);
    await load();
    status=differences.length?`Batch transaction confirmed. Recipient balance changes differ from requested amounts for: ${differences.join(', ')}. Inspect token transfer fees, rebasing or other transfers in the same block.`:'Batch transaction confirmed. Observed recipient balance increases match the requested amounts.';
    statusError=differences.length>0;
  }catch(e){status=`Batch transaction confirmed, but balance refresh failed: ${errorText(e)}. Inspect the confirmed transaction before preparing another batch.`;statusError=true;}
}
async function addManual(){
  if(!owner)throw new Error('Connect or inspect an address before checking its token balance.');
  const value=el<HTMLInputElement>('manual').value.trim(),account=owner,epoch=sessionEpoch,rpc=client();
  manualFeedback='Checking mainnet contract and ERC-20 reads…';render();
  try{
    if(await rpc.getChainId()!==1)throw new Error('RPC is not Ethereum mainnet. The address was not saved.');
    const result=await verifyManualToken(value,{
      code:address=>rpc.getCode({address}),
      decimals:address=>rpc.readContract({address,abi:erc20Abi,functionName:'decimals'}),
      symbol:address=>rpc.readContract({address,abi:erc20Abi,functionName:'symbol'}),
      balance:address=>rpc.readContract({address,abi:erc20Abi,functionName:'balanceOf',args:[account]}),
    });
    if(epoch!==sessionEpoch)return;
    const duplicate=settings.manual.some(a=>a.toLowerCase()===result.address.toLowerCase());
    settings.manual=normalizeManual([...settings.manual,result.address]);save();
    manualFeedback=`${result.address} ${duplicate?'is already saved':'saved for discovery'}. ${result.balance===0n?'It has no current positive balance in this account.':'Positive balance found; refreshing inventory.'} ${result.symbol?'Token label: '+result.symbol+'.':'Token label unavailable; use the contract address to identify it.'}`;
    await load();
  }catch(e){if(epoch===sessionEpoch)manualFeedback=errorText(e);throw e;}
}
async function removeManual(address:string){
  settings.manual=settings.manual.filter(a=>a.toLowerCase()!==address.toLowerCase());save();selected.delete(address.toLowerCase());invalidate();
  manualFeedback=`${address} removed from your manual discovery list. This does not remove wallet assets or hide a token independently found in the catalogue or an indexer.`;
  if(owner)await load();else render();
}
function manualBalance(address:string){
  if(!owner)return 'Saved for discovery. Connect or inspect an account to check its balance.';
  if(!inventoryReady)return 'Saved for discovery. Current inventory has not finished refreshing.';
  if(tokens.some(t=>t.address.toLowerCase()===address.toLowerCase()))return 'Saved for discovery; positive balance in the current inventory.';
  if(discoveryIssues.some(issue=>issue.toLowerCase().includes(address.toLowerCase())))return 'Saved for discovery; token lookup incomplete. Check discovery details; no verified positive balance is available.';
  return 'Saved for discovery; no current positive balance. No inventory row is shown for zero balances.';
}
function el<T extends HTMLElement>(id:string):T{return document.getElementById(id) as T;}
function render(){
  const transitioning=['restoring','connecting'].includes(session.state.phase);
  const locked=busy||transitioning||activeApprovalCount()>0;
  const list=tokens.filter(t=>`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(query.toLowerCase()));
  let selectedItems:SelectedToken[]=[],inputError='';try{selectedItems=items();}catch(e){inputError=errorText(e);}
  const needs=selectedItems.filter(i=>i.token.allowance===null||i.token.allowance<i.amount);
  const simulationReason=simulationBlockReason(),canSimulate=!simulationReason;
  el('app').innerHTML=`
  <header><a class="brand" href="/">Multisend<span>Ethereum</span></a><div class="wallet-tools"><select id="wallet-choice" aria-label="Wallet" ${locked?'disabled':''}>${wallets.map(w=>`<option value="${escape(w.uuid)}" ${w.uuid===(wallet?.uuid??chosenWallet)?'selected':''}>${escape(w.name)}</option>`).join('')||'<option>No wallet detected</option>'}</select><button id="connect" ${locked?'disabled':''}>${transitioning?session.state.phase==='restoring'?'Restoring…':'Connecting…':wallet&&owner?escape(short(owner)):'Connect wallet'}</button>${session.state.phase!=='disconnected'?'<button id="disconnect">Disconnect</button>':''}</div></header>
  <main><p class="hint wallet-state" role="status">${escape(session.state.message)}</p><div class="intro"><div><h1>Many tokens. One send.</h1><p>Select assets, approve once, then send a single atomic batch.</p></div><span class="fee">Service fee <strong>0 ETH</strong></span></div>
  <details class="settings" ${settingsOpen?'open':''}><summary>Connection & contract settings ${contractVerified?'· bytecode matches':''}</summary><div class="settings-grid">
  <label>Ethereum RPC<input id="rpc" value="${escape(settings.rpc)}" type="url" ${locked?'disabled':''}></label>
  <label>Multisend contract<input id="contract" placeholder="0x… verified Ethereum deployment" value="${escape(settings.contract)}" ${locked?'disabled':''}></label>
  </div><details class="advanced"><summary>Advanced: discover additional tokens with an indexer</summary><div class="settings-grid"><label>Alchemy API key (optional)<input id="alchemy" autocomplete="off" type="password" value="${escape(settings.alchemyKey)}" ${busy?'disabled':''}></label><label>Etherscan API key (optional)<input id="etherscan" autocomplete="off" type="password" value="${escape(settings.etherscanKey)}" ${busy?'disabled':''}></label></div><p class="hint">Only needed to discover addresses outside the known-token list. Alchemy takes priority if both keys are configured.</p></details><p class="hint">Known reward tokens and manual addresses work with the public RPC, without an API key. All settings stay in this browser.</p><button id="save-settings" ${locked?'disabled':''}>Save & refresh</button>
  <div class="inspect"><label>Inspect an address without connecting a wallet<input id="inspect-address" placeholder="0x… wallet address" value="${owner?escape(owner):''}" ${busy?'disabled':''}></label><button id="inspect" ${locked?'disabled':''}>Load inventory</button></div>
  </details>
  ${!settings.contract?'<p class="setup-note">Contract deployment is pending. Token discovery works now; approvals and batch sends become available after the verified mainnet contract is configured.</p>':''}
  <div class="workspace"><section class="inventory" aria-labelledby="inventory-title"><div class="section-head"><h2 id="inventory-title">Token inventory <span>${tokens.length}</span></h2><button id="refresh" ${locked||!owner?'disabled':''}>Refresh balances</button></div>${owner?`<p class="hint">${wallet?'Connected wallet':'Inspecting only'}: <span class="data">${escape(owner)}</span></p>`:''}
  <div class="toolbar"><input id="search" type="search" aria-label="Search tokens" placeholder="Search token or address" value="${escape(query)}"><button id="select-visible" ${busy||!tokens.length?'disabled':''}>Select visible</button><button id="clear" ${busy||!selected.size?'disabled':''}>Clear</button></div>
  <details class="preset-tools" open><summary>Named token groups</summary><label>Saved group<select id="group-choice" ${busy?'disabled':''}><option value="">Choose a group</option>${presets.groups.map(g=>`<option value="${escape(g.id)}" ${g.id===groupId?'selected':''}>${escape(g.name)} (${g.addresses.length})</option>`).join('')}</select></label><div class="preset-actions"><button id="apply-group" ${busy||!inventoryReady||!groupId?'disabled':''}>Add group · keep entered amounts</button><button id="max-group" ${busy||!inventoryReady||!groupId?'disabled':''}>Replace selection with group at Max</button></div><p class="hint">Add preserves existing custom amounts and leaves new amounts blank for review. Replace explicitly uses current full balances. Missing or zero-balance members are listed below after applying.</p><label>Group name<input id="group-name" maxlength="80" placeholder="e.g. Monthly rewards"></label><div class="preset-actions"><button id="save-group" ${busy||!selected.size?'disabled':''}>Save selection as new group</button><button id="rename-group" ${busy||!groupId?'disabled':''}>Rename group</button><button id="delete-group" ${busy||!groupId?'disabled':''}>Delete group</button></div>${presetFeedback?`<p id="preset-feedback" role="status">${escape(presetFeedback)}</p>`:''}${presets.warning?`<p class="error">${escape(presets.warning)}</p>`:''}</details>
  <div class="add-token"><input id="manual" aria-label="Token contract address" placeholder="Add any ERC-20 contract address" ${busy?'disabled':''}><button id="add" ${locked||!owner?'disabled':''}>Add token</button></div>
  <details class="manual-tokens" ${manualFeedback?'open':''}><summary>Saved manual tokens (${settings.manual.length})</summary><p class="hint">These addresses extend discovery. Removing one does not remove wallet assets or exclude catalogue/indexer discoveries. Existing saved entries are checked during balance refresh; saving alone is not verification.</p>${manualFeedback?`<p role="status">${escape(manualFeedback)}</p>`:''}<ul>${settings.manual.map(address=>`<li><a class="data" href="https://etherscan.io/token/${address}" target="_blank" rel="noopener noreferrer">${escape(address)}</a><p class="hint">${escape(manualBalance(address))}</p><button data-remove-manual="${address}" ${busy?'disabled':''}>Remove manual address</button></li>`).join('')||'<li>No manual token addresses saved.</li>'}</ul></details>
  <div class="table-wrap"><table class="${list.length?'':'table-empty'}"><thead><tr><th scope="col"><span class="sr-only">Select</span></th><th scope="col">Token</th><th scope="col">Balance / amount</th><th scope="col">Approval</th></tr></thead><tbody>${list.map(t=>{
    const a=t.address.toLowerCase(),on=selected.has(a),value=selected.get(a)??'',ready=t.allowance!==null&&t.allowance>=(on&&selectedItems.find(i=>i.token===t)?.amount||t.balance);
    const pending=pendingApproval(a);
    return `<tr class="${on?'selected':''}"><td><input type="checkbox" data-select="${a}" aria-label="Select ${escape(t.symbol)}" ${on?'checked':''} ${busy?'disabled':''}></td><td><strong>${escape(t.symbol)}</strong><span class="token-name">${escape(t.name)} · ${t.source==='known'?'Catalogue':t.source==='manual'?'Manual addition':'Indexer'}</span><a class="address" href="https://etherscan.io/token/${t.address}" target="_blank" rel="noopener noreferrer">${escape(short(t.address))}</a>${t.warning?`<span class="warning">${escape(t.warning)}</span>`:''}</td><td class="amount-cell"><span class="balance" title="${escape(formatUnits(t.balance,t.decimals))}">${escape(formatUnits(t.balance,t.decimals))}</span>${on?`<div class="amount-input"><input inputmode="decimal" data-amount="${a}" aria-label="Amount of ${escape(t.symbol)}" value="${escape(value)}" ${busy?'disabled':''}><button data-max="${a}" ${busy?'disabled':''}>Max</button></div>`:''}</td><td><span class="approval ${ready?'ready':''}">${pending?'Approval outcome pending/unknown':!settings.contract?'Set contract':ready?'Ready':'Needs approval'}</span>${pending?`<a href="https://etherscan.io/tx/${pending}" target="_blank" rel="noopener noreferrer">View approval</a>`:on&&!ready&&settings.contract?`<button class="small" data-approve="${a}" ${busy?'disabled':''}>Approve</button>${t.allowance!==null&&t.allowance>0n?`<button class="small secondary" data-reset="${a}" ${busy?'disabled':''}>Reset to zero</button>`:''}`:''}</td></tr>`;
  }).join('')||`<tr><td colspan="4" class="empty">${owner?tokens.length?'No matching tokens.':'Load balances or add a token address.':'Connect Rabby or MetaMask to discover your tokens.'}</td></tr>`}</tbody></table></div><p class="hint">No market-price filter. Dust and unpriced tokens remain selectable. A successful simulation does not establish a token's market value.</p>
  ${currentApprovals().length?`<section class="approval-recovery"><h2>Tracked approvals</h2><button id="check-approvals">Check receipts & allowances</button><p class="hint">Transaction outcome and current allowance are separate. Unknown outcomes block duplicate approvals. No transaction is resubmitted.</p><ul>${currentApprovals().map(([,r])=>`<li><span class="data">${escape(r.token)}</span> · ${escape(pendingApprovals.describe(r))} <a href="https://etherscan.io/tx/${r.hash}" target="_blank" rel="noopener noreferrer">${escape(r.hash)}</a>${r.previousHash?` · replaced hash <span class="data">${escape(r.previousHash)}</span>`:''}</li>`).join('')}</ul></section>`:''}</section>
  <aside class="review" aria-labelledby="review-title"><h2 id="review-title">Review batch</h2><details class="destinations" ${destinationsOpen?'open':''}><summary>Named destinations</summary><label>Saved destination<select id="destination-choice" ${busy?'disabled':''}><option value="">Manual recipient</option>${presets.destinations.map(d=>`<option value="${escape(d.id)}" ${d.address.toLowerCase()===settings.recipient.toLowerCase()?'selected':''}>${escape(d.name)}</option>`).join('')}</select></label><label>Destination name<input id="destination-name" maxlength="80" placeholder="e.g. Treasury"></label><label>Address to save<input id="destination-address" value="${escape(settings.recipient)}" placeholder="0x… full Ethereum address"></label><button id="save-destination" ${busy?'disabled':''}>Save new destination</button><button id="rename-destination" ${busy?'disabled':''}>Rename selected destination</button><button id="delete-destination" ${busy?'disabled':''}>Delete selected destination</button></details><label>Send everything to<input id="recipient" placeholder="0x… recipient address" value="${escape(settings.recipient)}" ${busy?'disabled':''}></label><p class="destination-review"><strong>${escape(presets.destinations.find(d=>d.address.toLowerCase()===settings.recipient.toLowerCase())?.name??'Manual destination')}</strong><span id="destination-full" class="data">${escape(settings.recipient)||'Choose a destination or enter the full address.'}</span></p><label class="destination-confirm"><input id="destination-reviewed" type="checkbox" ${recipientReviewed?'checked':''} ${busy?'disabled':''}> I reviewed this complete destination address</label><label>Approval amount<select id="approval-mode" ${busy?'disabled':''}><option value="unlimited" ${settings.unlimited?'selected':''}>Unlimited · reusable</option><option value="exact" ${!settings.unlimited?'selected':''}>Exact selected amount</option></select></label><p class="hint">Unlimited approvals let this contract transfer selected tokens in future batches. You can revoke allowances separately.</p>
  <dl><div><dt>Selected tokens</dt><dd>${selected.size} / ${MAX_TOKENS}</dd></div><div><dt>Approvals needed</dt><dd>${inputError?'—':needs.length}</dd></div><div><dt>Service fee</dt><dd>0 ETH</dd></div><div><dt>Estimated gas</dt><dd>${gasEstimate?.toLocaleString()??'Simulate first'}</dd></div><div><dt>Gas at estimated max fee</dt><dd>${feeEstimate!==null?escape(formatEther(feeEstimate))+' ETH':'—'}</dd></div></dl>
  ${selectedItems.length?`<details class="selected-review" open><summary>Selected amounts</summary><ul>${selectedItems.map(i=>`<li><span>${escape(i.token.symbol)}</span><span>${escape(formatUnits(i.amount,i.token.decimals))}</span></li>`).join('')}</ul></details>`:''}
  ${inputError?`<p class="error">${escape(inputError)}</p>`:''}<p id="simulation-help" class="hint" aria-live="polite">${escape(simulationReason)}</p><button id="simulate" class="primary" aria-describedby="simulation-help" ${busy||!canSimulate?'disabled':''}>Simulate batch</button><button id="send" class="primary send" ${busy||!reviewed||!recipientReviewed||!canSimulate?'disabled':''}>Review send in wallet</button><p class="hint">Approvals are separate transactions. The final send is one transaction; any failing token reverts the entire batch. Amounts are requested transfer amounts; tokens with transfer fees may deliver less. Final gas quote comes from your wallet.</p></aside></div>
  ${pendingApprovals.storageWarning?`<p class="error">${escape(pendingApprovals.storageWarning)}</p>`:''}<section class="status ${statusError?'error':''}" role="status" aria-live="polite">${busy?'<span class="busy-dot" aria-hidden="true"></span>':''}${escape(status)}${lastHash?`<a href="https://etherscan.io/tx/${lastHash}" target="_blank" rel="noopener noreferrer">View last transaction</a>`:''}</section>${discoveryIssues.length?`<details class="discovery-details"><summary>Discovery details (${discoveryIssues.length})</summary><ul>${discoveryIssues.map(i=>`<li>${escape(i)}</li>`).join('')}</ul></details>`:''}</main><footer><span>Ethereum mainnet · no service fee</span><span>Contract ${settings.contract?`<a href="https://etherscan.io/address/${escape(settings.contract)}#code" target="_blank" rel="noopener noreferrer">${escape(short(settings.contract))}</a>`:'not configured'}</span></footer>`;
  bind();
}
function bind(){
  document.querySelector<HTMLDetailsElement>('.settings')!.ontoggle=e=>{settingsOpen=(e.currentTarget as HTMLDetailsElement).open;};
  el<HTMLSelectElement>('wallet-choice').onchange=e=>{chosenWallet=(e.currentTarget as HTMLSelectElement).value;};
  document.getElementById('disconnect')?.addEventListener('click',()=>session.disconnect());
  el('connect').onclick=()=>void connect().catch(e=>notice(errorText(e),true));el('refresh').onclick=()=>void run(load);
  document.getElementById('check-approvals')?.addEventListener('click',reconcileApprovals);
  el('inspect').onclick=()=>void run(inspect);
  el('save-settings').onclick=()=>void run(async()=>{
    settings={...settings,rpc:el<HTMLInputElement>('rpc').value.trim(),contract:el<HTMLInputElement>('contract').value.trim(),alchemyKey:el<HTMLInputElement>('alchemy').value.trim(),etherscanKey:el<HTMLInputElement>('etherscan').value.trim()};
    save();invalidate();contractVerified=false;if(owner)await load();else notice('Settings saved in this browser.');
  });
  el('recipient').oninput=()=>{settings.recipient=el<HTMLInputElement>('recipient').value.trim();save();invalidate();el('destination-full').textContent=settings.recipient;document.querySelector('.destination-review strong')!.textContent='Manual destination';el<HTMLInputElement>('destination-reviewed').checked=false;el<HTMLButtonElement>('send').disabled=true;};
  el('approval-mode').onchange=()=>{settings.unlimited=el<HTMLSelectElement>('approval-mode').value==='unlimited';save();invalidate();render();};
  el('search').oninput=()=>{const input=el<HTMLInputElement>('search');query=input.value;render();el<HTMLInputElement>('search').focus();};
  el('select-visible').onclick=()=>{tokens.filter(t=>`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(query.toLowerCase())).forEach(t=>selected.set(t.address.toLowerCase(),formatUnits(t.balance,t.decimals)));invalidate();render();};
  el('clear').onclick=()=>{selected.clear();invalidate();render();};
  document.querySelector<HTMLDetailsElement>('.destinations')!.ontoggle=e=>{destinationsOpen=(e.currentTarget as HTMLDetailsElement).open;};
  el('group-choice').onchange=()=>{groupId=el<HTMLSelectElement>('group-choice').value;invalidate();render();};
  const apply=(mode:'keep'|'max')=>{const group=presets.groups.find(g=>g.id===groupId);if(!group||!inventoryReady)throw new Error('Choose a group and refresh the current inventory first.');const result=applyGroup(group,tokens,selected,mode);selected=result.selected;invalidate();presetFeedback=`${group.name}: ${result.held.length} held member(s), ${result.missing.length} missing/zero-balance or unavailable member(s). ${result.missing.length?'Missing addresses: '+result.missing.join(', ')+'. ':''}${mode==='keep'?'Existing custom amounts kept; enter amounts or press Max for newly added tokens.':'Selection replaced with current full balances (Max). Review all amounts.'}`;render();};
  el('apply-group').onclick=()=>void run(async()=>apply('keep'));
  el('max-group').onclick=()=>void run(async()=>apply('max'));
  el('save-group').onclick=()=>void run(async()=>{const group=presets.addGroup(el<HTMLInputElement>('group-name').value,[...selected.keys()]);groupId=group.id;invalidate();presetFeedback=`Saved group ${group.name} with ${group.addresses.length} token address(es). Amounts are never saved.`;render();});
  el('rename-group').onclick=()=>void run(async()=>{presets.renameGroup(groupId,el<HTMLInputElement>('group-name').value);invalidate();presetFeedback='Group renamed.';render();});
  el('delete-group').onclick=()=>void run(async()=>{presets.deleteGroup(groupId);groupId='';invalidate();presetFeedback='Group deleted; current entered amounts are unchanged.';render();});
  el('destination-choice').onchange=()=>{const destination=presets.destinations.find(d=>d.id===el<HTMLSelectElement>('destination-choice').value);if(destination){settings.recipient=destination.address;save();}invalidate();render();};
  el('save-destination').onclick=()=>void run(async()=>{const destination=presets.addDestination(el<HTMLInputElement>('destination-name').value,el<HTMLInputElement>('destination-address').value.trim());invalidate();notice(`Saved destination ${destination.name}. Choose it from Saved destination to prepare a batch.`);});
  el('rename-destination').onclick=()=>void run(async()=>{presets.renameDestination(el<HTMLSelectElement>('destination-choice').value,el<HTMLInputElement>('destination-name').value);invalidate();notice('Destination renamed. Review its complete address before sending.');});
  el('delete-destination').onclick=()=>void run(async()=>{presets.deleteDestination(el<HTMLSelectElement>('destination-choice').value);invalidate();notice('Saved destination deleted. The current recipient remains visible for review.');});
  el<HTMLInputElement>('destination-reviewed').onchange=()=>{recipientReviewed=el<HTMLInputElement>('destination-reviewed').checked;updateSimulationControls();};
  el('add').onclick=()=>void run(addManual);
  document.querySelectorAll<HTMLButtonElement>('[data-remove-manual]').forEach(e=>e.onclick=()=>void run(()=>removeManual(e.dataset.removeManual!)));
  document.querySelectorAll<HTMLInputElement>('[data-select]').forEach(e=>e.onchange=()=>{const a=e.dataset.select!,t=tokens.find(t=>t.address.toLowerCase()===a)!;if(e.checked)selected.set(a,formatUnits(t.balance,t.decimals));else selected.delete(a);invalidate();render();});
  document.querySelectorAll<HTMLInputElement>('[data-amount]').forEach(e=>{e.oninput=()=>{selected.set(e.dataset.amount!,e.value);invalidate();updateSimulationControls();};});
  document.querySelectorAll<HTMLButtonElement>('[data-max]').forEach(e=>e.onclick=()=>{const a=e.dataset.max!,t=tokens.find(t=>t.address.toLowerCase()===a)!;selected.set(a,formatUnits(t.balance,t.decimals));invalidate();render();});
  document.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach(e=>e.onclick=()=>void run(()=>approve(e.dataset.approve!)));
  document.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach(e=>e.onclick=()=>void run(()=>approve(e.dataset.reset!,true)));
  el('simulate').onclick=()=>void run(simulate);el('send').onclick=()=>void run(send);
}
window.addEventListener('eip6963:announceProvider',((event:CustomEvent<{info:{uuid:string;rdns:string;name:string};provider:EIP1193Provider}>)=>{
  const d=event.detail;if(!d?.info||!d.provider)return;
  session.announce({...d.info,provider:d.provider});render();
}) as EventListener);
render();window.dispatchEvent(new Event('eip6963:requestProvider'));

setInterval(()=>{if(currentApprovals().some(([key])=>pendingApprovals.transactions.has(key)))reconcileApprovals();},15000);
