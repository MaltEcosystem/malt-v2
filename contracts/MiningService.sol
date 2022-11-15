// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./Permissions.sol";
import "./interfaces/IRewardMine.sol";


/// @title Malt Mining Service
/// @author 0xScotch <scotch@malt.money>
/// @notice A contract that abstracts one or more implementations of AbstractRewardMine
contract MiningService is Permissions {
  using EnumerableSet for EnumerableSet.AddressSet;

  mapping(uint256 => EnumerableSet.AddressSet) internal poolMineSet;

  address public reinvestor;
  address public bonding;

  bytes32 public constant REINVESTOR_ROLE = keccak256("REINVESTOR_ROLE");
  bytes32 public constant BONDING_ROLE = keccak256("BONDING_ROLE");

  event AddRewardMine(address mine, uint256 poolId);
  event RemoveRewardMine(address mine, uint256 poolId);

  constructor(
    address _timelock,
    address initialAdmin
  ) {
    require(_timelock != address(0), "MiningSvc: Timelock addr(0)");
    require(initialAdmin != address(0), "MiningSvc: Admin addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);
  }

  function setupContracts(
    address _reinvestor,
    address _bonding
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have bonding privs")
  {
    require(bonding == address(0), "MiningSvc: Already setup");
    require(_reinvestor != address(0), "MiningSvc: Reinvestor addr(0)");
    require(_bonding != address(0), "MiningSvc: Bonding addr(0)");

    _roleSetup(REINVESTOR_ROLE, _reinvestor);
    _roleSetup(BONDING_ROLE, _bonding);

    bonding = _bonding;
    reinvestor = _reinvestor;
  }

  function withdrawAccountRewards(uint256 poolId, uint256 amount)
    external
    nonReentrant
  {
    _withdrawMultiple(msg.sender, poolId, amount);
  }

  function balanceOfRewards(address account, uint256 poolId)
    public
    view
    returns (uint256)
  {
    uint256 total;
    uint256 length = poolMineSet[poolId].length();
    for (uint i = 0; i < length; i = i + 1) {
      total += IRewardMine(poolMineSet[poolId].at(i)).balanceOfRewards(account);
    }

    return total;
  }

  function allMines(uint256 poolId) external view returns(address[] memory) {
    return poolMineSet[poolId].values();
  }

  function mines(uint256 poolId, uint256 index) external view returns(address) {
    return poolMineSet[poolId].at(index);
  }

  function netRewardBalance(address account, uint256 poolId) public view returns (uint256) {
    uint256 total;
    uint256 length = poolMineSet[poolId].length();
    for (uint i = 0; i < length; i = i + 1) {
      total += IRewardMine(poolMineSet[poolId].at(i)).netRewardBalance(account);
    }

    return total;
  }

  function numberOfMines(uint256 poolId) public view returns(uint256) {
    return poolMineSet[poolId].length();
  }

  function isMineActive(address mine, uint256 poolId) public view returns(bool) {
    return poolMineSet[poolId].contains(mine);
  }

  function earned(address account, uint256 poolId) public view returns (uint256) {
    uint256 total;
    uint256 length = poolMineSet[poolId].length();

    for (uint i = 0; i < length; i = i + 1) {
      total += IRewardMine(poolMineSet[poolId].at(i)).earned(account);
    }

    return total;
  }

  /*
   * PRIVILEDGED FUNCTIONS
   */
  function onBond(address account, uint256 poolId, uint256 amount)
    external
    onlyRoleMalt(BONDING_ROLE, "Must have bonding privs")
  {
    uint256 length = poolMineSet[poolId].length();
    for (uint i = 0; i < length; i = i + 1) {
      IRewardMine mine = IRewardMine(poolMineSet[poolId].at(i));
      mine.onBond(account, amount);
    }
  }

  function onUnbond(address account, uint256 poolId, uint256 amount)
    external
    onlyRoleMalt(BONDING_ROLE, "Must have bonding privs")
  {
    uint256 length = poolMineSet[poolId].length();
    for (uint i = 0; i < length; i = i + 1) {
      IRewardMine mine = IRewardMine(poolMineSet[poolId].at(i));
      mine.onUnbond(account, amount);
    }
  }

  function setReinvestor(address _reinvestor)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_reinvestor != address(0), "Cannot use address 0");
    _transferRole(_reinvestor, reinvestor, REINVESTOR_ROLE);
    reinvestor = _reinvestor;
  }

  function setBonding(address _bonding)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_bonding != address(0), "Cannot use address 0");
    _transferRole(_bonding, bonding, BONDING_ROLE);
    bonding = _bonding;
  }

  function addRewardMine(address mine, uint256 poolId)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(mine != address(0), "Cannot use address 0");

    if (poolMineSet[poolId].contains(mine)) {
      return;
    }

    poolMineSet[poolId].add(mine);

    emit AddRewardMine(mine, poolId);
  }

  function removeRewardMine(address mine, uint256 poolId)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(mine != address(0), "Cannot use address 0");

    poolMineSet[poolId].remove(mine);

    emit RemoveRewardMine(mine, poolId);
  }

  function withdrawRewardsForAccount(address account, uint256 poolId, uint256 amount)
    external
    onlyRoleMalt(REINVESTOR_ROLE, "Must have reinvestor privs")
  {
    _withdrawMultiple(account, poolId, amount);
  }

  /*
   * INTERNAL FUNCTIONS
   */
  function _withdrawMultiple(address account, uint256 poolId, uint256 amount) internal {
    uint256 length = poolMineSet[poolId].length();
    for (uint i = 0; i < length; i = i + 1) {
      uint256 withdrawnAmount = IRewardMine(poolMineSet[poolId].at(i)).withdrawForAccount(account, amount, msg.sender);

      amount = amount - withdrawnAmount;

      if (amount == 0) {
        break;
      }
    }
  }
}
