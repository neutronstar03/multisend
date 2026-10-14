// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MultiSend
/// @notice Minimal, non-custodial, zero-fee ERC20 batch transfer helper.
/// @dev Stateless besides a reentrancy lock: for every entry in the batch the contract
/// calls transferFrom on the token, moving the tokens straight from the caller to the
/// recipient inside the same transaction. It never holds a balance, has no owner or
/// admin, no upgrade path, no native ETH handling, no permit logic and no custody.
/// MultiSend never executes an approval: the ERC20 allowance must already have been
/// granted to this contract by the caller, per token, before the batch is submitted.
/// Only the caller's own balance and allowance are ever spent, because every
/// transferFrom uses msg.sender as the token owner.
contract MultiSend {
    /// @dev transferFrom(address,address,uint256) selector.
    bytes4 private constant _TRANSFER_FROM_SELECTOR = 0x23b872dd;

    /// @notice Maximum number of token transfers accepted in a single call.
    uint256 public constant MAX_TOKENS = 100;

    /// @dev 0 = idle, 1 = inside batchTransfer. Zero is the default value, which keeps the
    /// deployment cost of the lock minimal.
    uint256 private _status;

    /// @notice The recipient is the zero address.
    error ZeroRecipient();
    /// @notice The recipient is this contract, which would strand the tokens (no rescue path exists).
    error SelfRecipient();
    /// @notice The token list is empty.
    error EmptyBatch();
    /// @notice tokens.length is not equal to amounts.length.
    error LengthMismatch();
    /// @notice More than MAX_TOKENS entries were supplied.
    error TooManyTokens(uint256 length);
    /// @notice A supplied token address has no code (EOA or not deployed).
    error TokenNotContract(address token);
    /// @notice A supplied amount is zero.
    error ZeroAmount(uint256 index);
    /// @notice A token reported failure, returned malformed data, or reverted without data.
    error TransferFailed(address token, uint256 index);
    /// @notice batchTransfer was re-entered while already executing.
    error Reentrancy();

    /// @notice Emitted once per successful batch.
    /// @param caller The account whose tokens were moved.
    /// @param recipient The single account that received every token.
    /// @param tokenCount Number of token transfers performed.
    event BatchTransfer(address indexed caller, address indexed recipient, uint256 tokenCount);

    modifier nonReentrant() {
        if (_status != 0) revert Reentrancy();
        _status = 1;
        _;
        _status = 0;
    }

    /// @notice Moves amounts[i] of tokens[i] from msg.sender to recipient.
    /// @dev The whole batch is atomic: any failing transfer reverts the entire call, so no
    /// partial state can survive. Requirements:
    /// - recipient is neither the zero address nor this contract;
    /// - tokens.length is not zero and equals amounts.length;
    /// - tokens.length is at most MAX_TOKENS (100);
    /// - every tokens[i] is a deployed contract;
    /// - every amounts[i] is not zero;
    /// - msg.sender has approved this contract for at least amounts[i] of tokens[i] and
    ///   holds the balance, otherwise the token revert is bubbled up unchanged.
    /// Sending to msg.sender is permitted and is a no-op for well behaved tokens.
    /// Sending to this contract is rejected: MultiSend has no function that could move
    /// tokens out again, so they would be stranded.
    /// @param recipient The single account receiving every token in the batch.
    /// @param tokens The ERC20 token addresses to move.
    /// @param amounts The amount of each token to move, index aligned with tokens.
    function batchTransfer(address recipient, address[] calldata tokens, uint256[] calldata amounts)
        external
        nonReentrant
    {
        if (recipient == address(0)) revert ZeroRecipient();
        if (recipient == address(this)) revert SelfRecipient();

        uint256 length = tokens.length;
        if (length == 0) revert EmptyBatch();
        if (length != amounts.length) revert LengthMismatch();
        if (length > MAX_TOKENS) revert TooManyTokens(length);

        for (uint256 i; i < length; ++i) {
            address token = tokens[i];
            uint256 amount = amounts[i];

            if (token.code.length == 0) revert TokenNotContract(token);
            if (amount == 0) revert ZeroAmount(i);

            _safeTransferFrom(token, recipient, amount, i);
        }

        emit BatchTransfer(msg.sender, recipient, length);
    }

    /// @dev Calls transferFrom with a low level call so that ERC20 flavours that return no
    /// data, flavours that return false and malformed flavours are all handled:
    /// - call reverted with data: the token revert is bubbled up unchanged;
    /// - call reverted without data: TransferFailed;
    /// - empty return data: treated as success (legacy ERC20);
    /// - return data that is not exactly one 32 byte word: TransferFailed (malformed);
    /// - that word different from 1: TransferFailed (explicit false or noncanonical bool).
    function _safeTransferFrom(address token, address recipient, uint256 amount, uint256 index)
        private
    {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(_TRANSFER_FROM_SELECTOR, msg.sender, recipient, amount)
        );

        if (!ok) {
            if (data.length != 0) {
                assembly {
                    revert(add(data, 0x20), mload(data))
                }
            }
            revert TransferFailed(token, index);
        }

        if (data.length == 0) return;

        if (data.length != 32) revert TransferFailed(token, index);

        uint256 returned;
        assembly {
            returned := mload(add(data, 0x20))
        }
        if (returned != 1) revert TransferFailed(token, index);
    }
}
