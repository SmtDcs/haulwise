// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CargoBill} from "../CargoBill.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/**
 * @title CargoBillTest
 * @notice Comprehensive Foundry test suite for CargoBill.sol.
 */
contract CargoBillTest is Test {

    // ─────────────────────────────────────────────────────────────────────────
    // Actors
    // ─────────────────────────────────────────────────────────────────────────
    address internal shipper   = makeAddr("shipper");
    address internal carrier   = makeAddr("carrier");
    address internal arbiter   = makeAddr("arbiter");
    address internal feeRecip  = makeAddr("feeRecipient");
    address internal stranger  = makeAddr("stranger");

    // ─────────────────────────────────────────────────────────────────────────
    // Contracts
    // ─────────────────────────────────────────────────────────────────────────
    MockERC20  internal usdc;
    CargoBill  internal bill;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants that mirror the contract
    // ─────────────────────────────────────────────────────────────────────────
    uint256 internal constant FEE_BPS            = 50;
    uint256 internal constant AUTO_RELEASE_DELAY = 48 hours;
    uint256 internal constant AMOUNT             = 1_000e6; // 1 000 USDC (6 dec)
    uint256 internal constant PICKUP_OFFSET      = 2 days;
    uint256 internal constant DELIVERY_OFFSET    = 7 days;
    uint256 internal constant REFUND_DELAY       = 7 days;
    uint256 internal constant ESCALATE_DELAY     = 14 days;

    // ─────────────────────────────────────────────────────────────────────────
    // setUp – runs before EVERY test
    // ─────────────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        bill = new CargoBill(address(usdc), feeRecip, arbiter);

        // Fund shipper and pre-approve the contract for a generous allowance
        usdc.mint(shipper, 100_000e6);
        vm.prank(shipper);
        usdc.approve(address(bill), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Creates one standard shipment and returns its id.
    function _createShipment() internal returns (uint256 id) {
        vm.prank(shipper);
        id = bill.createShipment(
            carrier,
            AMOUNT,
            block.timestamp + PICKUP_OFFSET,
            block.timestamp + DELIVERY_OFFSET,
            "ipfs://meta"
        );
    }

    /// @dev Advances a shipment to PickedUp.
    function _pickUp(uint256 id) internal {
        vm.prank(carrier);
        bill.markPickedUp(id);
    }

    /// @dev Advances a shipment to Delivered.
    function _deliver(uint256 id) internal {
        vm.prank(carrier);
        bill.markDelivered(id);
    }

    /// @dev Opens a dispute from the shipper side.
    function _openDispute(uint256 id) internal {
        vm.prank(shipper);
        bill.openDispute(id, "goods damaged");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 1 – Deployment / Constructor
    // ═════════════════════════════════════════════════════════════════════════

    function test_Constructor_StoresImmutables() public view {
        assertEq(bill.usdc(),         address(usdc));
        assertEq(bill.feeRecipient(), feeRecip);
        assertEq(bill.arbiter(),      arbiter);
        assertEq(bill.pendingArbiter(), address(0));
        assertEq(bill.shipmentCount(), 0);
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(bytes("CargoBill: zero usdc"));
        new CargoBill(address(0), feeRecip, arbiter);
    }

    function test_Constructor_RevertsOnZeroFeeRecipient() public {
        vm.expectRevert(bytes("CargoBill: zero fee recipient"));
        new CargoBill(address(usdc), address(0), arbiter);
    }

    function test_Constructor_RevertsOnZeroArbiter() public {
        vm.expectRevert(bytes("CargoBill: zero arbiter"));
        new CargoBill(address(usdc), feeRecip, address(0));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 2 – createShipment
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateShipment_HappyPath() public {
        uint256 pickupDeadline = block.timestamp + PICKUP_OFFSET;
        uint256 deliveryDeadline = block.timestamp + DELIVERY_OFFSET;

        vm.prank(shipper);
        uint256 id = bill.createShipment(carrier, AMOUNT, pickupDeadline, deliveryDeadline, "ipfs://meta");

        assertEq(id, 1, "id should be 1");
        assertEq(bill.shipmentCount(), 1, "shipmentCount should increment");

        {
            (
                uint256 sId,
                address sShipper,
                address sCarrier,
                uint256 sAmount,
                uint256 sPickupDeadline,
                uint256 sDeliveryDeadline,
                ,
                ,
                ,
                ,
                ,
            ) = bill.shipments(1);

            assertEq(sId,               1,                "stored id");
            assertEq(sShipper,          shipper,          "stored shipper");
            assertEq(sCarrier,          carrier,          "stored carrier");
            assertEq(sAmount,           AMOUNT,           "stored amount");
            assertEq(sPickupDeadline,   pickupDeadline,   "stored pickupDeadline");
            assertEq(sDeliveryDeadline, deliveryDeadline, "stored deliveryDeadline");
        }

        {
            (
                ,
                ,
                ,
                ,
                ,
                ,
                string memory sUri,
                CargoBill.ShipmentStatus sStatus,
                uint256 sPickedUpAt,
                uint256 sDeliveredAt,
                string memory sReason,
                uint256 sDisputedAt
            ) = bill.shipments(1);

            assertEq(sUri,              "ipfs://meta",    "stored uri");
            assertEq(uint8(sStatus),    uint8(CargoBill.ShipmentStatus.Created), "status Created");
            assertEq(sPickedUpAt,       0, "pickedUpAt zero");
            assertEq(sDeliveredAt,      0, "deliveredAt zero");
            assertEq(sReason,           "", "no dispute reason");
            assertEq(sDisputedAt,       0, "disputedAt zero");
        }

        assertEq(usdc.balanceOf(address(bill)), AMOUNT, "contract holds AMOUNT");
    }

    function test_CreateShipment_EmitsShipmentCreated() public {
        uint256 pickupDeadline = block.timestamp + PICKUP_OFFSET;
        uint256 deliveryDeadline = block.timestamp + DELIVERY_OFFSET;

        vm.prank(shipper);
        vm.expectEmit(true, true, true, true, address(bill));
        emit CargoBill.ShipmentCreated(1, shipper, carrier, AMOUNT, pickupDeadline, deliveryDeadline, "ipfs://meta");
        bill.createShipment(carrier, AMOUNT, pickupDeadline, deliveryDeadline, "ipfs://meta");
    }

    function test_CreateShipment_RevertsZeroCarrier() public {
        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: zero carrier"));
        bill.createShipment(address(0), AMOUNT, block.timestamp + 1, block.timestamp + 2, "x");
    }

    function test_CreateShipment_RevertsCarrierIsSender() public {
        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: carrier cannot be shipper"));
        bill.createShipment(shipper, AMOUNT, block.timestamp + 1, block.timestamp + 2, "x");
    }

    function test_CreateShipment_RevertsZeroAmount() public {
        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: zero amount"));
        bill.createShipment(carrier, 0, block.timestamp + 1, block.timestamp + 2, "x");
    }

    function test_CreateShipment_RevertsBadPickupDeadline_Equal() public {
        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad pickup deadline"));
        bill.createShipment(carrier, AMOUNT, block.timestamp, block.timestamp + 1, "x");
    }

    function test_CreateShipment_RevertsBadPickupDeadline_Past() public {
        vm.warp(block.timestamp + 1 days);
        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad pickup deadline"));
        bill.createShipment(carrier, AMOUNT, block.timestamp - 1, block.timestamp + 1, "x");
    }

    function test_CreateShipment_RevertsBadDeliveryDeadline_EqualOrBeforePickup() public {
        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad delivery deadline"));
        bill.createShipment(carrier, AMOUNT, block.timestamp + 2, block.timestamp + 2, "x");

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad delivery deadline"));
        bill.createShipment(carrier, AMOUNT, block.timestamp + 2, block.timestamp + 1, "x");
    }

    function test_CreateShipment_RevertsMetadataTooLong() public {
        bytes memory longUri = new bytes(257);
        for (uint256 i = 0; i < 257; i++) {
            longUri[i] = "a";
        }

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: metadataURI too long"));
        bill.createShipment(carrier, AMOUNT, block.timestamp + 1, block.timestamp + 2, string(longUri));
    }

    function test_CreateShipment_AllowsMax256Metadata() public {
        bytes memory maxUri = new bytes(256);
        for (uint256 i = 0; i < 256; i++) {
            maxUri[i] = "a";
        }

        vm.prank(shipper);
        uint256 id = bill.createShipment(carrier, AMOUNT, block.timestamp + 1, block.timestamp + 2, string(maxUri));
        assertEq(id, 1);
    }

    function test_CreateShipment_IncrementId() public {
        uint256 p = block.timestamp + PICKUP_OFFSET;
        uint256 d = block.timestamp + DELIVERY_OFFSET;
        vm.startPrank(shipper);
        uint256 id1 = bill.createShipment(carrier, AMOUNT, p, d, "a");
        uint256 id2 = bill.createShipment(carrier, AMOUNT, p, d, "b");
        uint256 id3 = bill.createShipment(carrier, AMOUNT, p, d, "c");
        vm.stopPrank();
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
        assertEq(bill.shipmentCount(), 3);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 3 – markPickedUp
    // ═════════════════════════════════════════════════════════════════════════

    function test_MarkPickedUp_HappyPath() public {
        uint256 id = _createShipment();

        vm.prank(carrier);
        bill.markPickedUp(id);

        (, , , , , , , CargoBill.ShipmentStatus status, uint256 pickedUpAt, , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.PickedUp), "status PickedUp");
        assertEq(pickedUpAt, block.timestamp, "pickedUpAt set");
    }

    function test_MarkPickedUp_AtPickupDeadline_Succeeds() public {
        uint256 id = _createShipment();

        // Warp exactly to pickupDeadline
        vm.warp(block.timestamp + PICKUP_OFFSET);
        vm.prank(carrier);
        bill.markPickedUp(id);

        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.PickedUp));
    }

    function test_MarkPickedUp_EmitsPickedUp() public {
        uint256 id = _createShipment();

        vm.prank(carrier);
        vm.expectEmit(true, false, false, true, address(bill));
        emit CargoBill.PickedUp(id, block.timestamp);
        bill.markPickedUp(id);
    }

    function test_MarkPickedUp_RevertsNotCarrier() public {
        uint256 id = _createShipment();
        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not carrier"));
        bill.markPickedUp(id);
    }

    function test_MarkPickedUp_RevertsBadStatus_AlreadyPickedUp() public {
        uint256 id = _createShipment();
        _pickUp(id);
        vm.prank(carrier);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.markPickedUp(id);
    }

    function test_MarkPickedUp_RevertsPickupDeadlinePassed() public {
        uint256 id = _createShipment();

        // Warp past pickupDeadline
        vm.warp(block.timestamp + PICKUP_OFFSET + 1);

        vm.prank(carrier);
        vm.expectRevert(bytes("CargoBill: pickup deadline passed"));
        bill.markPickedUp(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 4 – markDelivered
    // ═════════════════════════════════════════════════════════════════════════

    function test_MarkDelivered_HappyPath() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.prank(carrier);
        bill.markDelivered(id);

        (, , , , , , , CargoBill.ShipmentStatus status, , uint256 deliveredAt, ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Delivered), "status Delivered");
        assertEq(deliveredAt, block.timestamp, "deliveredAt set");
    }

    function test_MarkDelivered_EmitsMarkedDelivered() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.prank(carrier);
        vm.expectEmit(true, false, false, true, address(bill));
        emit CargoBill.MarkedDelivered(id, block.timestamp);
        bill.markDelivered(id);
    }

    function test_MarkDelivered_RevertsNotCarrier() public {
        uint256 id = _createShipment();
        _pickUp(id);
        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not carrier"));
        bill.markDelivered(id);
    }

    function test_MarkDelivered_RevertsBadStatus_NotPickedUp() public {
        uint256 id = _createShipment();
        vm.prank(carrier);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.markDelivered(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 5 – confirmDelivery
    // ═════════════════════════════════════════════════════════════════════════

    function test_ConfirmDelivery_HappyPath_FeeSplit() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _deliver(id);

        uint256 expectedFee = (AMOUNT * FEE_BPS) / 10_000;
        uint256 expectedNet = AMOUNT - expectedFee;

        uint256 carrierBefore  = usdc.balanceOf(carrier);
        uint256 feeRecipBefore = usdc.balanceOf(feeRecip);

        vm.prank(shipper);
        bill.confirmDelivery(id);

        assertEq(usdc.balanceOf(carrier)   - carrierBefore,  expectedNet, "carrier receives net");
        assertEq(usdc.balanceOf(feeRecip)  - feeRecipBefore, expectedFee, "feeRecip receives fee");
        assertEq(usdc.balanceOf(address(bill)), 0,            "contract drained");
    }

    function test_ConfirmDelivery_StatusBecomesReleased() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        vm.prank(shipper);
        bill.confirmDelivery(id);

        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Released));
    }

    function test_ConfirmDelivery_EmitsEvents() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        uint256 fee = (AMOUNT * FEE_BPS) / 10_000;
        uint256 net = AMOUNT - fee;

        vm.prank(shipper);
        vm.expectEmit(true, false, false, false, address(bill));
        emit CargoBill.DeliveryConfirmed(id);
        vm.expectEmit(true, true, false, true, address(bill));
        emit CargoBill.FundsReleased(id, carrier, net, fee);
        bill.confirmDelivery(id);
    }

    function test_ConfirmDelivery_IncrementsReputation_Completed() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        vm.prank(shipper);
        bill.confirmDelivery(id);

        (uint256 completed, , ) = bill.reputation(carrier);
        assertEq(completed, 1, "completed incremented");
    }

    function test_ConfirmDelivery_IncrementsReputation_Late_WhenDeliveredAfterDeliveryDeadline() public {
        uint256 id = _createShipment();
        _pickUp(id);

        // Warp past the delivery deadline before delivering
        vm.warp(block.timestamp + DELIVERY_OFFSET + 1);
        _deliver(id);

        vm.prank(shipper);
        bill.confirmDelivery(id);

        (, , uint256 late) = bill.reputation(carrier);
        assertEq(late, 1, "late incremented when delivered after delivery deadline");
    }

    function test_ConfirmDelivery_NoLateIncrement_WhenOnTime() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        vm.prank(shipper);
        bill.confirmDelivery(id);

        (, , uint256 late) = bill.reputation(carrier);
        assertEq(late, 0, "late NOT incremented when on time");
    }

    function test_ConfirmDelivery_RevertsNotShipper() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not shipper"));
        bill.confirmDelivery(id);
    }

    function test_ConfirmDelivery_RevertsBadStatus_NotDelivered() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.confirmDelivery(id);
    }

    function test_ConfirmDelivery_RevertsBadStatus_Created() public {
        uint256 id = _createShipment();

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.confirmDelivery(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 6 – autoRelease
    // ═════════════════════════════════════════════════════════════════════════

    function test_AutoRelease_HappyPath_ByStranger() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        uint256 deliveredTs = block.timestamp;
        vm.warp(deliveredTs + AUTO_RELEASE_DELAY);

        uint256 expectedFee = (AMOUNT * FEE_BPS) / 10_000;
        uint256 expectedNet = AMOUNT - expectedFee;

        uint256 carrierBefore  = usdc.balanceOf(carrier);
        uint256 feeRecipBefore = usdc.balanceOf(feeRecip);

        vm.prank(stranger);
        bill.autoRelease(id);

        assertEq(usdc.balanceOf(carrier)   - carrierBefore,  expectedNet, "carrier receives net");
        assertEq(usdc.balanceOf(feeRecip)  - feeRecipBefore, expectedFee, "feeRecip receives fee");
        assertEq(usdc.balanceOf(address(bill)), 0,            "contract drained");
    }

    function test_AutoRelease_EmitsEvents() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        uint256 deliveredTs = block.timestamp;
        vm.warp(deliveredTs + AUTO_RELEASE_DELAY);

        uint256 fee = (AMOUNT * FEE_BPS) / 10_000;
        uint256 net = AMOUNT - fee;

        vm.prank(stranger);
        vm.expectEmit(true, true, false, false, address(bill));
        emit CargoBill.AutoReleased(id, stranger);
        vm.expectEmit(true, true, false, true, address(bill));
        emit CargoBill.FundsReleased(id, carrier, net, fee);
        bill.autoRelease(id);
    }

    function test_AutoRelease_StatusBecomesReleased() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);
        vm.warp(block.timestamp + AUTO_RELEASE_DELAY);

        vm.prank(stranger);
        bill.autoRelease(id);

        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Released));
    }

    function test_AutoRelease_IncrementsReputation_Completed() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);
        vm.warp(block.timestamp + AUTO_RELEASE_DELAY);

        bill.autoRelease(id);

        (uint256 completed, , ) = bill.reputation(carrier);
        assertEq(completed, 1);
    }

    function test_AutoRelease_IncrementsReputation_Late_WhenDeliveredAfterDeliveryDeadline() public {
        uint256 id = _createShipment();
        _pickUp(id);
        vm.warp(block.timestamp + DELIVERY_OFFSET + 1);
        _deliver(id);
        vm.warp(block.timestamp + AUTO_RELEASE_DELAY);

        bill.autoRelease(id);

        (, , uint256 late) = bill.reputation(carrier);
        assertEq(late, 1, "late incremented");
    }

    function test_AutoRelease_NoLateIncrement_WhenOnTime() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);
        vm.warp(block.timestamp + AUTO_RELEASE_DELAY);

        bill.autoRelease(id);

        (, , uint256 late) = bill.reputation(carrier);
        assertEq(late, 0, "late NOT incremented");
    }

    function test_AutoRelease_RevertsBeforeDelay() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        vm.warp(block.timestamp + AUTO_RELEASE_DELAY - 1);

        vm.expectRevert(bytes("CargoBill: delay not met"));
        bill.autoRelease(id);
    }

    function test_AutoRelease_RevertsBadStatus_NotDelivered() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.autoRelease(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 7 – refundUndelivered
    // ═════════════════════════════════════════════════════════════════════════

    function test_RefundUndelivered_HappyPath() public {
        uint256 id = _createShipment();
        _pickUp(id);

        uint256 beforeBal = usdc.balanceOf(shipper);

        // Warp past deliveryDeadline + 7 days
        vm.warp(block.timestamp + DELIVERY_OFFSET + REFUND_DELAY + 1);

        vm.prank(shipper);
        vm.expectEmit(true, false, false, false, address(bill));
        emit CargoBill.ShipmentRefunded(id);
        bill.refundUndelivered(id);

        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Refunded), "status Refunded");
        assertEq(usdc.balanceOf(shipper) - beforeBal, AMOUNT, "shipper fully refunded");
        assertEq(usdc.balanceOf(address(bill)), 0, "contract drained");

        (, , uint256 late) = bill.reputation(carrier);
        assertEq(late, 1, "carrier late count incremented");
    }

    function test_RefundUndelivered_RevertsNotShipper() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.warp(block.timestamp + DELIVERY_OFFSET + REFUND_DELAY + 1);

        vm.prank(carrier);
        vm.expectRevert(bytes("CargoBill: not shipper"));
        bill.refundUndelivered(id);
    }

    function test_RefundUndelivered_RevertsBadStatus_Created() public {
        uint256 id = _createShipment();

        vm.warp(block.timestamp + DELIVERY_OFFSET + REFUND_DELAY + 1);

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.refundUndelivered(id);
    }

    function test_RefundUndelivered_RevertsBadStatus_Delivered() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _deliver(id);

        vm.warp(block.timestamp + DELIVERY_OFFSET + REFUND_DELAY + 1);

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.refundUndelivered(id);
    }

    function test_RefundUndelivered_RevertsBeforeGracePeriod() public {
        uint256 id = _createShipment();
        _pickUp(id);

        // Warp to exactly deliveryDeadline + 7 days (not strictly greater)
        vm.warp(block.timestamp + DELIVERY_OFFSET + REFUND_DELAY);

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: delivery grace period not passed"));
        bill.refundUndelivered(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 8 – openDispute
    // ═════════════════════════════════════════════════════════════════════════

    function test_OpenDispute_ByShipper_WhilePickedUp() public {
        uint256 id = _createShipment();
        _pickUp(id);

        uint256 beforeTime = block.timestamp;

        vm.prank(shipper);
        bill.openDispute(id, "cargo missing");

        (, , , , , , , CargoBill.ShipmentStatus status, , , string memory reason, uint256 disputedAt) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Disputed), "status Disputed");
        assertEq(reason, "cargo missing", "reason stored");
        assertEq(disputedAt, beforeTime, "disputedAt stored");
    }

    function test_OpenDispute_ByCarrier_WhileDelivered() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        vm.prank(carrier);
        bill.openDispute(id, "payment concern");

        (, , , , , , , CargoBill.ShipmentStatus status, , , , uint256 disputedAt) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Disputed));
        assertEq(disputedAt, block.timestamp);
    }

    function test_OpenDispute_EmitsDisputeOpened() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.prank(shipper);
        vm.expectEmit(true, true, false, true, address(bill));
        emit CargoBill.DisputeOpened(id, shipper, "goods damaged");
        bill.openDispute(id, "goods damaged");
    }

    function test_OpenDispute_RevertsNotParticipant() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not participant"));
        bill.openDispute(id, "reason");
    }

    function test_OpenDispute_RevertsBadStatus_Created() public {
        uint256 id = _createShipment();

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.openDispute(id, "reason");
    }

    function test_OpenDispute_RevertsBadStatus_Released() public {
        uint256 id = _createShipment();
        _pickUp(id); _deliver(id);

        vm.prank(shipper);
        bill.confirmDelivery(id);

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.openDispute(id, "too late");
    }

    function test_OpenDispute_RevertsReasonTooLong() public {
        uint256 id = _createShipment();
        _pickUp(id);

        bytes memory longReason = new bytes(257);
        for (uint256 i = 0; i < 257; i++) {
            longReason[i] = "e";
        }

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: dispute reason too long"));
        bill.openDispute(id, string(longReason));
    }

    function test_OpenDispute_AllowsMax256Reason() public {
        uint256 id = _createShipment();
        _pickUp(id);

        bytes memory maxReason = new bytes(256);
        for (uint256 i = 0; i < 256; i++) {
            maxReason[i] = "e";
        }

        vm.prank(shipper);
        bill.openDispute(id, string(maxReason));
        (, , , , , , , CargoBill.ShipmentStatus status, , , string memory storedReason,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Disputed));
        assertEq(storedReason, string(maxReason));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 9 – resolveDispute & escalateTimeout
    // ═════════════════════════════════════════════════════════════════════════

    function test_ResolveDispute_CarrierLost_IncrementsCarrierDisputed() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        // carrierBps = 4999 (< 5000) -> carrier lost
        vm.prank(arbiter);
        bill.resolveDispute(id, 4_999);

        (, uint256 carrierDisputed, ) = bill.reputation(carrier);
        assertEq(carrierDisputed, 1, "carrier disputed incremented");
        assertEq(bill.shipperDisputesLost(shipper), 0, "shipper disputes lost 0");
    }

    function test_ResolveDispute_ShipperLost_IncrementsShipperLost() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        // carrierBps = 5000 (>= 5000) -> shipper lost
        vm.prank(arbiter);
        bill.resolveDispute(id, 5_000);

        (, uint256 carrierDisputed, ) = bill.reputation(carrier);
        assertEq(carrierDisputed, 0, "carrier disputed not incremented");
        assertEq(bill.shipperDisputesLost(shipper), 1, "shipper disputes lost incremented");
        assertEq(bill.getShipperDisputesLost(shipper), 1, "getter exposes count");
    }

    function test_ResolveDispute_ShipperLost_FullCarrier() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        uint256 carrierBefore  = usdc.balanceOf(carrier);
        uint256 shipperBefore  = usdc.balanceOf(shipper);

        vm.prank(arbiter);
        bill.resolveDispute(id, 10_000); // 100% to carrier

        assertEq(usdc.balanceOf(carrier)  - carrierBefore,  AMOUNT, "carrier gets all");
        assertEq(usdc.balanceOf(shipper)  - shipperBefore,  0,      "shipper gets nothing");
        assertEq(bill.shipperDisputesLost(shipper), 1, "shipper lost");
    }

    function test_ResolveDispute_CarrierLost_FullShipper() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        uint256 shipperBefore = usdc.balanceOf(shipper);
        uint256 carrierBefore = usdc.balanceOf(carrier);

        vm.prank(arbiter);
        bill.resolveDispute(id, 0); // 0% to carrier → 100% to shipper

        assertEq(usdc.balanceOf(shipper) - shipperBefore, AMOUNT, "shipper gets all");
        assertEq(usdc.balanceOf(carrier) - carrierBefore, 0,      "carrier gets nothing");

        (, uint256 carrierDisputed, ) = bill.reputation(carrier);
        assertEq(carrierDisputed, 1, "carrier lost");
        assertEq(bill.shipperDisputesLost(shipper), 0);
    }

    function test_ResolveDispute_StatusBecomesResolved() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        vm.prank(arbiter);
        bill.resolveDispute(id, 5_000);

        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Resolved));
    }

    function test_ResolveDispute_EmitsDisputeResolved() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        uint256 cBps    = 6_000;
        uint256 cAmount = (AMOUNT * cBps) / 10_000;
        uint256 sAmount = AMOUNT - cAmount;

        vm.prank(arbiter);
        vm.expectEmit(true, false, false, true, address(bill));
        emit CargoBill.DisputeResolved(id, cBps, cAmount, sAmount);
        bill.resolveDispute(id, cBps);
    }

    function test_ResolveDispute_RevertsNotArbiter() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not arbiter"));
        bill.resolveDispute(id, 5_000);
    }

    function test_ResolveDispute_RevertsInvalidBps() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        vm.prank(arbiter);
        vm.expectRevert(bytes("CargoBill: invalid bps"));
        bill.resolveDispute(id, 10_001);
    }

    function test_ResolveDispute_RevertsBadStatus_NotDisputed() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.prank(arbiter);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.resolveDispute(id, 5_000);
    }

    function test_EscalateTimeout_HappyPath() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        // Warp 14 days after dispute opened
        vm.warp(block.timestamp + ESCALATE_DELAY);

        uint256 carrierBefore = usdc.balanceOf(carrier);
        uint256 shipperBefore = usdc.balanceOf(shipper);

        // Anyone can call
        vm.prank(stranger);
        vm.expectEmit(true, false, false, true, address(bill));
        emit CargoBill.DisputeResolved(id, 5000, AMOUNT / 2, AMOUNT - (AMOUNT / 2));
        vm.expectEmit(true, false, false, true, address(bill));
        emit CargoBill.DisputeTimeoutResolved(id, AMOUNT / 2, AMOUNT - (AMOUNT / 2));
        bill.escalateTimeout(id);

        assertEq(usdc.balanceOf(carrier) - carrierBefore, AMOUNT / 2, "carrier 50%");
        assertEq(usdc.balanceOf(shipper) - shipperBefore, AMOUNT - (AMOUNT / 2), "shipper 50%");
        assertEq(usdc.balanceOf(address(bill)), 0, "contract drained");

        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Resolved));
    }

    function test_EscalateTimeout_RevertsBeforeTimeout() public {
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        vm.warp(block.timestamp + ESCALATE_DELAY - 1);

        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: dispute timeout not reached"));
        bill.escalateTimeout(id);
    }

    function test_EscalateTimeout_RevertsBadStatus_NotDisputed() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.warp(block.timestamp + ESCALATE_DELAY);

        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.escalateTimeout(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 10 – cancel
    // ═════════════════════════════════════════════════════════════════════════

    function test_Cancel_RevertsBeforePickupDeadline() public {
        uint256 id = _createShipment();

        // Warp before pickupDeadline
        vm.warp(block.timestamp + PICKUP_OFFSET - 1);

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: pickup deadline not passed"));
        bill.cancel(id);
    }

    function test_Cancel_HappyPath_AtOrAfterPickupDeadline() public {
        uint256 id = _createShipment();

        // Warp to pickupDeadline
        vm.warp(block.timestamp + PICKUP_OFFSET);

        uint256 beforeBal = usdc.balanceOf(shipper);

        vm.prank(shipper);
        vm.expectEmit(true, false, false, false, address(bill));
        emit CargoBill.ShipmentCancelled(id);
        bill.cancel(id);

        assertEq(usdc.balanceOf(shipper) - beforeBal, AMOUNT, "shipper refunded");
        assertEq(usdc.balanceOf(address(bill)), 0, "contract drained");

        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Cancelled));

        // CRITICAL: verify carrier late reputation is NOT incremented
        (, , uint256 late) = bill.reputation(carrier);
        assertEq(late, 0, "no late increment on cancel");
    }

    function test_Cancel_PastPickupDeadline_NoCarrierLate() public {
        uint256 id = _createShipment();

        // Warp well past pickupDeadline
        vm.warp(block.timestamp + PICKUP_OFFSET + 10 days);

        vm.prank(shipper);
        bill.cancel(id);

        (, , uint256 late) = bill.reputation(carrier);
        assertEq(late, 0, "carrier late count remains 0");
    }

    function test_Cancel_RevertsNotShipper() public {
        uint256 id = _createShipment();
        vm.warp(block.timestamp + PICKUP_OFFSET);

        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not shipper"));
        bill.cancel(id);
    }

    function test_Cancel_RevertsBadStatus_NotCreated() public {
        uint256 id = _createShipment();
        _pickUp(id);

        vm.warp(block.timestamp + PICKUP_OFFSET + 1);

        vm.prank(shipper);
        vm.expectRevert(bytes("CargoBill: bad status"));
        bill.cancel(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 11 – Two-Step Arbiter Transfer
    // ═════════════════════════════════════════════════════════════════════════

    address internal newArbiter = makeAddr("newArbiter");

    function test_TwoStepArbiterTransfer_HappyPath() public {
        vm.prank(arbiter);
        vm.expectEmit(true, true, false, false, address(bill));
        emit CargoBill.ArbiterTransferStarted(arbiter, newArbiter);
        bill.transferArbiter(newArbiter);

        assertEq(bill.arbiter(), arbiter, "arbiter still old");
        assertEq(bill.pendingArbiter(), newArbiter, "pendingArbiter set");

        vm.prank(newArbiter);
        vm.expectEmit(true, true, false, false, address(bill));
        emit CargoBill.ArbiterChanged(arbiter, newArbiter);
        bill.acceptArbiter();

        assertEq(bill.arbiter(), newArbiter, "arbiter now new");
        assertEq(bill.pendingArbiter(), address(0), "pendingArbiter reset");
    }

    function test_TransferArbiter_RevertsNotArbiter() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not arbiter"));
        bill.transferArbiter(newArbiter);
    }

    function test_TransferArbiter_RevertsZeroAddress() public {
        vm.prank(arbiter);
        vm.expectRevert(bytes("CargoBill: zero arbiter"));
        bill.transferArbiter(address(0));
    }

    function test_AcceptArbiter_RevertsNotPendingArbiter() public {
        vm.prank(arbiter);
        bill.transferArbiter(newArbiter);

        vm.prank(stranger);
        vm.expectRevert(bytes("CargoBill: not pending arbiter"));
        bill.acceptArbiter();

        vm.prank(arbiter);
        vm.expectRevert(bytes("CargoBill: not pending arbiter"));
        bill.acceptArbiter();
    }

    function test_OldArbiterCannotActAfterTransfer() public {
        vm.prank(arbiter);
        bill.transferArbiter(newArbiter);
        vm.prank(newArbiter);
        bill.acceptArbiter();

        // Old arbiter cannot call transferArbiter
        vm.prank(arbiter);
        vm.expectRevert(bytes("CargoBill: not arbiter"));
        bill.transferArbiter(stranger);

        // Old arbiter cannot resolve disputes
        uint256 id = _createShipment();
        _pickUp(id);
        _openDispute(id);

        vm.prank(arbiter);
        vm.expectRevert(bytes("CargoBill: not arbiter"));
        bill.resolveDispute(id, 5000);

        // New arbiter CAN resolve disputes
        vm.prank(newArbiter);
        bill.resolveDispute(id, 5000);
        (, , , , , , , CargoBill.ShipmentStatus status, , , ,) = bill.shipments(id);
        assertEq(uint8(status), uint8(CargoBill.ShipmentStatus.Resolved));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Section 12 – Fuzz: fee arithmetic (fee + net == amount for any amount > 0)
    // ═════════════════════════════════════════════════════════════════════════

    function testFuzz_FeeArithmetic_SumEqualsAmount(uint256 amount) public {
        amount = bound(amount, 1, 1e18);

        usdc.mint(shipper, amount);

        uint256 pickupDeadline = block.timestamp + PICKUP_OFFSET;
        uint256 deliveryDeadline = block.timestamp + DELIVERY_OFFSET;
        vm.prank(shipper);
        uint256 id = bill.createShipment(carrier, amount, pickupDeadline, deliveryDeadline, "fuzz");

        _pickUp(id);
        _deliver(id);

        uint256 carrierBefore  = usdc.balanceOf(carrier);
        uint256 feeRecipBefore = usdc.balanceOf(feeRecip);

        vm.prank(shipper);
        bill.confirmDelivery(id);

        uint256 paidToCarrier = usdc.balanceOf(carrier)  - carrierBefore;
        uint256 paidToFee     = usdc.balanceOf(feeRecip) - feeRecipBefore;

        assertEq(paidToCarrier + paidToFee, amount, "fee + net != amount");

        uint256 expectedFee = (amount * FEE_BPS) / 10_000;
        assertEq(paidToFee,     expectedFee,          "fee mismatch");
        assertEq(paidToCarrier, amount - expectedFee, "net mismatch");
    }

    function testFuzz_AutoRelease_FeeArithmetic(uint256 amount) public {
        amount = bound(amount, 1, 1e18);

        usdc.mint(shipper, amount);

        uint256 pickupDeadline = block.timestamp + PICKUP_OFFSET;
        uint256 deliveryDeadline = block.timestamp + DELIVERY_OFFSET;
        vm.prank(shipper);
        uint256 id = bill.createShipment(carrier, amount, pickupDeadline, deliveryDeadline, "fuzz-auto");

        _pickUp(id);
        _deliver(id);
        vm.warp(block.timestamp + AUTO_RELEASE_DELAY);

        uint256 carrierBefore  = usdc.balanceOf(carrier);
        uint256 feeRecipBefore = usdc.balanceOf(feeRecip);

        bill.autoRelease(id);

        uint256 paidToCarrier = usdc.balanceOf(carrier)  - carrierBefore;
        uint256 paidToFee     = usdc.balanceOf(feeRecip) - feeRecipBefore;

        assertEq(paidToCarrier + paidToFee, amount, "fee + net != amount (autoRelease)");

        uint256 expectedFee = (amount * FEE_BPS) / 10_000;
        assertEq(paidToFee,     expectedFee,          "fee mismatch (autoRelease)");
        assertEq(paidToCarrier, amount - expectedFee, "net mismatch (autoRelease)");
    }

    function testFuzz_ResolveDispute_SplitSumsToAmount(uint256 amount, uint256 cBps) public {
        amount = bound(amount, 1, 1e18);
        cBps   = bound(cBps,   0, 10_000);

        usdc.mint(shipper, amount);

        uint256 pickupDeadline = block.timestamp + PICKUP_OFFSET;
        uint256 deliveryDeadline = block.timestamp + DELIVERY_OFFSET;
        vm.prank(shipper);
        uint256 id = bill.createShipment(carrier, amount, pickupDeadline, deliveryDeadline, "fuzz-resolve");

        _pickUp(id);
        _openDispute(id);

        uint256 carrierBefore = usdc.balanceOf(carrier);
        uint256 shipperBefore = usdc.balanceOf(shipper);

        vm.prank(arbiter);
        bill.resolveDispute(id, cBps);

        uint256 paidToCarrier = usdc.balanceOf(carrier) - carrierBefore;
        uint256 paidToShipper = usdc.balanceOf(shipper) - shipperBefore;

        assertEq(paidToCarrier + paidToShipper, amount, "carrier + shipper != amount");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 13 – Invariant: contract USDC balance == sum of escrowed shipments
// ─────────────────────────────────────────────────────────────────────────────

contract CargoBillHandler is Test {
    CargoBill  internal bill;
    MockERC20  internal usdc;

    address internal shipper  = makeAddr("inv-shipper");
    address internal carrier  = makeAddr("inv-carrier");
    address internal arbiter;
    address internal feeRecip;

    uint256[] internal openIds;

    constructor(CargoBill _bill, MockERC20 _usdc, address _arbiter, address _feeRecip) {
        bill     = _bill;
        usdc     = _usdc;
        arbiter  = _arbiter;
        feeRecip = _feeRecip;

        usdc.mint(shipper, 1_000_000e6);
        vm.prank(shipper);
        usdc.approve(address(bill), type(uint256).max);
    }

    function createShipment(uint256 amount) external {
        amount = bound(amount, 1, 10_000e6);
        uint256 pickupDeadline = block.timestamp + 2 days;
        uint256 deliveryDeadline = block.timestamp + 7 days;
        vm.prank(shipper);
        uint256 id = bill.createShipment(carrier, amount, pickupDeadline, deliveryDeadline, "inv");
        openIds.push(id);
    }

    function pickUp(uint256 seed) external {
        if (openIds.length == 0) return;
        uint256 idx = seed % openIds.length;
        uint256 id  = openIds[idx];
        (, , , , uint256 pickupDeadline, , , CargoBill.ShipmentStatus st, , , ,) = bill.shipments(id);
        if (st != CargoBill.ShipmentStatus.Created) return;
        if (block.timestamp > pickupDeadline) return;
        vm.prank(carrier);
        bill.markPickedUp(id);
    }

    function deliver(uint256 seed) external {
        if (openIds.length == 0) return;
        uint256 idx = seed % openIds.length;
        uint256 id  = openIds[idx];
        (, , , , , , , CargoBill.ShipmentStatus st, , , ,) = bill.shipments(id);
        if (st != CargoBill.ShipmentStatus.PickedUp) return;
        vm.prank(carrier);
        bill.markDelivered(id);
    }

    function confirmDelivery(uint256 seed) external {
        if (openIds.length == 0) return;
        uint256 idx = seed % openIds.length;
        uint256 id  = openIds[idx];
        (, , , , , , , CargoBill.ShipmentStatus st, , , ,) = bill.shipments(id);
        if (st != CargoBill.ShipmentStatus.Delivered) return;
        vm.prank(shipper);
        bill.confirmDelivery(id);
        _removeId(idx);
    }

    function autoRelease(uint256 seed) external {
        if (openIds.length == 0) return;
        uint256 idx = seed % openIds.length;
        uint256 id  = openIds[idx];
        (, , , , , , , CargoBill.ShipmentStatus st, , uint256 deliveredAt, ,) = bill.shipments(id);
        if (st != CargoBill.ShipmentStatus.Delivered) return;
        if (block.timestamp < deliveredAt + bill.AUTO_RELEASE_DELAY()) return;
        bill.autoRelease(id);
        _removeId(idx);
    }

    function cancel(uint256 seed) external {
        if (openIds.length == 0) return;
        uint256 idx = seed % openIds.length;
        uint256 id  = openIds[idx];
        (, , , , uint256 pickupDeadline, , , CargoBill.ShipmentStatus st, , , ,) = bill.shipments(id);
        if (st != CargoBill.ShipmentStatus.Created) return;
        if (block.timestamp < pickupDeadline) return;
        vm.prank(shipper);
        bill.cancel(id);
        _removeId(idx);
    }

    function _removeId(uint256 idx) internal {
        openIds[idx] = openIds[openIds.length - 1];
        openIds.pop();
    }

    function sumEscrowed() external view returns (uint256 total) {
        for (uint256 i = 0; i < openIds.length; i++) {
            (, , , uint256 amount, , , , , , , ,) = bill.shipments(openIds[i]);
            total += amount;
        }
    }
}

contract CargoBillInvariantTest is Test {
    CargoBill        internal bill;
    MockERC20        internal usdc;
    CargoBillHandler internal handler;

    address internal arbiter  = makeAddr("inv-arbiter");
    address internal feeRecip = makeAddr("inv-feeRecip");

    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        bill    = new CargoBill(address(usdc), feeRecip, arbiter);
        handler = new CargoBillHandler(bill, usdc, arbiter, feeRecip);

        targetContract(address(handler));
    }

    function invariant_ContractBalanceEqualsEscrow() public view {
        assertEq(
            usdc.balanceOf(address(bill)),
            handler.sumEscrowed(),
            "contract balance != sum of open escrow"
        );
    }
}
