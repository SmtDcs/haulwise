// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {HaulwiseGreenLane} from "../HaulwiseGreenLane.sol";
import {CargoBill} from "../CargoBill.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

contract HaulwiseGreenLaneTest is Test {
    address shipper = makeAddr("shipper");
    address carrier = makeAddr("carrier");
    address arbiter = makeAddr("arbiter");
    address attestor = makeAddr("attestor");
    address feeRecip = makeAddr("fee");
    address stranger = makeAddr("stranger");

    MockERC20 usdc;
    HaulwiseGreenLane gl;

    uint256 constant AMOUNT = 1_000e6;
    uint256 constant BONUS = 50e6;

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        gl = new HaulwiseGreenLane(address(usdc), feeRecip, arbiter, attestor);
        usdc.mint(shipper, 100_000e6);
        vm.prank(shipper);
        usdc.approve(address(gl), type(uint256).max);
    }

    function _create(HaulwiseGreenLane.Mode m, uint32 km, uint32 kg, uint256 bonus) internal returns (uint256 id) {
        vm.prank(shipper);
        id = gl.createGreenShipment(
            carrier, AMOUNT, block.timestamp + 1 days, block.timestamp + 5 days, "ipfs://x", m, km, kg, bonus
        );
    }

    function _deliver(uint256 id) internal {
        vm.startPrank(carrier);
        gl.markPickedUp(id);
        gl.markDelivered(id);
        vm.stopPrank();
    }

    function test_create_escrowsAmountPlusBonus() public {
        _create(HaulwiseGreenLane.Mode.Road, 560, 20_000, BONUS);
        assertEq(usdc.balanceOf(address(gl)), AMOUNT + BONUS);
    }

    function test_co2_writtenOnConfirm_declaredRoad() public {
        // Istanbul -> Ankara ~ 450 km road, 20 t: 9,000 tkm * 0.10163 kg = 914.67 kg
        uint256 id = _create(HaulwiseGreenLane.Mode.Road, 450, 20_000, 0);
        _deliver(id);
        vm.prank(shipper);
        gl.confirmDelivery(id);
        (,,,,,,,, , uint256 co2) = gl.green(id);
        assertEq(co2, 914_670);
        assertEq(gl.intensityMgPerTkm(carrier), 101_630);
        assertEq(gl.greenScore(carrier), 0); // all-road, unattested
    }

    function test_bonusPaid_whenAttestedRouteMatches() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Rail, 1_000, 10_000, BONUS);
        vm.prank(carrier);
        gl.markPickedUp(id);
        vm.prank(attestor);
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Rail, 1_080); // within +10%
        vm.prank(carrier);
        gl.markDelivered(id);
        uint256 before = usdc.balanceOf(carrier);
        vm.prank(shipper);
        gl.confirmDelivery(id);
        uint256 net = AMOUNT - (AMOUNT * 50) / 10_000;
        assertEq(usdc.balanceOf(carrier) - before, net + BONUS);
        assertEq(usdc.balanceOf(address(gl)), 0);
        // 10 t * 1080 km = 10,800 tkm * 0.02779 = 300.132 kg
        (,,,,,,,, , uint256 co2) = gl.green(id);
        assertEq(co2, 300_132);
        // intensity part: (101630-27790)*50/101630 = 36 ; match part 50
        assertEq(gl.greenScore(carrier), 86);
    }

    function test_bonusReturned_whenModeMismatch() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Rail, 1_000, 10_000, BONUS);
        vm.prank(carrier);
        gl.markPickedUp(id);
        vm.prank(attestor);
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Road, 1_000);
        vm.prank(carrier);
        gl.markDelivered(id);
        uint256 sb = usdc.balanceOf(shipper);
        vm.prank(shipper);
        gl.confirmDelivery(id);
        assertEq(usdc.balanceOf(shipper) - sb, BONUS);
        (,,,,,, bool matched,,, uint256 co2) = gl.green(id);
        assertFalse(matched);
        assertEq(co2, 1_016_300); // charged at the road factor actually used
    }

    function test_bonusReturned_whenDistanceOverTolerance() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Sea, 2_000, 5_000, BONUS);
        vm.prank(carrier);
        gl.markPickedUp(id);
        vm.prank(attestor);
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Sea, 2_201);
        vm.prank(carrier);
        gl.markDelivered(id);
        uint256 sb = usdc.balanceOf(shipper);
        vm.prank(shipper);
        gl.confirmDelivery(id);
        assertEq(usdc.balanceOf(shipper) - sb, BONUS);
    }

    function test_bonusReturned_whenNotAttested() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Rail, 500, 1_000, BONUS);
        _deliver(id);
        uint256 sb = usdc.balanceOf(shipper);
        vm.prank(shipper);
        gl.confirmDelivery(id);
        assertEq(usdc.balanceOf(shipper) - sb, BONUS);
    }

    function test_autoRelease_recordsEmissions() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Road, 100, 1_000, 0);
        _deliver(id);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(stranger);
        gl.autoRelease(id);
        (,,,,,,, bool settled,, uint256 co2) = gl.green(id);
        assertTrue(settled);
        assertEq(co2, 10_163);
    }

    function test_cancel_returnsBonus_noEmissions() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Road, 100, 1_000, BONUS);
        vm.warp(block.timestamp + 1 days);
        uint256 sb = usdc.balanceOf(shipper);
        vm.prank(shipper);
        gl.cancel(id);
        assertEq(usdc.balanceOf(shipper) - sb, AMOUNT + BONUS);
        (uint256 kgKm,,,,) = gl.greenRep(carrier);
        assertEq(kgKm, 0);
    }

    function test_dispute_returnsBonus() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Road, 100, 1_000, BONUS);
        _deliver(id);
        vm.prank(shipper);
        gl.openDispute(id, "damaged");
        uint256 sb = usdc.balanceOf(shipper);
        vm.prank(arbiter);
        gl.resolveDispute(id, 5_000);
        assertEq(usdc.balanceOf(shipper) - sb, AMOUNT / 2 + BONUS);
        assertEq(usdc.balanceOf(address(gl)), 0);
    }

    function test_attest_onlyAttestorOrArbiter() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Road, 100, 1_000, 0);
        vm.prank(carrier);
        gl.markPickedUp(id);
        vm.prank(carrier);
        vm.expectRevert("GreenLane: not attestor");
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Road, 100);
        vm.prank(arbiter);
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Road, 100);
    }

    function test_attest_revertsBeforePickupAndAfterRelease() public {
        uint256 id = _create(HaulwiseGreenLane.Mode.Road, 100, 1_000, 0);
        vm.prank(attestor);
        vm.expectRevert("GreenLane: bad status");
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Road, 100);
        _deliver(id);
        vm.prank(shipper);
        gl.confirmDelivery(id);
        vm.prank(attestor);
        vm.expectRevert("GreenLane: bad status");
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Road, 100);
    }

    function test_attest_revertsForPlainShipment() public {
        vm.prank(shipper);
        uint256 id = gl.createShipment(carrier, AMOUNT, block.timestamp + 1 days, block.timestamp + 5 days, "x");
        vm.prank(carrier);
        gl.markPickedUp(id);
        vm.prank(attestor);
        vm.expectRevert("GreenLane: not green shipment");
        gl.attestRoute(id, HaulwiseGreenLane.Mode.Road, 100);
        vm.prank(carrier);
        gl.markDelivered(id);
        vm.prank(shipper);
        gl.confirmDelivery(id); // plain flow unaffected
    }

    function test_create_rejectsBadInputs() public {
        vm.startPrank(shipper);
        vm.expectRevert("GreenLane: bad distance");
        gl.createGreenShipment(carrier, AMOUNT, block.timestamp + 1, block.timestamp + 2, "", HaulwiseGreenLane.Mode.Road, 0, 1, 0);
        vm.expectRevert("GreenLane: bad weight");
        gl.createGreenShipment(carrier, AMOUNT, block.timestamp + 1, block.timestamp + 2, "", HaulwiseGreenLane.Mode.Road, 1, 0, 0);
        vm.stopPrank();
    }

    function test_setFactor_onlyArbiter_andBounds() public {
        vm.expectRevert("GreenLane: not arbiter");
        gl.setFactor(HaulwiseGreenLane.Mode.Road, 1);
        vm.startPrank(arbiter);
        vm.expectRevert("GreenLane: bad factor");
        gl.setFactor(HaulwiseGreenLane.Mode.Road, 0);
        gl.setFactor(HaulwiseGreenLane.Mode.Road, 80_000);
        vm.stopPrank();
        assertEq(gl.factorMgPerTkm(HaulwiseGreenLane.Mode.Road), 80_000);
    }

    function test_setAttestor_onlyArbiter() public {
        vm.expectRevert("GreenLane: not arbiter");
        gl.setAttestor(stranger);
        vm.prank(arbiter);
        gl.setAttestor(stranger);
        assertEq(gl.attestor(), stranger);
    }

    function testFuzz_co2Math(uint32 km, uint32 kg) public view {
        km = uint32(bound(km, 1, 40_000));
        kg = uint32(bound(kg, 1, 100_000_000));
        uint256 g = gl.estimateCo2eGrams(HaulwiseGreenLane.Mode.Road, km, kg);
        assertEq(g, (uint256(kg) * km * 101_630) / 1e6);
    }
}
