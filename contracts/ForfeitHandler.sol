// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Permissions.sol";


/// @title Forfeit Handler
/// @author 0xScotch <scotch@malt.money>
/// @notice When a user unbonds, their unvested rewards are forfeited. This contract decides what to do with those funds
contract ForfeitHandler is Permissions {
  using SafeERC20 for ERC20;

  ERC20 public rewardToken;
  address public treasuryMultisig;
  address public swingTrader;

  uint256 public swingTraderRewardCutBps = 5000;

  event Forfeit(address sender, uint256 amount);
  event SetRewardCut(uint256 swingTraderCut);
  event SetTreasury(address treasury);
  event SetSwingTrader(address swingTrader);

  constructor(
    address _timelock,
    address initialAdmin,
    address _rewardToken,
    address _treasuryMultisig
  ) {
    require(_timelock != address(0), "ForfeitHandler: Timelock addr(0)");
    require(initialAdmin != address(0), "ForfeitHandler: Admin addr(0)");
    require(_rewardToken != address(0), "ForfeitHandler: RewardToken addr(0)");
    require(_treasuryMultisig != address(0), "ForfeitHandler: Treasury addr(0)");

    _adminSetup(_timelock);
    _setupRole(ADMIN_ROLE, initialAdmin);

    rewardToken = ERC20(_rewardToken);
    treasuryMultisig = _treasuryMultisig;
  }

  function handleForfeit() external {
    uint256 balance = rewardToken.balanceOf(address(this));

    if (balance == 0) {
      return;
    }

    uint256 swingTraderCut = balance * swingTraderRewardCutBps / 10000;
    uint256 treasuryCut = balance - swingTraderCut;

    if (swingTraderCut > 0) {
      rewardToken.safeTransfer(swingTrader, swingTraderCut);
    }

    if (treasuryCut > 0) {
      rewardToken.safeTransfer(treasuryMultisig, treasuryCut);
    }

    emit Forfeit(msg.sender, balance);
  }

  /*
   * PRIVILEDGED METHODS
   */
  function setRewardCut(
    uint256 _swingTraderCut
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_swingTraderCut <= 10000, "Reward cut must add to 100%");

    swingTraderRewardCutBps = _swingTraderCut;

    emit SetRewardCut(_swingTraderCut);
  }

  function setTreasury(address _treasury)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_treasury != address(0), "Cannot set 0 address");

    treasuryMultisig = _treasury;

    emit SetTreasury(_treasury);
  }

  function setSwingTrader(address _swingTrader)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_swingTrader != address(0), "Cannot set 0 address");

    swingTrader = _swingTrader;

    emit SetSwingTrader(_swingTrader);
  }
}
