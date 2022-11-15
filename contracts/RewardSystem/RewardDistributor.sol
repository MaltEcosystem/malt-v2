// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../Permissions.sol";
import "../interfaces/IBonding.sol";
import "../interfaces/IForfeit.sol";
import "../interfaces/IRewardMine.sol";


struct State {
  uint256 declaredBalance;
}

struct FocalPoint {
  uint256 id;
  uint256 focalLength;
  uint256 endTime;

  uint256 rewarded;
  uint256 vested;

  uint256 lastVestingTime;
}

/// @title Reward Vesting Distributor
/// @author 0xScotch <scotch@malt.money>
/// @notice The contract in charge of implementing the focal vesting scheme for rewards
contract RewardDistributor is Permissions {
  using SafeERC20 for ERC20;

  uint256 public focalID = 1; // Avoid issues with defaulting to 0
  uint256 public focalLength = 2 days;

  bytes32 public constant REWARDER_ROLE = keccak256("REWARDER_ROLE");
  bytes32 public constant REWARD_MINE_ROLE = keccak256("REWARD_MINE_ROLE");
  bytes32 public constant FOCAL_LENGTH_UPDATER_ROLE = keccak256("FOCAL_LENGTH_UPDATER_ROLE");

  address public throttler;
  IRewardMine public rewardMine;
  IForfeit public forfeitor;
  ERC20 public rewardToken;
  IBonding public bonding;

  State internal _globals;
  FocalPoint[] internal focalPoints;

  event DeclareReward(
    uint256 amount,
    address rewardToken
  );
  event Forfeit(address account, address rewardToken, uint256 forfeited);
  event RewardFocal(
    uint256 id,
    uint256 focalLength,
    uint256 endTime,
    uint256 rewarded
  );

  constructor(
    address _timelock,
    address initialAdmin,
    address _rewardToken
  ) {
    require(_timelock != address(0), "Distributor: Timelock addr(0)");
    require(initialAdmin != address(0), "Distributor: Admin addr(0)");
    require(_rewardToken != address(0), "Distributor: RewardToken addr(0)");

    _adminSetup(_timelock);
    _setupRole(FOCAL_LENGTH_UPDATER_ROLE, _timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);
    _roleSetup(FOCAL_LENGTH_UPDATER_ROLE, initialAdmin);

    rewardToken = ERC20(_rewardToken);

    focalPoints.push();
    focalPoints.push();
  }

  function setupContracts(
    address _rewardMine,
    address _bonding,
    address _throttler,
    address _forfeitor
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Only admin role")
  {
    require(throttler == address(0), "Distributor: Setup already done");
    require(_rewardMine != address(0), "Distributor: RewardMine addr(0)");
    require(_bonding != address(0), "Distributor: Bonding addr(0)");
    require(_throttler != address(0), "Distributor: Throttler addr(0)");
    require(_forfeitor != address(0), "Distributor: Forfeitor addr(0)");

    _roleSetup(REWARDER_ROLE, _throttler);
    _roleSetup(REWARD_MINE_ROLE, _rewardMine);

    rewardMine = IRewardMine(_rewardMine);
    bonding = IBonding(_bonding);
    throttler = _throttler;
    forfeitor = IForfeit(_forfeitor);
  }

  function vest() public {
    if (_globals.declaredBalance == 0) {
      return;
    }
    uint256 vestedReward = 0;
    uint256 balance = rewardToken.balanceOf(address(this));

    FocalPoint storage vestingFocal = _getVestingFocal();
    FocalPoint storage activeFocal = _updateAndGetActiveFocal();

    vestedReward = _getVestableQuantity(vestingFocal);
    uint256 activeReward = _getVestableQuantity(activeFocal);

    vestedReward = vestedReward + activeReward;

    if (vestedReward > balance) {
      vestedReward = balance;
    }

    if (vestedReward > 0) {
      // Send vested amount to liquidity mine
      rewardToken.safeTransfer(address(rewardMine), vestedReward);
      rewardMine.releaseReward(vestedReward);
    }

    // increment focalID if time is past the halfway mark
    // through a focal period
    if (block.timestamp >= _getNextFocalStart(activeFocal)) {
      _incrementFocalPoint();
    }
  }

  /* PUBLIC VIEW FUNCTIONS */
  function totalDeclaredReward() public view returns (uint256) {
    return _globals.declaredBalance;
  }

  function getAllFocalUnvestedBps()
    public
    view
    returns (
      uint256 currentUnvestedBps,
      uint256 vestingUnvestedBps
    )
  {
    uint256 currentId = focalID;

    FocalPoint storage currentFocal = focalPoints[_getFocalIndex(currentId)];
    FocalPoint storage vestingFocal = focalPoints[_getFocalIndex(currentId + 1)];

    return (
      _getFocalUnvestedBps(currentFocal),
      _getFocalUnvestedBps(vestingFocal)
    );
  }

  function getFocalUnvestedBps(uint256 id)
    public
    view
    returns (uint256 unvestedBps)
  {
    FocalPoint storage currentFocal = focalPoints[_getFocalIndex(id)];

    return _getFocalUnvestedBps(currentFocal);
  }

  /* INTERNAL VIEW FUNCTIONS */
  function _getFocalUnvestedBps(FocalPoint memory focal)
    internal
    view
    returns (uint256)
  {
    uint256 periodLength = focal.focalLength;
    uint256 vestingEndTime = focal.endTime;

    if (block.timestamp >= vestingEndTime) {
      return 0;
    }

    return (vestingEndTime - block.timestamp) * 10000 / periodLength;
  }

  function _getFocalIndex(uint256 id) internal pure returns (uint8 index) {
    return uint8(id % 2);
  }

  function _getVestingFocal() internal view returns (FocalPoint storage) {
    // Can add 1 as the modulo ensures we wrap correctly
    uint8 index = _getFocalIndex(focalID + 1);
    return focalPoints[index];
  }

  /* INTERNAL FUNCTIONS */
  function _updateAndGetActiveFocal() internal returns (FocalPoint storage) {
    uint8 index = _getFocalIndex(focalID);
    FocalPoint storage focal = focalPoints[index];

    if (focal.id != focalID) {
      // If id is not focalID then reinitialize the struct
      _resetFocalPoint(focalID, block.timestamp + focalLength);
    }

    return focal;
  }

  function _rewardCheck(uint256 reward) internal {
    require(reward > 0, "Cannot declare 0 reward");

    _globals.declaredBalance = _globals.declaredBalance + reward;

    uint256 totalReward = rewardToken.balanceOf(address(this)) + rewardMine.totalReleasedReward();

    require(_globals.declaredBalance <= totalReward, "Insufficient balance");
  }

  function _forfeit(uint256 forfeited) internal {
    require(forfeited <= _globals.declaredBalance, "Cannot forfeit more than declared");

    _globals.declaredBalance = _globals.declaredBalance - forfeited;

    _decrementFocalRewards(forfeited);

    rewardToken.safeTransfer(address(forfeitor), forfeited);
    forfeitor.handleForfeit();

    uint256 totalReward = rewardToken.balanceOf(address(this)) + rewardMine.totalReleasedReward();

    require(_globals.declaredBalance <= totalReward, "Insufficient balance");

    emit Forfeit(msg.sender, address(rewardToken), forfeited);
  }

  function _decrementFocalRewards(uint256 amount) internal {
    FocalPoint storage vestingFocal = _getVestingFocal();
    uint256 remainingVest = vestingFocal.rewarded - vestingFocal.vested;

    if (remainingVest >= amount) {
      vestingFocal.rewarded -= amount;
    } else {
      vestingFocal.rewarded -= remainingVest;
      remainingVest = amount - remainingVest;

      FocalPoint storage activeFocal = _updateAndGetActiveFocal();

      if (activeFocal.rewarded >= remainingVest) {
        activeFocal.rewarded -= remainingVest;
      } else {
        activeFocal.rewarded = 0;
      }
    }
  }

  function _resetFocalPoint(uint256 id, uint256 endTime) internal {
    uint8 index = _getFocalIndex(id);
    FocalPoint storage newFocal = focalPoints[index];

    newFocal.id = id;
    newFocal.focalLength = focalLength;
    newFocal.endTime = endTime;
    newFocal.rewarded = 0;
    newFocal.vested = 0;
    newFocal.lastVestingTime = endTime - focalLength;
  }

  function _incrementFocalPoint() internal {
    FocalPoint storage oldFocal = _updateAndGetActiveFocal();

    // This will increment every 24 hours so overflow on uint256
    // isn't an issue.
    focalID = focalID + 1;

    // Emit event that documents the focalPoint that has just ended
    emit RewardFocal(
      oldFocal.id,
      oldFocal.focalLength,
      oldFocal.endTime,
      oldFocal.rewarded
    );

    uint256 newEndTime = oldFocal.endTime + focalLength / 2;

    _resetFocalPoint(focalID, newEndTime);
  }

  function _getNextFocalStart(FocalPoint storage focal) internal view returns (uint256) {
    return focal.endTime - (focal.focalLength / 2);
  }

  function _getVestableQuantity(FocalPoint storage focal) internal returns (
    uint256 vestedReward
  ) {
    uint256 currentTime = block.timestamp;

    if (focal.lastVestingTime >= currentTime) {
      return 0;
    }

    if (currentTime > focal.endTime) {
      currentTime = focal.endTime;
    }

    // Time in between last vesting call and end of focal period
    uint256 timeRemaining = focal.endTime - focal.lastVestingTime;

    if (timeRemaining == 0) {
      return 0;
    }

    // Time since last vesting call
    uint256 vestedTime = currentTime - focal.lastVestingTime;

    uint256 remainingReward = focal.rewarded - focal.vested;

    vestedReward = remainingReward * vestedTime / timeRemaining;

    focal.vested = focal.vested + vestedReward;
    focal.lastVestingTime = currentTime;

    return vestedReward;
  }

  /*
   * PRIVILEDGED METHODS
   */
  function declareReward(uint256 amount)
    external
    onlyRoleMalt(REWARDER_ROLE, "Only throttler role")
  {
    _rewardCheck(amount);

    if (bonding.totalBonded() == 0) {
      // There is no accounts to distribute the rewards to so forfeit it
      _forfeit(amount);
      return;
    }

    // Vest current reward before adding new reward to ensure
    // Everything is up to date before we add new reward
    vest();

    FocalPoint storage activeFocal = _updateAndGetActiveFocal();
    activeFocal.rewarded = activeFocal.rewarded + amount;

    rewardMine.declareReward(amount);

    emit DeclareReward(amount, address(rewardToken));
  }

  function forfeit(uint256 amount)
    external
    onlyRoleMalt(REWARD_MINE_ROLE, "Only reward mine")
  {
    if (amount > 0) {
      _forfeit(amount);
    }
  }

  function decrementRewards(uint256 amount)
    external
    onlyRoleMalt(REWARD_MINE_ROLE, "Only reward mine")
  {
    require(amount <= _globals.declaredBalance, "Can't decrement more than total reward balance");

    if (amount > 0) {
      _globals.declaredBalance = _globals.declaredBalance - amount;
    }
  }

  function setFocalLength(uint256 _focalLength)
    external
    onlyRoleMalt(FOCAL_LENGTH_UPDATER_ROLE, "Only focal length updater")
  {
    // Cannot have focal length under 1 hour
    require(_focalLength >= 3600, "Focal length too small");
    focalLength = _focalLength;
  }

  function setThrottler(address _throttler)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_throttler != address(0), "Cannot set 0 address as throttler");
    _transferRole(_throttler, address(throttler), REWARDER_ROLE);
    throttler = _throttler;
  }

  function setRewardMine(address _rewardMine)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_rewardMine != address(0), "Cannot set 0 address as rewardMine");
    _transferRole(_rewardMine, address(rewardMine), REWARD_MINE_ROLE);
    rewardMine = IRewardMine(_rewardMine);
  }

  function setForfeitor(address _forfeitor)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_forfeitor != address(0), "Cannot set 0 address as forfeitor");
    forfeitor = IForfeit(_forfeitor);
  }

  function setBonding(address _bonding)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_bonding != address(0), "Cannot set 0 address as bonding");
    bonding = IBonding(_bonding);
  }

  function addFocalLengthUpdater(address _updater)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_updater != address(0), "Cannot set 0 address as focal length updater");
    _roleSetup(FOCAL_LENGTH_UPDATER_ROLE, _updater);
  }

  function removeFocalLengthUpdater(address _updater)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    revokeRole(FOCAL_LENGTH_UPDATER_ROLE, _updater);
  }
}
