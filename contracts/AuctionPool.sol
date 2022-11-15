// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./libraries/Initializable.sol";

import "./AuctionParticipant.sol";
import "./AbstractRewardMine.sol";
import "./interfaces/IAuction.sol";
import "./interfaces/IBurnMintableERC20.sol";
import "./interfaces/IDexHandler.sol";
import "./interfaces/IBonding.sol";


/// @title LP Auction Pool
/// @author 0xScotch <scotch@malt.money>
/// @notice A portion of above peg profit is directed here and the capital is deployed into arbitrage auctions when possible.
/// @notice The core functionality is implemented in AuctionParticipant and AbstractRewardMine. But together they make new composite functionality.
contract AuctionPool is Initializable, AuctionParticipant, AbstractRewardMine {
  using SafeERC20 for ERC20;

  uint256 public forfeitedRewards;
  uint256 internal shareUnity;

  IBonding public bonding;
  address public forfeitDestination;

  uint256 public perShareReward;
  mapping(address => uint256) public accountDebtPerShare;

  constructor(
    address _timelock,
    address initialAdmin,
    uint256 _poolId
  ) {
    require(_timelock != address(0), "AuctionPool: Timelock addr(0)");
    require(initialAdmin != address(0), "AuctionPool: Admin addr(0)");

    _adminSetup(_timelock);

    _setupRole(ADMIN_ROLE, initialAdmin);

    poolId = _poolId;
  }

  function setupContracts(
    address _auction,
    address _impliedCollateralService,
    address _bonding,
    address _miningService,
    address _forfeitDestination,
    address _rewardToken
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_auction != address(0), "AuctionPool: Auction addr(0)");
    require(_impliedCollateralService != address(0), "AuctionPool: ColSvc addr(0)");
    require(_bonding != address(0), "AuctionPool: Bonding addr(0)");
    require(_miningService != address(0), "AuctionPool: MiningSvc addr(0)");
    require(_forfeitDestination != address(0), "AuctionPool: ForfeitDest addr(0)");
    require(_rewardToken != address(0), "AuctionPool: RewardToken addr(0)");

    bonding = IBonding(_bonding);
    _initialSetup(_rewardToken, _miningService, globalAdmin);
    _setupRole(AUCTION_ROLE, _auction);
    _setupParticipant(_impliedCollateralService, _rewardToken, _auction);

    shareUnity = 10**rewardToken.decimals();

    forfeitDestination = _forfeitDestination;
  }

  function onUnbond(address account, uint256 amount)
    override
    external
    onlyRoleMalt(MINING_SERVICE_ROLE, "Must having mining service privilege")
  {
    // Withdraw all current rewards
    // Done now before we change stake padding below
    uint256 rewardEarned = earned(account);
    _handleWithdrawForAccount(account, rewardEarned, account);

    uint256 bondedBalance = balanceOfBonded(account);

    if (bondedBalance == 0) {
      return;
    }

    _checkForForfeit(account, amount, bondedBalance);

    uint256 lessStakePadding = balanceOfStakePadding(account) * amount / bondedBalance;

    _reconcileWithdrawn(account, amount, bondedBalance);
    _removeFromStakePadding(account, lessStakePadding);
  }

  function totalBonded() override public view returns (uint256) {
    return bonding.totalBonded();
  }

  function balanceOfBonded(address account) override public view returns (uint256) {
    return bonding.balanceOfBonded(poolId, account);
  }

  function totalDeclaredReward() override public view returns (uint256) {
    // Outstanding Arb tokens + the total released rewards
    // minus rewards that have been forfeited

    return outstandingArbTokens() + _globalReleased - forfeitedRewards;
  }

  function usableBalance() override public view returns(uint256) {
    uint256 totalBalance = auctionRewardToken.balanceOf(address(this));

    if (totalBalance > claimableRewards) {
      return totalBalance - claimableRewards;
    }

    return 0;
  }

  function earned(address account)
    public
    view
    override
    returns (uint256 earnedReward)
  {
    uint256 totalAccountReward = balanceOfRewards(account);
    uint256 unvested = _getAccountUnvested(account);

    uint256 vested;

    if (totalAccountReward > unvested) {
      vested = totalAccountReward - unvested;
    }

    if (vested > _userWithdrawn[account]) {
      return vested - _userWithdrawn[account];
    }

    return 0;
  }

  /*
   * INTERNAL FUNCTIONS
   */
  function _getAccountUnvested(address account)
    internal
    view
    returns (uint256 unvested)
  {
    uint256 globalRewardPerShare = perShareReward;
    uint256 accountPerShareDebt = accountDebtPerShare[account];
    uint256 userBonded = balanceOfBonded(account);

    if (globalRewardPerShare == 0 || userBonded == 0) {
      return 0;
    }

    uint256 vestedBps = totalReleasedReward() * 10000 / totalDeclaredReward();

    uint256 rewardPerShare = (globalRewardPerShare * vestedBps / 10000);
    uint256 debtPerShare = (accountPerShareDebt * vestedBps / 10000);

    uint256 userTotalPerShare = globalRewardPerShare - accountPerShareDebt;
    uint256 userVestedPerShare = rewardPerShare - debtPerShare;

    uint256 unvestedPerShare;
    if (userTotalPerShare > userVestedPerShare) {
      unvestedPerShare = userTotalPerShare - userVestedPerShare;
    }

    unvested = unvestedPerShare * userBonded / shareUnity;
  }

  function _checkForForfeit(address account, uint256 amount, uint256 bondedBalance) internal {
    uint256 unvested = _getAccountUnvested(account);
    uint256 forfeitAmount = unvested * amount / bondedBalance;

    if (forfeitAmount > 0) {
      forfeitedRewards += forfeitAmount;
    }
  }

  function _afterWithdraw(address account, uint256 amount) override internal {
    claimableRewards = claimableRewards - amount;
  }

  function _afterBond(address account, uint256 amount)
    override
    internal
  {
    uint256 initialUserBonded = balanceOfBonded(account);
    uint256 userTotalBonded = initialUserBonded + amount;

    uint256 globalRewardPerShare = perShareReward;

    if (globalRewardPerShare == 0) {
      return;
    }

    uint256 debt = accountDebtPerShare[account];

    // Pro-rata it down according to old bonded value
    debt = debt * initialUserBonded / userTotalBonded;

    // Now add on the new pro-ratad perShare values
    debt += globalRewardPerShare * amount / userTotalBonded;

    accountDebtPerShare[account] = debt;
  }

  function _handleRewardDistribution(uint256 rewarded) override internal {
    if (forfeitedRewards > 0) {
      // forfeitedRewards are arb tokens that have been forfeited before they
      // have been paid back. So when they are finally covered by the protocol
      // that capital goes back into the contract and not distributed as rewards
      uint256 coverage;
      // Need to pay down some of the forfeited amount
      if (rewarded > forfeitedRewards) {
        // Can cover everything
        coverage = forfeitedRewards;
      } else {
        coverage = rewarded;
      }

      forfeitedRewards = forfeitedRewards - coverage;
      claimableRewards = claimableRewards - coverage;
      _globalReleased += rewarded - coverage;

      rewardToken.safeTransfer(forfeitDestination, coverage);
    } else {
      _globalReleased += rewarded;
    }
    require(claimableRewards + _globalWithdrawn >= _globalReleased, "RewardAssertion");
  }

  /*
   * PRIVILEDGED FUNCTIONS
   */
  function setBonding(address _bonding)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_bonding != address(0), "Not zero address");
    bonding = IBonding(_bonding);
  }

  function declareReward(uint256 amount)
    virtual
    external
    onlyRoleMalt(AUCTION_ROLE, "Only auction role")
  {
    uint256 bonded = totalBonded();

    if (amount == 0 || bonded == 0) {
      return;
    }

    perShareReward += (amount * shareUnity / bonded);
  }

  function setForfeitDestination(address _forfeitDestination)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    require(_forfeitDestination != address(0), "Not zero address");
    forfeitDestination = _forfeitDestination;
  }
}
