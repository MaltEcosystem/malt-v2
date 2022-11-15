// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./interfaces/IBurnMintableERC20.sol";
import "./Permissions.sol";


/// @title Malt DAO
/// @author 0xScotch <scotch@malt.money>
/// @notice In essence a contract that is the oracle for the current epoch
contract MaltDAO is Permissions {
  IBurnMintableERC20 public malt;
  uint256 public epoch = 0;
  uint256 public epochLength;
  uint256 public immutable genesisTime;
  uint256 public advanceIncentive = 100; // 100 Malt
  uint256 public timeZero;

  event Advance(uint256 indexed epoch);
  event Mint(address recipient, uint256 amount);
  event SetMaltToken(address maltToken);
  event SetEpochLength(uint256 length);
  event SetAdvanceIncentive(uint256 incentive);

  constructor(
    address _timelock,
    address initialAdmin,
    uint256 _epochLength,
    uint256 _genesisTime
  ) {
    require(_timelock != address(0), "DAO: Timelock addr(0)");
    require(initialAdmin != address(0), "DAO: Admin addr(0)");
    epochLength = _epochLength;
    emit SetEpochLength(_epochLength);

    _adminSetup(_timelock);
    _setupRole(ADMIN_ROLE, initialAdmin);

    genesisTime = _genesisTime;
    timeZero = _genesisTime;
  }

  receive() external payable {}

  function advance() external {
    require(block.timestamp >= getEpochStartTime(epoch + 1), "Cannot advance epoch until start of new epoch");

    epoch += 1;

    malt.mint(msg.sender, advanceIncentive * (10**malt.decimals()) );

    emit Advance(epoch);
  }

  function getEpochStartTime(uint256 _epoch) public view returns (uint256) {
    return timeZero + (epochLength * _epoch);
  }

  function epochsPerYear() public view returns (uint256) {
    // 31557600 = seconds in a year
    return 31557600 / epochLength;
  }

  function mint(address to, uint256 amount)
    external
    onlyRoleMalt(TIMELOCK_ROLE, "Must have timelock role")
  {
    require(amount > 0, "Cannot have zero amount");
    malt.mint(to, amount);
    emit Mint(to, amount);
  }

  function setMaltToken(address _malt, uint256 initialMint, address mintTarget)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    // Can only set it once
    require(address(malt) == address(0), "Malt: already set");
    require(_malt != address(0), "Malt: addr(0)");
    malt = IBurnMintableERC20(_malt);
    emit SetMaltToken(_malt);

    if (initialMint > 0) {
      require(mintTarget != address(0), "Mint: Not to addr(0)");
      // Tokens minted to Community Whitelist contract

      malt.mint(mintTarget, initialMint);
    }
  }

  function setEpochLength(uint256 _length)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_length > 0, "Cannot have zero length epochs");
    require(_length != epochLength, "Length must be different");

    // Reset time so that epochStartTime is calculated correctly for the new epoch length
    // This also makes current time the start of the epoch
    timeZero = block.timestamp - (_length * epoch);

    epochLength = _length;
    emit SetEpochLength(_length);
  }

  function setAdvanceIncentive(uint256 incentive)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(incentive <= 1000, "Incentive cannot be more than 1000 Malt");
    advanceIncentive = incentive;
    emit SetAdvanceIncentive(incentive);
  }
}
