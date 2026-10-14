// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal subset of the Foundry cheatcode interface, declared locally so the test
/// suite stays self contained with no forge-std (or any other) dependency.
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function assume(bool condition) external;

    function deal(address account, uint256 newBalance) external;

    function prank(address msgSender) external;

    function startPrank(address msgSender) external;

    function stopPrank() external;

    function expectRevert() external;

    function expectRevert(bytes4 revertData) external;

    function expectRevert(bytes calldata revertData) external;

    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData)
        external;

    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData,
        address emitter
    ) external;
}
