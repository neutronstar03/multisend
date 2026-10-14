// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal assertion helpers, so the suite does not need forge-std.
abstract contract Assertions {
    error AssertionFailed(string assertion, uint256 left, uint256 right);
    error AssertionFailedWithoutValues(string assertion);

    function assertTrue(bool value) internal pure {
        if (!value) revert AssertionFailedWithoutValues("assertTrue");
    }

    function assertTrue(bool value, string memory label) internal pure {
        if (!value) revert AssertionFailedWithoutValues(label);
    }

    function assertFalse(bool value) internal pure {
        if (value) revert AssertionFailedWithoutValues("assertFalse");
    }

    function assertFalse(bool value, string memory label) internal pure {
        if (value) revert AssertionFailedWithoutValues(label);
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        if (left != right) revert AssertionFailed("assertEq(uint256)", left, right);
    }

    function assertEq(uint256 left, uint256 right, string memory label) internal pure {
        if (left != right) revert AssertionFailed(label, left, right);
    }

    function assertEq(address left, address right) internal pure {
        if (left != right) {
            revert AssertionFailed(
                "assertEq(address)", uint256(uint160(left)), uint256(uint160(right))
            );
        }
    }

    function assertEq(address left, address right, string memory label) internal pure {
        if (left != right) {
            revert AssertionFailed(label, uint256(uint160(left)), uint256(uint160(right)));
        }
    }

    function assertEq(bytes4 left, bytes4 right, string memory label) internal pure {
        if (left != right) {
            revert AssertionFailed(label, uint256(uint32(left)), uint256(uint32(right)));
        }
    }
}
