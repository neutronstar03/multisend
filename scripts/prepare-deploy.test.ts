import { expect,test } from 'bun:test';
import { getContractAddress, type Hex } from 'viem';
import { deploymentPlan,FACTORY,SALT } from './prepare-deploy';
test('CREATE2 plan binds factory, salt and creation code; calldata is salt followed by initcode',()=>{
  const bytecode:Hex='0x60006000f3';
  const plan=deploymentPlan(bytecode);
  expect(plan.address).toBe(getContractAddress({from:FACTORY,opcode:'CREATE2',salt:SALT,bytecode}));
  expect(plan.data).toBe((SALT+bytecode.slice(2)) as Hex);
  expect(deploymentPlan('0x60016000f3').address).not.toBe(plan.address);
});
