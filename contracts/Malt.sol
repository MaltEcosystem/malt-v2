// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "./ERC20Permit.sol";
import "./Permissions.sol";
import "./interfaces/ITransferService.sol";


/// @title Malt V2 Token
/// @author 0xScotch <scotch@malt.money>
/// @notice The ERC20 token contract for Malt V2
contract Malt is ERC20Permit, Permissions {
  // Can mint/burn Malt
  bytes32 public constant MONETARY_MINTER_ROLE = keccak256("MONETARY_MINTER_ROLE");
  bytes32 public constant MONETARY_BURNER_ROLE = keccak256("MONETARY_BURNER_ROLE");

  ITransferService public transferService;

  bool internal initialSetup;

  event SetTransferService(address service);

  constructor(
    string memory name,
    string memory ticker,
    address _timelock,
    address initialAdmin,
    address _transferService
  ) ERC20Permit(name, ticker) {
    require(_timelock != address(0), "Malt: Timelock addr(0)");
    require(initialAdmin != address(0), "Malt: Admin addr(0)");
    require(_transferService != address(0), "Malt: XferSvc addr(0)");
    _adminSetup(_timelock);
    _setupRole(ADMIN_ROLE, initialAdmin);

    // These roles aren't set up using _roleSetup as ADMIN_ROLE
    // should not be the admin of these roles like it is for all
    // other roles
    _grantRole(MONETARY_MINTER_ROLE, _timelock);
    _setRoleAdmin(MONETARY_MINTER_ROLE, TIMELOCK_ROLE);
    _grantRole(MONETARY_BURNER_ROLE, _timelock);
    _setRoleAdmin(MONETARY_BURNER_ROLE, TIMELOCK_ROLE);

    transferService = ITransferService(_transferService);
    emit SetTransferService(_transferService);
  }

  function initialSupplyControlSetup(
    address[] memory minters,
    address[] memory burners
  )
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    // This should only be called once
    require(!initialSetup, "Malt: Already setup");
    initialSetup = true;

    for (uint256 i = 0; i < minters.length; i = i + 1) {
      require(minters[i] != address(0), "Malt: Minter addr(0)");
      _setupRole(MONETARY_MINTER_ROLE, minters[i]);
    }
    for (uint256 i = 0; i < burners.length; i = i + 1) {
      require(burners[i] != address(0), "Malt: Burner addr(0)");
      _setupRole(MONETARY_BURNER_ROLE, burners[i]);
    }
  }

  function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
    (bool success, string memory reason) = transferService.verifyTransferAndCall(from, to, amount);
    require(success, reason);
  }

  function mint(address to, uint256 amount)
    external
    onlyRoleMalt(MONETARY_MINTER_ROLE, "Must have monetary minter role")
  {
    _mint(to, amount);
  }

  function burn(address from, uint256 amount)
    external
    onlyRoleMalt(MONETARY_BURNER_ROLE, "Must have monetary burner role")
  {
    _burn(from, amount);
  }

  function setTransferService(address _service)
    external
    onlyRoleMalt(ADMIN_ROLE, "Must have admin role")
  {
    require(_service != address(0), "Cannot use address 0 as transfer service");
    transferService = ITransferService(_service);
    emit SetTransferService(_service);
  }
}
