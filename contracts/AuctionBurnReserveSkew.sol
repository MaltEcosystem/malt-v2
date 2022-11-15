// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IStabilizerNode.sol";
import "./Auction.sol";
import "./Permissions.sol";


/// @title Auction Burn Reserve Skew
/// @author 0xScotch <scotch@malt.money>
/// @notice This contract makes decisions about what do to with excess Liquidity Extension balance at the end of an auction. Burn additional Malt or retain capital in LE
contract AuctionBurnReserveSkew is Permissions {
  // An array of 0s or 1s that track if active stabilization was
  // needed above or below peg.
  // 0 = below peg
  // 1 = above peg
  //
  // By doing this we can average the array to get a value that
  // indicates if we are more frequently over or under peg.
  uint256[] public pegObservations;
  uint256 public auctionAverageLookback = 10;

  IStabilizerNode public stabilizerNode;
  IAuction public auction;

  // This is the total number of stabilization observation we have seen
  uint256 public count;

  event SetAuctionAverageLookback(uint256 lookback);
  event SetStabilizerNode(address stabilizerNode);
  event SetAuction(address auction);
  event AbovePegObservation(uint256 amount);
  event BelowPegObservation(uint256 amount);

  constructor(
    address _timelock,
    address initialAdmin,
    address _stabilizerNode,
    address _auction,
    uint256 _period
  ) {
    require(_timelock != address(0), "BurnSkew: Timelock addr(0)");
    require(initialAdmin != address(0), "BurnSkew: Admin addr(0)");
    require(_stabilizerNode != address(0), "BurnSkew: StabNode addr(0)");
    require(_auction != address(0), "BurnSkew: Auction addr(0)");
    _adminSetup(_timelock);
    _setupRole(STABILIZER_NODE_ROLE, _stabilizerNode);
    _setupRole(ADMIN_ROLE, initialAdmin);

    stabilizerNode = IStabilizerNode(_stabilizerNode);
    auction = IAuction(_auction);
    auctionAverageLookback = _period;

    for (uint i = 0; i < _period; i++) {
      pegObservations.push(0);
    }
  }

  function consult(uint256 excess) public view returns (uint256) {
    uint256 frequency = getPegDeltaFrequency();
    uint256 participation = getAverageParticipation();

    // Weight participation higher than frequency
    uint256 skew = (frequency + (participation * 2)) / 3;

    return excess * skew / 10000;
  }

  function getRealBurnBudget(
    uint256 maxBurnSpend,
    uint256 premiumExcess
  ) public view returns(uint256) {
    // Returning maxBurnSpend = maximum supply burn with no reserve ratio improvement
    // Returning premiumExcess = maximum reserve ratio improvement with no real supply burn

    if (premiumExcess > maxBurnSpend) {
      // Never spend more than the max
      return maxBurnSpend;
    }

    uint256 usableExcess = maxBurnSpend - premiumExcess;

    if (usableExcess == 0) {
      return premiumExcess;
    }

    uint256 burnable = consult(usableExcess);

    return premiumExcess + burnable;
  }

  function getAverageParticipation() public view returns (uint256) {
    uint256 initialAuction = 0;
    uint256 currentAuctionId = auction.currentAuctionId();

    if (currentAuctionId > auctionAverageLookback) {
      initialAuction = currentAuctionId - auctionAverageLookback;
    }

    // Use the existing struct to avoid filling the stack with temp vars
    uint256 _maxCommitments;
    uint256 _commitments;

    for (uint256 i = initialAuction; i < currentAuctionId; ++i) {
      (uint256 commitments, uint256 maxCommitments) = auction.getAuctionCommitments(i);
      _maxCommitments = _maxCommitments + maxCommitments;
      _commitments = _commitments + commitments;
    }

    uint256 participation = 0;
    if (_maxCommitments > 0) {
      participation = _commitments * 10000 / _maxCommitments;
    }

    return participation;
  }

  function getPegDeltaFrequency() public view returns (uint256) {
    uint256 initialIndex = 0;
    uint256 index;
    uint256 auctionCount = count; // gas saving

    if (auctionCount == 0) {
      return 0;
    }

    if (auctionCount > auctionAverageLookback) {
      initialIndex = auctionCount - auctionAverageLookback;
    }

    uint256 total = 0;

    for (uint256 i = initialIndex; i < auctionCount; ++i) {
      index = _getIndexOfObservation(i);
      total = total + pegObservations[index];
    }

    return total * 10000 / auctionAverageLookback;
  }

  function _getIndexOfObservation(uint _index) internal view returns (uint index) {
    return _index % auctionAverageLookback;
  }

  /*
   * The arguments passed into these observation functions are not currently used but they are added
   * incase future versions to this contract want to use them. In that case the stabilizernode
   * won't have to be changed as it is already passing in this argument.
   */
  function addAbovePegObservation(uint256 amount)
    external
    onlyRoleMalt(STABILIZER_NODE_ROLE, "Must be a stabilizer node to call this method")
  {
    uint256 index = _getIndexOfObservation(count);
    // above peg
    pegObservations[index] = 1;

    count = count + 1;
    emit AbovePegObservation(amount);
  }

  function addBelowPegObservation(uint256 amount)
    external
    onlyRoleMalt(STABILIZER_NODE_ROLE, "Must be a stabilizer node to call this method")
  {
    uint256 index = _getIndexOfObservation(count);
    // below peg
    pegObservations[index] = 0;

    count = count + 1;
    emit BelowPegObservation(amount);
  }

  function setNewStabilizerNode(address _node)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_node != address(0), "Cannot set 0 address");
    _transferRole(_node, address(stabilizerNode), STABILIZER_NODE_ROLE);
    stabilizerNode = IStabilizerNode(_node);
    emit SetStabilizerNode(_node);
  }

  function setNewAuction(address _auction)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_auction != address(0), "Cannot set 0 address");
    auction = IAuction(_auction);
    emit SetAuction(_auction);
  }

  function setAuctionAverageLookback(uint256 _lookback)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_lookback > 0, "Cannot have zero lookback period");

    uint256 oldLookback = auctionAverageLookback;

    require(_lookback != oldLookback, "New lookback must be different");

    uint256 currentIndex = _getIndexOfObservation(count);

    if (_lookback > oldLookback) {
      for (uint i = oldLookback; i < _lookback; i++) {
        pegObservations.push(0);
      }
      count = currentIndex;
    } else if (currentIndex >= _lookback) {
      count = _lookback - 1;
    } else {
      count = currentIndex;
    }

    auctionAverageLookback = _lookback;
    emit SetAuctionAverageLookback(_lookback);
  }
}
