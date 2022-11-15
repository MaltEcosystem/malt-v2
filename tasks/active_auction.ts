import { task  } from "hardhat/config";
import { utils, Contract } from "ethers";
import * as fs from "fs";

task("active_auction", "Checks infomation about auctions")
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

    const auction = await ethers.getContractAt("Auction", artifacts.auction.address);

    const {
      auctionId,
      maxCommitments,
      commitments,
      maltPurchased,
      startingPrice,
      endingPrice,
      finalPrice,
      pegPrice,
      startingTime,
      endingTime,
      finalBurnBudget,
      finalPurchased,
    } = await auction.getActiveAuction();

    const {
      active
    } = await auction.getAuctionCore(auctionId);

    console.log('auctionID', auctionId.toString());
    console.log('maxCommitments', utils.formatEther(maxCommitments));
    console.log('commitments', utils.formatEther(commitments));
    console.log('maltPurchased', utils.formatEther(maltPurchased));
    console.log('startingPrice', utils.formatEther(startingPrice));
    console.log('endingPrice', utils.formatEther(endingPrice));
    console.log('finalPrice', utils.formatEther(finalPrice));
    console.log('pegPrice', utils.formatEther(pegPrice));
    console.log('startingTime', startingTime.toString());
    console.log('endingTime', endingTime.toString());
    console.log('finalBurnBudget', utils.formatEther(finalBurnBudget));
    console.log('finalPurchased', utils.formatEther(finalPurchased));
    console.log('active', active);
  });
