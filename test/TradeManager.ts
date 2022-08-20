import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber, Bytes } from "ethers";
import { deployments, ethers, network } from "hardhat";
import { SubscriptionConstraintsStruct, TradeStructOutput } from "../typechain-types/contracts/trades/TradeManager";
import {
  BAD_RULE_HASH,
  DEFAULT_REWARD,
  ERC20_DECIMALS,
  ETH_PRICE_IN_UNI,
  UNI_PRICE_IN_ETH,
  ETH_PRICE_IN_UNI_PARAM,
  UNI_PRICE_IN_ETH_PARAM,
  GT,
} from "./Constants";
import { makePassingTrigger, makeSwapAction, setupTradeManager } from "./Fixtures";

const MIN_COLLATERAL_PER_SUB = BigNumber.from(10).mul(ERC20_DECIMALS);
const MAX_COLLATERAL_PER_SUB = BigNumber.from(100).mul(ERC20_DECIMALS);
const MIN_COLLATERAL_TOTAL = BigNumber.from(200).mul(ERC20_DECIMALS);
const MAX_COLLATERAL_TOTAL = BigNumber.from(500).mul(ERC20_DECIMALS);

async function makeSubConstraints(): Promise<SubscriptionConstraintsStruct> {
  return {
    minCollateralPerSub: MIN_COLLATERAL_PER_SUB,
    maxCollateralPerSub: MAX_COLLATERAL_PER_SUB,
    minCollateralTotal: MIN_COLLATERAL_TOTAL,
    maxCollateralTotal: MAX_COLLATERAL_TOTAL,
    deadline: (await time.latest()) + 86400,
    lockin: (await time.latest()) + 86400 * 10,
    rewardPercentage: 100,
  };
}

describe("TradeManager", () => {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshopt in every test.
  async function deployTradeManagerFixture() {
    await deployments.fixture();
    return setupTradeManager();
  }

  async function deployValidTradeFixture() {
    const {
      ownerWallet,
      priceTrigger,
      swapUniSingleAction,
      testToken1,
      testToken2,
      tradeManager,
      traderWallet,
      someOtherWallet,
      tradeSubscriberWallet,
      ruleExecutor,
    } = await deployTradeManagerFixture();

    const ETHtoTST1SwapPriceTrigger = {
      op: GT,
      param: ETH_PRICE_IN_UNI_PARAM,
      callee: priceTrigger.address,
      value: ETH_PRICE_IN_UNI.sub(1),
    };

    const TST1toETHSwapPriceTrigger = {
      op: GT,
      param: UNI_PRICE_IN_ETH_PARAM,
      callee: priceTrigger.address,
      value: UNI_PRICE_IN_ETH.sub(1),
    };

    const swapTST1ToETHAction = makeSwapAction(
      swapUniSingleAction.address,
      testToken1.address,
      ethers.constants.AddressZero
    );

    const swapETHToTST1Action = makeSwapAction(
      swapUniSingleAction.address,
      ethers.constants.AddressZero,
      testToken1.address
    );

    const properContraints = await makeSubConstraints();

    const tx = await tradeManager
      .connect(traderWallet)
      .createTrade([TST1toETHSwapPriceTrigger], [swapTST1ToETHAction], properContraints, { value: DEFAULT_REWARD });
    const receipt = await tx.wait();
    const tradeTST1forETHHash: Bytes = receipt.events?.find(
      (x: { event: string; address: string }) => x.event == "Created" && x.address == tradeManager.address
    )?.args?.tradeHash;

    const tx2 = await tradeManager
      .connect(traderWallet)
      .createTrade([ETHtoTST1SwapPriceTrigger], [swapETHToTST1Action], properContraints, { value: DEFAULT_REWARD });
    const receipt2 = await tx2.wait();
    const tradeETHforTST1Hash: Bytes = receipt2.events?.find(
      (x: { event: string; address: string }) => x.event == "Created" && x.address == tradeManager.address
    )?.args?.tradeHash;

    return {
      ownerWallet,
      testToken1,
      testToken2,
      tradeManager,
      traderWallet,
      someOtherWallet,
      tradeSubscriberWallet,
      tradeTST1forETHHash,
      tradeETHforTST1Hash,
      ruleExecutor,
    };
  }

  describe("Deployment", () => {
    it("Should set the right owner", async function () {
      const { tradeManager, ownerWallet } = await loadFixture(deployTradeManagerFixture);
      expect(await tradeManager.owner()).to.equal(ownerWallet.address);
    });
  });

  describe.skip("Admin functions", () => {
    it("Should be able to X if owner", async function () {});
    it("Should not be able to X if not owner", async function () {});
  });

  describe("Opening a Trade", () => {
    it("Should emit the Created event properly", async function () {
      const { priceTrigger, swapUniSingleAction, testToken1, tradeManager, traderWallet } = await loadFixture(
        deployTradeManagerFixture
      );
      const passingTrigger = makePassingTrigger(priceTrigger.address);
      const executableAction = makeSwapAction(
        swapUniSingleAction.address,
        testToken1.address,
        ethers.constants.AddressZero
      );
      const properContraints = await makeSubConstraints();

      await expect(
        await tradeManager
          .connect(traderWallet)
          .createTrade([passingTrigger], [executableAction], properContraints, { value: DEFAULT_REWARD })
      ).to.emit(tradeManager, "Created");
    });

    it("Should revert if tries to open duplicate trades in same block", async function () {
      const { priceTrigger, swapUniSingleAction, testToken1, tradeManager, traderWallet } = await loadFixture(
        deployTradeManagerFixture
      );
      const passingTrigger = makePassingTrigger(priceTrigger.address);
      const executableAction = makeSwapAction(
        swapUniSingleAction.address,
        testToken1.address,
        ethers.constants.AddressZero
      );
      const properContraints = await makeSubConstraints();

      await network.provider.send("evm_setAutomine", [false]);
      const tx1 = await await tradeManager
        .connect(traderWallet)
        .createTrade([passingTrigger], [executableAction], properContraints, { value: DEFAULT_REWARD });
      const tx2 = await tradeManager
        .connect(traderWallet)
        .createTrade([passingTrigger], [executableAction], properContraints, { value: DEFAULT_REWARD });
      await network.provider.send("evm_mine", []);
      await network.provider.send("evm_setAutomine", [true]);

      var tx1Success: Boolean = false;
      var tx2Success: Boolean = false;
      try {
        await tx1.wait();
        tx1Success = true;
      } catch {}

      try {
        await tx2.wait();
        tx2Success = true;
      } catch {}

      expect(tx1Success).to.not.equal(tx2Success);
    });

    it("Should succeed if tries to open duplicate trade in a different block", async function () {
      const { priceTrigger, swapUniSingleAction, testToken1, tradeManager, traderWallet } = await loadFixture(
        deployTradeManagerFixture
      );
      const passingTrigger = makePassingTrigger(priceTrigger.address);
      const executableAction = makeSwapAction(
        swapUniSingleAction.address,
        testToken1.address,
        ethers.constants.AddressZero
      );
      const properContraints = await makeSubConstraints();

      await expect(
        await tradeManager
          .connect(traderWallet)
          .createTrade([passingTrigger], [executableAction], properContraints, { value: DEFAULT_REWARD })
      ).to.emit(tradeManager, "Created");

      await expect(
        await tradeManager
          .connect(traderWallet)
          .createTrade([passingTrigger], [executableAction], properContraints, { value: DEFAULT_REWARD })
      ).to.emit(tradeManager, "Created");
    });

    // TODO: maybe should check if the entire trade/rule chain was proper?
    it("Should set the right manager for the trade", async function () {
      const { tradeTST1forETHHash, tradeManager, traderWallet } = await loadFixture(deployValidTradeFixture);
      const trade: TradeStructOutput = await tradeManager.getTrade(tradeTST1forETHHash);
      expect(trade.manager).to.equal(traderWallet.address);
    });
  });

  describe("Cancelling a Trade", () => {
    it("Should revert if non-owner tries to cancel your trade", async function () {
      const { tradeTST1forETHHash, tradeManager, someOtherWallet } = await loadFixture(deployValidTradeFixture);
      const trade: TradeStructOutput = await tradeManager.getTrade(tradeTST1forETHHash);
      await expect(tradeManager.connect(someOtherWallet).cancelTrade(tradeTST1forETHHash)).to.be.revertedWith(
        "onlyManager"
      );
    });
    it("Should succeed if manager wants to cancel trade", async function () {
      const { tradeTST1forETHHash, tradeManager, traderWallet } = await loadFixture(deployValidTradeFixture);
      await expect(tradeManager.connect(traderWallet).cancelTrade(tradeTST1forETHHash))
        .to.emit(tradeManager, "Cancelled")
        .withArgs(tradeTST1forETHHash);
    });
    it("Should revert if trying to cancel non-existing trade", async function () {
      const { tradeTST1forETHHash, tradeManager, traderWallet } = await loadFixture(deployValidTradeFixture);
      await expect(tradeManager.connect(traderWallet).cancelTrade(BAD_RULE_HASH)).to.be.reverted;
    });
    it("Should revert if manager tries to cancel same trade twice", async function () {
      const { tradeTST1forETHHash, tradeManager, traderWallet } = await loadFixture(deployValidTradeFixture);
      await expect(tradeManager.connect(traderWallet).cancelTrade(tradeTST1forETHHash))
        .to.emit(tradeManager, "Cancelled")
        .withArgs(tradeTST1forETHHash);

      await expect(tradeManager.connect(traderWallet).cancelTrade(tradeTST1forETHHash)).to.be.reverted;
    });
    it.skip("Should revert if manager tries to cancel a trade that is completed", async function () {});
  });

  describe("Subscriber depositing", () => {
    it("Should revert if subscriber deposits wrong asset", async function () {
      const { ownerWallet, tradeTST1forETHHash, tradeManager, traderWallet, tradeSubscriberWallet, testToken2 } =
        await loadFixture(deployValidTradeFixture);
      const collateralAmount = MIN_COLLATERAL_PER_SUB.add(1);
      await testToken2.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount);
      await testToken2.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount);
      await expect(
        tradeManager.connect(tradeSubscriberWallet).deposit(tradeTST1forETHHash, testToken2.address, collateralAmount)
      ).to.be.revertedWith("Wrong Collateral Type");
    });

    it("Should revert if subscriber deposits too little / much at once", async function () {
      const { ownerWallet, tradeTST1forETHHash, tradeManager, traderWallet, tradeSubscriberWallet, testToken1 } =
        await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB.add(1);
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount);
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount);

      await expect(
        tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, MAX_COLLATERAL_PER_SUB.add(1))
      ).to.be.revertedWith("Max Collateral for Subscription exceeded");

      await expect(
        tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, MIN_COLLATERAL_PER_SUB.sub(1))
      ).to.be.revertedWith("Insufficient Collateral for Subscription");
    });

    it("Should succeed in depositing ERC20 properly", async function () {
      // anything between MIN_COLLATERAL_PER_SUB and MAX_COLLATERAL_PER_SUB should work (inclusive)
      const { ownerWallet, tradeTST1forETHHash, tradeManager, traderWallet, tradeSubscriberWallet, testToken1 } =
        await loadFixture(deployValidTradeFixture);
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, MAX_COLLATERAL_TOTAL);
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, MAX_COLLATERAL_TOTAL);

      await expect(
        tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, MIN_COLLATERAL_PER_SUB)
      )
        .to.emit(tradeManager, "Deposit")
        .withArgs(tradeTST1forETHHash, 0, testToken1.address, MIN_COLLATERAL_PER_SUB);

      await expect(
        tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, MAX_COLLATERAL_PER_SUB)
      )
        .to.emit(tradeManager, "Deposit")
        .withArgs(tradeTST1forETHHash, 1, testToken1.address, MAX_COLLATERAL_PER_SUB);

      await expect(
        tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, MIN_COLLATERAL_PER_SUB.add(MAX_COLLATERAL_PER_SUB).div(2))
      )
        .to.emit(tradeManager, "Deposit")
        .withArgs(
          tradeTST1forETHHash,
          2,
          testToken1.address,
          MIN_COLLATERAL_PER_SUB.add(MAX_COLLATERAL_PER_SUB).div(2)
        );
    });

    it("Should succeed if same acccount subscribes multiple times", async function () {
      const { ownerWallet, tradeTST1forETHHash, tradeManager, traderWallet, tradeSubscriberWallet, testToken1 } =
        await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_TOTAL;
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, MAX_COLLATERAL_TOTAL);
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, MAX_COLLATERAL_TOTAL);

      for (var i = 0; i < MAX_COLLATERAL_TOTAL.div(MAX_COLLATERAL_PER_SUB).toNumber(); i++) {
        await tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, MAX_COLLATERAL_PER_SUB);
      }
      expect((await tradeManager.getTrade(tradeTST1forETHHash)).subscriptions.length).to.equal(
        MAX_COLLATERAL_TOTAL.div(MAX_COLLATERAL_PER_SUB).toNumber()
      );
    });

    it("Should activate rule if minCollateral for trade is reached", async function () {
      const {
        ownerWallet,
        tradeTST1forETHHash,
        tradeManager,
        traderWallet,
        tradeSubscriberWallet,
        testToken1,
        ruleExecutor,
      } = await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB;
      const times = MIN_COLLATERAL_TOTAL.div(collateralAmount);
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount.mul(times));
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount.mul(times));

      const trade: TradeStructOutput = await tradeManager.getTrade(tradeTST1forETHHash);

      for (var i = 0; i < times.toNumber() - 1; i++) {
        await tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, collateralAmount);
      }

      await expect(
        tradeManager.connect(tradeSubscriberWallet).deposit(tradeTST1forETHHash, testToken1.address, collateralAmount)
      )
        .to.emit(ruleExecutor, "Activated")
        .withArgs(trade.ruleHash);
    });

    it("Should allow multiple subscriptions from multiple people", async function () {
      // here tradeSubscriberWaller and ownerWallet are both subscribing to the same trade
      const { ownerWallet, tradeTST1forETHHash, tradeManager, traderWallet, tradeSubscriberWallet, testToken1 } =
        await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB;
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount);
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount);
      await testToken1.connect(ownerWallet).approve(tradeManager.address, collateralAmount);

      await expect(
        tradeManager.connect(tradeSubscriberWallet).deposit(tradeTST1forETHHash, testToken1.address, collateralAmount)
      )
        .to.emit(tradeManager, "Deposit")
        .withArgs(tradeTST1forETHHash, 0, testToken1.address, collateralAmount);

      await expect(tradeManager.connect(ownerWallet).deposit(tradeTST1forETHHash, testToken1.address, collateralAmount))
        .to.emit(tradeManager, "Deposit")
        .withArgs(tradeTST1forETHHash, 1, testToken1.address, collateralAmount);
    });

    it("Should revert if deposits take it beyond maxCollateralTotal", async function () {
      const { ownerWallet, tradeTST1forETHHash, tradeManager, traderWallet, tradeSubscriberWallet, testToken1 } =
        await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB;
      const times = MAX_COLLATERAL_TOTAL.div(MAX_COLLATERAL_PER_SUB);
      await testToken1
        .connect(ownerWallet)
        .transfer(tradeSubscriberWallet.address, collateralAmount.mul(times).add(MIN_COLLATERAL_PER_SUB));
      await testToken1
        .connect(tradeSubscriberWallet)
        .approve(tradeManager.address, collateralAmount.mul(times).add(MIN_COLLATERAL_PER_SUB));

      for (var i = 0; i < times.toNumber(); i++) {
        await tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, collateralAmount);
      }

      await expect(
        tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, MIN_COLLATERAL_PER_SUB)
      ).to.be.revertedWith("Max Collateral for Trade exceeded");
    });

    it.skip("Should succeed in depositing ETH properly", async function () {});
  });

  describe("Subscriber withdrawing", () => {
    it("Should revert if non-subscriber is trying to withdraw collateral", async function () {
      const {
        ownerWallet,
        tradeTST1forETHHash,
        tradeManager,
        traderWallet,
        tradeSubscriberWallet,
        testToken1,
        ruleExecutor,
      } = await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB;
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount);
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount);

      await tradeManager
        .connect(tradeSubscriberWallet)
        .deposit(tradeTST1forETHHash, testToken1.address, collateralAmount);

      await expect(tradeManager.connect(ownerWallet).withdraw(tradeTST1forETHHash, 0)).to.be.revertedWith(
        "You're not the subscriber!"
      );
    });

    it("Should succeed if subscriber tries to withdraw if rule is active (ERC20)", async function () {
      const {
        ownerWallet,
        tradeTST1forETHHash,
        tradeManager,
        traderWallet,
        tradeSubscriberWallet,
        testToken1,
        ruleExecutor,
      } = await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB;
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount.mul(2));
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount.mul(2));

      await tradeManager
        .connect(tradeSubscriberWallet)
        .deposit(tradeTST1forETHHash, testToken1.address, collateralAmount);

      await expect(
        tradeManager.connect(tradeSubscriberWallet).deposit(tradeTST1forETHHash, testToken1.address, collateralAmount)
      )
        .to.emit(ruleExecutor, "Activated")
        .withArgs((await tradeManager.getTrade(tradeTST1forETHHash)).ruleHash);

      await expect(tradeManager.connect(tradeSubscriberWallet).withdraw(tradeTST1forETHHash, 0))
        .to.emit(tradeManager, "Withdraw")
        .withArgs(tradeTST1forETHHash, 0, testToken1.address, collateralAmount);
    });

    it("Should succeed if subscriber tries to withdraw if rule is inactive (ERC20), but a second time will revert", async function () {
      const {
        ownerWallet,
        tradeTST1forETHHash,
        tradeManager,
        traderWallet,
        tradeSubscriberWallet,
        testToken1,
        ruleExecutor,
      } = await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB;
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount);
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount);
      await tradeManager
        .connect(tradeSubscriberWallet)
        .deposit(tradeTST1forETHHash, testToken1.address, collateralAmount);

      await expect(tradeManager.connect(tradeSubscriberWallet).withdraw(tradeTST1forETHHash, 0))
        .to.emit(tradeManager, "Withdraw")
        .withArgs(tradeTST1forETHHash, 0, testToken1.address, collateralAmount);

      await expect(tradeManager.connect(tradeSubscriberWallet).withdraw(tradeTST1forETHHash, 0)).to.be.revertedWith(
        "This subscription is not active!"
      );
    });

    it("Should deactivate rule if withdrawal takes it below minCollateral", async function () {
      const {
        ownerWallet,
        tradeTST1forETHHash,
        tradeManager,
        traderWallet,
        tradeSubscriberWallet,
        testToken1,
        ruleExecutor,
      } = await loadFixture(deployValidTradeFixture);
      const collateralAmount = MAX_COLLATERAL_PER_SUB;
      const times = MIN_COLLATERAL_TOTAL.div(collateralAmount);
      await testToken1.connect(ownerWallet).transfer(tradeSubscriberWallet.address, collateralAmount.mul(times));
      await testToken1.connect(tradeSubscriberWallet).approve(tradeManager.address, collateralAmount.mul(times));

      const trade: TradeStructOutput = await tradeManager.getTrade(tradeTST1forETHHash);

      for (var i = 0; i < times.toNumber() - 1; i++) {
        await tradeManager
          .connect(tradeSubscriberWallet)
          .deposit(tradeTST1forETHHash, testToken1.address, collateralAmount);
      }
      await expect(
        tradeManager.connect(tradeSubscriberWallet).deposit(tradeTST1forETHHash, testToken1.address, collateralAmount)
      )
        .to.emit(ruleExecutor, "Activated")
        .withArgs(trade.ruleHash);

      await expect(tradeManager.connect(tradeSubscriberWallet).withdraw(tradeTST1forETHHash, 0))
        .to.emit(tradeManager, "Withdraw")
        .withArgs(tradeTST1forETHHash, 0, testToken1.address, collateralAmount)
        .to.emit(ruleExecutor, "Deactivated")
        .withArgs(trade.ruleHash);
    });

    it.skip("Should succeed in giving back output after trade is completed (ERC20)", async function () {});
    it.skip("Should succeed in giving back output after trade is completed (ETH)", async function () {});
  });
});
