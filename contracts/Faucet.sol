// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IBurnMintableERC20.sol";


contract TestFaucet {
  IBurnMintableERC20 public token;

  constructor(address _token) {
    token = IBurnMintableERC20(_token);
  }

  function faucet() external {
    uint256 decimals = token.decimals();
    token.mint(msg.sender, 10000*10**decimals);
  }
}
