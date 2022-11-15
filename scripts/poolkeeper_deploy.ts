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

  // Fetch contract factories
  const KeeperFactory = await ethers.getContractFactory("UniV2PoolKeeper");

  try {
    // Deploy the contracts
    const keeper = (await KeeperFactory.deploy(
      contractArtifacts.timelock.address,
      signerAddress,
      contractArtifacts.maltDataLab.address,
      contractArtifacts.rewardDistributor.address,
      contractArtifacts.uniswapHandler.address,
      contractArtifacts.dao.address,
      process.env.KEEPER_REGISTRY,
      contractArtifacts.rewardThrottle.address
    )) as UniV2PoolKeeper;

    await keeper.deployTransaction.wait();

    let gasUsed = keeper.deployTransaction.gasLimit;

    console.log(`Total gas usage for deploy: ${gasUsed}`);

    // Use GAS_COST_GWEI as a benchmar
    const deployGasCost = gasUsed.mul(utils.parseUnits(GAS_COST_GWEI.toString(), 'gwei'));
    console.log(`Gas cost @ ${GAS_COST_GWEI}Gwei: ${utils.formatEther(deployGasCost)}`);

    const contractAddresses = {
      ...contractArtifacts,
      keeper: {
        address: keeper.address,
        artifacts: artifacts.readArtifactSync("UniV2PoolKeeper"),
      }
    }
    console.log(keeper.address);

    if (existsSync('./deployments')) {
      await promises.writeFile(
        `./deployments/contracts.${network.name}.json`,
        JSON.stringify(contractAddresses, undefined, 2)
      );
    }
  } catch (error) {
    console.error(error);
  }
}


deploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

