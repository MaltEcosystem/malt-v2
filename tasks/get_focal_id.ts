import { task  } from "hardhat/config";
import { utils, Contract, BigNumber } from "ethers";
import * as fs from "fs";

task("get_focal_id", "Fetches info for a specific auction")
  .setAction(async ({}, { ethers, network }) => {
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

    const distributor = await ethers.getContractAt("RewardDistributor", artifacts.rewardDistributor.address);

    const focalId = await distributor.focalID();

    console.log('Focal ID: ', focalId.toString());
  });
