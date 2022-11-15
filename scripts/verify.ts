import dotenv from 'dotenv';
import { run, ethers, network, artifacts } from "hardhat";
import { Signer, ContractFactory, constants, utils, Contract, BigNumber } from "ethers";
import { UniV2PoolKeeper } from "../type/UniV2PoolKeeper";

import { promises, existsSync, readFileSync } from 'fs'

const result = dotenv.config()

if (result.error) {
  throw result.error;
}

const artifactFile =
  __dirname + `/../deployments/contracts.${network.name}.json`;

if (!existsSync(artifactFile)) {
  console.error("You need to deploy your contract first");
  process.exit();
}

const artifactJson = readFileSync(artifactFile);
const contractArtifacts = JSON.parse(artifactJson.toString());

const GAS_COST_GWEI = 50;

async function deploy() {
  await run("typechain");

  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();

  console.log('Timelock');
  await run("verify:verify", {
    address: contractArtifacts.timelock.address,
    constructorArguments: [
      signerAddress
    ],
  });
  console.log('malt');
  await run("verify:verify", {
    address: contractArtifacts.malt.address,
    constructorArguments:
      ["Malt Stablecoin (V2)", "MALT", contractArtifacts.timelock.address, signerAddress, contractArtifacts.transferService.address],
  });

  console.log('transferService');
  await run("verify:verify", {
    address: contractArtifacts.transferService.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress
    ],
  });

  console.log('dai');
  await run("verify:verify", {
    address: contractArtifacts.dao.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      60 * 30,
      1651946400
    ],
  });

  console.log('maltPoolMA');
  await run("verify:verify", {
    address: contractArtifacts.maltPoolMA.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      30,
      60,
      utils.parseEther('2'),
      0
    ],
  });

  console.log('maltDataLab');
  await run("verify:verify", {
    address: contractArtifacts.maltDataLab.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.malt.address,
      contractArtifacts.rewardToken.address,
      contractArtifacts.maltPair.address,
      utils.parseEther('1'),
      contractArtifacts.maltPoolMA.address
    ],
  });

  console.log('uniswapHandler');
  await run("verify:verify", {
    address: contractArtifacts.uniswapHandler.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.malt.address,
      contractArtifacts.rewardToken.address,
      contractArtifacts.maltPair.address,
      contractArtifacts.router.address,
      contractArtifacts.maltDataLab.address,
    ],
  });

  console.log('stabilizerNode');
  await run("verify:verify", {
    address: contractArtifacts.stabilizerNode.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.malt.address,
      contractArtifacts.rewardToken.address,
      "0x6BEe230A6de341B457e733ee667d8f9dA26Abb32",
      utils.parseEther('100')
    ],
  });

  console.log('auctionPool');
  await run("verify:verify", {
    address: contractArtifacts.auctionPool.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      0
    ],
  });

  console.log('auction');
  await run("verify:verify", {
    address: contractArtifacts.auction.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.rewardToken.address,
      contractArtifacts.malt.address,
      600,
      contractArtifacts.stabilizerNode.address,
      contractArtifacts.maltDataLab.address,
      contractArtifacts.uniswapHandler.address,
      utils.parseEther('10')
    ],
  });

  console.log('escapeHatch');
  await run("verify:verify", {
    address: contractArtifacts.escapeHatch.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.auction.address,
      contractArtifacts.uniswapHandler.address,
      contractArtifacts.rewardToken.address,
      contractArtifacts.malt.address,
    ],
  });

  console.log('liquidityExtension');
  await run("verify:verify", {
    address: contractArtifacts.liquidityExtension.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.auction.address,
      contractArtifacts.rewardToken.address,
      contractArtifacts.malt.address,
      contractArtifacts.uniswapHandler.address,
      contractArtifacts.maltDataLab.address,
    ],
  });

  console.log('burnReserveSkew');
  await run("verify:verify", {
    address: contractArtifacts.burnReserveSkew.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.stabilizerNode.address,
      contractArtifacts.auction.address,
      10
    ],
  });

  console.log('impliedCollateral');
  await run("verify:verify", {
    address: contractArtifacts.impliedCollateralService.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.rewardToken.address,
      contractArtifacts.malt.address
    ],
  });

  console.log('rewardReinvestor');
  await run("verify:verify", {
    address: contractArtifacts.rewardReinvestor.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.malt.address,
      contractArtifacts.rewardToken.address,
      contractArtifacts.factory.address,
      "0x6BEe230A6de341B457e733ee667d8f9dA26Abb32"
    ],
  });

  console.log('miningService');
  await run("verify:verify", {
    address: contractArtifacts.miningService.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
    ],
  });

  console.log('rewardDistributor');
  await run("verify:verify", {
    address: contractArtifacts.rewardDistributor.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.rewardToken.address,
    ],
  });

  console.log('bonding');
  await run("verify:verify", {
    address: contractArtifacts.bonding.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.malt.address,
      contractArtifacts.rewardToken.address,
      contractArtifacts.maltPair.address,
      contractArtifacts.dao.address,
      contractArtifacts.miningService.address,
      contractArtifacts.uniswapHandler.address,
      contractArtifacts.maltDataLab.address,
      contractArtifacts.rewardDistributor.address,
    ],
  });

  console.log('forfeitHandler');
  await run("verify:verify", {
    address: contractArtifacts.forfeitHandler.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.rewardToken.address,
      "0x6BEe230A6de341B457e733ee667d8f9dA26Abb32"
    ],
  });

  console.log('rewardOverflow');
  await run("verify:verify", {
    address: contractArtifacts.rewardOverflow.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
    ],
  });

  console.log('rewardThrottle');
  await run("verify:verify", {
    address: contractArtifacts.rewardThrottle.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.dao.address,
      contractArtifacts.rewardOverflow.address,
      contractArtifacts.bonding.address,
      contractArtifacts.rewardToken.address,
    ],
  });

  console.log('transferVerification');
  await run("verify:verify", {
    address: contractArtifacts.transferVerification.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      200,
      200,
      contractArtifacts.maltDataLab.address,
      30,
      60*5,
      contractArtifacts.maltPair.address,
      contractArtifacts.stabilizerNode.address,
      contractArtifacts.auction.address,
    ],
  });

  console.log('swingTrader');
  await run("verify:verify", {
    address: contractArtifacts.swingTrader.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.rewardToken.address,
      contractArtifacts.malt.address,
      contractArtifacts.uniswapHandler.address,
      contractArtifacts.stabilizerNode.address,
      contractArtifacts.rewardThrottle.address,
    ],
  });

  console.log('erc20mine');
  await run("verify:verify", {
    address: contractArtifacts.daiVestedMine.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.miningService.address,
      contractArtifacts.rewardDistributor.address,
      contractArtifacts.bonding.address,
      contractArtifacts.rewardToken.address,
      0
    ],
  });

  console.log('erc20mine');
  await run("verify:verify", {
    address: contractArtifacts.keeper.address,
    constructorArguments: [
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.maltDataLab.address,
      contractArtifacts.rewardDistributor.address,
      contractArtifacts.uniswapHandler.address,
      contractArtifacts.dao.address,
      "0x7b3EC232b08BD7b4b3305BE0C044D907B2DF960B",
      contractArtifacts.rewardThrottle.address,
      0
    ],
  });
}


deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

