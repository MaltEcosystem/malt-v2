// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "./libraries/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./Permissions.sol";
import "./interfaces/IAuction.sol";


/// @title Auction Participant
/// @author 0xScotch <scotch@malt.money>
/// @notice Will generally be inherited to give another contract the ability to use its capital to buy arbitrage tokens
contract AuctionParticipant is Permissions {
  using SafeERC20 for ERC20;

  bytes32 public constant IMPLIED_COLLATERAL_SERVICE_ROLE = keccak256("IMPLIED_COLLATERAL_SERVICE_ROLE");

  IAuction public auction;
  ERC20 public auctionRewardToken;

  uint256 public replenishingIndex;
  uint256[] public auctionIds;
  mapping(uint256 => uint256) public idIndex;
  uint256 public claimableRewards;

  event SetReplenishingIndex(uint256 index);

  address private _deployer;

  constructor() {
    _deployer = msg.sender;
  }

  function setupParticipantContracts(
    address _impliedCollateralService,
    address _rewardToken,
    address _auction
  ) external {
    require(msg.sender == _deployer, "Only deployer");
    require(address(auction) == address(0), "Participant: Already setup");
    _setupParticipant(
      _impliedCollateralService,
      _rewardToken,
      _auction
    );
  }

  function _setupParticipant(
    address _impliedCollateralService,
    address _rewardToken,
    address _auction
  ) internal {
    require(_impliedCollateralService != address(0), "Participant: ImpCol addr(0)");
    require(_rewardToken != address(0), "Participant: RewardToken addr(0)");
    require(_auction != address(0), "Participant: Auction addr(0)");

    _roleSetup(IMPLIED_COLLATERAL_SERVICE_ROLE, _impliedCollateralService);
    auctionRewardToken = ERC20(_rewardToken);
    auction = IAuction(_auction);
  }

  function purchaseArbitrageTokens(uint256 maxAmount)
    external
    onlyRoleMalt(IMPLIED_COLLATERAL_SERVICE_ROLE, "Must have implied collateral service privs")
    returns (uint256 remaining)
  {
    // Just to make sure we are starting from 0
    auctionRewardToken.safeApprove(address(auction), 0);

    uint256 balance = usableBalance();

    if (balance == 0) {
      return maxAmount;
    }

    if (maxAmount < balance) {
      balance = maxAmount;
    }

    uint256 currentAuction = auction.currentAuctionId();

    if (!auction.auctionActive(currentAuction)) {
      return maxAmount;
    }

    // First time participating in this auction
    if (idIndex[currentAuction] == 0) {
      auctionIds.push(currentAuction);
      idIndex[currentAuction] = auctionIds.length;
    }

    auctionRewardToken.safeApprove(address(auction), balance);
    auction.purchaseArbitrageTokens(balance);

    // Reset approval
    auctionRewardToken.safeApprove(address(auction), 0);

    return maxAmount - balance;
  }

  function claim() external {
    uint256 length = auctionIds.length;
    if (length == 0 || replenishingIndex >= length) {
      return;
    }

    uint256 currentIndex = replenishingIndex;
    uint256 auctionId = auctionIds[currentIndex];
    uint256 auctionReplenishing = auction.replenishingAuctionId();

    if (auctionId > auctionReplenishing) {
      // Not yet replenishing this auction
      return;
    }

    uint256 claimableTokens = auction.userClaimableArbTokens(address(this), auctionId);

    if (claimableTokens == 0 && auctionReplenishing > auctionId) { // in this case, we will never receive any more tokens from this auction
      currentIndex += 1;
      auctionId = auctionIds[currentIndex];
      claimableTokens = auction.userClaimableArbTokens(address(this), auctionId);
    }

    if (claimableTokens == 0) {
      // Nothing to claim yet
      replenishingIndex = currentIndex;
      return;
    }

    uint256 balance = auctionRewardToken.balanceOf(address(this));

    auction.claimArbitrage(auctionId);

    uint256 finalBalance = auctionRewardToken.balanceOf(address(this));
    uint256 rewardedAmount = finalBalance - balance;

    claimableRewards = claimableRewards + rewardedAmount;

    if (auction.replenishingAuctionId() > auctionId &&
        auction.userClaimableArbTokens(address(this), auctionId) == 0) {
      // Don't increment replenishingIndex if replenishingAuctionId == auctionId as
      // claimable could be 0 due to the debt not being 100% replenished.
      currentIndex += 1;
    }

    replenishingIndex = currentIndex;

    _handleRewardDistribution(rewardedAmount);
  }

  function outstandingArbTokens() public view returns (uint256 outstanding) {
    outstanding = 0;

    uint256 length = auctionIds.length;

    for (uint256 i = replenishingIndex; i < length; i = i + 1) {
      outstanding = outstanding + auction.balanceOfArbTokens(auctionIds[i], address(this));
    }

    return outstanding;
  }

  function getAllAuctionIds() public view returns (uint256[] memory) {
    return auctionIds;
  }

  function usableBalance() virtual public view returns(uint256) {
    return auctionRewardToken.balanceOf(address(this));
  }

  function _handleRewardDistribution(uint256 rewarded) virtual internal {
    // Do nothing
    return;
  }

  function setReplenishingIndex(uint256 _index)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin privs")
  {
    replenishingIndex = _index;
    emit SetReplenishingIndex(_index);
  }
}
