// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MultiSend } from "../contracts/MultiSend.sol";

interface ForkVm {
    function envOr(string calldata, address) external returns (address);
    function envOr(string calldata, string calldata) external returns (string memory);
    function createSelectFork(string calldata) external returns (uint256);
    function startPrank(address) external;
    function stopPrank() external;
}

interface ForkToken {
    function balanceOf(address) external view returns (uint256);
}

/// @notice Optional real-token integration, simulated only. No transactions broadcast.
contract MainnetForkTest {
    ForkVm constant vm = ForkVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function test_MainnetBatchAfterApprovals() external {
        address owner = vm.envOr("MULTISEND_TEST_WALLET", address(0));
        if (owner == address(0)) return;
        string memory rpc =
            vm.envOr("MAINNET_RPC_URL", string("https://ethereum-rpc.publicnode.com"));
        vm.createSelectFork(rpc);
        MultiSend sender = deployDeterministically();
        address recipient = address(0xBEEF);
        address[17] memory catalogue = [
            address(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B),
            address(0xD533a949740bb3306d119CC777fa900bA034cd52),
            address(0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E),
            address(0x6440f144b7e50D6a8439336510312d2F54beB01D),
            address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
            address(0x01791F726B4103694969820be083196cC7c045fF),
            address(0x04ACaF8D2865c0714F79da09645C13FD2888977f),
            address(0x419905009e4656fdC02418C7Df35B1E61Ed5F726),
            address(0x365AccFCa291e7D3914637ABf1F7635dB165Bb09),
            address(0xf4c13D631450De6B12a19829E37c8e2826891dC4),
            address(0x501eBf66d76A96D4FB26ccead42957653e16B8B8),
            address(0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29),
            address(0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee),
            address(0x069662D2588fcaC24B5c209456Db965D151556f0),
            address(0x7aC81B3172870397496bD30502a07Cc9BfBB25eE),
            address(0xc8CF6D7991f15525488b2A83Df53468D682Ba4B0),
            address(0x000000Dc51B82DC9C14c2c034341c912907d0d59)
        ];
        uint256 count;
        for (uint256 i; i < catalogue.length; ++i) {
            if (ForkToken(catalogue[i]).balanceOf(owner) > 0) ++count;
        }
        require(count >= 10, "Test wallet must hold at least 10 catalogue tokens");
        address[] memory tokens = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        uint256[] memory beforeBalances = new uint256[](count);
        uint256 index;
        vm.startPrank(owner);
        for (uint256 i; i < catalogue.length; ++i) {
            uint256 balance = ForkToken(catalogue[i]).balanceOf(owner);
            if (balance == 0) continue;
            tokens[index] = catalogue[i];
            amounts[index] = balance;
            beforeBalances[index] = ForkToken(catalogue[i]).balanceOf(recipient);
            (bool ok, bytes memory data) = catalogue[i].call(
                abi.encodeWithSignature(
                    "approve(address,uint256)", address(sender), type(uint256).max
                )
            );
            require(ok && (data.length == 0 || abi.decode(data, (bool))), "Approval failed");
            ++index;
        }
        sender.batchTransfer(recipient, tokens, amounts);
        vm.stopPrank();
        for (uint256 i; i < count; ++i) {
            require(ForkToken(tokens[i]).balanceOf(owner) == 0, "Sender balance not cleared");
            require(
                ForkToken(tokens[i]).balanceOf(recipient) >= beforeBalances[i] + amounts[i],
                "Recipient mismatch"
            );
            require(ForkToken(tokens[i]).balanceOf(address(sender)) == 0, "Unexpected custody");
        }
    }

    function deployDeterministically() private returns (MultiSend) {
        address factory = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        bytes32 salt = keccak256("ns03.multisend.v0.1.0");
        bytes memory creationCode = type(MultiSend).creationCode;
        address predicted = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), factory, salt, keccak256(creationCode))
                    )
                )
            )
        );
        (bool deployed,) = factory.call(abi.encodePacked(salt, creationCode));
        require(deployed, "CREATE2 factory deployment failed");
        require(predicted.code.length > 0, "Predicted CREATE2 address has no code");
        require(
            keccak256(predicted.code) == keccak256(type(MultiSend).runtimeCode),
            "CREATE2 runtime mismatch"
        );
        return MultiSend(predicted);
    }
}
