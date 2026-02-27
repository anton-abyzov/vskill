---
description: "Smart contract security patterns (CEI, reentrancy guards), Foundry fuzz/invariant testing, gas optimization, and security checklist. Use for Solidity development, contract auditing, and gas-efficient implementations."
---

# Blockchain & Web3 Development

## Checks-Effects-Interactions (CEI) Pattern

The CEI pattern prevents reentrancy by updating all state BEFORE making external calls.

```solidity
// CORRECT: CEI pattern with reentrancy guard
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SecureVault is ReentrancyGuard {
    mapping(address => uint256) private balances;

    function withdraw(uint256 amount) external nonReentrant {
        // 1. CHECKS - validate all preconditions
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // 2. EFFECTS - update ALL state before external calls
        balances[msg.sender] -= amount;

        // 3. INTERACTIONS - external calls LAST
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }
}
```

**Why both CEI AND ReentrancyGuard:**
- CEI prevents the specific reentrancy vector in this function
- `nonReentrant` protects against cross-function reentrancy (attacker re-enters a DIFFERENT function that reads stale state)
- Belt-and-suspenders: defense in depth for contracts holding real value

**Common CEI violation -- ERC-20 with callbacks:**
```solidity
// DANGEROUS: ERC-777 tokens have receive hooks that execute before transfer returns
function deposit(address token, uint256 amount) external {
    // If token is ERC-777, transferFrom triggers recipient hook BEFORE returning
    IERC20(token).transferFrom(msg.sender, address(this), amount); // INTERACTION
    balances[msg.sender][token] += amount;                         // EFFECT (too late!)
}

// SAFE: Effects before interaction
function deposit(address token, uint256 amount) external nonReentrant {
    balances[msg.sender][token] += amount;                         // EFFECT first
    bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
    require(success, "Transfer failed");
}
```

## Foundry Testing: Fuzz and Invariant

### Fuzz Testing

Foundry auto-generates random inputs and runs the test function many times.

```solidity
// test/SecureVault.t.sol
import "forge-std/Test.sol";

contract SecureVaultTest is Test {
    SecureVault vault;
    MockERC20 token;
    address user1 = makeAddr("user1");

    function setUp() public {
        vault = new SecureVault();
        token = new MockERC20();
        vault.setAllowedToken(address(token), true);
        token.transfer(user1, 1000 ether);
    }

    // Fuzz: Foundry generates random `amount` values
    function testFuzz_deposit(uint256 amount) public {
        amount = bound(amount, 1, 1000 ether);  // Constrain to valid range

        vm.startPrank(user1);
        token.approve(address(vault), amount);
        vault.deposit(address(token), amount);
        vm.stopPrank();

        assertEq(vault.getBalance(user1, address(token)), amount);
    }

    // Fuzz withdrawal never exceeds deposit
    function testFuzz_withdrawNeverExceedsBalance(uint256 depositAmt, uint256 withdrawAmt) public {
        depositAmt = bound(depositAmt, 1, 1000 ether);
        withdrawAmt = bound(withdrawAmt, depositAmt + 1, type(uint256).max);

        vm.startPrank(user1);
        token.approve(address(vault), depositAmt);
        vault.deposit(address(token), depositAmt);

        vm.expectRevert();
        vault.withdraw(address(token), withdrawAmt);
        vm.stopPrank();
    }
}
```

### Invariant Testing

Invariants assert properties that must ALWAYS hold, regardless of action sequence.

```solidity
// test/SecureVault.invariant.t.sol
contract SecureVaultInvariantTest is Test {
    SecureVault vault;
    MockERC20 token;
    VaultHandler handler;

    function setUp() public {
        vault = new SecureVault();
        token = new MockERC20();
        vault.setAllowedToken(address(token), true);

        handler = new VaultHandler(vault, token);
        targetContract(address(handler));  // Foundry calls random handler functions
    }

    // INVARIANT: Vault token balance >= sum of all tracked user balances
    function invariant_solvency() public view {
        uint256 vaultBalance = token.balanceOf(address(vault));
        uint256 trackedTotal = handler.totalTrackedDeposits();
        assertGe(vaultBalance, trackedTotal, "Vault is insolvent");
    }

    // INVARIANT: No user can have negative balance
    function invariant_noNegativeBalances() public view {
        address[] memory users = handler.getUsers();
        for (uint256 i = 0; i < users.length; i++) {
            assertGe(vault.getBalance(users[i], address(token)), 0);
        }
    }
}

// Handler: defines the action space for invariant testing
contract VaultHandler is Test {
    SecureVault vault;
    MockERC20 token;
    address[] public users;
    uint256 public totalTrackedDeposits;

    constructor(SecureVault _vault, MockERC20 _token) {
        vault = _vault;
        token = _token;
        // Create actor pool
        for (uint256 i = 0; i < 5; i++) {
            address user = makeAddr(string(abi.encodePacked("user", i)));
            users.push(user);
            token.transfer(user, 100 ether);
        }
    }

    function deposit(uint256 userIdx, uint256 amount) external {
        userIdx = bound(userIdx, 0, users.length - 1);
        amount = bound(amount, 1, 10 ether);
        address user = users[userIdx];

        vm.startPrank(user);
        token.approve(address(vault), amount);
        vault.deposit(address(token), amount);
        vm.stopPrank();

        totalTrackedDeposits += amount;
    }

    function getUsers() external view returns (address[] memory) { return users; }
}
```

**Run commands:**
```bash
forge test --fuzz-runs 10000                    # Fuzz with 10K iterations
forge test --match-test invariant               # Run invariant tests
forge test --match-test invariant -vvvv         # Verbose (shows call sequences on failure)
```

## Gas Optimization

### Storage Packing

```solidity
// BAD: 4 storage slots (128 bytes, 4 SLOAD/SSTORE operations)
contract Unoptimized {
    uint256 a;    // slot 0 (32 bytes)
    bool b;       // slot 1 (wastes 31 bytes)
    uint256 c;    // slot 2
    bool d;       // slot 3
}

// GOOD: 3 storage slots (bools packed together)
contract Optimized {
    uint256 a;    // slot 0
    uint256 c;    // slot 1
    bool b;       // slot 2 (packed with d -- 2 bytes total)
    bool d;       // slot 2
}

// BEST: Struct packing for related data
struct UserData {
    uint128 balance;     // 16 bytes \
    uint64 lastUpdate;   // 8 bytes   |-- 29 bytes total, fits in 1 slot
    uint32 nonce;        // 4 bytes  /
    bool active;         // 1 byte  /
}
```

### calldata vs memory

```solidity
// Use calldata for read-only external params (saves ~60 gas per word vs memory copy)
function process(bytes calldata data) external pure returns (bytes32) {
    return keccak256(data);
}

// memory is required only when you need to modify the parameter
function modify(bytes memory data) internal pure returns (bytes memory) {
    data[0] = 0x00;
    return data;
}
```

### immutable and constant

```solidity
contract GasEfficient {
    // constant: value known at compile time, inlined everywhere (zero SLOAD)
    uint256 public constant MAX_SUPPLY = 10000;

    // immutable: set once in constructor, stored in bytecode (zero SLOAD)
    address public immutable owner;
    uint256 public immutable deployedAt;

    constructor() {
        owner = msg.sender;       // Set once, never uses storage slot
        deployedAt = block.timestamp;
    }
}
```

### Unchecked Blocks

```solidity
// Save ~100 gas per arithmetic operation when overflow is impossible
function sum(uint256[] calldata values) external pure returns (uint256 total) {
    for (uint256 i = 0; i < values.length;) {
        total += values[i];
        unchecked { ++i; }  // Safe: i < values.length prevents overflow
    }
}

// Also use for counters that realistically never overflow
unchecked { tokenId++; }  // uint256 won't overflow in practice
```

### Additional Gas Tips

```solidity
// Custom errors save ~50 gas vs require strings (no string storage)
error InsufficientBalance(uint256 requested, uint256 available);
if (amount > balance) revert InsufficientBalance(amount, balance);

// Cache storage reads in local variables
function withdrawAll(address[] storage users) internal {
    uint256 length = users.length;  // 1 SLOAD, not N
    for (uint256 i = 0; i < length;) {
        _withdraw(users[i]);
        unchecked { ++i; }
    }
}

// Use mappings over arrays for large collections (O(1) vs O(n) lookup)
// Delete storage to get gas refund (up to 20% of transaction gas)
delete balances[msg.sender];
```

## Security Checklist

**Reentrancy:**
- [ ] CEI pattern on ALL functions with external calls
- [ ] `nonReentrant` modifier on payable/withdrawal functions
- [ ] Watch for ERC-777 token callback reentrancy (receive hooks)
- [ ] Cross-function reentrancy: no stale reads between state update and external call

**Oracle Manipulation:**
- [ ] Use Chainlink or other decentralized oracles (never single-source price feeds)
- [ ] Implement TWAP (Time-Weighted Average Price) for on-chain price data
- [ ] Set maximum price deviation thresholds (reject >10% moves in single block)
- [ ] Never use `block.timestamp` or spot AMM price as sole oracle

**Flash Loan Attacks:**
- [ ] Assume any external call can be funded with unlimited capital
- [ ] Do not use token balance of current block as governance voting weight
- [ ] Use time-delayed snapshots for governance and reward calculations
- [ ] Price-sensitive functions should reference historical price (TWAP)

**Front-Running / MEV:**
- [ ] Commit-reveal scheme for sensitive operations (auctions, reveals)
- [ ] Set reasonable slippage limits on DEX interactions (`minAmountOut`)
- [ ] Consider Flashbots Protect for private transaction submission
- [ ] Deadline parameters on time-sensitive transactions

**Access Control:**
- [ ] All admin functions protected (`onlyOwner` or `AccessControl`)
- [ ] Use multi-sig or timelock for mainnet admin operations
- [ ] Emergency `pause()` mechanism for critical contracts
- [ ] No hardcoded addresses; use constructor params or admin setters

**General:**
- [ ] Events emitted for ALL state changes (required for off-chain indexing)
- [ ] Input validation on all external/public functions
- [ ] Slither static analysis: no high/medium findings
- [ ] Fuzz testing: 10,000+ runs on critical functions
- [ ] Invariant tests for protocol-level properties (solvency, supply conservation)
- [ ] Independent audit for contracts holding significant value
