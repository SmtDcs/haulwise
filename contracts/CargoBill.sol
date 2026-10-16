// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract CargoBill is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PROTOCOL_FEE_BPS = 50;
    uint256 public constant AUTO_RELEASE_DELAY = 48 hours;
    uint256 public constant REFUND_UNDELIVERED_DELAY = 7 days;
    uint256 public constant ESCALATE_TIMEOUT_DELAY = 14 days;

    address public immutable usdc;
    address public immutable feeRecipient;
    address public arbiter;
    address public pendingArbiter;
    uint256 public shipmentCount;

    enum ShipmentStatus {
        Created,
        PickedUp,
        Delivered,
        Released,
        Disputed,
        Cancelled,
        Resolved,
        Refunded
    }

    struct Shipment {
        uint256 id;
        address shipper;
        address carrier;
        uint256 amount;
        uint256 pickupDeadline;
        uint256 deliveryDeadline;
        string metadataURI;
        ShipmentStatus status;
        uint256 pickedUpAt;
        uint256 deliveredAt;
        string disputeReason;
        uint256 disputedAt;
    }

    struct Reputation {
        uint256 completed;
        uint256 disputed;
        uint256 late;
    }

    mapping(uint256 => Shipment) public shipments;
    mapping(address => Reputation) public reputation;
    mapping(address => uint256) public shipperDisputesLost;

    event ShipmentCreated(
        uint256 indexed id,
        address indexed shipper,
        address indexed carrier,
        uint256 amount,
        uint256 pickupDeadline,
        uint256 deliveryDeadline,
        string metadataURI
    );
    event PickedUp(uint256 indexed id, uint256 timestamp);
    event MarkedDelivered(uint256 indexed id, uint256 timestamp);
    event DeliveryConfirmed(uint256 indexed id);
    event FundsReleased(uint256 indexed id, address indexed carrier, uint256 net, uint256 fee);
    event AutoReleased(uint256 indexed id, address indexed caller);
    event DisputeOpened(uint256 indexed id, address indexed opener, string reason);
    event DisputeResolved(uint256 indexed id, uint256 carrierBps, uint256 carrierAmount, uint256 shipperAmount);
    event DisputeTimeoutResolved(uint256 indexed id, uint256 carrierAmount, uint256 shipperAmount);
    event ShipmentCancelled(uint256 indexed id);
    event ShipmentRefunded(uint256 indexed id);
    event ArbiterTransferStarted(address indexed currentArbiter, address indexed pendingArbiter);
    event ArbiterChanged(address indexed oldArbiter, address indexed newArbiter);

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "CargoBill: not arbiter");
        _;
    }

    constructor(address _usdc, address _feeRecipient, address _arbiter) {
        require(_usdc != address(0), "CargoBill: zero usdc");
        require(_feeRecipient != address(0), "CargoBill: zero fee recipient");
        require(_arbiter != address(0), "CargoBill: zero arbiter");

        usdc = _usdc;
        feeRecipient = _feeRecipient;
        arbiter = _arbiter;
    }

    function createShipment(
        address carrier,
        uint256 amountUSDC,
        uint256 pickupDeadline,
        uint256 deliveryDeadline,
        string calldata metadataURI
    ) public nonReentrant returns (uint256 id) {
        require(carrier != address(0), "CargoBill: zero carrier");
        require(carrier != msg.sender, "CargoBill: carrier cannot be shipper");
        require(amountUSDC > 0, "CargoBill: zero amount");
        require(pickupDeadline > block.timestamp, "CargoBill: bad pickup deadline");
        require(deliveryDeadline > pickupDeadline, "CargoBill: bad delivery deadline");
        require(bytes(metadataURI).length <= 256, "CargoBill: metadataURI too long");

        id = ++shipmentCount;

        shipments[id] = Shipment({
            id: id,
            shipper: msg.sender,
            carrier: carrier,
            amount: amountUSDC,
            pickupDeadline: pickupDeadline,
            deliveryDeadline: deliveryDeadline,
            metadataURI: metadataURI,
            status: ShipmentStatus.Created,
            pickedUpAt: 0,
            deliveredAt: 0,
            disputeReason: "",
            disputedAt: 0
        });

        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amountUSDC);

        emit ShipmentCreated(
            id,
            msg.sender,
            carrier,
            amountUSDC,
            pickupDeadline,
            deliveryDeadline,
            metadataURI
        );
    }

    function markPickedUp(uint256 id) external {
        Shipment storage s = shipments[id];

        require(msg.sender == s.carrier, "CargoBill: not carrier");
        require(s.status == ShipmentStatus.Created, "CargoBill: bad status");
        require(block.timestamp <= s.pickupDeadline, "CargoBill: pickup deadline passed");

        s.status = ShipmentStatus.PickedUp;
        s.pickedUpAt = block.timestamp;

        emit PickedUp(id, block.timestamp);
    }

    function markDelivered(uint256 id) external {
        Shipment storage s = shipments[id];

        require(msg.sender == s.carrier, "CargoBill: not carrier");
        require(s.status == ShipmentStatus.PickedUp, "CargoBill: bad status");

        s.status = ShipmentStatus.Delivered;
        s.deliveredAt = block.timestamp;

        emit MarkedDelivered(id, block.timestamp);
    }

    function confirmDelivery(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(msg.sender == s.shipper, "CargoBill: not shipper");
        require(s.status == ShipmentStatus.Delivered, "CargoBill: bad status");

        uint256 fee = (s.amount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 net = s.amount - fee;

        s.status = ShipmentStatus.Released;
        reputation[s.carrier].completed++;
        if (s.deliveredAt > s.deliveryDeadline) {
            reputation[s.carrier].late++;
        }

        IERC20(usdc).safeTransfer(feeRecipient, fee);
        IERC20(usdc).safeTransfer(s.carrier, net);

        emit DeliveryConfirmed(id);
        emit FundsReleased(id, s.carrier, net, fee);

        _afterSettle(id, true);
    }

    function autoRelease(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(s.status == ShipmentStatus.Delivered, "CargoBill: bad status");
        require(block.timestamp >= s.deliveredAt + AUTO_RELEASE_DELAY, "CargoBill: delay not met");

        uint256 fee = (s.amount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 net = s.amount - fee;

        s.status = ShipmentStatus.Released;
        reputation[s.carrier].completed++;
        if (s.deliveredAt > s.deliveryDeadline) {
            reputation[s.carrier].late++;
        }

        IERC20(usdc).safeTransfer(feeRecipient, fee);
        IERC20(usdc).safeTransfer(s.carrier, net);

        emit AutoReleased(id, msg.sender);
        emit FundsReleased(id, s.carrier, net, fee);

        _afterSettle(id, true);
    }

    function refundUndelivered(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(msg.sender == s.shipper, "CargoBill: not shipper");
        require(s.status == ShipmentStatus.PickedUp, "CargoBill: bad status");
        require(
            block.timestamp > s.deliveryDeadline + REFUND_UNDELIVERED_DELAY,
            "CargoBill: delivery grace period not passed"
        );

        s.status = ShipmentStatus.Refunded;
        reputation[s.carrier].late++;

        IERC20(usdc).safeTransfer(s.shipper, s.amount);

        emit ShipmentRefunded(id);

        _afterSettle(id, false);
    }

    function openDispute(uint256 id, string calldata reason) external {
        Shipment storage s = shipments[id];

        require(msg.sender == s.shipper || msg.sender == s.carrier, "CargoBill: not participant");
        require(
            s.status == ShipmentStatus.PickedUp || s.status == ShipmentStatus.Delivered,
            "CargoBill: bad status"
        );
        require(bytes(reason).length <= 256, "CargoBill: dispute reason too long");

        s.status = ShipmentStatus.Disputed;
        s.disputeReason = reason;
        s.disputedAt = block.timestamp;

        emit DisputeOpened(id, msg.sender, reason);
    }

    function resolveDispute(uint256 id, uint256 carrierBps) external nonReentrant onlyArbiter {
        Shipment storage s = shipments[id];

        require(s.status == ShipmentStatus.Disputed, "CargoBill: bad status");
        require(carrierBps <= 10_000, "CargoBill: invalid bps");

        uint256 carrierAmount = (s.amount * carrierBps) / 10_000;
        uint256 shipperAmount = s.amount - carrierAmount;

        s.status = ShipmentStatus.Resolved;
        if (carrierBps < 5000) {
            reputation[s.carrier].disputed++;
        }
        if (carrierBps >= 5000) {
            shipperDisputesLost[s.shipper]++;
        }

        if (carrierAmount > 0) {
            IERC20(usdc).safeTransfer(s.carrier, carrierAmount);
        }
        if (shipperAmount > 0) {
            IERC20(usdc).safeTransfer(s.shipper, shipperAmount);
        }

        emit DisputeResolved(id, carrierBps, carrierAmount, shipperAmount);

        _afterSettle(id, false);
    }

    function escalateTimeout(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(s.status == ShipmentStatus.Disputed, "CargoBill: bad status");
        require(
            block.timestamp >= s.disputedAt + ESCALATE_TIMEOUT_DELAY,
            "CargoBill: dispute timeout not reached"
        );

        uint256 carrierAmount = (s.amount * 5000) / 10_000;
        uint256 shipperAmount = s.amount - carrierAmount;

        s.status = ShipmentStatus.Resolved;

        if (carrierAmount > 0) {
            IERC20(usdc).safeTransfer(s.carrier, carrierAmount);
        }
        if (shipperAmount > 0) {
            IERC20(usdc).safeTransfer(s.shipper, shipperAmount);
        }

        emit DisputeResolved(id, 5000, carrierAmount, shipperAmount);
        emit DisputeTimeoutResolved(id, carrierAmount, shipperAmount);

        _afterSettle(id, false);
    }

    function cancel(uint256 id) external nonReentrant {
        Shipment storage s = shipments[id];

        require(msg.sender == s.shipper, "CargoBill: not shipper");
        require(s.status == ShipmentStatus.Created, "CargoBill: bad status");
        require(block.timestamp >= s.pickupDeadline, "CargoBill: pickup deadline not passed");

        s.status = ShipmentStatus.Cancelled;

        IERC20(usdc).safeTransfer(s.shipper, s.amount);

        emit ShipmentCancelled(id);

        _afterSettle(id, false);
    }

    function transferArbiter(address newArbiter) external onlyArbiter {
        require(newArbiter != address(0), "CargoBill: zero arbiter");
        pendingArbiter = newArbiter;

        emit ArbiterTransferStarted(arbiter, newArbiter);
    }

    function acceptArbiter() external {
        require(msg.sender == pendingArbiter, "CargoBill: not pending arbiter");

        address oldArbiter = arbiter;
        arbiter = pendingArbiter;
        pendingArbiter = address(0);

        emit ArbiterChanged(oldArbiter, arbiter);
    }

    function getShipperDisputesLost(address shipper) external view returns (uint256) {
        return shipperDisputesLost[shipper];
    }

    /// @dev Called once when a shipment reaches a final state. `released` is true only when the
    /// carrier was paid in full after delivery (confirmDelivery / autoRelease). No-op in the base.
    function _afterSettle(uint256 id, bool released) internal virtual {}
}
