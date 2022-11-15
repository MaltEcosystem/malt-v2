import { task  } from "hardhat/config";
import { utils, Contract, BigNumber } from "ethers";
import * as fs from "fs";

task("average_apr", "Fetches APR")
  .addPositionalParam("startEpoch", "The start epoch for the average")
  .addPositionalParam("endEpoch", "The end epoch for the average")
  .setAction(async ({ startEpoch, endEpoch }, { ethers, network }) => {
    if (network.name === "hardhat") {
      console.warn(
        "You are running the faucet task with Hardhat network, which" +
          "gets automatically created and destroyed every time. Use the Hardhat" +
          " option '--network localhost'"
      );
    }

    const artifactFile =
      __dirname + `/../deployments/contracts.${network.name}.json`;

    if (!fs.existsSync(artifactFile)) {
      console.error("You need to deploy your contract first");
      return;
    }

    const artifactJson = fs.readFileSync(artifactFile);
    const artifacts = JSON.parse(artifactJson.toString());

    if ((await ethers.provider.getCode(artifacts.malt.address)) === "0x") {
      console.error("You need to deploy your contract first");
      return;
    }

    const [sender] = await ethers.getSigners();
    const senderAddress = await sender.getAddress();

    const throttle = await ethers.getContractAt("RewardThrottle", artifacts.rewardThrottle.address);

    const apr = await throttle.averageAPR(startEpoch, endEpoch);

    console.log(`Average APR: ${parseInt(apr.toString()) / 100}%`);
  });
