// SPDX-License-Identifier: MIT
pragma solidity >=0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IBurnMintableERC20.sol";

interface IFaucet {
  function faucet() external;
}

contract TestFaucetTwo {
  IFaucet public faucetContract;
  IBurnMintableERC20 public token;

  constructor(address _faucet, address _token) {
    faucetContract = IFaucet(_faucet);
    token = IBurnMintableERC20(_token);
  }

  function faucet(uint256 _amount) external {
    uint256 balance = 0;
    while (true) {
      faucetContract.faucet();
      balance = token.balanceOf(address(this));

      if (balance > _amount) {
        break;
      }
    }

    token.transfer(msg.sender, balance);
  }
}
