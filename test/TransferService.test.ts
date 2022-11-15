import { expect } from "chai";
import { ethers, waffle } from "hardhat";
import { PoolTransferVerification } from "../type/PoolTransferVerification";
import { StabilizerNode } from "../type/StabilizerNode";
import { TransferService } from "../type/TransferService";
import { Signer, ContractFactory, constants, utils, Contract, BigNumber } from 'ethers';
import { hardhatSnapshot, hardhatRevert, increaseTime } from "./helpers";
import { Interface } from '@ethersproject/abi';

const { deployMockContract } = waffle;

describe("Transfer Service", function() {
  let accounts: Signer[];
  let owner: Signer;
  let admin: Signer;

  let transferService: TransferService;
  let snapshotId: string;

  let mockPoolVerification: PoolTransferVerification;

  beforeEach(async function() {
    snapshotId = await hardhatSnapshot();
    [owner, admin, ...accounts] = await ethers.getSigners();

    const ownerAddress = await owner.getAddress();
    const adminAddress = await admin.getAddress();

    mockPoolVerification = ((await deployMockContract(owner, [
      "function verifyTransfer(address, address, uint256) returns(bool, string memory, address, bytes)",
    ])) as any) as PoolTransferVerification;

    // Deploy the TransferService
    const TransferServiceFactory = await ethers.getContractFactory("TransferService");

    transferService = (await TransferServiceFactory.deploy(
      ownerAddress,
      adminAddress,
    )) as TransferService;
  });

  afterEach(async function() {
    await hardhatRevert(snapshotId);
  });

  it("Has correct initial conditions", async function() {
    expect(await transferService.numberOfVerifiers()).to.equal(0);
  });

  it("Only allows admin to add a verifier", async function() {
    const [user, user1, user2] = accounts;
    const userAddress = await user.getAddress();
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();

    await expect(transferService.connect(user).addVerifier(userAddress, mockPoolVerification.address)).to.be.reverted;
    await expect(transferService.connect(user1).addVerifier(userAddress, mockPoolVerification.address)).to.be.reverted;

    expect(await transferService.numberOfVerifiers()).to.equal(0);

    await transferService.connect(admin).addVerifier(userAddress, mockPoolVerification.address);
    // owner is timelock for these tests
    await transferService.addVerifier(userOneAddress, mockPoolVerification.address);

    expect(await transferService.numberOfVerifiers()).to.equal(2);
  });

  it("Only allows admin to remove a verifier", async function() {
    const [user, user1, user2] = accounts;
    const userAddress = await user.getAddress();
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();

    await transferService.connect(admin).addVerifier(userAddress, mockPoolVerification.address);

    expect(await transferService.numberOfVerifiers()).to.equal(1);

    await expect(transferService.connect(user).removeVerifier(userAddress)).to.be.reverted;

    expect(await transferService.numberOfVerifiers()).to.equal(1);

    await transferService.connect(admin).removeVerifier(userAddress);

    expect(await transferService.numberOfVerifiers()).to.equal(0);
  });

  it("Handles adding a duplicate verifier", async function() {
    const [user, user1, user2] = accounts;
    const userAddress = await user.getAddress();
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();

    expect(await transferService.numberOfVerifiers()).to.equal(0);

    await transferService.connect(admin).addVerifier(userAddress, mockPoolVerification.address);
    expect(await transferService.numberOfVerifiers()).to.equal(1);

    // Do it again
    await expect(transferService.connect(admin).addVerifier(
      userAddress, mockPoolVerification.address)).to.be.revertedWith("Address already exists");
    expect(await transferService.numberOfVerifiers()).to.equal(1);
  });

  it("Returns true from verifyTransfer when there are no verifiers", async function() {
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('20384');

    const [success, str] = await transferService.verifyTransfer(userOneAddress, userTwoAddress, amount);
    expect(success).to.equal(true);
    expect(str).to.equal("");
  });

  it("Returns correct values when from address has a verifier", async function() {
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('20384');

    await transferService.connect(admin).addVerifier(userOneAddress, mockPoolVerification.address);
    // mockPoolVerification has no mocked method yet
    await expect(transferService.verifyTransfer(userOneAddress, userTwoAddress, amount)).to.be.reverted;

    const msg = "Error Message";
    await mockPoolVerification.mock.verifyTransfer.withArgs(
      userOneAddress,
      userTwoAddress,
      amount
    ).returns(false, msg, constants.AddressZero, 0);

    const [success, str] = await transferService.verifyTransfer(userOneAddress, userTwoAddress, amount);
    expect(success).to.equal(false);
    expect(str).to.equal(msg);
  });

  it("Returns correct values when to address has a verifier", async function() {
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('20384');

    await transferService.connect(admin).addVerifier(userTwoAddress, mockPoolVerification.address);
    // mockPoolVerification has no mocked method yet
    await expect(transferService.verifyTransfer(userOneAddress, userTwoAddress, amount)).to.be.reverted;

    const msg = "Error Message 2";
    await mockPoolVerification.mock.verifyTransfer.withArgs(
      userOneAddress,
      userTwoAddress,
      amount
    ).returns(false, msg, constants.AddressZero, 0);

    const [success, str] = await transferService.verifyTransfer(userOneAddress, userTwoAddress, amount);
    expect(success).to.equal(false);
    expect(str).to.equal(msg);
  });

  it("Returns true when both to and from have verifiers that return true", async function() {
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('20384');

    await transferService.connect(admin).addVerifier(userOneAddress, mockPoolVerification.address);
    await transferService.connect(admin).addVerifier(userTwoAddress, mockPoolVerification.address);
    // mockPoolVerification has no mocked method yet
    await expect(transferService.verifyTransfer(userOneAddress, userTwoAddress, amount)).to.be.reverted;

    await mockPoolVerification.mock.verifyTransfer.withArgs(
      userOneAddress,
      userTwoAddress,
      amount
    ).returns(true, "", constants.AddressZero, 0);

    const [success, str] = await transferService.verifyTransfer(userOneAddress, userTwoAddress, amount);
    expect(success).to.equal(true);
    expect(str).to.equal("");
  });

  it("Calls the correct method when using verifyTransferAndCall", async function() {
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('20384');

    const funcs = ["function stabilize()"];
    const stabilizerNodeInterface = new Interface(funcs);
    const mockStabilizerNode = ((await deployMockContract(owner, funcs)) as any) as StabilizerNode;

    await transferService.connect(admin).addVerifier(userOneAddress, mockPoolVerification.address);
    // mockPoolVerification has no mocked method yet
    await expect(transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount)).to.be.reverted;

    const msg = "Error Message";
    await mockPoolVerification.mock.verifyTransfer.withArgs(
      userOneAddress,
      userTwoAddress,
      amount
    ).returns(true, msg, mockStabilizerNode.address, stabilizerNodeInterface.encodeFunctionData("stabilize", []));

    // StabilizerNode.stabilize not mocked yet
    await expect(transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount)).to.be.reverted;

    await mockStabilizerNode.mock.stabilize.returns();

    const tx = await transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount);
    await tx.wait();
  });

  it("Calls can call two methods when using verifyTransferAndCall", async function() {
    const [user1, user2] = accounts;
    const userOneAddress = await user1.getAddress();
    const userTwoAddress = await user2.getAddress();
    const amount = utils.parseEther('20384');

    const funcs = ["function stabilize()", "function anotherMethod()"];
    const stabilizerNodeInterface = new Interface(funcs);
    const mockStabilizerNode = ((await deployMockContract(owner, funcs)) as any) as StabilizerNode;

    const mockPoolVerificationTwo = ((await deployMockContract(owner, [
      "function verifyTransfer(address, address, uint256) returns(bool, string memory, address, bytes)",
    ])) as any) as PoolTransferVerification;

    await transferService.connect(admin).addVerifier(userOneAddress, mockPoolVerification.address);
    await transferService.connect(admin).addVerifier(userTwoAddress, mockPoolVerificationTwo.address);

    // mockPoolVerification has no mocked method yet
    await expect(transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount)).to.be.reverted;
    const msg = "Error Message";
    await mockPoolVerification.mock.verifyTransfer.withArgs(
      userOneAddress,
      userTwoAddress,
      amount
    ).returns(true, msg, mockStabilizerNode.address, stabilizerNodeInterface.encodeFunctionData("stabilize", []));

    // StabilizerNode.stabilize not mocked yet
    await expect(transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount)).to.be.reverted;
    await mockStabilizerNode.mock.stabilize.returns();

    // mockPoolVerificationTwo not mocked yet
    await expect(transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount)).to.be.reverted;
    await mockPoolVerificationTwo.mock.verifyTransfer.withArgs(
      userOneAddress,
      userTwoAddress,
      amount
    ).returns(true, msg, mockStabilizerNode.address, stabilizerNodeInterface.encodeFunctionData("anotherMethod", []));

    // StabilizerNode.anotherMethod not mocked yet
    await expect(transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount)).to.be.reverted;
    await mockStabilizerNode.mock.anotherMethod.returns();

    const tx = await transferService.verifyTransferAndCall(userOneAddress, userTwoAddress, amount);
    await tx.wait();
  });
});
