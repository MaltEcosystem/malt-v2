// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/Initializable.sol";

import "../AuctionParticipant.sol";

/// @title Reward Overflow Pool
/// @author 0xScotch <scotch@malt.money>
/// @notice Allows throttler contract to request capital when the current epoch underflows desired reward
contract RewardOverflowPool is Initializable, AuctionParticipant {
  using SafeERC20 for ERC20;

  uint256 public maxFulfillmentBps = 5000; // 50%
  address public throttler;

  event FulfilledRequest(uint256 amount);

  constructor(
    address _timelock,
    address initialAdmin
  ) {
    require(_timelock != address(0), "Overflow: Timelock addr(0)");
    require(initialAdmin != address(0), "Overflow: Admin addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);
  }

  function setupContracts(
    address _throttler,
    address _auction,
    address _impliedCollateralService,
    address _rewardToken
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(throttler == address(0), "Overflow: Already setup");
    require(_auction != address(0), "Overflow: Auction addr(0)");
    require(_impliedCollateralService != address(0), "Overflow: ColSvc addr(0)");
    require(_throttler != address(0), "Overflow: Throttle addr(0)");
    require(_rewardToken != address(0), "Overflow: RewardToken addr(0)");

    _setupParticipant(
      _impliedCollateralService,
      _rewardToken,
      _auction
    );

    _setupRole(REWARD_THROTTLE_ROLE, _throttler);

    throttler = _throttler;
  }

  function requestCapital(uint256 amount)
    external
    onlyRoleMalt(REWARD_THROTTLE_ROLE, "Must have Reward throttle privs")
    returns (uint256 fulfilledAmount)
  {
    uint256 balance = auctionRewardToken.balanceOf(address(this));

    if (balance == 0) {
      return 0;
    }

    // This is the max amount allowable
    fulfilledAmount = balance * maxFulfillmentBps / 10000;

    if (amount <= fulfilledAmount) {
      fulfilledAmount = amount;
    }

    auctionRewardToken.safeTransfer(throttler, fulfilledAmount);

    emit FulfilledRequest(fulfilledAmount);

    return fulfilledAmount;
  }

  /*
   * INTERNAL FUNCTIONS
   */
  function _handleRewardDistribution(uint256 amount) override internal {
    // reset claimable rewards as all rewards stay here
    claimableRewards = 0;
  }

  /*
   * PRIVILEDGED FUNCTIONS
   */
  function setMaxFulfillment(uint256 _maxFulfillment) external onlyRoleMalt(ADMIN_ROLE, "Must have admin privs") {
    require(_maxFulfillment != 0, "Can't have 0 max fulfillment");
    require(_maxFulfillment <= 10000, "Can't have above 100% max fulfillment");

    maxFulfillmentBps = _maxFulfillment;
  }

  function setThrottler(address _throttler) external onlyRoleMalt(ADMIN_ROLE, "Must have admin privs") {
    require(_throttler != address(0), "Not address 0");

    if (throttler != address(0)) {
      revokeRole(REWARD_THROTTLE_ROLE, throttler);
    }
    _setupRole(REWARD_THROTTLE_ROLE, _throttler);

    throttler = _throttler;
  }
}
