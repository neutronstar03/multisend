import './style.css';
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc20Abi, formatEther, formatUnits, getAddress, http, isAddress, keccak256, parseAbi, zeroAddress, type Abi, type Address, type EIP1193Provider, type Hex } from 'viem';
import { mainnet } from 'viem/chains';
import artifact from './contract.json';
import { discoverTokens, type Token } from './lib/discovery';
import { approvalAmount, batchFingerprint, MAX_TOKENS, parseAmount, validateBatch, type SelectedToken } from './lib/batch';

type Settings = { rpc:string; alchemyKey:string; etherscanKey:string; contract:string; recipient:string; unlimited:boolean; manual:string[] };
type Wallet = { uuid:string; name:string; provider:EIP1193Provider };
const defaults: Settings = { rpc:'https://ethereum-rpc.publicnode.com',alchemyKey:'',etherscanKey:'',contract:'',recipient:'',unlimited:true,manual:[] };
function restore(): Settings {
  try {
    const value: unknown=JSON.parse(localStorage.getItem('multisend.settings')??'null');
    if(!value || typeof value!=='object') return {...defaults};
    const s=value as Record<string,unknown>;
    return {rpc:typeof s.rpc==='string'?s.rpc:defaults.rpc,alchemyKey:typeof s.alchemyKey==='string'?s.alchemyKey:'',etherscanKey:typeof s.etherscanKey==='string'?s.etherscanKey:'',contract:typeof s.contract==='string'?s.contract:'',recipient:typeof s.recipient==='string'?s.recipient:'',unlimited:typeof s.unlimited==='boolean'?s.unlimited:true,manual:Array.isArray(s.manual)?s.manual.filter((x):x is string=>typeof x==='string'&&isAddress(x)):[]};
  } catch {return {...defaults};}
}
let settings=restore();

let savedSet:string[]=[];
try{const value:unknown=JSON.parse(localStorage.getItem('multisend.tokenSet')??'[]');if(Array.isArray(value))savedSet=value.filter((a):a is string=>typeof a==='string'&&isAddress(a)).map(a=>a.toLowerCase());}catch{/* No saved token set. */}
let settingsOpen=false;
const wallets: Wallet[]=[];
let wallet: Wallet|null=null, owner:Address|null=null, tokens:Token[]=[], busy=false, query='', status='Connect a wallet to load its Ethereum balances.', statusError=false;
let selected=new Map<string,string>(), lastHash:Hex|null=null, scanId=0, reviewed:string|null=null, gasEstimate:bigint|null=null, feeEstimate:bigint|null=null, contractVerified=false;
let discoveryIssues:string[]=[];
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
function invalidate(){reviewed=null;gasEstimate=null;feeEstimate=null;}
function notice(message:string,error=false){status=message;statusError=error;render();}
function errorText(e:unknown){return e instanceof Error?e.message.slice(0,1800):String(e);}
async function run(fn:()=>Promise<void>){if(busy)return;busy=true;try{const pending=fn();render();await pending;}catch(e){notice(errorText(e),true);}finally{busy=false;render();}}
async function checkWallet(expected:Address){
  if(!wallet||owner!==expected)throw new Error('Wallet account changed. Reconnect and refresh.');
  const [accounts,chain]=await Promise.all([wallet.provider.request({method:'eth_accounts'}),wallet.provider.request({method:'eth_chainId'})]);
  if(!Array.isArray(accounts)||!accounts.some(a=>typeof a==='string'&&a.toLowerCase()===expected.toLowerCase()))throw new Error('Wallet account changed. Reconnect and refresh.');
  if(typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)||BigInt(chain)!==1n)throw new Error('Switch your wallet to Ethereum mainnet.');
  return createWalletClient({account:expected,chain:mainnet,transport:custom(wallet.provider)});
}
async function verifyContract(){
  checkArtifact();
  contractVerified=false;
  const rpc=client();if(await rpc.getChainId()!==1)throw new Error('RPC is not Ethereum mainnet.');
  const code=await rpc.getCode({address:spender()});
  if(!code||code==='0x'||artifact.runtimeHash==='0x'||keccak256(code)!==artifact.runtimeHash)throw new Error('Contract bytecode does not match this tested build. Check the address and deployment version.');
  contractVerified=true;
}
async function load(){
  if(!owner)throw new Error('Connect a wallet first.');
  const id=++scanId,account=owner;
  invalidate();status='Reading token balances, including unpriced assets…';render();
  const rpc=client();if(await rpc.getChainId()!==1)throw new Error('RPC is not Ethereum mainnet.');
  let address:Address|null=null;
  if(settings.contract){await verifyContract();address=spender();}
  const result=await discoverTokens(rpc,account,{alchemyKey:settings.alchemyKey,etherscanKey:settings.etherscanKey,spender:address,manualAddresses:settings.manual.map(a=>getAddress(a))});
  if(id!==scanId||owner!==account)return;
  tokens=result.tokens.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  selected=new Map([...selected].filter(([a])=>tokens.some(t=>t.address.toLowerCase()===a)));
  discoveryIssues=result.issues;
  status=`${tokens.length} tokens with positive balances. ${result.complete?'Indexed discovery completed.':'Inventory may be incomplete.'} ${result.issues.length?'See discovery details below.':''}`;
  statusError=false;render();
}
async function connect(){
  const choice=wallets.find(w=>w.uuid===el<HTMLSelectElement>('wallet-choice').value);
  if(!choice)throw new Error('No injected wallet found. Enable Rabby or MetaMask and reload.');
  const accounts=await choice.provider.request({method:'eth_requestAccounts'});
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||!isAddress(accounts[0]))throw new Error('Wallet did not return a valid Ethereum account.');
  wallet=choice;owner=getAddress(accounts[0]);tokens=[];selected.clear();scanId++;invalidate();await load();
}
async function inspect(){
  const address=el<HTMLInputElement>('inspect-address').value.trim();
  if(!isAddress(address)||getAddress(address)===zeroAddress)throw new Error('Enter a valid Ethereum address to inspect.');
  wallet=null;owner=getAddress(address);tokens=[];selected.clear();scanId++;invalidate();await load();
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
  const rpc=client(),w=await checkWallet(account);
  status=`Review ${reset?'zero reset':settings.unlimited?'unlimited':'exact amount'} approval for ${t.symbol} in your wallet.`;render();
  const approveAbi=parseAbi(['function approve(address spender,uint256 amount)']);
  const raw=await rpc.call({to:t.address,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[s,value]}),account});
  if(raw.data&&raw.data!=='0x'&&(raw.data.length<66||BigInt(raw.data)!==1n))throw new Error('Token rejected the approval simulation.');
  const simulated=await rpc.simulateContract({address:t.address,abi:approveAbi,functionName:'approve',args:[s,value],account});
  await checkWallet(account);
  invalidate();await receipt(await w.writeContract(simulated.request));
  try{
    const allowance=await rpc.readContract({address:t.address,abi:erc20Abi,functionName:'allowance',args:[account,s]});
    if(reset?allowance!==0n:allowance<amount)throw new Error('Allowance is insufficient. Refresh balances and inspect the token.');
    await load();status=`${t.symbol} approval confirmed.`;
  }catch(e){status=`${t.symbol} approval transaction confirmed, but refresh failed: ${errorText(e)}`;statusError=true;}
}
async function simulate(){
  if(!owner)throw new Error('Connect your wallet.');await verifyContract();
  const account=owner,list=items(),recipient=validateBatch(settings.recipient,account,list),s=spender();
  if(recipient===s)throw new Error('Recipient cannot be the Multisend contract.');
  await checkWallet(account);const rpc=client();
  await rpc.simulateContract({address:s,abi:batchAbi,functionName:'batchTransfer',args:[recipient,list.map(i=>i.token.address),list.map(i=>i.amount)],account});
  const gas=await rpc.estimateContractGas({address:s,abi:batchAbi,functionName:'batchTransfer',args:[recipient,list.map(i=>i.token.address),list.map(i=>i.amount)],account});
  const fees=await rpc.estimateFeesPerGas();
  gasEstimate=gas;feeEstimate=gas*(fees.maxFeePerGas??fees.gasPrice??0n);reviewed=batchFingerprint(account,s,recipient,list);
  status='Batch simulation passed. Review the recipient, amounts and wallet gas quote before sending.';statusError=false;
}
async function send(){
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
function el<T extends HTMLElement>(id:string):T{return document.getElementById(id) as T;}
function render(){
  const list=tokens.filter(t=>`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(query.toLowerCase()));
  let selectedItems:SelectedToken[]=[],inputError='';try{selectedItems=items();}catch(e){inputError=errorText(e);}
  const needs=selectedItems.filter(i=>i.token.allowance===null||i.token.allowance<i.amount);
  const canSimulate=!!wallet&&!!owner&&!!settings.contract&&selectedItems.length>0&&!needs.length&&!inputError;
  el('app').innerHTML=`
  <header><a class="brand" href="/">Multisend<span>Ethereum</span></a><div class="wallet-tools"><select id="wallet-choice" aria-label="Wallet" ${busy?'disabled':''}>${wallets.map(w=>`<option value="${escape(w.uuid)}" ${w===wallet?'selected':''}>${escape(w.name)}</option>`).join('')||'<option>No wallet detected</option>'}</select><button id="connect" ${busy?'disabled':''}>${wallet&&owner?escape(short(owner)):'Connect wallet'}</button></div></header>
  <main><div class="intro"><div><h1>Many tokens. One send.</h1><p>Select assets, approve once, then send a single atomic batch.</p></div><span class="fee">Service fee <strong>0 ETH</strong></span></div>
  <details class="settings" ${settingsOpen?'open':''}><summary>Connection & contract settings ${contractVerified?'· bytecode matches':''}</summary><div class="settings-grid">
  <label>Ethereum RPC<input id="rpc" value="${escape(settings.rpc)}" type="url" ${busy?'disabled':''}></label>
  <label>Multisend contract<input id="contract" placeholder="0x… verified Ethereum deployment" value="${escape(settings.contract)}" ${busy?'disabled':''}></label>
  </div><details class="advanced"><summary>Advanced: discover additional tokens with an indexer</summary><div class="settings-grid"><label>Alchemy API key (optional)<input id="alchemy" autocomplete="off" type="password" value="${escape(settings.alchemyKey)}" ${busy?'disabled':''}></label><label>Etherscan API key (optional)<input id="etherscan" autocomplete="off" type="password" value="${escape(settings.etherscanKey)}" ${busy?'disabled':''}></label></div><p class="hint">Only needed to discover addresses outside the known-token list. Alchemy takes priority if both keys are configured.</p></details><p class="hint">Known reward tokens and manual addresses work with the public RPC, without an API key. All settings stay in this browser.</p><button id="save-settings" ${busy?'disabled':''}>Save & refresh</button>
  <div class="inspect"><label>Inspect an address without connecting a wallet<input id="inspect-address" placeholder="0x… wallet address" value="${owner?escape(owner):''}" ${busy?'disabled':''}></label><button id="inspect" ${busy?'disabled':''}>Load inventory</button></div>
  </details>
  ${!settings.contract?'<p class="setup-note">Contract deployment is pending. Token discovery works now; approvals and batch sends become available after the verified mainnet contract is configured.</p>':''}
  <div class="workspace"><section class="inventory" aria-labelledby="inventory-title"><div class="section-head"><h2 id="inventory-title">Token inventory <span>${tokens.length}</span></h2><button id="refresh" ${busy||!owner?'disabled':''}>Refresh balances</button></div>${owner?`<p class="hint">${wallet?'Connected wallet':'Inspecting only'}: <span class="data">${escape(owner)}</span></p>`:''}
  <div class="toolbar"><input id="search" type="search" aria-label="Search tokens" placeholder="Search token or address" value="${escape(query)}"><button id="select-visible" ${busy||!tokens.length?'disabled':''}>Select visible</button><button id="clear" ${busy||!selected.size?'disabled':''}>Clear</button></div>
  <div class="preset-tools"><button id="save-set" ${busy||!selected.size?'disabled':''}>Save token set</button><button id="load-set" ${busy||!tokens.length||!savedSet.length?'disabled':''}>Load saved set${savedSet.length?' ('+savedSet.length+')':''}</button><span class="hint">Reuse your reward-token selection. Amounts reload from current balances.</span></div>
  <div class="add-token"><input id="manual" aria-label="Token contract address" placeholder="Add any ERC-20 contract address" ${busy?'disabled':''}><button id="add" ${busy||!owner?'disabled':''}>Add token</button></div>
  <div class="table-wrap"><table class="${list.length?'':'table-empty'}"><thead><tr><th scope="col"><span class="sr-only">Select</span></th><th scope="col">Token</th><th scope="col">Balance / amount</th><th scope="col">Approval</th></tr></thead><tbody>${list.map(t=>{
    const a=t.address.toLowerCase(),on=selected.has(a),value=selected.get(a)??'',ready=t.allowance!==null&&t.allowance>=(on&&selectedItems.find(i=>i.token===t)?.amount||t.balance);
    return `<tr class="${on?'selected':''}"><td><input type="checkbox" data-select="${a}" aria-label="Select ${escape(t.symbol)}" ${on?'checked':''} ${busy?'disabled':''}></td><td><strong>${escape(t.symbol)}</strong><span class="token-name">${escape(t.name)}</span><a class="address" href="https://etherscan.io/token/${t.address}" target="_blank" rel="noopener noreferrer">${escape(short(t.address))}</a>${t.warning?`<span class="warning">${escape(t.warning)}</span>`:''}</td><td class="amount-cell"><span class="balance" title="${escape(formatUnits(t.balance,t.decimals))}">${escape(formatUnits(t.balance,t.decimals))}</span>${on?`<div class="amount-input"><input inputmode="decimal" data-amount="${a}" aria-label="Amount of ${escape(t.symbol)}" value="${escape(value)}" ${busy?'disabled':''}><button data-max="${a}" ${busy?'disabled':''}>Max</button></div>`:''}</td><td><span class="approval ${ready?'ready':''}">${!settings.contract?'Set contract':ready?'Ready':'Needs approval'}</span>${on&&!ready&&settings.contract?`<button class="small" data-approve="${a}" ${busy?'disabled':''}>Approve</button>${t.allowance!==null&&t.allowance>0n?`<button class="small secondary" data-reset="${a}" ${busy?'disabled':''}>Reset to zero</button>`:''}`:''}</td></tr>`;
  }).join('')||`<tr><td colspan="4" class="empty">${owner?tokens.length?'No matching tokens.':'Load balances or add a token address.':'Connect Rabby or MetaMask to discover your tokens.'}</td></tr>`}</tbody></table></div><p class="hint">No market-price filter. Dust and unpriced tokens remain selectable. A successful simulation does not establish a token's market value.</p></section>
  <aside class="review" aria-labelledby="review-title"><h2 id="review-title">Review batch</h2><label>Send everything to<input id="recipient" placeholder="0x… recipient address" value="${escape(settings.recipient)}" ${busy?'disabled':''}></label><label>Approval amount<select id="approval-mode" ${busy?'disabled':''}><option value="unlimited" ${settings.unlimited?'selected':''}>Unlimited · reusable</option><option value="exact" ${!settings.unlimited?'selected':''}>Exact selected amount</option></select></label><p class="hint">Unlimited approvals let this contract transfer selected tokens in future batches. You can revoke allowances separately.</p>
  <dl><div><dt>Selected tokens</dt><dd>${selected.size} / ${MAX_TOKENS}</dd></div><div><dt>Approvals needed</dt><dd>${inputError?'—':needs.length}</dd></div><div><dt>Service fee</dt><dd>0 ETH</dd></div><div><dt>Estimated gas</dt><dd>${gasEstimate?.toLocaleString()??'Simulate first'}</dd></div><div><dt>Gas at estimated max fee</dt><dd>${feeEstimate!==null?escape(formatEther(feeEstimate))+' ETH':'—'}</dd></div></dl>
  ${selectedItems.length?`<details class="selected-review" open><summary>Selected amounts</summary><ul>${selectedItems.map(i=>`<li><span>${escape(i.token.symbol)}</span><span>${escape(formatUnits(i.amount,i.token.decimals))}</span></li>`).join('')}</ul></details>`:''}
  ${inputError?`<p class="error">${escape(inputError)}</p>`:''}<button id="simulate" class="primary" ${busy||!canSimulate?'disabled':''}>Simulate batch</button><button id="send" class="primary send" ${busy||!reviewed||!canSimulate?'disabled':''}>Review send in wallet</button><p class="hint">Approvals are separate transactions. The final send is one transaction; any failing token reverts the entire batch. Amounts are requested transfer amounts; tokens with transfer fees may deliver less. Final gas quote comes from your wallet.</p></aside></div>
  <section class="status ${statusError?'error':''}" role="status" aria-live="polite">${busy?'<span class="busy-dot" aria-hidden="true"></span>':''}${escape(status)}${lastHash?`<a href="https://etherscan.io/tx/${lastHash}" target="_blank" rel="noopener noreferrer">View last transaction</a>`:''}</section>${discoveryIssues.length?`<details class="discovery-details"><summary>Discovery details (${discoveryIssues.length})</summary><ul>${discoveryIssues.map(i=>`<li>${escape(i)}</li>`).join('')}</ul></details>`:''}</main><footer><span>Ethereum mainnet · no service fee</span><span>Contract ${settings.contract?`<a href="https://etherscan.io/address/${escape(settings.contract)}#code" target="_blank" rel="noopener noreferrer">${escape(short(settings.contract))}</a>`:'not configured'}</span></footer>`;
  bind();
}
function bind(){
  document.querySelector<HTMLDetailsElement>('.settings')!.ontoggle=e=>{settingsOpen=(e.currentTarget as HTMLDetailsElement).open;};
  el('connect').onclick=()=>void run(connect);el('refresh').onclick=()=>void run(load);
  el('inspect').onclick=()=>void run(inspect);
  el('save-settings').onclick=()=>void run(async()=>{
    settings={...settings,rpc:el<HTMLInputElement>('rpc').value.trim(),contract:el<HTMLInputElement>('contract').value.trim(),alchemyKey:el<HTMLInputElement>('alchemy').value.trim(),etherscanKey:el<HTMLInputElement>('etherscan').value.trim()};
    save();invalidate();contractVerified=false;if(owner)await load();else notice('Settings saved in this browser.');
  });
  el('recipient').oninput=()=>{settings.recipient=el<HTMLInputElement>('recipient').value.trim();save();invalidate();el<HTMLButtonElement>('send').disabled=true;};
  el('approval-mode').onchange=()=>{settings.unlimited=el<HTMLSelectElement>('approval-mode').value==='unlimited';save();invalidate();render();};
  el('search').oninput=()=>{const input=el<HTMLInputElement>('search');query=input.value;render();el<HTMLInputElement>('search').focus();};
  el('select-visible').onclick=()=>{tokens.filter(t=>`${t.symbol} ${t.name} ${t.address}`.toLowerCase().includes(query.toLowerCase())).forEach(t=>selected.set(t.address.toLowerCase(),formatUnits(t.balance,t.decimals)));invalidate();render();};
  el('clear').onclick=()=>{selected.clear();invalidate();render();};
  el('save-set').onclick=()=>{savedSet=[...selected.keys()];localStorage.setItem('multisend.tokenSet',JSON.stringify(savedSet));notice('Token set saved in this browser.');};
  el('load-set').onclick=()=>{selected.clear();for(const t of tokens)if(savedSet.includes(t.address.toLowerCase()))selected.set(t.address.toLowerCase(),formatUnits(t.balance,t.decimals));invalidate();notice(`Loaded ${selected.size} held tokens from the saved set. Review current balances before sending.`);};
  el('add').onclick=()=>void run(async()=>{const a=el<HTMLInputElement>('manual').value.trim();if(!isAddress(a)||getAddress(a)===zeroAddress)throw new Error('Enter a valid ERC-20 contract address.');settings.manual=[...new Set([...settings.manual,getAddress(a)])];save();await load();});
  document.querySelectorAll<HTMLInputElement>('[data-select]').forEach(e=>e.onchange=()=>{const a=e.dataset.select!,t=tokens.find(t=>t.address.toLowerCase()===a)!;if(e.checked)selected.set(a,formatUnits(t.balance,t.decimals));else selected.delete(a);invalidate();render();});
  document.querySelectorAll<HTMLInputElement>('[data-amount]').forEach(e=>{e.oninput=()=>{selected.set(e.dataset.amount!,e.value);invalidate();el<HTMLButtonElement>('send').disabled=true;const pending=itemsSafe();el<HTMLButtonElement>('simulate').disabled=busy||!wallet||!settings.contract||pending===null||pending.length===0||pending.some(i=>i.token.allowance===null||i.token.allowance<i.amount);};});
  document.querySelectorAll<HTMLButtonElement>('[data-max]').forEach(e=>e.onclick=()=>{const a=e.dataset.max!,t=tokens.find(t=>t.address.toLowerCase()===a)!;selected.set(a,formatUnits(t.balance,t.decimals));invalidate();render();});
  document.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach(e=>e.onclick=()=>void run(()=>approve(e.dataset.approve!)));
  document.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach(e=>e.onclick=()=>void run(()=>approve(e.dataset.reset!,true)));
  el('simulate').onclick=()=>void run(simulate);el('send').onclick=()=>void run(send);
}
window.addEventListener('eip6963:announceProvider',((event:CustomEvent<{info:{uuid:string;name:string};provider:EIP1193Provider}>)=>{
  const d=event.detail;if(!d?.info||!d.provider||wallets.some(w=>w.uuid===d.info.uuid))return;
  const entry={uuid:d.info.uuid,name:d.info.name,provider:d.provider};wallets.push(entry);
  const p=d.provider as EIP1193Provider & {on?:(event:string,listener:()=>void)=>void};
  const changed=()=>{if(wallet!==entry)return;scanId++;owner=null;tokens=[];selected.clear();invalidate();notice('Wallet account or network changed. Reconnect to refresh the inventory.');};
  p.on?.('accountsChanged',changed);p.on?.('chainChanged',changed);if(!busy)render();
}) as EventListener);
render();window.dispatchEvent(new Event('eip6963:requestProvider'));
