// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.8.11;

interface IUniswapV1Factory {
    function getExchange(address) external view returns (address);
}
