// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Shared ERC20 storage and internal logic for every mock token below.
/// Deliberately not a full ERC20: it exposes only what the tests need.
abstract contract ERC20Core {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InsufficientAllowance(address spender, uint256 allowed, uint256 needed);
    error ERC20InvalidReceiver(address receiver);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) public virtual {
        if (to == address(0)) revert ERC20InvalidReceiver(to);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) public virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function _spendAllowance(address owner, uint256 amount) internal {
        uint256 allowed = allowance[owner][msg.sender];
        if (allowed == type(uint256).max) return;
        if (allowed < amount) revert ERC20InsufficientAllowance(msg.sender, allowed, amount);
        allowance[owner][msg.sender] = allowed - amount;
    }

    function _move(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ERC20InvalidReceiver(to);
        uint256 balance = balanceOf[from];
        if (balance < amount) revert ERC20InsufficientBalance(from, balance, amount);
        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// @dev Well behaved ERC20: transferFrom returns true.
contract GoodERC20 is ERC20Core {
    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        _spendAllowance(from, amount);
        _move(from, to, amount);
        return true;
    }
}

/// @dev Legacy / non standard ERC20: transferFrom returns no data at all.
contract NoReturnERC20 is ERC20Core {
    function transferFrom(address from, address to, uint256 amount) external {
        _spendAllowance(from, amount);
        _move(from, to, amount);
    }
}

/// @dev Broken ERC20: performs the transfer but reports failure with false.
contract FalseReturnERC20 is ERC20Core {
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, amount);
        _move(from, to, amount);
        return false;
    }
}

/// @dev Malformed ERC20: returns a single byte instead of an ABI encoded bool.
contract MalformedReturnERC20 is ERC20Core {
    function transferFrom(address, address, uint256) external pure {
        assembly {
            mstore(0x00, 1)
            return(0x1f, 1)
        }
    }
}

/// @dev Frozen / paused ERC20: always reverts, with returndata.
contract RevertingERC20 is ERC20Core {
    error TokenBoom();

    function transferFrom(address, address, uint256) external pure {
        revert TokenBoom();
    }
}

/// @dev Malicious ERC20: tries to re-enter MultiSend during transferFrom.
contract ReentrantERC20 is GoodERC20 {
    address public reentryTarget;
    bytes public reentryPayload;

    function setReentry(address target, bytes calldata payload) external {
        reentryTarget = target;
        reentryPayload = payload;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _spendAllowance(from, amount);
        _move(from, to, amount);

        address target = reentryTarget;
        if (target != address(0)) {
            (bool ok, bytes memory data) = target.call(reentryPayload);
            if (!ok) {
                assembly {
                    revert(add(data, 0x20), mload(data))
                }
            }
        }
        return true;
    }
}

/// @dev Returns the ABI word 2 instead of 1: valid encoding, noncanonical bool.
contract NonCanonicalBoolERC20 is ERC20Core {
    function transferFrom(address, address, uint256) external pure returns (uint256) {
        return 2;
    }
}

/// @dev Returns 64 bytes of returndata: a true word followed by trailing garbage.
contract LongReturnERC20 is ERC20Core {
    function transferFrom(address, address, uint256) external pure returns (uint256, uint256) {
        return (1, 0);
    }
}

/// @dev Malicious ERC20: re-enters MultiSend during transferFrom and swallows the outcome.
contract SwallowingReentrantERC20 is GoodERC20 {
    address public reentryTarget;
    bytes public reentryPayload;
    bool public lastReentrySucceeded;
    bytes public lastReentryReturnData;

    function setReentry(address target, bytes calldata payload) external {
        reentryTarget = target;
        reentryPayload = payload;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _spendAllowance(from, amount);
        _move(from, to, amount);

        address target = reentryTarget;
        if (target != address(0)) {
            (bool ok, bytes memory data) = target.call(reentryPayload);
            lastReentrySucceeded = ok;
            lastReentryReturnData = data;
        }
        return true;
    }
}
