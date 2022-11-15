// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "./interfaces/IMaltDataLab.sol";
import "./interfaces/IStabilizerNode.sol";
import "./interfaces/IAuction.sol";
import "./Permissions.sol";
import "./AbstractTransferVerification.sol";


/// @title Pool Transfer Verification
/// @author 0xScotch <scotch@malt.money>
/// @notice Implements ability to block Malt transfers
contract PoolTransferVerification is AbstractTransferVerification {
  uint256 public upperThresholdBps;
  uint256 public lowerThresholdBps;
  IMaltDataLab public maltDataLab;
  uint256 public priceLookbackBelow;
  uint256 public priceLookbackAbove;
  address public pool;
  address public stabilizerNode;
  IAuction public auction;
  bool public paused = true;
  bool internal killswitch = true;

  mapping(address => bool) public whitelist;
  mapping(address => bool) public killswitchAllowlist;

  event AddToWhitelist(address indexed _address);
  event RemoveFromWhitelist(address indexed _address);
  event AddToKillswitchAllowlist(address indexed _address);
  event RemoveFromKillswitchAllowlist(address indexed _address);
  event SetPool(address indexed pool);
  event SetPriceLookbacks(uint256 lookbackUpper, uint256 lookbackLower);
  event SetThresholds(uint256 newUpperThreshold, uint256 newLowerThreshold);
  event SetStabilizerNode(address _node);
  event SetAuction(address _auction);
  event SetPaused(bool paused);
  event SetKillswitch(bool killswitch);

  constructor(
    address _timelock,
    address initialAdmin,
    uint256 _lowerThresholdBps,
    uint256 _upperThresholdBps,
    address _maltDataLab,
    uint256 _lookbackAbove,
    uint256 _lookbackBelow,
    address _pool,
    address _stabilizerNode,
    address _auction
  ) {
    require(_timelock != address(0), "XferVerifier: Timelock addr(0)");
    require(initialAdmin != address(0), "XferVerifier: Admin addr(0)");
    require(_maltDataLab != address(0), "XferVerifier: DataLab addr(0)");
    require(_pool != address(0), "XferVerifier: Pool addr(0)");
    _adminSetup(_timelock);
    _setupRole(ADMIN_ROLE, initialAdmin);

    lowerThresholdBps = _lowerThresholdBps;
    upperThresholdBps = _upperThresholdBps;
    maltDataLab = IMaltDataLab(_maltDataLab);
    priceLookbackAbove = _lookbackAbove;
    priceLookbackBelow = _lookbackBelow;
    pool = _pool;
    stabilizerNode = _stabilizerNode;
    auction = IAuction(_auction);
  }

  function verifyTransfer(address from, address to, uint256 amount)
    external view override returns (bool, string memory, address, bytes memory)
  {
    if (killswitch) {
      if (killswitchAllowlist[from] || killswitchAllowlist[to]) {
        return (true, "", address(0), "");
      }
      return (false, "Malt: Pool transfers have been paused", address(0), "");
    }

    if (paused) {
      // This pauses any transfer verifiers. In essence allowing all Malt Txs
      return (true, "", address(0), "");
    }

    if (from != pool) {
      return (true, "", address(0), "");
    }

    if (whitelist[to]) {
      return (true, "", address(0), "");
    }

    return _belowPegCheck();
  }

  function _belowPegCheck() internal view returns(bool, string memory, address, bytes memory) {
    if (auction.hasOngoingAuction()) {
      return (false, "Malt: ACTIVE AUCTION", address(0), "");
    }

    uint256 priceTarget = maltDataLab.priceTarget();

    return (
      maltDataLab.maltPriceAverage(priceLookbackBelow) > priceTarget * (10000 - lowerThresholdBps) / 10000,
      "Malt: BELOW PEG",
      address(0),
      ""
    );
  }

  function isWhitelisted(address _address) public view returns(bool) {
    return whitelist[_address];
  }

  function isAllowlisted(address _address) public view returns(bool) {
    return killswitchAllowlist[_address];
  }

  /*
   * PRIVILEDGED METHODS
   */
  function setThresholds(uint256 newUpperThreshold, uint256 newLowerThreshold)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(newUpperThreshold != 0 && newUpperThreshold < 10000, "Upper threshold must be between 0-100%");
    require(newLowerThreshold != 0 && newLowerThreshold < 10000, "Lower threshold must be between 0-100%");
    upperThresholdBps = newUpperThreshold;
    lowerThresholdBps = newLowerThreshold;
    emit SetThresholds(newUpperThreshold, newLowerThreshold);
  }

  function setPriceLookback(uint256 lookbackAbove, uint256 lookbackBelow)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(lookbackAbove != 0 && lookbackBelow != 0, "Cannot have 0 lookback");
    priceLookbackAbove = lookbackAbove;
    priceLookbackBelow = lookbackBelow;
    emit SetPriceLookbacks(lookbackAbove, lookbackBelow);
  }

  function setPool(address _pool)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_pool != address(0), "Cannot have 0 lookback");
    pool = _pool;
    emit SetPool(_pool);
  }

  function addToWhitelist(address _address)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    whitelist[_address] = true;
    emit AddToWhitelist(_address);
  }

  function removeFromWhitelist(address _address)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    if (!whitelist[_address]) {
      return;
    }
    whitelist[_address] = false;
    emit RemoveFromWhitelist(_address);
  }

  function addToAllowlist(address _address)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    killswitchAllowlist[_address] = true;
    emit AddToKillswitchAllowlist(_address);
  }

  function removeFromAllowlist(address _address)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    if (!killswitchAllowlist[_address]) {
      return;
    }
    killswitchAllowlist[_address] = false;
    emit RemoveFromKillswitchAllowlist(_address);
  }

  function setStabilizerNode(address _stabilizerNode)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_stabilizerNode != address(0), "No address 0");
    stabilizerNode = _stabilizerNode;
    emit SetStabilizerNode(_stabilizerNode);
  }

  function setAuction(address _auction)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_auction != address(0), "No address 0");
    auction = IAuction(_auction);
    emit SetAuction(_auction);
  }

  function togglePause()
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    bool localPaused = paused;
    paused = !localPaused;
    emit SetPaused(localPaused);
  }

  function toggleKillswitch()
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    bool localKillswitch = killswitch;
    killswitch = !localKillswitch;
    emit SetKillswitch(!localKillswitch);
  }
}
