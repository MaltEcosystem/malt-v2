import { task  } from "hardhat/config";
import { utils, Contract } from "ethers";
import * as fs from "fs";

task("set_transfer_threshold", "")
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

    const transferVerification = await ethers.getContractAt("PoolTransferVerification", artifacts.transferVerification.address);

    const tx = await transferVerification.setThresholds(
      200, 200
    );
    await tx.wait();

    const upper = await transferVerification.upperThresholdBps();
    const lower = await transferVerification.lowerThresholdBps();

    console.log("Upper", upper.toString());
    console.log("Lower", lower.toString());
  });
