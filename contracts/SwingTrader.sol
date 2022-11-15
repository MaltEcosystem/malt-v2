// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Permissions.sol";
import "./interfaces/IAuction.sol";
import "./interfaces/IRewardThrottle.sol";
import "./interfaces/IDexHandler.sol";


/// @title Swing Trader
/// @author 0xScotch <scotch@malt.money>
/// @notice The sole aim of this contract is to defend peg and try to profit in the process.
/// @dev It does so from a privileged internal position where it is allowed to purchase on the AMM even in recovery mode
contract SwingTrader is Permissions {
  using SafeERC20 for ERC20;

  bytes32 public constant CAPITAL_DELEGATE_ROLE = keccak256("CAPITAL_DELEGATE_ROLE");

  ERC20 public collateralToken;
  ERC20 public malt;
  IDexHandler public dexHandler;
  IRewardThrottle public rewardThrottle;

  uint256 internal deployedCapital;
  uint256 public lpProfitCutBps = 5000; // 50%
  uint256 public profitGreedBps = 5000; // 50%

  event SetLpProfitCut(uint256 profitCut);
  event SetProfitGreed(uint256 profitGreed);
  event Delegation(uint256 amount, address destination, address delegate);

  constructor(
    address _timelock,
    address initialAdmin,
    address _collateralToken,
    address _malt,
    address _dexHandler,
    address _stabilizerNode,
    address _rewardThrottle
  ) {
    require(_timelock != address(0), "SwingTrader: Timelock addr(0)");
    require(initialAdmin != address(0), "SwingTrader: Admin addr(0)");
    require(_collateralToken != address(0), "SwingTrader: ColToken addr(0)");
    require(_malt != address(0), "SwingTrader: Malt addr(0)");
    require(_dexHandler != address(0), "SwingTrader: DexHandler addr(0)");
    require(_stabilizerNode != address(0), "SwingTrader: StabNode addr(0)");
    require(_rewardThrottle != address(0), "SwingTrader: Throttle addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);
    _setupRole(STABILIZER_NODE_ROLE, _stabilizerNode);

    // Only timelock can add a delegate
    _roleSetup(CAPITAL_DELEGATE_ROLE, _timelock);

    collateralToken = ERC20(_collateralToken);
    malt = ERC20(_malt);
    dexHandler = IDexHandler(_dexHandler);
    rewardThrottle = IRewardThrottle(_rewardThrottle);
  }

  function buyMalt(uint256 maxCapital)
    external
    onlyRoleMalt(STABILIZER_NODE_ROLE, "Must have stabilizer node privs")
    returns (uint256 capitalUsed)
  {
    if (maxCapital == 0) {
      return 0;
    }

    uint256 balance = collateralToken.balanceOf(address(this));

    if (balance == 0) {
      return 0;
    }

    if (maxCapital < balance) {
      balance = maxCapital;
    }

    collateralToken.safeTransfer(address(dexHandler), balance);
    dexHandler.buyMalt(balance, 10000); // 100% allowable slippage

    deployedCapital = deployedCapital + balance;

    return balance;
  }

  function sellMalt(uint256 maxAmount)
    external
    onlyRoleMalt(STABILIZER_NODE_ROLE, "Must have stabilizer node privs")
    returns (uint256 amountSold)
  {
    if (maxAmount == 0) {
      return 0;
    }

    uint256 totalMaltBalance = malt.balanceOf(address(this));

    if (totalMaltBalance == 0) {
      return 0;
    }

    maxAmount = maxAmount * profitGreedBps / 10000;

    (uint256 basis,) = costBasis();

    if (maxAmount > totalMaltBalance) {
      maxAmount = totalMaltBalance;
    }

    malt.safeTransfer(address(dexHandler), maxAmount);
    // This only gets called during the stabilize flow
    // And transferVerification ensures any attempt to
    // sandwich will trigger stabilize first
    uint256 rewards = dexHandler.sellMalt(maxAmount, 10000);

    if (rewards <= deployedCapital && maxAmount < totalMaltBalance) {
      // If all malt is spent we want to reset deployed capital
      deployedCapital = deployedCapital - rewards;
    } else {
      deployedCapital = 0;
    }

    uint256 profit = _calculateProfit(basis, maxAmount, rewards);

    if (profit > 0) {
      uint256 lpCut = profit * lpProfitCutBps / 10000;

      collateralToken.safeTransfer(address(rewardThrottle), lpCut);
      rewardThrottle.handleReward();
    }

    return maxAmount;
  }

  function costBasis() public view returns (uint256 cost, uint256 decimals) {
    // Always returns using the decimals of the collateralToken as that is the
    // currency costBasis is calculated in
    decimals = collateralToken.decimals();
    uint256 maltBalance = malt.balanceOf(address(this));

    if (deployedCapital == 0 || maltBalance == 0) {
      return (0, decimals);
    }

    uint256 maltDecimals = malt.decimals();

    if (maltDecimals == decimals) {
      return (deployedCapital * (10**decimals) / maltBalance, decimals);
    } else if (maltDecimals > decimals) {
      uint256 diff = maltDecimals - decimals;
      return (deployedCapital * (10**decimals) / (maltBalance / (10**diff)), decimals);
    } else {
      uint256 diff = decimals - maltDecimals;
      return (deployedCapital * (10**decimals) / (maltBalance * (10**diff)), decimals);
    }
  }

  function _calculateProfit(
    uint256 costBasis,
    uint256 soldAmount,
    uint256 recieved
  )
    internal
    returns (uint256 profit)
  {
    if (costBasis == 0) {
      return 0;
    }
    uint256 decimals = collateralToken.decimals();
    uint256 maltDecimals = malt.decimals();

    if (maltDecimals == decimals) {
      uint256 soldBasis = costBasis * soldAmount / (10**decimals);

      if (recieved > soldBasis) {
        profit = recieved - soldBasis;
      }
    } else if (maltDecimals > decimals) {
      uint256 diff = maltDecimals - decimals;
      uint256 soldBasis = costBasis * soldAmount / (10**diff) / (10**decimals);

      if (recieved > soldBasis) {
        profit = recieved - soldBasis;
      }
    } else {
      uint256 diff = decimals - maltDecimals;
      uint256 soldBasis = costBasis * soldAmount * (10**diff) / (10**decimals);

      if (recieved > soldBasis) {
        profit = recieved - soldBasis;
      }
    }
  }

  function delegateCapital(uint256 amount, address destination)
    external
    onlyRoleMalt(CAPITAL_DELEGATE_ROLE, "Must have capital delegation privs")
  {
    collateralToken.safeTransfer(destination, amount);
    emit Delegation(amount, destination, msg.sender);
  }

  function setLpProfitCut(uint256 _profitCut) external onlyRoleMalt(ADMIN_ROLE, "Must have admin privs") {
    require(_profitCut <= 10000, "Must be between 0 and 100%");
    lpProfitCutBps = _profitCut;
    emit SetLpProfitCut(_profitCut);
  }

  function setProfitGreed(uint256 _profitGreed) external onlyRoleMalt(ADMIN_ROLE, "Must have admin privs") {
    require(_profitGreed <= 10000, "Must be between 0 and 100%");
    profitGreedBps = _profitGreed;
    emit SetProfitGreed(_profitGreed);
  }
}
