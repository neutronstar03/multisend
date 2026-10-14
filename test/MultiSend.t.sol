// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MultiSend } from "../contracts/MultiSend.sol";
import { Assertions } from "./Assertions.sol";
import { Vm } from "./Vm.sol";
import {
    ERC20Core,
    GoodERC20,
    NoReturnERC20,
    FalseReturnERC20,
    MalformedReturnERC20,
    NonCanonicalBoolERC20,
    LongReturnERC20,
    RevertingERC20,
    ReentrantERC20,
    SwallowingReentrantERC20
} from "./mocks/MockTokens.sol";

contract MultiSendTest is Assertions {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MultiSend private multisend;
    GoodERC20 private tokenA;
    GoodERC20 private tokenB;
    NoReturnERC20 private noReturnToken;
    FalseReturnERC20 private falseReturnToken;
    MalformedReturnERC20 private malformedReturnToken;
    RevertingERC20 private revertingToken;
    ReentrantERC20 private reentrantToken;
    NonCanonicalBoolERC20 private nonCanonicalToken;
    LongReturnERC20 private longReturnToken;
    SwallowingReentrantERC20 private swallowingToken;

    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);
    address private carol = address(0xCA401);
    address private eoaToken = address(0xdead);

    function setUp() public {
        multisend = new MultiSend();
        tokenA = new GoodERC20();
        tokenB = new GoodERC20();
        noReturnToken = new NoReturnERC20();
        falseReturnToken = new FalseReturnERC20();
        malformedReturnToken = new MalformedReturnERC20();
        revertingToken = new RevertingERC20();
        reentrantToken = new ReentrantERC20();
        nonCanonicalToken = new NonCanonicalBoolERC20();
        longReturnToken = new LongReturnERC20();
        swallowingToken = new SwallowingReentrantERC20();
    }

    // ---------------------------------------------------------------- helpers

    function _single(address token) private pure returns (address[] memory tokens) {
        tokens = new address[](1);
        tokens[0] = token;
    }

    function _pair(address token0, address token1) private pure returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = token0;
        tokens[1] = token1;
    }

    function _one(uint256 amount) private pure returns (uint256[] memory amounts) {
        amounts = new uint256[](1);
        amounts[0] = amount;
    }

    function _two(uint256 amount0, uint256 amount1)
        private
        pure
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](2);
        amounts[0] = amount0;
        amounts[1] = amount1;
    }

    function _approve(address token, uint256 amount) private {
        ERC20Core(token).approve(address(multisend), amount);
    }

    // ------------------------------------------------------- happy path

    function test_BatchTransferMovesTwoTokensToRecipient() public {
        tokenA.mint(alice, 100e18);
        tokenB.mint(alice, 50e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        _approve(address(tokenB), type(uint256).max);
        multisend.batchTransfer(bob, _pair(address(tokenA), address(tokenB)), _two(10e18, 40e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(bob), 10e18, "bob tokenA");
        assertEq(tokenB.balanceOf(bob), 40e18, "bob tokenB");
        assertEq(tokenA.balanceOf(alice), 90e18, "alice tokenA");
        assertEq(tokenB.balanceOf(alice), 10e18, "alice tokenB");
    }

    function test_BatchTransferKeepsNoCustody() public {
        tokenA.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        multisend.batchTransfer(bob, _single(address(tokenA)), _one(10e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(address(multisend)), 0, "multisend holds no tokens");
        assertEq(address(multisend).balance, 0, "multisend holds no ETH");
        assertEq(tokenA.balanceOf(bob), 10e18, "bob received");
    }

    function test_BatchTransferEmitsEventOnce() public {
        tokenA.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        vm.expectEmit(true, true, false, false, address(multisend));
        emit MultiSend.BatchTransfer(alice, bob, 1);
        multisend.batchTransfer(bob, _single(address(tokenA)), _one(1e18));
        vm.stopPrank();
    }

    function test_CallerAsRecipientIsAllowedAndNeutral() public {
        tokenA.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        multisend.batchTransfer(alice, _single(address(tokenA)), _one(3e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), 10e18, "balance unchanged");
        assertEq(tokenA.balanceOf(address(multisend)), 0, "no custody");
    }

    function test_DuplicateTokenEntriesAreAllowed() public {
        tokenA.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        multisend.batchTransfer(bob, _pair(address(tokenA), address(tokenA)), _two(4e18, 6e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(bob), 10e18, "bob total");
        assertEq(tokenA.balanceOf(alice), 0, "alice drained");
    }

    function test_AllowsExactlyMaxTokens() public {
        uint256 count = multisend.MAX_TOKENS();
        tokenA.mint(alice, count * 1e18);

        address[] memory tokens = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            tokens[i] = address(tokenA);
            amounts[i] = 1e18;
        }

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        multisend.batchTransfer(bob, tokens, amounts);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(bob), count * 1e18, "bob total");
        assertEq(tokenA.balanceOf(alice), 0, "alice drained");
    }

    // ------------------------------------------------- non standard ERC20

    function test_NoReturnTokenIsAccepted() public {
        noReturnToken.mint(alice, 5e18);

        vm.startPrank(alice);
        _approve(address(noReturnToken), type(uint256).max);
        multisend.batchTransfer(bob, _single(address(noReturnToken)), _one(5e18));
        vm.stopPrank();

        assertEq(noReturnToken.balanceOf(bob), 5e18, "bob");
        assertEq(noReturnToken.balanceOf(alice), 0, "alice");
    }

    function test_FalseReturnTokenIsRejected() public {
        falseReturnToken.mint(alice, 5e18);

        vm.startPrank(alice);
        _approve(address(falseReturnToken), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                MultiSend.TransferFailed.selector, address(falseReturnToken), uint256(0)
            )
        );
        multisend.batchTransfer(bob, _single(address(falseReturnToken)), _one(5e18));
        vm.stopPrank();

        assertEq(falseReturnToken.balanceOf(bob), 0, "no tokens moved");
    }

    function test_MalformedReturnDataIsRejected() public {
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MultiSend.TransferFailed.selector, address(malformedReturnToken), uint256(0)
            )
        );
        multisend.batchTransfer(bob, _single(address(malformedReturnToken)), _one(1e18));
        vm.stopPrank();
    }

    function test_RevertingTokenBubblesTokenError() public {
        vm.startPrank(alice);
        vm.expectRevert(RevertingERC20.TokenBoom.selector);
        multisend.batchTransfer(bob, _single(address(revertingToken)), _one(1e18));
        vm.stopPrank();
    }

    function test_RevertsOnInsufficientAllowance() public {
        tokenA.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), 1e18);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20Core.ERC20InsufficientAllowance.selector,
                address(multisend),
                uint256(1e18),
                uint256(2e18)
            )
        );
        multisend.batchTransfer(bob, _single(address(tokenA)), _one(2e18));
        vm.stopPrank();
    }

    function test_RevertsOnInsufficientBalance() public {
        tokenA.mint(alice, 1e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20Core.ERC20InsufficientBalance.selector, alice, uint256(1e18), uint256(2e18)
            )
        );
        multisend.batchTransfer(bob, _single(address(tokenA)), _one(2e18));
        vm.stopPrank();
    }

    // ----------------------------------------------------------- atomicity

    function test_LateFailureRollsBackEarlierTransfers() public {
        tokenA.mint(alice, 100e18);
        falseReturnToken.mint(alice, 100e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        _approve(address(falseReturnToken), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                MultiSend.TransferFailed.selector, address(falseReturnToken), uint256(1)
            )
        );
        multisend.batchTransfer(
            bob, _pair(address(tokenA), address(falseReturnToken)), _two(10e18, 10e18)
        );
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), 100e18, "first token restored");
        assertEq(tokenA.balanceOf(bob), 0, "recipient untouched");
        assertEq(tokenA.balanceOf(address(multisend)), 0, "no dust");
        assertEq(falseReturnToken.balanceOf(alice), 100e18, "failing token restored");
        assertEq(falseReturnToken.balanceOf(bob), 0, "failing token not delivered");
    }

    function test_RevertingTokenInLaterIndexRollsBackEarlierTransfers() public {
        tokenA.mint(alice, 100e18);
        tokenB.mint(alice, 100e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        _approve(address(tokenB), type(uint256).max);
        vm.expectRevert(RevertingERC20.TokenBoom.selector);
        multisend.batchTransfer(
            bob, _pair(address(tokenA), address(revertingToken)), _two(10e18, 10e18)
        );
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), 100e18, "first token restored");
        assertEq(tokenA.balanceOf(bob), 0, "recipient untouched");
        assertEq(tokenB.balanceOf(alice), 100e18, "untouched token intact");
    }

    // ------------------------------------------------------ reentrancy

    function test_ReentrancyIsBlocked() public {
        reentrantToken.mint(alice, 100e18);

        address[] memory tokens = _single(address(reentrantToken));
        uint256[] memory amounts = _one(1e18);
        reentrantToken.setReentry(
            address(multisend), abi.encodeCall(MultiSend.batchTransfer, (bob, tokens, amounts))
        );

        vm.startPrank(alice);
        _approve(address(reentrantToken), type(uint256).max);
        vm.expectRevert(MultiSend.Reentrancy.selector);
        multisend.batchTransfer(bob, tokens, amounts);
        vm.stopPrank();

        assertEq(reentrantToken.balanceOf(bob), 0, "nothing moved");
        assertEq(reentrantToken.balanceOf(alice), 100e18, "balance restored");
    }

    function test_SwallowedReentrancyCannotSpendAnotherOwnersAllowance() public {
        tokenA.mint(alice, 100e18);
        swallowingToken.mint(bob, 10e18);

        vm.prank(alice);
        tokenA.approve(address(multisend), type(uint256).max);

        swallowingToken.setReentry(
            address(multisend),
            abi.encodeCall(
                MultiSend.batchTransfer,
                (address(swallowingToken), _single(address(tokenA)), _one(50e18))
            )
        );

        vm.startPrank(bob);
        _approve(address(swallowingToken), type(uint256).max);
        multisend.batchTransfer(carol, _single(address(swallowingToken)), _one(10e18));
        vm.stopPrank();

        assertFalse(swallowingToken.lastReentrySucceeded(), "nested call must fail");
        assertEq(
            bytes4(swallowingToken.lastReentryReturnData()),
            MultiSend.Reentrancy.selector,
            "nested reason"
        );
        assertEq(tokenA.balanceOf(alice), 100e18, "alice keeps tokenA");
        assertEq(tokenA.balanceOf(address(swallowingToken)), 0, "nothing stolen");
        assertEq(
            tokenA.allowance(alice, address(multisend)), type(uint256).max, "alice allowance intact"
        );
        assertEq(swallowingToken.balanceOf(bob), 0, "bob paid");
        assertEq(swallowingToken.balanceOf(carol), 10e18, "legitimate transfer went through");
        assertEq(swallowingToken.balanceOf(address(multisend)), 0, "no custody");
    }

    function test_UnauthorizedCallerCannotSpendAnotherUsersAllowance() public {
        tokenA.mint(alice, 100e18);

        vm.prank(alice);
        tokenA.approve(address(multisend), type(uint256).max);

        vm.startPrank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20Core.ERC20InsufficientAllowance.selector,
                address(multisend),
                uint256(0),
                uint256(1e18)
            )
        );
        multisend.batchTransfer(carol, _single(address(tokenA)), _one(1e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), 100e18, "alice balance intact");
        assertEq(tokenA.balanceOf(carol), 0, "attacker recipient got nothing");
        assertEq(
            tokenA.allowance(alice, address(multisend)), type(uint256).max, "alice allowance intact"
        );
        assertEq(tokenA.allowance(bob, address(multisend)), 0, "bob still has no allowance");
    }

    function test_RevertsOnSelfRecipient() public {
        tokenA.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        vm.expectRevert(MultiSend.SelfRecipient.selector);
        multisend.batchTransfer(address(multisend), _single(address(tokenA)), _one(1e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(address(multisend)), 0, "no custody");
        assertEq(tokenA.balanceOf(alice), 10e18, "balance intact");
    }

    function test_NonCanonicalBoolReturnIsRejected() public {
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MultiSend.TransferFailed.selector, address(nonCanonicalToken), uint256(0)
            )
        );
        multisend.batchTransfer(bob, _single(address(nonCanonicalToken)), _one(1e18));
        vm.stopPrank();
    }

    function test_OversizedReturnDataIsRejected() public {
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MultiSend.TransferFailed.selector, address(longReturnToken), uint256(0)
            )
        );
        multisend.batchTransfer(bob, _single(address(longReturnToken)), _one(1e18));
        vm.stopPrank();
    }

    // ------------------------------------------------- input validation

    function test_RevertsOnZeroRecipient() public {
        vm.startPrank(alice);
        vm.expectRevert(MultiSend.ZeroRecipient.selector);
        multisend.batchTransfer(address(0), _single(address(tokenA)), _one(1e18));
        vm.stopPrank();
    }

    function test_RevertsOnEmptyTokenList() public {
        vm.startPrank(alice);
        vm.expectRevert(MultiSend.EmptyBatch.selector);
        multisend.batchTransfer(bob, new address[](0), new uint256[](0));
        vm.stopPrank();
    }

    function test_RevertsOnEmptyTokenListWithAmounts() public {
        vm.startPrank(alice);
        vm.expectRevert(MultiSend.EmptyBatch.selector);
        multisend.batchTransfer(bob, new address[](0), _one(1e18));
        vm.stopPrank();
    }

    function test_RevertsOnLengthMismatch() public {
        vm.startPrank(alice);
        vm.expectRevert(MultiSend.LengthMismatch.selector);
        multisend.batchTransfer(bob, _pair(address(tokenA), address(tokenB)), _one(1e18));
        vm.stopPrank();
    }

    function test_RevertsAboveMaxTokens() public {
        uint256 count = multisend.MAX_TOKENS() + 1;

        address[] memory tokens = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            tokens[i] = address(tokenA);
            amounts[i] = 1e18;
        }

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(MultiSend.TooManyTokens.selector, count));
        multisend.batchTransfer(bob, tokens, amounts);
        vm.stopPrank();
    }

    function test_RevertsOnTokenWithoutCode() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(MultiSend.TokenNotContract.selector, eoaToken));
        multisend.batchTransfer(bob, _single(eoaToken), _one(1e18));
        vm.stopPrank();
    }

    function test_RevertsOnZeroAmountAtIndexZero() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(MultiSend.ZeroAmount.selector, uint256(0)));
        multisend.batchTransfer(bob, _single(address(tokenA)), _one(0));
        vm.stopPrank();
    }

    function test_RevertsOnZeroAmountAfterAValidFirstEntry() public {
        tokenA.mint(alice, 1e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(MultiSend.ZeroAmount.selector, uint256(1)));
        multisend.batchTransfer(bob, _pair(address(tokenA), address(tokenB)), _two(1e18, 0));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), 1e18, "nothing moved");
    }

    function test_RevertsOnZeroRecipientBeforeAnyTokenWork() public {
        tokenA.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        vm.expectRevert(MultiSend.ZeroRecipient.selector);
        multisend.batchTransfer(address(0), _single(address(tokenA)), _one(1e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), 10e18, "no transfer attempted");
    }

    function test_RejectsNativeEth() public {
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        (bool ok,) = address(multisend).call{ value: 1 ether }("");

        assertFalse(ok, "multisend must not accept native ETH");
        assertEq(address(multisend).balance, 0, "balance stays zero");
    }

    function test_RequiresPerTokenApproval() public {
        tokenA.mint(alice, 10e18);

        // No approval was made on behalf of the multisender: nothing can move.
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20Core.ERC20InsufficientAllowance.selector,
                address(multisend),
                uint256(0),
                uint256(1e18)
            )
        );
        multisend.batchTransfer(bob, _single(address(tokenA)), _one(1e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), 10e18, "balance intact");
        assertEq(tokenA.allowance(alice, address(multisend)), 0, "allowance untouched");
    }

    // ------------------------------------------------------- fuzz

    function testFuzz_TransfersRequestedAmounts(uint96 amountA, uint96 amountB, address recipient)
        public
    {
        vm.assume(recipient != address(0));
        vm.assume(recipient != alice);
        vm.assume(amountA > 0 && amountB > 0);

        tokenA.mint(alice, amountA);
        tokenB.mint(alice, amountB);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        _approve(address(tokenB), type(uint256).max);
        multisend.batchTransfer(
            recipient, _pair(address(tokenA), address(tokenB)), _two(amountA, amountB)
        );
        vm.stopPrank();

        assertEq(tokenA.balanceOf(recipient), amountA, "tokenA delivered");
        assertEq(tokenB.balanceOf(recipient), amountB, "tokenB delivered");
        assertEq(tokenA.balanceOf(alice), 0, "tokenA drained");
        assertEq(tokenB.balanceOf(alice), 0, "tokenB drained");
        assertEq(tokenA.balanceOf(address(multisend)), 0, "no custody A");
        assertEq(tokenB.balanceOf(address(multisend)), 0, "no custody B");
    }

    function testFuzz_PartialAllowanceRevertsAndRollsBack(uint96 amount) public {
        vm.assume(amount > 1e18);

        tokenA.mint(alice, amount);
        tokenB.mint(alice, 10e18);

        vm.startPrank(alice);
        _approve(address(tokenA), type(uint256).max);
        _approve(address(tokenB), 1e18 - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ERC20Core.ERC20InsufficientAllowance.selector,
                address(multisend),
                uint256(1e18 - 1),
                uint256(1e18)
            )
        );
        multisend.batchTransfer(bob, _pair(address(tokenA), address(tokenB)), _two(amount, 1e18));
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice), amount, "first token rolled back");
        assertEq(tokenB.balanceOf(alice), 10e18, "second token intact");
        assertEq(tokenA.balanceOf(bob), 0, "recipient untouched");
    }
}
