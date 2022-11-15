// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/IDAO.sol";
import "./interfaces/IMiningService.sol";
import "./interfaces/IDexHandler.sol";
import "./interfaces/IMaltDataLab.sol";
import "./interfaces/IBondExtension.sol";

import "./Permissions.sol";


struct UserState {
  uint256 bonded;
  uint256 bondedEpoch;
}

struct EpochState {
  uint256 lastTotalBonded;
  uint256 lastUpdateTime;
  uint256 cumulativeTotalBonded;
}

struct RewardPool {
  uint256 id;
  uint256 index; // index into the activePools array
  uint256 totalBonded;
  address distributor;
  bytes32 accessRole;
  bool active;
  string name;
}


/// @title LP Bonding
/// @author 0xScotch <scotch@malt.money>
/// @notice The contract which LP tokens are bonded to to make a user eligible for protocol rewards
contract Bonding is Permissions {
  using SafeERC20 for ERC20;

  bytes32 public constant LINEAR_RECIEVER_ROLE = keccak256("LINEAR_RECIEVER_ROLE");

  ERC20 public malt;
  ERC20 public rewardToken;
  ERC20 public stakeToken;
  IDAO public dao;
  IMiningService public miningService;
  IDexHandler public dexHandler;
  IMaltDataLab public maltDataLab;
  IBondExtension public bondExtension;

  uint256 public stakeTokenDecimals;

  uint256 internal _globalBonded;
  uint256 internal _currentEpoch;
  mapping(uint256 => RewardPool) public rewardPools;
  mapping(uint256 => mapping(address => UserState)) internal userState;
  mapping(uint256 => EpochState) internal epochState;
  uint256[] public activePools;

  event Bond(address indexed account, uint256 indexed poolId, uint256 value);
  event Unbond(address indexed account, uint256 indexed poolId, uint256 value);
  event UnbondAndBreak(address indexed account, uint256 indexed poolId, uint256 amountLPToken, uint256 amountMalt, uint256 amountReward);
  event NewBondingRole(string name, bytes32 role);
  event TogglePoolActive(uint256 indexed poolId, bool active);
  event AddRewardPool(uint256 indexed poolId, string name, bool active, bytes32 accessRole);
  event SetPoolDistributor(uint256 indexed poolId, address distributor);

  constructor(
    address _timelock,
    address initialAdmin,
    address _malt,
    address _rewardToken,
    address _stakeToken,
    address _dao,
    address _miningService,
    address _dexHandler,
    address _maltDataLab,
    address _distributor
  ) {
    require(_timelock != address(0), "Bonding: Timelock addr(0)");
    require(initialAdmin != address(0), "Bonding: Admin addr(0)");
    require(_malt != address(0), "Bonding: Malt addr(0)");
    require(_rewardToken != address(0), "Bonding: RewardToken addr(0)");
    require(_stakeToken != address(0), "Bonding: lpToken addr(0)");
    require(_dao != address(0), "Bonding: DAO addr(0)");
    require(_miningService != address(0), "Bonding: MiningSvc addr(0)");
    require(_dexHandler != address(0), "Bonding: DexHandler addr(0)");
    require(_maltDataLab != address(0), "Bonding: DataLab addr(0)");
    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);
    _setRoleAdmin(LINEAR_RECIEVER_ROLE, ADMIN_ROLE);

    dao = IDAO(_dao);
    stakeToken = ERC20(_stakeToken);
    miningService = IMiningService(_miningService);
    dexHandler = IDexHandler(_dexHandler);
    malt = ERC20(_malt);
    rewardToken = ERC20(_rewardToken);
    maltDataLab = IMaltDataLab(_maltDataLab);

    stakeTokenDecimals = stakeToken.decimals();

    rewardPools[0] = RewardPool({
      id: 0,
      index: 0,
      totalBonded: 0,
      distributor: _distributor,
      accessRole: bytes32(0),
      active: true,
      name: "Vesting"
    });

    // Will be used in the future
    rewardPools[1] = RewardPool({
      id: 1,
      index: 1,
      totalBonded: 0,
      distributor: address(0), // Will set in future
      accessRole: LINEAR_RECIEVER_ROLE,
      active: false,
      name: "Linear"
    });

    activePools.push(0);
  }

  function bond(uint256 poolId, uint256 amount)
    external
  {
    bondToAccount(msg.sender, poolId, amount);
  }

  function bondToAccount(address account, uint256 poolId, uint256 amount)
    public
    nonReentrant
  {
    require(account != address(0), "Bonding: 0x0");
    require(amount > 0, "Cannot bond 0");

    RewardPool memory pool = rewardPools[poolId];
    require(pool.id == poolId, "Unknown Pool");
    require(pool.active, "Pool is not active");
    require(pool.distributor != address(0), "Pool not configured");

    if (pool.accessRole != 0) {
      // This throws if msg.sender doesn't have correct role
      _onlyRoleMalt(pool.accessRole, "Not allowed to bond to this pool");
    }

    miningService.onBond(account, poolId, amount);

    _bond(account, poolId, amount);
  }

  function unbond(uint256 poolId, uint256 amount)
    external
    nonReentrant
  {
    require(amount > 0, "Cannot unbond 0");

    uint256 bondedBalance = balanceOfBonded(poolId, msg.sender);

    require(bondedBalance > 0, "< bonded balance");
    require(amount <= bondedBalance, "< bonded balance");

    // Avoid leaving dust behind
    if (amount + (10**(stakeTokenDecimals - 2)) > bondedBalance) {
      amount = bondedBalance;
    }

    miningService.onUnbond(msg.sender, poolId, amount);

    _unbond(poolId, amount);
  }

  function unbondAndBreak(uint256 poolId, uint256 amount, uint256 slippageBps)
    external
    nonReentrant
  {
    require(amount > 0, "Cannot unbond 0");

    uint256 bondedBalance = balanceOfBonded(poolId, msg.sender);

    require(bondedBalance > 0, "< bonded balance");
    require(amount <= bondedBalance, "< bonded balance");

    // Avoid leaving dust behind
    if (amount + (10**(stakeTokenDecimals - 2)) > bondedBalance) {
      amount = bondedBalance;
    }

    miningService.onUnbond(msg.sender, poolId, amount);

    _unbondAndBreak(poolId, amount, slippageBps);
  }

  /*
   * PUBLIC VIEW FUNCTIONS
   */
  function averageBondedValue(uint256 epoch) public view returns (uint256) {
    EpochState storage state = epochState[epoch];
    uint256 epochLength = dao.epochLength();
    uint256 timeElapsed = epochLength;
    uint256 epochStartTime = dao.getEpochStartTime(epoch);
    uint256 diff;
    uint256 lastUpdateTime = state.lastUpdateTime;
    uint256 lastTotalBonded = state.lastTotalBonded;

    if (lastUpdateTime == 0) {
      lastUpdateTime = epochStartTime;
    }

    if (lastTotalBonded == 0) {
      lastTotalBonded = _globalBonded;
    }

    if (block.timestamp < epochStartTime) {
      return 0;
    }

    if (epochStartTime + epochLength <= lastUpdateTime) {
      return maltDataLab.realValueOfLPToken((state.cumulativeTotalBonded) / epochLength);
    }

    if (epochStartTime + epochLength < block.timestamp) {
      // The desired epoch is in the past
      diff = (epochStartTime + epochLength) - lastUpdateTime;
    } else {
      diff = block.timestamp - lastUpdateTime;
      timeElapsed = block.timestamp - epochStartTime;
    }

    if (timeElapsed == 0) {
      // Only way timeElapsed should == 0 is when block.timestamp == epochStartTime
      // Therefore just return the lastTotalBonded value
      return maltDataLab.realValueOfLPToken(lastTotalBonded);
    }

    uint256 endValue = state.cumulativeTotalBonded + (lastTotalBonded * diff);
    return maltDataLab.realValueOfLPToken((endValue) / timeElapsed);
  }

  function totalBonded() public view returns (uint256) {
    return _globalBonded;
  }

  function allActivePools() public view returns(
    uint256[] memory ids,
    uint256[] memory bondedTotals,
    address[] memory distributors,
    bytes32[] memory accessRoles,
    string[] memory names
  ) {
    uint256[] memory poolIds = activePools;
    uint256 length = poolIds.length;

    ids = new uint256[](length);
    bondedTotals = new uint256[](length);
    distributors = new address[](length);
    accessRoles = new bytes32[](length);
    names = new string[](length);

    for (uint256 i; i < length; ++i) {
      ids[i] = rewardPools[poolIds[i]].id;
      bondedTotals[i] = rewardPools[poolIds[i]].totalBonded;
      distributors[i] = rewardPools[poolIds[i]].distributor;
      accessRoles[i] = rewardPools[poolIds[i]].accessRole;
      names[i] = rewardPools[poolIds[i]].name;
    }

    return (
      ids,
      bondedTotals,
      distributors,
      accessRoles,
      names
    );
  }

  function balanceOfBonded(uint256 poolId, address account) public view returns (uint256) {
    return userState[poolId][account].bonded;
  }

  function bondedEpoch(uint256 poolId, address account) public view returns (uint256) {
    return userState[poolId][account].bondedEpoch;
  }

  function epochData(uint256 epoch) public view returns(uint256, uint256, uint256) {
    return (epochState[epoch].lastTotalBonded, epochState[epoch].lastUpdateTime, epochState[epoch].cumulativeTotalBonded);
  }

  function poolAllocations()
    public
    view
    returns (
      uint256[] memory poolIds,
      uint256[] memory allocations,
      address[] memory distributors
    )
  {
    uint256 totalBonded = _globalBonded;

    uint256[] memory poolIds = activePools;
    uint256 length = poolIds.length;
    uint256[] memory allocations = new uint256[](length);
    address[] memory distributors = new address[](length);

    for (uint256 i; i < length; ++i) {
      RewardPool memory pool = rewardPools[poolIds[i]];
      allocations[i] = pool.totalBonded * 1e18 / totalBonded;
      distributors[i] = pool.distributor;
    }

    return (poolIds, allocations, distributors);
  }

  /*
   * INTERNAL VIEW FUNCTIONS
   */
  function _balanceCheck() internal view {
    require(stakeToken.balanceOf(address(this)) >= totalBonded(), "Balance inconsistency");
  }

  /*
   * INTERNAL FUNCTIONS
   */
  function _bond(address account, uint256 poolId, uint256 amount) internal {

    uint256 oldBalance = stakeToken.balanceOf(address(this));
    stakeToken.safeTransferFrom(msg.sender, address(this), amount);
    amount = stakeToken.balanceOf(address(this)) - oldBalance;

    _addToBonded(account, poolId, amount);

    _balanceCheck();

    if (address(bondExtension) != address(0)) {
      bondExtension.onBond(account, poolId, amount);
    }

    emit Bond(account, poolId, amount);
  }

  function _unbond(uint256 poolId, uint256 amountLPToken) internal {
    _removeFromBonded(msg.sender, poolId, amountLPToken);

    stakeToken.safeTransfer(msg.sender, amountLPToken);

    _balanceCheck();

    emit Unbond(msg.sender, poolId, amountLPToken);
  }

  function _unbondAndBreak(uint256 poolId, uint256 amountLPToken, uint256 slippageBps) internal {
    _removeFromBonded(msg.sender, poolId, amountLPToken);

    stakeToken.safeTransfer(address(dexHandler), amountLPToken);
    uint256 initialBalance = stakeToken.balanceOf(address(this));

    (uint256 amountMalt, uint256 amountReward) = dexHandler.removeLiquidity(amountLPToken, slippageBps);

    // Send any excess back
    uint256 currentBalance = stakeToken.balanceOf(address(this));
    if (currentBalance > initialBalance) {
      stakeToken.safeTransfer(msg.sender, currentBalance - initialBalance);
    }

    malt.safeTransfer(msg.sender, amountMalt);
    rewardToken.safeTransfer(msg.sender, amountReward);

    _balanceCheck();

    emit UnbondAndBreak(msg.sender, poolId, amountLPToken, amountMalt, amountReward);
  }

  function _addToBonded(address account, uint256 poolId, uint256 amount) internal {
    userState[poolId][account].bonded += amount;
    rewardPools[poolId].totalBonded += amount;

    _updateEpochState(_globalBonded + amount);

    if (userState[poolId][account].bondedEpoch == 0) {
      userState[poolId][account].bondedEpoch = dao.epoch();
    }
  }

  function _removeFromBonded(address account, uint256 poolId, uint256 amount) internal {
    userState[poolId][account].bonded -= amount;
    rewardPools[poolId].totalBonded -= amount;

    _updateEpochState(_globalBonded - amount);
  }

  function _updateEpochState(uint256 newTotalBonded) internal {
    EpochState storage state = epochState[_currentEpoch];
    uint256 epoch = dao.epoch();
    uint256 epochStartTime = dao.getEpochStartTime(_currentEpoch);
    uint256 lastUpdateTime = state.lastUpdateTime;
    uint256 lengthOfEpoch = dao.epochLength();
    uint256 epochEndTime = epochStartTime + lengthOfEpoch;

    if (lastUpdateTime == 0) {
      lastUpdateTime = epochStartTime;
    }

    if (lastUpdateTime > epochEndTime) {
      lastUpdateTime = epochEndTime;
    }

    if (epoch == _currentEpoch) {
      // We are still in the same epoch. Just update
      uint256 finalTime = block.timestamp;
      if (block.timestamp > epochEndTime) {
        // We are past the end of the epoch so cap to end of epoch
        finalTime = epochEndTime;
      }

      uint256 diff = finalTime - lastUpdateTime;

      if (diff > 0) {
        state.cumulativeTotalBonded = state.cumulativeTotalBonded + (state.lastTotalBonded * diff);

        state.lastUpdateTime = finalTime;
        state.lastTotalBonded = newTotalBonded;
      }
    } else {
      // We have crossed at least 1 epoch boundary

      // Won't underflow due to check on lastUpdateTime above
      uint256 diff = epochEndTime - lastUpdateTime;

      state.cumulativeTotalBonded = state.cumulativeTotalBonded + (state.lastTotalBonded * diff);
      state.lastUpdateTime = epochEndTime;
      state.lastTotalBonded = _globalBonded;

      for (uint256 i = _currentEpoch + 1; i <= epoch; i += 1) {
        state = epochState[i];
        epochStartTime = dao.getEpochStartTime(i);
        epochEndTime = epochStartTime + lengthOfEpoch;
        state.lastTotalBonded = _globalBonded;

        if (epochEndTime < block.timestamp) {
          // The desired epoch is in the past
          diff = lengthOfEpoch;
          state.lastUpdateTime = epochEndTime;
        } else {
          diff = block.timestamp - epochStartTime;
          state.lastUpdateTime = block.timestamp;
        }

        state.cumulativeTotalBonded = state.lastTotalBonded * diff;
      }

      state.lastTotalBonded = newTotalBonded;
      _currentEpoch = epoch;
    }

    _globalBonded = newTotalBonded;
  }

  /*
   * PRIVILEDGED FUNCTIONS
   */
  function setMiningService(address _miningService)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_miningService != address(0), "Cannot set 0 address");
    miningService = IMiningService(_miningService);
  }

  function setDAO(address _dao)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_dao != address(0), "Cannot set 0 address");
    dao = IDAO(_dao);
  }

  function setDexHandler(address _dexHandler)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_dexHandler != address(0), "Cannot set 0 address");
    dexHandler = IDexHandler(_dexHandler);
  }

  function setCurrentEpoch(uint256 _epoch)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    _currentEpoch = _epoch;
  }

  function addNewRole(string memory roleName)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    bytes32 role = keccak256(abi.encodePacked(roleName));
    _setRoleAdmin(role, ADMIN_ROLE);
    emit NewBondingRole(roleName, role);
  }

  function addRewardPool(
    uint256 poolId,
    bytes32 accessRole,
    bool active,
    address distributor,
    string calldata name
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    RewardPool storage pool = rewardPools[poolId];
    require(poolId > 1 && pool.id == 0, "Pool already used");

    rewardPools[poolId] = RewardPool({
      id: poolId,
      index: activePools.length,
      distributor: distributor,
      totalBonded: 0,
      accessRole: accessRole,
      active: active,
      name: name
    });

    activePools.push(poolId);

    emit AddRewardPool(poolId, name, active, accessRole);
  }

  function togglePoolActive(uint256 poolId)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    RewardPool storage pool = rewardPools[poolId];
    require(pool.id == poolId, "Unknown pool");

    bool active = !pool.active;
    pool.active = active;

    if (active) {
      // setting it to active so add to activePools
      pool.index = activePools.length;
      activePools.push(poolId);
    } else {
      // Becoming inactive so remove from activePools
      uint256 index = pool.index;
      uint256 lastPool = activePools[activePools.length - 1];
      activePools[index] = lastPool;
      activePools.pop();

      rewardPools[lastPool].index = index;
    }

    emit TogglePoolActive(poolId, active);
  }

  function setPoolDistributor(uint256 poolId, address distributor)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    RewardPool storage pool = rewardPools[poolId];
    require(pool.id == poolId, "Unknown pool");

    pool.distributor = distributor;

    emit SetPoolDistributor(poolId, distributor);
  }
}
