import { createPublicClient, getContractAddress, http, keccak256, stringToHex, type Address, type Hex } from 'viem';
import artifact from '../src/contract.json';

export const FACTORY:Address='0x4e59b44847b379578588920cA78FbF26c0B4956C';
export const FACTORY_RUNTIME:Hex='0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';
export const SALT=keccak256(stringToHex('ns03.multisend.v0.1.0'));
export function deploymentPlan(bytecode:Hex){
  return {factory:FACTORY,salt:SALT,initCodeHash:keccak256(bytecode),address:getContractAddress({from:FACTORY,opcode:'CREATE2',salt:SALT,bytecode}),data:(SALT+bytecode.slice(2)) as Hex};
}

if(import.meta.main){
  const rpc=process.env.MAINNET_RPC_URL??'https://ethereum-rpc.publicnode.com';
  const chainId=Number(process.env.DEPLOY_CHAIN_ID??'1');
  if(!Number.isSafeInteger(chainId)||chainId<=0)throw new Error('Invalid DEPLOY_CHAIN_ID.');
  const client=createPublicClient({transport:http(rpc)});
  if(await client.getChainId()!==chainId)throw new Error('RPC chain does not match DEPLOY_CHAIN_ID.');
  if(await client.getCode({address:FACTORY})!==FACTORY_RUNTIME)throw new Error('Expected deterministic factory is missing or has different bytecode on this chain.');
  const plan=deploymentPlan(artifact.bytecode as Hex);
  const existing=await client.getCode({address:plan.address});
  if(existing&&existing!=='0x'&&keccak256(existing)!==artifact.runtimeHash)throw new Error('Predicted address is occupied by different runtime code.');
  const state=existing&&existing!=='0x'?'already deployed, runtime matches':'not deployed';
  if(state==='not deployed')await client.call({to:FACTORY,data:plan.data});
  const manifest={chainId,...plan,runtimeHash:artifact.runtimeHash,state};
  await Bun.write('deployment-plan.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({chainId,factory:FACTORY,salt:SALT,address:plan.address,initCodeHash:plan.initCodeHash,runtimeHash:artifact.runtimeHash,state},null,2));
  console.log('Prepared deployment-plan.json; no transaction broadcast.');
}
